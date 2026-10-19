import { registerUserToken, cancelUserToken } from '../lib/queue.js';
import { handleAdminCommand } from '../lib/admin.js';
import { sendWhatsAppText } from '../lib/whatsapp.js';
import { parseMessageWithAI } from '../lib/gemini.js';

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
  const ADMIN_PHONE = (process.env.ADMIN_PHONE || '').replace(/\D/g, '');

  // 1. Webhook Verification (GET)
  if (req.method === 'GET') {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
      return res.status(200).send(req.query['hub.challenge']);
    }
    return res.status(403).send('Forbidden');
  }

  // 2. Incoming Event Handler (POST)
  if (req.method === 'POST') {
    const body = req.body;
    const entry = body?.entry?.[0]?.changes?.[0]?.value;
    const message = entry?.messages?.[0];

    if (message) {
      const from = message.from;

      // Case A: Interactive Button Reply clicked
      if (message.type === 'interactive') {
        const buttonId = message.interactive?.button_reply?.id;

        if (buttonId === 'btn_cancel') {
          await cancelUserToken(from);
        } else if (buttonId === 'btn_status') {
          await registerUserToken(from, ''); // Triggers current status & buttons
        }
      }

      // Case B: Plain Text Message sent
      else if (message.type === 'text') {
        const text = message.text.body.trim();

        // 1. Admin Commands (bypasses AI)
        if (from === ADMIN_PHONE && text.startsWith('/')) {
          await handleAdminCommand(ADMIN_PHONE, text);
        }
        // 2. Quick text cancellation (bypasses AI)
        else if (text.toLowerCase() === 'cancel') {
          await cancelUserToken(from);
        }
        // 3. User Input routed through Gemini
        else {
          const aiResult = await parseMessageWithAI(text);

          if (aiResult.action === 'CREATE_TOKEN' && aiResult.name) {
            await registerUserToken(from, aiResult.name);
          } else {
            // Case 1: Greeting, random text, or missing name
            await sendWhatsAppText(from, 'Please enter your name to generate token.');
          }
        }
      }
    }

    return res.status(200).json({ status: 'ok' });
  }

  return res.status(405).send('Method Not Allowed');
}
