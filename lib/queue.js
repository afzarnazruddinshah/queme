import { redisCommand } from './redis.js';
import { sendWhatsAppText, sendWhatsAppButtons } from './whatsapp.js';

export const CLINIC_CONFIG = {
  startHour: 10,
  startMinute: 0,
  closeHour: 22,    // 10:00 PM
  closeMinute: 0,
  slotDurationMinutes: 15,
};

export function getMaxTokens() {
  const startTotalMinutes = CLINIC_CONFIG.startHour * 60 + CLINIC_CONFIG.startMinute;
  const closeTotalMinutes = CLINIC_CONFIG.closeHour * 60 + CLINIC_CONFIG.closeMinute;
  return Math.floor((closeTotalMinutes - startTotalMinutes) / CLINIC_CONFIG.slotDurationMinutes);
}

export function getTokenTime(tokenNumber) {
  const totalMinutes =
    CLINIC_CONFIG.startHour * 60 +
    CLINIC_CONFIG.startMinute +
    (Number(tokenNumber) - 1) * CLINIC_CONFIG.slotDurationMinutes;

  const hours24 = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;

  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const formattedMinutes = String(minutes).padStart(2, '0');

  return `${hours12}:${formattedMinutes} ${period}`;
}

export function isClinicPastClosing() {
  // IST Time (UTC + 5:30)
  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istMinutes = (utcMinutes + 330) % 1440;

  const closeMinutes = CLINIC_CONFIG.closeHour * 60 + CLINIC_CONFIG.closeMinute;
  return istMinutes >= closeMinutes;
}

// Helper to extract clean token number from JSON payload or raw string
function parseServingTokenNumber(rawServing) {
  if (!rawServing) return 0;
  if (typeof rawServing === 'object') {
    return Number(String(rawServing.tokenNumber || rawServing.token || 0).replace(/\D/g, '')) || 0;
  }
  try {
    const parsed = JSON.parse(rawServing);
    return Number(String(parsed.tokenNumber || parsed.token || 0).replace(/\D/g, '')) || 0;
  } catch (_) {
    return Number(String(rawServing).replace(/\D/g, '')) || 0;
  }
}

// Helper to calculate total minutes from midnight for a given token number
function getTokenMinutesFromMidnight(tokenNumber) {
  return (
    CLINIC_CONFIG.startHour * 60 +
    CLINIC_CONFIG.startMinute +
    (Number(tokenNumber) - 1) * CLINIC_CONFIG.slotDurationMinutes
  );
}

// Find earliest reusable cancelled slot with at least 30 mins buffer
async function popEligibleCancelledSlot(tenantId) {
  const cancelledKey = `tenant:${tenantId}:cancelled_slots`;
  const rawList = (await redisCommand(['LRANGE', cancelledKey, '0', '-1'])) || [];
  if (rawList.length === 0) return null;

  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const currentIstMinutes = (utcMinutes + 330) % 1440;

  // Sort cancelled slots ascending by token number (earliest gap first)
  const sortedTokens = rawList
    .map((num) => Number(num))
    .filter((num) => !isNaN(num) && num > 0)
    .sort((a, b) => a - b);

  for (const tokenNum of sortedTokens) {
    const slotMinutes = getTokenMinutesFromMidnight(tokenNum);
    // Gap check: slot start time must be at least 30 minutes in the future
    if (slotMinutes - currentIstMinutes >= 30) {
      // Remove from cancelled list
      await redisCommand(['LREM', cancelledKey, '1', String(tokenNum)]);
      return tokenNum;
    }
  }

  return null;
}

// Helper to push a token and keep the queue sorted chronologically
async function insertQueueRecord(keyQueue, recordObj) {
  const list = (await redisCommand(['LRANGE', keyQueue, '0', '-1'])) || [];
  const records = [];

  for (const item of list) {
    try {
      records.push(JSON.parse(item));
    } catch (_) {}
  }

  // Add new or backfilled record
  records.push(recordObj);

  // Sort by token number
  records.sort((a, b) => {
    const aNum = Number(String(a.token || a.tokenNumber || 0).replace(/\D/g, ''));
    const bNum = Number(String(b.token || b.tokenNumber || 0).replace(/\D/g, ''));
    return aNum - bNum;
  });

  // Re-write queue list in sorted order
  await redisCommand(['DEL', keyQueue]);
  if (records.length > 0) {
    const payload = records.map((r) => JSON.stringify(r));
    await redisCommand(['RPUSH', keyQueue, ...payload]);
  }
}

export async function registerUserToken(from, name, tenantId = 'neefa') {
  try {
    const keyCounter = `tenant:${tenantId}:counter`;
    const keyQueue = `tenant:${tenantId}:queue`;
    const keyServing = `tenant:${tenantId}:now_serving`;
    const keyUser = `tenant:${tenantId}:user:${from}`;

    const existingToken = await redisCommand(['GET', keyUser]);
    const rawServing = await redisCommand(['GET', keyServing]);
    const currentServing = parseServingTokenNumber(rawServing);

    // 1. Existing Token Holder Check
    if (existingToken) {
      const ahead = Math.max(0, Number(existingToken) - currentServing);
      const tokenSlot = getTokenTime(Number(existingToken));
      const reminderMsg = `Hi! You already hold Token *#${existingToken}*.\n⏰ Estimated Slot: *${tokenSlot}*\nCurrently serving: *#${currentServing || 'Not started'}*.\nPeople ahead: *${ahead}*.`;

      await sendWhatsAppButtons(from, reminderMsg, [
        { id: 'btn_status', title: '📊 Status' },
        { id: 'btn_cancel', title: '❌ Cancel Token' },
      ]);
      return;
    }

    // 2. Closure Check: Have operating hours already passed?
    if (isClinicPastClosing()) {
      await sendWhatsAppText(
        from,
        `🌙 *Clinic Closed for Today*\n\nOur consultation hours are from 10:00 AM to 10:00 PM. Token registrations reopen tomorrow morning.`
      );
      return;
    }

    // 3. Check for eligible cancelled slot first (>= 30 mins buffer)
    let assignedToken = await popEligibleCancelledSlot(tenantId);
    let isReassignedSlot = false;

    if (assignedToken) {
      isReassignedSlot = true;
    } else {
      // 4. Fallback: Check capacity before creating new token
      const maxTokens = getMaxTokens();
      const currentCounter = Number(await redisCommand(['GET', keyCounter])) || 0;

      if (currentCounter >= maxTokens) {
        const lastSlot = getTokenTime(maxTokens);
        await sendWhatsAppText(
          from,
          `⚠️ *All Tokens Booked for Today*\n\nAll available slots have been fully booked (Last slot was Token *#${maxTokens}* at *${lastSlot}*).\n\nPlease check back tomorrow morning.`
        );
        return;
      }

      assignedToken = await redisCommand(['INCR', keyCounter]);
    }

    const timeSlot = getTokenTime(Number(assignedToken));

    // 5. Map phone to token (expires in 24 hrs)
    await redisCommand(['SET', keyUser, String(assignedToken), 'EX', '86400']);

    // 6. Store structured record matching both Desk UI and WhatsApp requirements
    const userRecord = {
      token: Number(assignedToken),
      tokenNumber: `A${String(assignedToken).padStart(3, '0')}`,
      name: name || 'Guest',
      patientName: name || 'Guest',
      phone: from,
      phoneNumber: from,
      timeSlot,
      status: 'waiting',
      source: 'whatsapp',
      isWalkIn: false,
      timestamp: Date.now(),
      createdAt: new Date().toISOString(),
    };

    await insertQueueRecord(keyQueue, userRecord);

    // 7. Calculate people ahead
    const peopleAhead = Math.max(0, Number(assignedToken) - currentServing - 1);
    
    let userMsg = `Hi *${name}*!\n\nYour Token Number is: *#${assignedToken}*\n⏰ Estimated Slot: *${timeSlot}*\nCurrently Serving: *#${currentServing || 1}*\nPeople ahead of you: *${peopleAhead}*`;

    if (isReassignedSlot) {
      userMsg = `Hi *${name}*!\n\n✨ *Priority Slot Assigned!*\nYou have been allotted an earlier cancelled slot: *#${assignedToken}*.\n⏰ Estimated Slot: *${timeSlot}*\nCurrently Serving: *#${currentServing || 1}*\nPeople ahead of you: *${peopleAhead}*`;
    }

    // 8. Send confirmation to user
    await sendWhatsAppButtons(from, userMsg, [
      { id: 'btn_status', title: '📊 Status' },
      { id: 'btn_cancel', title: '❌ Cancel Token' },
    ]);

    // 9. Notify Admin
    const adminPhone = (process.env.ADMIN_PHONE || '').replace(/\D/g, '');
    if (adminPhone && adminPhone !== from) {
      const alert = `🔔 *New Queue Entry*\n• Name: *${name}*\n• Phone: +${from}\n• Assigned Token: *#${assignedToken}*${isReassignedSlot ? ' (Reassigned Gap)' : ''}\n• Slot: *${timeSlot}*`;
      await sendWhatsAppText(adminPhone, alert);
    }
  } catch (err) {
    console.error('Error in registerUserToken:', err);
  }
}

export async function cancelUserToken(from, tenantId = 'neefa') {
  try {
    const keyQueue = `tenant:${tenantId}:queue`;
    const keyUser = `tenant:${tenantId}:user:${from}`;
    const cancelledKey = `tenant:${tenantId}:cancelled_slots`;

    const existingToken = await redisCommand(['GET', keyUser]);
    const adminPhone = (process.env.ADMIN_PHONE || '').replace(/\D/g, '');

    if (!existingToken) {
      await sendWhatsAppText(from, 'You do not have an active token to cancel.');
      return;
    }

    const tokenNum = Number(existingToken);

    // 1. Remove user lock
    await redisCommand(['DEL', keyUser]);

    // 2. Remove token from waiting queue list and track in cancelled_slots for gap backfilling
    const list = (await redisCommand(['LRANGE', keyQueue, '0', '-1'])) || [];
    let cancelledUserName = 'User';

    for (let i = 0; i < list.length; i++) {
      try {
        const record = JSON.parse(list[i]);
        const recordTokenNum = Number(record.token || String(record.tokenNumber).replace(/\D/g, ''));
        if (recordTokenNum === tokenNum) {
          cancelledUserName = record.name || record.patientName || 'User';
          // Remove from queue
          await redisCommand(['LREM', keyQueue, '1', list[i]]);
          // Add to cancelled slots for future backfill
          await redisCommand(['RPUSH', cancelledKey, String(tokenNum)]);
          break;
        }
      } catch (_) {}
    }

    // 3. Confirm to user
    await sendWhatsAppText(from, `✅ Your Token *#${tokenNum}* has been successfully cancelled.`);

    // 4. Alert Admin
    if (adminPhone && adminPhone !== from) {
      const alert = `⚠️ *Token Cancelled*\n• Token: *#${tokenNum}*\n• Name: *${cancelledUserName}*\n• Phone: +${from}`;
      await sendWhatsAppText(adminPhone, alert);
    }
  } catch (err) {
    console.error('Error in cancelUserToken:', err);
  }
}

export async function registerWalkInToken(name, phone = null, tenantId = 'neefa') {
  try {
    const keyCounter = `tenant:${tenantId}:counter`;
    const keyQueue = `tenant:${tenantId}:queue`;
    const keyServing = `tenant:${tenantId}:now_serving`;

    const cleanPhone = phone ? phone.replace(/\D/g, '') : null;

    // Check for eligible cancelled slot first (>= 30 mins)
    let assignedToken = await popEligibleCancelledSlot(tenantId);
    let isReassignedSlot = false;

    if (assignedToken) {
      isReassignedSlot = true;
    } else {
      assignedToken = await redisCommand(['INCR', keyCounter]);
    }

    const timeSlot = getTokenTime(Number(assignedToken));
    const maxTokens = getMaxTokens();
    const isOverCapacity = Number(assignedToken) > maxTokens;

    if (cleanPhone) {
      await redisCommand(['SET', `tenant:${tenantId}:user:${cleanPhone}`, String(assignedToken), 'EX', '86400']);
    }

    const userRecord = {
      token: Number(assignedToken),
      tokenNumber: `A${String(assignedToken).padStart(3, '0')}`,
      name,
      patientName: name,
      phone: cleanPhone || 'WALK_IN',
      phoneNumber: cleanPhone || '—',
      timeSlot,
      status: 'waiting',
      source: 'walk-in',
      isWalkIn: true,
      timestamp: Date.now(),
      createdAt: new Date().toISOString(),
    };

    await insertQueueRecord(keyQueue, userRecord);

    if (cleanPhone) {
      const rawServing = await redisCommand(['GET', keyServing]);
      const currentServing = parseServingTokenNumber(rawServing);
      const peopleAhead = Math.max(0, Number(assignedToken) - currentServing - 1);
      const userMsg = `Hi *${name}*!\n\nYou have been added to the queue at the counter.\n\nYour Token Number is: *#${assignedToken}*\n⏰ Estimated Slot: *${timeSlot}*\nCurrently Serving: *#${currentServing || 1}*\nPeople ahead of you: *${peopleAhead}*`;

      await sendWhatsAppButtons(cleanPhone, userMsg, [
        { id: 'btn_status', title: '📊 Status' },
        { id: 'btn_cancel', title: '❌ Cancel Token' },
      ]);
    }

    return { token: assignedToken, timeSlot, isOverCapacity, maxTokens, isReassignedSlot };
  } catch (err) {
    console.error('Error in registerWalkInToken:', err);
    return { token: '?', timeSlot: '10:00 AM', isOverCapacity: false, maxTokens: 44, isReassignedSlot: false };
  }
}

export async function adminCancelToken(identifier, tenantId = 'neefa') {
  const keyQueue = `tenant:${tenantId}:queue`;
  const cancelledKey = `tenant:${tenantId}:cancelled_slots`;
  const cleaned = identifier.replace(/\D/g, '');
  if (!cleaned) return { success: false, reason: 'Invalid input' };

  let tokenToCancel = null;
  let userPhone = null;

  // Case A: Input is a phone number (7 to 15 digits)
  if (cleaned.length >= 7) {
    const foundToken = await redisCommand(['GET', `tenant:${tenantId}:user:${cleaned}`]);
    if (!foundToken) {
      return { success: false, reason: `No active token found for phone +${cleaned}.` };
    }
    tokenToCancel = Number(foundToken);
    userPhone = cleaned;
  } 
  // Case B: Input is a Token Number (e.g., 3, 14)
  else {
    tokenToCancel = Number(cleaned);
  }

  // Find record in waiting list
  const list = (await redisCommand(['LRANGE', keyQueue, '0', '-1'])) || [];
  let targetRecord = null;
  let rawRecordString = null;

  for (let i = 0; i < list.length; i++) {
    try {
      const record = JSON.parse(list[i]);
      const recordTokenNum = Number(record.token || String(record.tokenNumber).replace(/\D/g, ''));
      if (recordTokenNum === tokenToCancel) {
        targetRecord = record;
        rawRecordString = list[i];
        if (!userPhone && record.phone && record.phone !== 'WALK_IN' && record.phone !== '—') {
          userPhone = record.phone;
        }
        break;
      }
    } catch (_) {}
  }

  if (!targetRecord) {
    return { success: false, reason: `Token #${tokenToCancel} does not exist in queue.` };
  }

  // 1. Remove from waiting list and record as cancelled slot for reuse
  await redisCommand(['LREM', keyQueue, '1', rawRecordString]);
  await redisCommand(['RPUSH', cancelledKey, String(tokenToCancel)]);

  // 2. Remove user phone mapping
  if (userPhone) {
    await redisCommand(['DEL', `tenant:${tenantId}:user:${userPhone}`]);
  }

  // 3. Notify user via WhatsApp (if registered via WhatsApp)
  if (userPhone && userPhone !== 'WALK_IN') {
    const alertMsg = `⚠️ *Token Notice*\n\nYour Token *#${tokenToCancel}* has been cancelled by the reception desk.`;
    await sendWhatsAppText(userPhone, alertMsg);
  }

  return {
    success: true,
    token: tokenToCancel,
    name: targetRecord.name || targetRecord.patientName,
    phone: userPhone,
  };
}
