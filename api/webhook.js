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
        const from = message.from; // Sender phone digits

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

              const statusMsg = `📊 *Queue Status Report*\n\n• Currently Serving: *#${currentServing}*\n• Total Tokens Issued: *#${totalIssued}*\n• People Waiting in Line: *${waitingCount}*`;
              await sendWhatsAppMessage(ADMIN_PHONE, statusMsg, ACCESS_TOKEN, PHONE_NUMBER_ID);

            } else if (lowerText === '/queue') {
              // Retrieve all waiting list entries
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
                    queueRoster += `${marker}*#${record.token}* - ${record.name} (+${record.phone})\n`;
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
                  // Notify the user it is their turn
                  const userTurnMsg = `🎉 *Hi ${nextUser.name}!*\n\nIt is now *YOUR TURN* (Token *#${nextUser.token}*).\nPlease proceed to the counter immediately.`;
                  await sendWhatsAppMessage(nextUser.phone, userTurnMsg, ACCESS_TOKEN, PHONE_NUMBER_ID);

                  // Confirm back to admin
                  const adminConfirmMsg = `✅ Advanced queue to *#${currentServing}*.\nNotified: *${nextUser.name}* (+${nextUser.phone}).`;
                  await sendWhatsAppMessage(ADMIN_PHONE, adminConfirmMsg, ACCESS_TOKEN, PHONE_NUMBER_ID);
                } else {
                  await sendWhatsAppMessage(ADMIN_PHONE, `✅ Advanced queue to *#${currentServing}* (User record not found).`, ACCESS_TOKEN, PHONE_NUMBER_ID);
                }
              }

            } else if (lowerText === '/reset') {
              // Delete all queue-related keys
              await redisCommand(['DEL', 'queue:token_counter', 'queue:currently_serving', 'queue:waiting_list'], REDIS_URL, REDIS_TOKEN);

              // Clear user lookup keys
              const userKeys = await redisCommand(['KEYS', 'user:*'], REDIS_URL, REDIS_TOKEN) || [];
              if (userKeys.length > 0) {
                await redisCommand(['DEL', ...userKeys], REDIS_URL, REDIS_TOKEN);
              }

              await sendWhatsAppMessage(ADMIN_PHONE, '🔄 *Queue has been completely reset
