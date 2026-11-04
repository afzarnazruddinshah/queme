import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

function cleanTokenDigits(val: unknown): string {
  if (!val) return '';
  return String(val).replace(/\D/g, '');
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const body = await request.json().catch(() => ({}));
    
    // Support tenantId from query param or body, defaulting to neefa
    const rawTenant = searchParams.get('tenantId') || body.tenantId || 'neefa';
    const tenantId = rawTenant.toLowerCase().trim();
    const tokenNumber = body.tokenNumber || body.token;

    if (!tokenNumber) {
      return NextResponse.json(
        { success: false, error: 'Token number is required' },
        { status: 400 }
      );
    }

    const targetDigits = cleanTokenDigits(tokenNumber);
    let cancelledPhone: string | null = null;
    let cancelledName: string | null = null;
    let foundAndRemoved = false;

    // 1. Check if the token being cancelled is currently in "Now Serving"
    const keyServing = `tenant:${tenantId}:now_serving`;
    const keyAltServing = `tenant:${tenantId}:currently_serving`;
    const rawServing = await redis.get(keyServing);

    if (rawServing) {
      const parsedServing = typeof rawServing === 'string' ? JSON.parse(rawServing) : rawServing;
      const servingDigits = cleanTokenDigits(parsedServing.tokenNumber || parsedServing.token);

      if (servingDigits === targetDigits || parsedServing.tokenNumber === tokenNumber) {
        cancelledPhone = parsedServing.phoneNumber || parsedServing.phone || null;
        cancelledName = parsedServing.patientName || parsedServing.name || null;
        
        await redis.del(keyServing);
        await redis.del(keyAltServing);
        foundAndRemoved = true;
      }
    }

    // 2. Check and remove from the waiting queue list
    const queueKey = `tenant:${tenantId}:queue`;
    const queueItems = (await redis.lrange(queueKey, 0, -1)) || [];

    for (const item of queueItems) {
      const parsed = typeof item === 'string' ? JSON.parse(item) : item;
      const itemDigits = cleanTokenDigits(parsed.tokenNumber || parsed.token);

      if (itemDigits === targetDigits || parsed.tokenNumber === tokenNumber || parsed.token === tokenNumber) {
        const itemString = typeof item === 'string' ? item : JSON.stringify(item);
        
        // Remove exactly this entry from the Redis list
        await redis.lrem(queueKey, 1, itemString);
        
        cancelledPhone = cancelledPhone || parsed.phoneNumber || parsed.phone || null;
        cancelledName = cancelledName || parsed.patientName || parsed.name || null;
        foundAndRemoved = true;
        break;
      }
    }

    if (!foundAndRemoved) {
      return NextResponse.json(
        { success: false, error: `Token #${tokenNumber} not found in active queue or consultation.` },
        { status: 404 }
      );
    }

    // 3. Clear WhatsApp patient session lock so patient can re-book
    if (cancelledPhone && cancelledPhone !== 'WALK_IN' && cancelledPhone !== '—') {
      const cleanPhone = cancelledPhone.replace(/\D/g, '');
      await redis.del(`tenant:${tenantId}:user:${cleanPhone}`);
      await redis.del(`tenant:${tenantId}:user:+${cleanPhone}`);
      await redis.del(`user:${cleanPhone}`);
    }

    // 4. Update or clear the "next_patient" pointer cache
    const nextPatientKey = `tenant:${tenantId}:next_patient`;
    const updatedQueue = (await redis.lrange(queueKey, 0, 0)) || [];
    if (updatedQueue.length > 0) {
      const newNext = typeof updatedQueue[0] === 'string' ? JSON.parse(updatedQueue[0]) : updatedQueue[0];
      await redis.set(nextPatientKey, JSON.stringify(newNext));
    } else {
      await redis.del(nextPatientKey);
    }

    return NextResponse.json({
      success: true,
      message: `Token #${tokenNumber} (${cancelledName || 'Patient'}) successfully cancelled.`
    });

  } catch (error) {
    console.error('Error cancelling token:', error);
    return NextResponse.json({ success: false, error: 'Failed to cancel token' }, { status: 500 });
  }
}
