import { redisCommand } from './redis.js';
import { sendWhatsAppText, sendWhatsAppButtons } from './whatsapp.js';

export function getTokenTime(tokenNumber) {
  const startHour = 10;
  const startMinute = 0;
  const slotDurationMinutes = 15;

  const totalMinutes = startHour * 60 + startMinute + (Number(tokenNumber) - 1) * slotDurationMinutes;
  const hours24 = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;

  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const formattedMinutes = String(minutes).padStart(2, '0');

  return `${hours12}:${formattedMinutes} ${period}`;
}

export async function registerUserToken(from, name) {
  try {
    const existingToken = await redisCommand(['GET', `user:${from}`]);
    const currentServing = Number(await redisCommand(['GET', 'queue:currently_serving'])) || 0;

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

    // 1. Issue new sequential token
    const newToken = await redisCommand(['INCR', 'queue:token_counter']);
    const timeSlot = getTokenTime(Number(newToken));

    // 2. Map phone to token (expires in 24 hrs)
    await redisCommand(['SET', `user:${from}`, String(newToken), 'EX', '86400']);

    // 3. Store record in waiting list
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

    // 4. Calculate people ahead
    const peopleAhead = Math.max(0, Number(newToken) - currentServing - 1);
    const userMsg = `Hi *${name}*!\n\nYour Token Number is: *#${newToken}*\n⏰ Estimated Slot: *${timeSlot}*\nCurrently Serving: *#${currentServing || 1}*\nPeople ahead of you: *${peopleAhead}*`;

    // 5. Send confirmation to user
    await sendWhatsAppButtons(from, userMsg, [
      { id: 'btn_status', title: '📊 Status' },
      { id: 'btn_cancel', title: '❌ Cancel Token' },
    ]);

    // 6. Notify Admin (wrapped in try/catch so admin errors never block user)
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

    // 1. Issue next sequential token
    const newToken = await redisCommand(['INCR', 'queue:token_counter']);
    const timeSlot = getTokenTime(Number(newToken));

    // 2. Map phone if provided
    if (cleanPhone) {
      await redisCommand(['SET', `user:${cleanPhone}`, String(newToken), 'EX', '86400']);
    }

    // 3. Store record in waiting list
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

    // 4. If phone is provided, send token confirmation to visitor
    if (cleanPhone) {
      const currentServing = Number(await redisCommand(['GET', 'queue:currently_serving'])) || 0;
      const peopleAhead = Math.max(0, Number(newToken) - currentServing - 1);
      const userMsg = `Hi *${name}*!\n\nYou have been added to the queue at the counter.\n\nYour Token Number is: *#${newToken}*\n⏰ Estimated Slot: *${timeSlot}*\nCurrently Serving: *#${currentServing || 1}*\nPeople ahead of you: *${peopleAhead}*`;

      await sendWhatsAppButtons(cleanPhone, userMsg, [
        { id: 'btn_status', title: '📊 Status' },
        { id: 'btn_cancel', title: '❌ Cancel Token' },
      ]);
    }

    return { token: newToken, timeSlot };
  } catch (err) {
    console.error('Error in registerWalkInToken:', err);
    return { token: '?', timeSlot: '10:00 AM' };
  }
}
