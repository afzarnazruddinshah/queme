import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get('tenantId') || 'default_clinic';

    // 1. Get the current waiting queue from Redis list
    const queueKey = `tenant:${tenantId}:queue`;
    const nowServingKey = `tenant:${tenantId}:now_serving`;
    const nextPatientKey = `tenant:${tenantId}:next_patient`;

    // Fetch the first patient from the waiting list (pop from left)
    const nextItemString = await redis.lpop(queueKey);

    if (!nextItemString) {
      // If queue is empty, clear active serving tokens
      await redis.del(nowServingKey);
      await redis.del(nextPatientKey);

      return NextResponse.json({
        success: true,
        message: 'Queue is now empty.',
        data: { nowServing: null, nextPatient: null }
      });
    }

    const nextPatient = typeof nextItemString === 'string' ? JSON.parse(nextItemString) : nextItemString;

    // 2. Set this patient as the new "Now Serving"
    await redis.set(nowServingKey, JSON.stringify(nextPatient));

    // 3. Peek at the new next patient in line (index 0 now)
    const upcomingList = await redis.lrange(queueKey, 0, 0);
    const newNextPatient = upcomingList.length > 0 
      ? (typeof upcomingList[0] === 'string' ? JSON.parse(upcomingList[0]) : upcomingList[0]) 
      : null;

    if (newNextPatient) {
      await redis.set(nextPatientKey, JSON.stringify(newNextPatient));
    } else {
      await redis.del(nextPatientKey);
    }

    return NextResponse.json({
      success: true,
      data: {
        nowServing: nextPatient,
        nextPatient: newNextPatient,
      }
    });

  } catch (error) {
    console.error('Error advancing queue:', error);
    return NextResponse.json({ success: false, error: 'Failed to advance queue' }, { status: 500 });
  }
}
