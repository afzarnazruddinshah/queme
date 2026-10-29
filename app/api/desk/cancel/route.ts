import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get('tenantId') || 'default_clinic';
    const body = await request.json();
    const { tokenNumber } = body;

    if (!tokenNumber) {
      return NextResponse.json({ success: false, error: 'Token number is required' }, { status: 400 });
    }

    const queueKey = `tenant:${tenantId}:queue`;
    
    // Fetch all items currently in the waiting queue list
    const queueItems = await redis.lrange(queueKey, 0, -1);

    if (!queueItems || queueItems.length === 0) {
      return NextResponse.json({ success: false, error: 'Queue is empty' }, { status: 404 });
    }

    // Find the item matching the tokenNumber to remove
    let targetItemString: string | null = null;
    for (const item of queueItems) {
      const parsed = typeof item === 'string' ? JSON.parse(item) : item;
      if (parsed.tokenNumber === tokenNumber) {
        targetItemString = typeof item === 'string' ? item : JSON.stringify(item);
        break;
      }
    }

    if (!targetItemString) {
      return NextResponse.json({ success: false, error: 'Token not found in waiting queue' }, { status: 404 });
    }

    // Remove the item from the Redis list (LREM removes occurrences of the value)
    await redis.lrem(queueKey, 1, targetItemString);

    // Update the "next_patient" pointer cache if necessary
    const nextPatientKey = `tenant:${tenantId}:next_patient`;
    const updatedQueue = await redis.lrange(queueKey, 0, 0);
    if (updatedQueue.length > 0) {
      const newNext = typeof updatedQueue[0] === 'string' ? JSON.parse(updatedQueue[0]) : updatedQueue[0];
      await redis.set(nextPatientKey, JSON.stringify(newNext));
    } else {
      await redis.del(nextPatientKey);
    }

    return NextResponse.json({
      success: true,
      message: `Token ${tokenNumber} successfully cancelled and removed from queue.`
    });

  } catch (error) {
    console.error('Error cancelling token:', error);
    return NextResponse.json({ success: false, error: 'Failed to cancel token' }, { status: 500 });
  }
}
