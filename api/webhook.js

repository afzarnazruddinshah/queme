export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
  const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
  const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

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
        const from = message.from;

        if (message.type === 'text') {
          const userName = message.text.body.trim();
          const replyText = `Hi ${userName}!`;

          try {
            await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: from,
                type: 'text',
                text: { body: replyText },
              }),
            });
          } catch (err) {
            console.error('Fetch error:', err);
          }
        }
      }
    }
    return res.status(200).json({ status: 'ok' });
  }

  return res.status(405).send('Method Not Allowed');
}
