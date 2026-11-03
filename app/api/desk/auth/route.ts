import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { redisCommand } from '@/lib/redis';

// 1. GET: Verify if the browser already holds a valid 30-day session cookie
export async function GET(req: NextRequest) {
  try {
    const sessionCookie = req.cookies.get('desk_session')?.value;
    if (!sessionCookie) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    const sessionData = await redisCommand(['GET', `session:${sessionCookie}`]);
    if (!sessionData) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    const parsed = typeof sessionData === 'string' ? JSON.parse(sessionData) : sessionData;
    return NextResponse.json({
      authenticated: true,
      tenantId: parsed.tenantId,
    });
  } catch (error) {
    console.error('Session verification error:', error);
    return NextResponse.json({ authenticated: false }, { status: 500 });
  }
}

// 2. POST: Authenticate Clinic Code + 6-Digit PIN
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { clinicCode, pin } = body;

    if (!clinicCode || !pin) {
      return NextResponse.json(
        { success: false, message: 'Clinic code and PIN are required.' },
        { status: 400 }
      );
    }

    const tenantId = String(clinicCode).trim().toLowerCase();
    const enteredPin = String(pin).trim();

    // Rate-limiting check: 5 failed attempts locks out for 15 minutes
    const attemptsKey = `tenant:${tenantId}:pin_attempts`;
    const attempts = Number(await redisCommand(['GET', attemptsKey])) || 0;
    if (attempts >= 5) {
      return NextResponse.json(
        { success: false, message: 'Too many incorrect attempts. Locked for 15 minutes.' },
        { status: 429 }
      );
    }

    // Verify against Redis key (e.g. tenant:neefa:desk_pin)
    const storedPin = await redisCommand(['GET', `tenant:${tenantId}:desk_pin`]);
    if (!storedPin || String(storedPin).trim() !== enteredPin) {
      const currentAttempts = await redisCommand(['INCR', attemptsKey]);
      if (currentAttempts === 1) {
        await redisCommand(['EXPIRE', attemptsKey, '900']); // 15 mins lock
      }
      return NextResponse.json(
        { success: false, message: 'Invalid Clinic Code or PIN.' },
        { status: 401 }
      );
    }

    // Clear failed attempts on success
    await redisCommand(['DEL', attemptsKey]);

    // Create session token stored in Redis with 30-day persistence
    const sessionToken = crypto.randomUUID();
    const maxAgeSeconds = 60 * 60 * 24 * 30; // 30 days

    await redisCommand([
      'SET',
      `session:${sessionToken}`,
      JSON.stringify({ tenantId, createdAt: new Date().toISOString() }),
      'EX',
      String(maxAgeSeconds),
    ]);

    // Set HttpOnly persistent cookie
    const response = NextResponse.json({ success: true, tenantId });
    response.cookies.set({
      name: 'desk_session',
      value: sessionToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: maxAgeSeconds,
    });

    return response;
  } catch (error) {
    console.error('Desk auth error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error.' },
      { status: 500 }
    );
  }
}
