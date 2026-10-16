import { redisCommand } from '../lib/redis.js';
import { sendWhatsAppText } from '../lib/whatsapp.js';

export default async function handler(req, res) {
  // 1. Optional security check: Verify the call is genuinely from Vercel's Cron scheduler
  const authHeader = req.headers['authorization'];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const adminPhone = (process.env.ADMIN_PHONE || '').replace(/\D/g, '');

  try {
    // 2. Clear current day's queue counters and waiting list
    await redisCommand(['DEL', 'queue:token_counter', 'queue:currently_serving', 'queue:waiting_list']);

    // 3. Clear all user phone-to-token mappings
    const userKeys = (await redisCommand(['KEYS', 'user:*'])) || [];
    if (userKeys.length > 0) {
      await redisCommand(['DEL', ...userKeys]);
    }

    // 4. Send morning confirmation to Admin
    if (adminPhone) {
      const morningMsg = `🌅 *Good morning!*\n\nToday's queue has been automatically reset to 0. Ready for new tokens!`;
      await sendWhatsAppText(adminPhone, morningMsg);
    }

    return res.status(200).json({ status: 'queue_reset_successful' });
  } catch (error) {
    console.error('Daily cron reset failed:', error);
    return res.status(500).json({ error: 'Failed to reset queue' });
  }
}
