export async function registerWalkInToken(name, phone = null) {
  const cleanPhone = phone ? phone.replace(/\D/g, '') : null;

  // 1. Issue next sequential token
  const newToken = await redisCommand(['INCR', 'queue:token_counter']);
  const timeSlot = getTokenTime(Number(newToken));

  // 2. Map phone if provided
  if (cleanPhone) {
    await redisCommand(['SET', `user:${cleanPhone}`, newToken, 'EX', '86400']);
  }

  // 3. Store record in waiting list
  const userRecord = JSON.stringify({
    token: newToken,
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
}