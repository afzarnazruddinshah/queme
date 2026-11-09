import crypto from 'crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

const COOKIE_NAME = 'desk_session';
const SESSION_SECRET = process.env.DESK_SESSION_SECRET || 'neefa-admindesk-secret-key-32chars-min!!';
const MAX_FAILED_ATTEMPTS = 3;
const LOCKOUT_SECONDS = 30 * 60; // 30 minutes

/**
 * Creates a tamper-proof HMAC-signed session token:
 * format: `${tenantId}:${timestamp}.${signature}`
 */
export function signSessionToken(tenantId: string): string {
  const timestamp = Date.now();
  const data = `${tenantId}:${timestamp}`;
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(data)
    .digest('base64url');
  return `${data}.${signature}`;
}

/**
 * Validates the HMAC signature and verifies the tenant match.
 */
export function verifySessionToken(token: string, expectedTenantId: string): boolean {
  if (!token || !token.includes('.')) return false;

  const [data, signature] = token.split('.');
  const [tenantId] = data.split(':');

  if (tenantId !== expectedTenantId) return false;

  const expectedSignature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(data)
    .digest('base64url');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'utf8'),
      Buffer.from(expectedSignature, 'utf8')
    );
  } catch {
    return false;
  }
}

/**
 * Checks if the tenant/IP is currently locked out after 3 failed attempts.
 */
export async function checkLockout(tenantId: string, ip: string): Promise<{ locked: boolean; remainingMinutes?: number }> {
  const lockKey = `ratelimit:pin_locked:${tenantId}:${ip}`;
  const ttl = await redis.ttl(lockKey);

  if (ttl > 0) {
    return {
      locked: true,
      remainingMinutes: Math.ceil(ttl / 60),
    };
  }

  return { locked: false };
}

/**
 * Records a failed PIN attempt. Triggers 30-minute lockout on 3rd failure.
 */
export async function recordFailedAttempt(tenantId: string, ip: string): Promise<{ locked: boolean; remainingAttempts: number }> {
  const attemptKey = `ratelimit:pin_attempts:${tenantId}:${ip}`;
  const lockKey = `ratelimit:pin_locked:${tenantId}:${ip}`;

  const attempts = await redis.incr(attemptKey);

  // Expire the attempt window after 30 minutes if not already locked
  if (attempts === 1) {
    await redis.expire(attemptKey, LOCKOUT_SECONDS);
  }

  if (attempts >= MAX_FAILED_ATTEMPTS) {
    await redis.set(lockKey, 'locked', { ex: LOCKOUT_SECONDS });
    await redis.del(attemptKey);
    return { locked: true, remainingAttempts: 0 };
  }

  return { locked: false, remainingAttempts: MAX_FAILED_ATTEMPTS - attempts };
}

/**
 * Clears failed attempt tracking upon successful authentication.
 */
export async function clearFailedAttempts(tenantId: string, ip: string): Promise<void> {
  const attemptKey = `ratelimit:pin_attempts:${tenantId}:${ip}`;
  const lockKey = `ratelimit:pin_locked:${tenantId}:${ip}`;
  await redis.del(attemptKey, lockKey);
}

/**
 * Sets the HttpOnly, SameSite=Lax, Secure session cookie.
 */
export async function setDeskSessionCookie(response: NextResponse, tenantId: string): Promise<void> {
  const token = signSessionToken(tenantId);
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
}

/**
 * Extracts and verifies the desk session cookie for a tenant.
 * Reusable one-line guard for API route handlers.
 */
export async function authorizeDeskRequest(tenantId: string): Promise<{ authorized: boolean; errorResponse?: NextResponse }> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(COOKIE_NAME)?.value;

  if (!sessionCookie || !verifySessionToken(sessionCookie, tenantId)) {
    return {
      authorized: false,
      errorResponse: NextResponse.json(
        { success: false, message: 'Unauthorized desk session. Please unlock the desk.' },
        { status: 401 }
      ),
    };
  }

  return { authorized: true };
}
