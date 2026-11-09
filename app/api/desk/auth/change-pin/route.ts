import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { authorizeDeskRequest } from '../../../../../lib/deskAuth';

const redis = Redis.fromEnv();

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { tenantId = 'neefa', currentPin, newPin } = body;

    const cleanTenant = String(tenantId).toLowerCase().trim();

    // Rule 3: Validate desk session cookie before mutating Redis
    const auth = await authorizeDeskRequest(cleanTenant);
    if (!auth.authorized) {
      return auth.errorResponse!;
    }

    const cleanCurrentPin = String(currentPin || '').trim();
    const cleanNewPin = String(newPin || '').trim();

    if (!cleanCurrentPin || !cleanNewPin) {
      return NextResponse.json(
        { success: false, message: 'Current PIN and new PIN are required.' },
        { status: 400 }
      );
    }

    if (!/^\d{6}$/.test(cleanNewPin)) {
      return NextResponse.json(
        { success: false, message: 'New PIN must be exactly 6 digits.' },
        { status: 400 }
      );
    }

    // Default clinic PIN fallback is '123456' or process.env.DESK_DEFAULT_PIN
    const pinKey = `tenant:${cleanTenant}:desk_pin`;
    const storedPin = (await redis.get(pinKey)) || process.env.DESK_DEFAULT_PIN || '123456';

    if (cleanCurrentPin !== String(storedPin)) {
      return NextResponse.json(
        { success: false, message: 'Current PIN is incorrect.' },
        { status: 401 }
      );
    }

    // Persist new PIN to Redis
    await redis.set(pinKey, cleanNewPin);

    return NextResponse.json({
      success: true,
      message: 'Clinic PIN updated successfully.',
    });
  } catch (error) {
    console.error('Error changing clinic PIN:', error);
    return NextResponse.json(
      { success: false, message: 'Server error while updating PIN.' },
      { status: 500 }
    );
  }
}
