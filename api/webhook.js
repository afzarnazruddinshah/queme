import { registerUserToken, cancelUserToken } from '../lib/queue.js';
import { handleAdminCommand } from '../lib/admin.js';

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
          await registerUserToken(from, ''); // Triggers status reminder
        }
      }

      // Case B: Plain Text Message sent
      else if (message.type === 'text') {
        const text = message.text.body.trim();

        // 1. Admin Commands
        if (from === ADMIN_PHONE && text.startsWith('/')) {
          await handleAdminCommand(ADMIN_PHONE, text);
        }
        // 2. Quick text cancel support
        else if (text.toLowerCase() === 'cancel') {
          await cancelUserToken(from);
        }
        // 3. User joining queue
        else {
          await registerUserToken(from, text);
        }
      }
    }

    return res.status(200).json({ status: 'ok' });
  }

  return res.status(405).send('Method Not Allowed');
}