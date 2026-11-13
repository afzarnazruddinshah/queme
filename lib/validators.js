import { redisCommand } from './redis.js';

// Rule: 1 Registration per day. 1st violation = Warning. 2nd violation = Silence.
export async function checkDailyRegistration(phone, tenantId) {
  const regKey = `tenant:${tenantId}:daily_reg:${phone}`;
  const strikeKey = `tenant:${tenantId}:spam_strikes:${phone}`;

  const hasRegistered = await redisCommand(['GET', regKey]);
  
  if (hasRegistered) {
    const strikes = Number(await redisCommand(['GET', strikeKey])) || 0;
    if (strikes === 0) {
      await redisCommand(['SET', strikeKey, '1', 'EX', '86400']);
      return { 
        allowed: false, 
        reply: '⚠️ You have exceeded the token registration limit for today (max 1). Please try from another number or register tomorrow.' 
      };
    } else {
      // Strike 2: Total Silence
      return { allowed: false, reply: null }; 
    }
  }
  return { allowed: true };
}

// Called only when a token is successfully generated
export async function markPhoneAsRegistered(phone, tenantId) {
  await redisCommand(['SET', `tenant:${tenantId}:daily_reg:${phone}`, '1', 'EX', '86400']);
}

// Rule: Handle non-registration chatter (e.g. "hi") using the same strike system
export async function handleInvalidInput(phone, tenantId) {
  const strikeKey = `tenant:${tenantId}:spam_strikes:${phone}`;
  const strikes = Number(await redisCommand(['GET', strikeKey])) || 0;
  
  if (strikes === 0) {
    await redisCommand(['SET', strikeKey, '1', 'EX', '86400']);
    return { allowed: false, reply: 'Please enter your full name to generate a token.' };
  } else {
    // Strike 2: Total Silence
    return { allowed: false, reply: null }; 
  }
}

// Rule: Handle users clicking "Cancel" repeatedly when they don't have a token
export async function checkCancelSpam(phone, tenantId, hasExistingToken) {
  if (hasExistingToken) return { allowed: true };
  
  const strikeKey = `tenant:${tenantId}:spam_strikes:${phone}`;
  const strikes = Number(await redisCommand(['GET', strikeKey])) || 0;
  
  if (strikes === 0) {
    await redisCommand(['SET', strikeKey, '1', 'EX', '86400']);
    return { allowed: false, reply: 'You do not have an active token to cancel.' };
  } else {
    // Strike 2: Total Silence
    return { allowed: false, reply: null };
  }
}
