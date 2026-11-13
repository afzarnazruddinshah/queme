// lib/validators.js
import { redisCommand } from './redis.js';

/**
 * Rule 2: Anti-Churn Cancellation Throttle
 * Max 1 self-cancellation per phone per day.
 */
export async function checkAndRecordCancel(phone, tenantId) {
  const key = `tenant:${tenantId}:cancel_count:${phone}`;
  const currentCount = await redisCommand(['GET', key]);
  
  if (currentCount && Number(currentCount) >= 1) {
    return { 
      allowed: false, 
      message: '⚠️ You have already cancelled a booking today. To modify or cancel this token, please contact the clinic reception directly.' 
    };
  }

  // Record the cancellation with 24-hour expiration
  await redisCommand(['SET', key, '1', 'EX', '86400']);
  return { allowed: true };
}

/**
 * Rule 3: Non-Registration Rate Limiter
 * Max 2 casual replies per day to save WhatsApp costs.
 */
export async function checkRateLimit(phone, tenantId) {
  const key = `tenant:${tenantId}:misc_count:${phone}`;
  const count = Number(await redisCommand(['GET', key])) || 0;

  if (count === 0) {
    await redisCommand(['SET', key, '1', 'EX', '86400']);
    return { 
      allowed: true, 
      reply: 'Please enter your full name to generate a token.' 
    };
  } else if (count === 1) {
    await redisCommand(['INCR', key]);
    return { 
      allowed: true, 
      reply: '⚠️ To book an appointment, please send only the patient\'s Full Name. For clinic address, medical queries, or emergency assistance, please call the clinic directly.' 
    };
  } else {
    // Exceeded 2 replies. Block silently.
    return { allowed: false };
  }
}
