export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
  const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
  const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
  const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  const ADMIN_PHONE = (process.env.ADMIN_PHONE || '').replace(/\D/g, '');

  // 1. Meta Webhook URL Verification (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // 2. Incoming Messages Handler (POST)
  if (req.method === 'POST') {
    const body = req.body;

    if (body?.object && body?.entry) {
      const entry = body.entry[0]?.changes?.[0]?.value;
      const messages = entry?.messages;

      if (messages && messages[0]) {
        const message = messages[0];
        const from = message.from; // Sender phone number

        if (message.type === 'text') {
          const rawText = message.text.body.trim();
          const lowerText = rawText.toLowerCase();

          // ----------------------------------------------------
          // BRANCH A: ADMIN COMMANDS (Executed only by ADMIN_PHONE)
          // ----------------------------------------------------
          if (from === ADMIN_PHONE && lowerText.startsWith('/')) {
            if (lowerText === '/status') {
              const currentServing = Number(await redisCommand(['GET', 'queue:currently_serving'], REDIS_URL, REDIS_TOKEN)) || 0;
              const totalIssued = Number(await redisCommand(['GET', 'queue:token_counter'], REDIS_URL, REDIS_TOKEN)) || 0;
              const waitingCount = Math.max(0, totalIssued - currentServing);
              const servingTime = currentServing > 0 ? getTokenTime(currentServing) : 'Not started';

              const statusMsg = `📊 *Queue Status Report*\n\n• Currently Serving: *#${currentServing}* (${servingTime})\n• Total Tokens Issued: *#${totalIssued}*\n• People Waiting in Line: *${waitingCount}*`;
              await sendWhatsAppMessage(ADMIN_PHONE, statusMsg, ACCESS_TOKEN, PHONE_NUMBER_ID);

            } else if (lowerText === '/queue') {
              const list = await redisCommand(['LRANGE', 'queue:waiting_list', '0', '-1'], REDIS_URL, REDIS_TOKEN) || [];
              const currentServing = Number(await redisCommand(['GET', 'queue:currently_serving'], REDIS_URL, REDIS_TOKEN)) || 0;

              if (list.length === 0) {
                await sendWhatsAppMessage(ADMIN_PHONE, '📋 Queue is currently empty.', ACCESS_TOKEN, PHONE_NUMBER_ID);
              } else {
                let queueRoster = `📋 *Active Queue List* (Serving #${currentServing}):\n\n`;
                list.forEach((item) => {
                  try {
                    const record = JSON.parse(item);
                    const marker = record.token === currentServing ? '👉 ' : '• ';
                    queueRoster += `${marker}*#${record.token}* [${record.timeSlot || getTokenTime(record.token)}] - ${record.name} (+${record.phone})\n`;
                  } catch (_) {}
                });
                await sendWhatsAppMessage(ADMIN_PHONE, queueRoster, ACCESS_TOKEN, PHONE_NUMBER_ID);
              }

            } else if (lowerText === '/next') {
              const totalIssued = Number(await redisCommand(['GET', 'queue:token_counter'], REDIS_URL, REDIS_TOKEN)) || 0;
              let currentServing = Number(await redisCommand(['GET', 'queue:currently_serving'], REDIS_URL, REDIS_TOKEN)) || 0;

              if (currentServing >= totalIssued) {
                await sendWhatsAppMessage(ADMIN_PHONE, '⚠️ No one is left in line. All issued tokens have been served.', ACCESS_TOKEN, PHONE_NUMBER_ID);
              } else {
                // Advance counter
                currentServing = await redisCommand(['INCR', 'queue:currently_serving'], REDIS_URL, REDIS_TOKEN);

                // Find user info for the new token
                const list = await redisCommand(['LRANGE', 'queue:waiting_list', '0', '-1'], REDIS_URL, REDIS_TOKEN) || [];
                let nextUser = null;
                for (const item of list) {
                  try {
                    const parsed = JSON.parse(item);
                    if (parsed.token === currentServing) {
                      nextUser = parsed;
                      break;
                    }
                  } catch (_) {}
                }

                if (nextUser) {
                  const userTurnMsg = `🎉 *Hi ${nextUser.name}!*\n\nIt is now *YOUR TURN* (Token *#${nextUser.token}* - Scheduled: *${nextUser.timeSlot || getTokenTime(nextUser.token)}*).\nPlease proceed to the counter immediately.`;
                  await sendWhatsAppMessage(nextUser.phone, userTurnMsg, ACCESS_TOKEN, PHONE_NUMBER_ID);

                  const adminConfirmMsg = `✅ Advanced queue to *#${currentServing}* (${nextUser.timeSlot || getTokenTime(nextUser.token)}).\nNotified: *${nextUser.name}* (+${nextUser.phone}).`;
                  await sendWhatsAppMessage(ADMIN_PHONE, adminConfirmMsg, ACCESS_TOKEN, PHONE_NUMBER_ID);
                } else {
                  await sendWhatsAppMessage(ADMIN_PHONE, `✅ Advanced queue to *#${currentServing}* (User record not found).`, ACCESS_TOKEN, PHONE_NUMBER_ID);
                }
              }

            } else if (lowerText === '/reset') {
              await redisCommand(['DEL', 'queue:token_counter', 'queue:currently_serving', 'queue:waiting_list'], REDIS_URL, REDIS_TOKEN);

              const userKeys = await redisCommand(['KEYS', 'user:*'], REDIS_URL, REDIS_TOKEN) || [];
              if (userKeys.length > 0) {
                await redisCommand(['DEL', ...userKeys], REDIS_URL, REDIS_TOKEN);
              }

              await sendWhatsAppMessage(ADMIN_PHONE, '🔄 *Queue has been completely reset to 0.*', ACCESS_TOKEN, PHONE_NUMBER_ID);

            } else {
              const helpMsg = `❓ *Unknown Admin Command*\n\nAvailable commands:\n• */next* - Call next token & notify user\n• */status* - Overview of queue counts & times\n• */queue* - Full roster of people in line with slots\n• */reset* - Clear today's queue to 0`;
              await sendWhatsAppMessage(ADMIN_PHONE, helpMsg, ACCESS_TOKEN, PHONE_NUMBER_ID);
            }

            return res.status(200).json({ status: 'admin_command_processed' });
          }

          // ----------------------------------------------------
          // BRANCH B: REGULAR USER (Registering for a token)
          // ----------------------------------------------------
          const existingToken = await redisCommand(['GET', `user:${from}`], REDIS_URL, REDIS_TOKEN);

          if (existingToken) {
            const currentServing = Number(await redisCommand(['GET', 'queue:currently_serving'], REDIS_URL, REDIS_TOKEN)) || 0;
            const ahead = Math.max(0, Number(existingToken) - currentServing);
            const tokenSlot = getTokenTime(Number(existingToken));
            const reminderMsg = `Hi! You already hold Token *#${existingToken}*.\n⏰ Estimated Slot: *${tokenSlot}*\nCurrently serving: *#${currentServing}*.\nPeople ahead: *${ahead}*.`;
            await sendWhatsAppMessage(from, reminderMsg, ACCESS_TOKEN, PHONE_NUMBER_ID);
          } else {
            // 1. Issue next token
            const newToken = await redisCommand(['INCR', 'queue:token_counter'], REDIS_URL, REDIS_TOKEN);

            // 2. Compute scheduled time slot (starts at 10:00 AM, 15 min steps)
            const timeSlot = getTokenTime(Number(newToken));

            // 3. Map phone to token (expires in 24 hrs)
            await redisCommand(['SET', `user:${from}`, newToken, 'EX', '86400'], REDIS_URL, REDIS_TOKEN);

            // 4. Store record in waiting list
            const userRecord = JSON.stringify({
              token: newToken,
              name: rawText,
              phone: from,
              timeSlot: timeSlot,
              timestamp: Date.now(),
            });
            await redisCommand(['RPUSH', 'queue:waiting_list', userRecord], REDIS_URL, REDIS_TOKEN);

            // 5. Calculate position
            const currentServing = Number(await redisCommand(['GET', 'queue:currently_serving'], REDIS_URL, REDIS_TOKEN)) || 0;
            const peopleAhead = Math.max(0, Number(newToken) - currentServing - 1);

            const userMsg = `Hi *${rawText}*!\n\nYour Token Number is: *#${newToken}*\n⏰ Estimated Time Slot: *${timeSlot}*\nCurrently Serving: *#${currentServing || 1}*\nPeople ahead of you: *${peopleAhead}*`;
            await sendWhatsAppMessage(from, userMsg, ACCESS_TOKEN, PHONE_NUMBER_ID);

            // 6. Notify admin of new registrant
            if (ADMIN_PHONE) {
              const adminAlert = `🔔 *New Queue Entry*\n• Name: *${rawText}*\n• Phone: +${from}\n• Assigned Token: *#${newToken}*\n• Slot: *${timeSlot}*`;
              await sendWhatsAppMessage(ADMIN_PHONE, adminAlert, ACCESS_TOKEN, PHONE_NUMBER_ID);
            }
          }
        }
      }
    }
    return res.status(200).json({ status: 'ok' });
  }

  return res.status(405).send('Method Not Allowed');
}

// Calculates slot time starting at 10:00 AM with 15-minute increments
function getTokenTime(tokenNumber) {
  const startHour = 10;
  const startMinute = 0;
  const slotDurationMinutes = 15;

  const totalMinutes = (startHour * 60) + startMinute + ((tokenNumber - 1) * slotDurationMinutes);

  const hours24 = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;

  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;

  const formattedMinutes = String(minutes).padStart(2, '0');
  return `${hours12}:${formattedMinutes} ${period}`;
}

// Lightweight HTTP wrapper for Upstash Redis REST API
async function redisCommand(commandArray, url, token) {
  try {
    const res = await fetch(`${url}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commandArray),
    });
    const data = await res.json();
    return data.result;
  } catch (err) {
    console.error('Redis error:', err);
    return null;
  }
}

// Function to send message via Meta Graph API
async function sendWhatsAppMessage(to, text, accessToken, phoneId) {
  const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: { body: text },
      }),
    });
  } catch (err) {
    console.error('WhatsApp send error:', err);
  }
}