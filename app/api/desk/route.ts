import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

// Initialize Redis (pulls from your environment variables)
const redis = Redis.fromEnv();

// GET: Fetch live queue, now serving, and waiting list for a clinic
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get('tenantId') || 'default_clinic';

    // Fetch current state from Redis
    const nowServing = await redis.get(`tenant:${tenantId}:now_serving`) || null;
    const nextPatient = await redis.get(`tenant:${tenantId}:next_patient`) || null;
    const waitingQueue = await redis.lrange(`tenant:${tenantId}:queue`, 0, -1) || [];

    return NextResponse.json({
      success: true,
      data: {
        nowServing,
        nextPatient,
        waitingQueue: waitingQueue.map((item: any) => typeof item === 'string' ? JSON.parse(item) : item),
      }
    });
  } catch (error) {
    console.error('Error fetching desk queue:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch queue' }, { status: 500 });
  }
}

// POST: Add a walk-in token from the front-desk UI
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { tenantId = 'default_clinic', patientName, phoneNumber } = body;

    if (!patientName || !phoneNumber) {
      return NextResponse.json({ success: false, error: 'Patient name and phone number are required' }, { status: 400 });
    }

    // Atomically increment token counter
    const tokenNumber = await redis.incr(`tenant:${tenantId}:counter`);
    const formattedToken = `A${String(tokenNumber).padStart(3, '0')}`; // e.g. A015

    const tokenData = {
      tokenNumber: formattedToken,
      patientName,
      phoneNumber,
      source: 'walk-in',
      createdAt: new Date().toISOString(),
      status: 'waiting',
    };

    // Push to Redis queue list
    await redis.rpush(`tenant:${tenantId}:queue`, JSON.stringify(tokenData));

    return NextResponse.json({
      success: true,
      data: tokenData,
    });
  } catch (error) {
    console.error('Error adding walk-in token:', error);
    return NextResponse.json({ success: false, error: 'Failed to add token' }, { status: 500 });
  }
}
