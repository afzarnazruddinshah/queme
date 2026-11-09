import { NextRequest, NextResponse } from 'next/server';
import { redisCommand } from '../../../../lib/redis.js';
import {
  checkLockout,
  recordFailedAttempt,
  clearFailedAttempts,
  setDeskSessionCookie,
  verifySessionToken,
} from '../../../../lib/deskAuth';

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers.get('x-real-ip') || 'unknown-ip';
}

// 1. GET: Verify existing HMAC-signed session cookie on page load
export async function GET(req: NextRequest) {
  try {
    const sessionCookie = req.cookies.get('desk_session')?.value;
    const { searchParams } = new URL(req.url);
    const tenantId = (searchParams.get('tenantId') || 'neefa').toLowerCase().trim();

    if (!sessionCookie) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    const isValid = verifySessionToken(sessionCookie, tenantId);
    if (!isValid) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    return NextResponse.json({
      authenticated: true,
      tenantId,
    });
  } catch (error) {
    console.error('Session verification error:', error);
    return NextResponse.json({ authenticated: false }, { status: 500 });
  }
}

// 2. POST: Authenticate Clinic Code + 6-Digit PIN
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { clinicCode, pin } = body;

    if (!clinicCode || !pin) {
      return NextResponse.json(
        { success: false, message: 'Clinic code and PIN are required.' },
        { status: 400 }
      );
    }

    const tenantId = String(clinicCode).trim().toLowerCase();
    const enteredPin = String(pin).trim();
    const clientIp = getClientIp(req);

    // Rule 1: Check if tenant/IP is currently locked out (30 mins after 3 failed attempts)
    const lockStatus = await checkLockout(tenantId, clientIp);
    if (lockStatus.locked) {
      return NextResponse.json(
        {
          success: false,
          message: `Desk locked due to 3 failed attempts. Try again in ${lockStatus.remainingMinutes} minute(s).`,
        },
        { status: 429 }
      );
    }

    // Lookup PIN from Redis (fallback to env or default '123456')
    const storedPin =
      (await redisCommand(['GET', `tenant:${tenantId}:desk_pin`])) ||
      process.env.DESK_DEFAULT_PIN ||
      '123456';

    // Verify PIN
    if (String(storedPin).trim() !== enteredPin) {
      const attemptResult = await recordFailedAttempt(tenantId, clientIp);

      if (attemptResult.locked) {
        return NextResponse.json(
          {
            success: false,
            message: 'Too many incorrect attempts. Desk is locked for 30 minutes.',
          },
          { status: 429 }
        );
      }

      return NextResponse.json(
        {
          success: false,
          message: `Invalid PIN. ${attemptResult.remainingAttempts} attempt(s) remaining before a 30-minute lock.`,
        },
        { status: 401 }
      );
    }

    // Successful login: reset lockout counter
    await clearFailedAttempts(tenantId, clientIp);

    // Rule 2: Create response and attach HttpOnly, SameSite=Lax, Secure HMAC signed cookie
    const response = NextResponse.json({ success: true, tenantId });
    await setDeskSessionCookie(response, tenantId);

    return response;
  } catch (error) {
    console.error('Desk auth error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error.' },
      { status: 500 }
    );
  }
}
