import { redisCommand } from '../lib/redis.js';

export default async function handler(req, res) {
  try {
    const authHeader = req.headers['authorization'];
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const tenantId = (req.query.tenantId || 'neefa').toLowerCase().trim();

    // 1. Delete all queue, counter, now_serving, and cancelled gap keys
    await redisCommand([
      'DEL',
      `tenant:${tenantId}:counter`,
      `tenant:${tenantId}:queue`,
      `tenant:${tenantId}:now_serving`,
      `tenant:${tenantId}:currently_serving`,
      `tenant:${tenantId}:next_patient`,
      `tenant:${tenantId}:cancelled_slots`,
      'queue:waiting_list',
      'queue:token_counter',
      'queue:currently_serving',
    ]);

    // 2. Remove all active patient phone session locks
    const userKeys = (await redisCommand(['KEYS', `tenant:${tenantId}:user:*`])) || [];
    if (userKeys.length > 0) {
      await redisCommand(['DEL', ...userKeys]);
    }

    const legacyUserKeys = (await redisCommand(['KEYS', 'user:*'])) || [];
    if (legacyUserKeys.length > 0) {
      await redisCommand(['DEL', ...legacyUserKeys]);
    }

    return res.status(200).json({
      success: true,
      message: `Daily queue and slots reset successfully for tenant: ${tenantId}`,
    });
  } catch (error) {
    console.error('Cron reset error:', error);
    return res.status(500).json({ success: false, error: 'Failed to reset queue' });
  }
}
