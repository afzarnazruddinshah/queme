import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

// Initialize Redis (pulls from your environment variables)
const redis = Redis.fromEnv();

function parseRecord(val: unknown) {
  if (!val) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(String(val));
  } catch {
    return null;
  }
}

function normalizePatient(record: any) {
  if (!record) return null;
  const rawToken = record.tokenNumber || record.token;
  const tokenNumber = typeof rawToken === 'number' 
    ? `A${String(rawToken).padStart(3, '0')}` 
    : String(rawToken || '');

  return {
    tokenNumber,
    patientName: record.patientName || record.name || 'Patient',
    phoneNumber: record.phoneNumber || record.phone || '—',
    source: record.source || (record.isWalkIn ? 'walk-in' : 'whatsapp'),
    timeSlot: record.timeSlot || '—',
    status: record.status || 'waiting',
    createdAt: record.createdAt || record.calledAt || new Date().toISOString(),
  };
}

// GET: Fetch live queue, now serving, and waiting list for a clinic
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = (searchParams.get('tenantId') || 'neefa').toLowerCase().trim();

    // 1. Fetch nowServing (check primary key first, fallback to alternate)
    const rawServing = (await redis.get(`tenant:${tenantId}:now_serving`)) ||
      (await redis.get(`tenant:${tenantId}:currently_serving`));
    
    const parsedServing = parseRecord(rawServing);
    const nowServing = parsedServing ? normalizePatient(parsedServing) : null;

    // 2. Fetch full queue list from Redis
    const rawQueue = (await redis.lrange(`tenant:${tenantId}:queue`, 0, -1)) || [];
    
    const waitingQueue = rawQueue
      .map((item: any) => parseRecord(item))
      .filter((item: any) => item && item.status !== 'CANCELLED')
      .map((item: any) => normalizePatient(item));

    // 3. Derive nextPatient dynamically from the head of the queue so it's always in sync
    const nextPatient = waitingQueue.length > 0 ? waitingQueue[0] : null;

    return NextResponse.json({
      success: true,
      data: {
        nowServing,
        nextPatient,
        waitingQueue,
      },
    });
  } catch (error) {
    console.error('Error fetching desk queue:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch queue' }, { status: 500 });
  }
}

// POST: Add a walk-in token from the front-desk UI
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawTenant = body.tenantId || 'neefa';
    const tenantId = String(rawTenant).toLowerCase().trim();
    const { patientName, phoneNumber } = body;

    if (!patientName) {
      return NextResponse.json(
        { success: false, error: 'Patient name is required' },
        { status: 400 }
      );
    }

    // Atomically increment token counter
    const tokenNumber = await redis.incr(`tenant:${tenantId}:counter`);
    const formattedToken = `A${String(tokenNumber).padStart(3, '0')}`;

    const tokenData = {
      tokenNumber: formattedToken,
      patientName: patientName.trim(),
      phoneNumber: phoneNumber ? String(phoneNumber).trim() : 'WALK_IN',
      source: 'walk-in',
      createdAt: new Date().toISOString(),
      status: 'waiting',
    };

    // Push to Redis queue list
    await redis.rpush(`tenant:${tenantId}:queue`, JSON.stringify(tokenData));

    // Sync next_patient cache key
    const currentQueue = (await redis.lrange(`tenant:${tenantId}:queue`, 0, 0)) || [];
    if (currentQueue.length > 0) {
      const parsed = parseRecord(currentQueue[0]);
      if (parsed) {
        await redis.set(`tenant:${tenantId}:next_patient`, JSON.stringify(parsed));
      }
    }

    return NextResponse.json({
      success: true,
      data: tokenData,
    });
  } catch (error) {
    console.error('Error adding walk-in token:', error);
    return NextResponse.json({ success: false, error: 'Failed to add token' }, { status: 500 });
  }
}
