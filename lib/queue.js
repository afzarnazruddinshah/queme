import { redisCommand } from './redis.js';
import { sendWhatsAppText, sendWhatsAppButtons } from './whatsapp.js';

export const CLINIC_CONFIG = {
  startHour: 10,
  startMinute: 0,
  closeHour: 22,    // 9:00 PM
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

export async function registerUserToken(from, name) {
  try {
    const existingToken = await redisCommand(['GET', `user:${from}`]);
    const currentServing = Number(await redisCommand(['GET', 'queue:currently_serving'])) || 0;

    // 1. Existing Token Holder Check
    if (existingToken) {
      const ahead = Math.max(0, Number(existingToken) - currentServing);
      const tokenSlot = getTokenTime(Number(existingToken));
      const reminderMsg = `Hi! You already hold Token *#${existingToken}*.\n⏰ Estimated Slot: *${tokenSlot}*\nCurrently serving: *#${currentServing}*.\nPeople ahead: *${ahead}*.`;

      await sendWhatsAppButtons(from, reminderMsg, [
        { id: 'btn_status', title: '📊 Status' },
        { id: 'btn_cancel', title: '❌ Cancel Token' },
      ]);
      return;
    }

    // 2. Closure Check A: Have operating hours already passed?
    if (isClinicPastClosing()) {
      await sendWhatsAppText(
        from,
        `🌙 *Clinic Closed for Today*\n\nOur consultation hours are from 10:00 AM to 10:00 PM. Token registrations reopen tomorrow morning.`
      );
      return;
    }

    // 3. Closure Check B: Has daily token capacity been reached?
    const maxTokens = getMaxTokens();
    const currentCounter = Number(await redisCommand(['GET', 'queue:token_counter'])) || 0;

    if (currentCounter >= maxTokens) {
      const lastSlot = getTokenTime(maxTokens);
      await sendWhatsAppText(
        from,
        `⚠️ *All Tokens Booked for Today*\n\nAll available slots have been fully booked (Last slot was Token *#${maxTokens}* at *${lastSlot}*).\n\nPlease check back tomorrow morning.`
      );
      return;
    }

    // 4. Issue next sequential token
    const newToken = await redisCommand(['INCR', 'queue:token_counter']);
    const timeSlot = getTokenTime(Number(newToken));

    // 5. Map phone to token (expires in 24 hrs)
    await redisCommand(['SET', `user:${from}`, String(newToken), 'EX', '86400']);

    // 6. Store record in waiting list
    const userRecord = JSON.stringify({
      token: Number(newToken),
      name: name || 'Guest',
      phone: from,
      timeSlot,
      status: 'ACTIVE',
      isWalkIn: false,
      timestamp: Date.now(),
    });
    await redisCommand(['RPUSH', 'queue:waiting_list', userRecord]);

    // 7. Calculate people ahead
    const peopleAhead = Math.max(0, Number(newToken) - currentServing - 1);
    const userMsg = `Hi *${name}*!\n\nYour Token Number is: *#${newToken}*\n⏰ Estimated Slot: *${timeSlot}*\nCurrently Serving: *#${currentServing || 1}*\nPeople ahead of you: *${peopleAhead}*`;

    // 8. Send confirmation to user
    await sendWhatsAppButtons(from, userMsg, [
      { id: 'btn_status', title: '📊 Status' },
      { id: 'btn_cancel', title: '❌ Cancel Token' },
    ]);

    // 9. Notify Admin
    const adminPhone = (process.env.ADMIN_PHONE || '').replace(/\D/g, '');
    if (adminPhone && adminPhone !== from) {
      const alert = `🔔 *New Queue Entry*\n• Name: *${name}*\n• Phone: +${from}\n• Assigned Token: *#${newToken}*\n• Slot: *${timeSlot}*`;
      await sendWhatsAppText(adminPhone, alert);
    }
  } catch (err) {
    console.error('Error in registerUserToken:', err);
  }
}

export async function cancelUserToken(from) {
  try {
    const existingToken = await redisCommand(['GET', `user:${from}`]);
    const adminPhone = (process.env.ADMIN_PHONE || '').replace(/\D/g, '');

    if (!existingToken) {
      await sendWhatsAppText(from, 'You do not have an active token to cancel.');
      return;
    }

    const tokenNum = Number(existingToken);

    // 1. Remove mapping
    await redisCommand(['DEL', `user:${from}`]);

    // 2. Mark item as CANCELLED in queue:waiting_list
    const list = (await redisCommand(['LRANGE', 'queue:waiting_list', '0', '-1'])) || [];
    let cancelledUserName = 'User';

    for (let i = 0; i < list.length; i++) {
      try {
        const record = JSON.parse(list[i]);
        if (Number(record.token) === tokenNum) {
          cancelledUserName = record.name;
          record.status = 'CANCELLED';
          await redisCommand(['LSET', 'queue:waiting_list', i, JSON.stringify(record)]);
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

export async function registerWalkInToken(name, phone = null) {
  try {
    const cleanPhone = phone ? phone.replace(/\D/g, '') : null;

    // Issue next sequential token (Admin can always override)
    const newToken = await redisCommand(['INCR', 'queue:token_counter']);
    const timeSlot = getTokenTime(Number(newToken));
    const maxTokens = getMaxTokens();
    const isOverCapacity = Number(newToken) > maxTokens;

    if (cleanPhone) {
      await redisCommand(['SET', `user:${cleanPhone}`, String(newToken), 'EX', '86400']);
    }

    const userRecord = JSON.stringify({
      token: Number(newToken),
      name,
      phone: cleanPhone || 'WALK_IN',
      timeSlot,
      status: 'ACTIVE',
      isWalkIn: true,
      timestamp: Date.now(),
    });
    await redisCommand(['RPUSH', 'queue:waiting_list', userRecord]);

    if (cleanPhone) {
      const currentServing = Number(await redisCommand(['GET', 'queue:currently_serving'])) || 0;
      const peopleAhead = Math.max(0, Number(newToken) - currentServing - 1);
      const userMsg = `Hi *${name}*!\n\nYou have been added to the queue at the counter.\n\nYour Token Number is: *#${newToken}*\n⏰ Estimated Slot: *${timeSlot}*\nCurrently Serving: *#${currentServing || 1}*\nPeople ahead of you: *${peopleAhead}*`;

      await sendWhatsAppButtons(cleanPhone, userMsg, [
        { id: 'btn_status', title: '📊 Status' },
        { id: 'btn_cancel', title: '❌ Cancel Token' },
      ]);
    }

    return { token: newToken, timeSlot, isOverCapacity, maxTokens };
  } catch (err) {
    console.error('Error in registerWalkInToken:', err);
    return { token: '?', timeSlot: '10:00 AM', isOverCapacity: false, maxTokens: 44 };
  }
}
