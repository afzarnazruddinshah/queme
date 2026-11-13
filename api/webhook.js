import crypto from 'crypto';
import { redisCommand } from '../lib/redis.js';
import { registerUserToken, cancelUserToken } from '../lib/queue.js';
import { handleAdminCommand } from '../lib/admin.js';
import { sendWhatsAppText } from '../lib/whatsapp.js';
import { parseMessageWithAI } from '../lib/gemini.js';
import { checkAndRecordCancel, checkRateLimit } from '../lib/validators.js';


// 1. Disable Next.js automatic body parser so we can verify the raw byte stream
export const config = {
  api: {
    bodyParser: false,
  },
};

// Helper: Read raw request stream into a Buffer
async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// Helper: Verify Meta x-hub-signature-256 securely
function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader || !appSecret) {
    return false;
  }

  // Header format is "sha256=<hash>"
  const parts = signatureHeader.split('sha256=');
  if (parts.length !== 2) {
    return false;
  }

  const expectedHash = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  const signatureBuffer = Buffer.from(parts[1], 'utf8');
  const expectedBuffer = Buffer.from(expectedHash, 'utf8');

  // Length guard before timingSafeEqual to avoid range errors
  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
}

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
  const APP_SECRET = process.env.META_APP_SECRET;
  const ADMIN_PHONE = (process.env.ADMIN_PHONE || '').replace(/\D/g, '');

  // 1. Webhook Handshake Verification (GET)
  if (req.method === 'GET') {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
      return res.status(200).send(req.query['hub.challenge']);
    }
    return res.status(403).send('Forbidden');
  }

  // 2. Incoming Event Handler (POST)
  if (req.method === 'POST') {
    const rawBody = await getRawBody(req);
    const signature = req.headers['x-hub-signature-256'];

    // Rule 4: Reject requests that do not pass signature verification
    if (!verifyMetaSignature(rawBody, signature, APP_SECRET)) {
      console.warn('Blocked untrusted POST to webhook: invalid or missing x-hub-signature-256');
      return res.status(401).send('Unauthorized');
    }

    let body;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch (parseErr) {
      console.error('Invalid JSON payload in webhook body:', parseErr);
      return res.status(400).send('Bad Request');
    }

    const entry = body?.entry?.[0]?.changes?.[0]?.value;
    const message = entry?.messages?.[0];

    if (message) {
      const from = message.from;

      // Extract Meta metadata to resolve tenantId dynamically
      const metadata = entry?.metadata;
      const incomingPhoneId = metadata?.phone_number_id;
      const displayPhoneNumber = metadata?.display_phone_number;

      let tenantId = null;
      try {
        if (incomingPhoneId) {
          tenantId = await redisCommand(['GET', `phone:${incomingPhoneId}:tenant`]);
        }
        if (!tenantId && displayPhoneNumber) {
          tenantId = await redisCommand(['GET', `phone:${displayPhoneNumber}:tenant`]);
        }
      } catch (err) {
        console.error('Error fetching tenant from redis:', err);
      }

      // Default fallback
      if (!tenantId) {
        tenantId = 'neefa';
      }

      // Case A: Interactive Button Reply clicked
      if (message.type === 'interactive') {
        const buttonId = message.interactive?.button_reply?.id;

        if (buttonId === 'btn_cancel') {
          await cancelUserToken(from, tenantId);
        } else if (buttonId === 'btn_status') {
          await registerUserToken(from, '', tenantId);
        }
      }

      // Case B: Plain Text Message sent
      else if (message.type === 'text') {
        const text = message.text.body.trim();

        // 1. Admin Commands (bypasses AI)
        if (from === ADMIN_PHONE && text.startsWith('/')) {
          await handleAdminCommand(ADMIN_PHONE, text, tenantId);
        }
        // 2. Quick text cancellation (bypasses AI)
        else if (text.toLowerCase() === 'cancel') {
          await cancelUserToken(from, tenantId);
        }
        // 3. User Input routed through Gemini
        else {
          const aiResult = await parseMessageWithAI(text);

          if (aiResult.action === 'CREATE_TOKEN' && aiResult.name) {
            await registerUserToken(from, aiResult.name, tenantId);
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
