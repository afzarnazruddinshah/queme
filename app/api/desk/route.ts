import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

const CLINIC_CONFIG = {
  startHour: 10,
  startMinute: 0,
  closeHour: 22,
  closeMinute: 0,
  slotDurationMinutes: 15,
};

function getTokenTime(tokenNumber: number | string): string {
  const cleanNum = Number(String(tokenNumber).replace(/\D/g, ''));
  if (isNaN(cleanNum) || cleanNum <= 0) return '—';

  const totalMinutes =
    CLINIC_CONFIG.startHour * 60 +
    CLINIC_CONFIG.startMinute +
    (cleanNum - 1) * CLINIC_CONFIG.slotDurationMinutes;

  const hours24 = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const formattedMinutes = String(minutes).padStart(2, '0');

  return `${hours12}:${formattedMinutes} ${period}`;
}

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
  const cleanDigits = Number(String(record.tokenNumber || record.token || 0).replace(/\D/g, ''));
  const tokenNumber = record.tokenNumber || (cleanDigits > 0 ? `A${String(cleanDigits).padStart(3, '0')}` : '—');
  const timeSlot = record.timeSlot || (cleanDigits > 0 ? getTokenTime(cleanDigits) : '—');

  return {
    token: cleanDigits,
    tokenNumber,
    patientName: record.patientName || record.name || 'Patient',
    phoneNumber: record.phoneNumber || record.phone || '—',
    source: record.source || (record.isWalkIn ? 'walk-in' : 'whatsapp'),
    timeSlot,
    status: record.status || 'waiting',
    createdAt: record.createdAt || record.calledAt || new Date().toISOString(),
  };
}

// GET: Fetch live queue, now serving, and waiting list for a clinic
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = (searchParams.get('tenantId') || 'neefa').toLowerCase().trim();

    // 1. Fetch nowServing
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

    // 3. Derive nextPatient dynamically from head of queue
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

    const counterKey = `tenant:${tenantId}:counter`;
    const queueKey = `tenant:${tenantId}:queue`;
    const cancelledKey = `tenant:${tenantId}:cancelled_slots`;

    // 1. Check for eligible cancelled slot (>= 30 mins buffer)
    const rawCancelled = (await redis.lrange(cancelledKey, 0, -1)) || [];
    let assignedTokenNum: number | null = null;

    if (rawCancelled.length > 0) {
      const now = new Date();
      const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
      const istMinutes = (utcMinutes + 330) % 1440;

      const sortedSlots = rawCancelled
        .map((num: any) => Number(num))
        .filter((num: number) => !isNaN(num) && num > 0)
        .sort((a: number, b: number) => a - b);

      for (const candidate of sortedSlots) {
        const slotStart =
          CLINIC_CONFIG.startHour * 60 +
          CLINIC_CONFIG.startMinute +
          (candidate - 1) * CLINIC_CONFIG.slotDurationMinutes;

        if (slotStart - istMinutes >= 30) {
          assignedTokenNum = candidate;
          await redis.lrem(cancelledKey, 1, String(candidate));
          break;
        }
      }
    }

    // 2. If no eligible gap, increment counter
    if (!assignedTokenNum) {
      assignedTokenNum = await redis.incr(counterKey);
    }

    const formattedToken = `A${String(assignedTokenNum).padStart(3, '0')}`;
    const timeSlot = getTokenTime(assignedTokenNum);

    // 3. Store normalized token record with both token, tokenNumber, and computed timeSlot
    const tokenData = {
      token: assignedTokenNum,
      tokenNumber: formattedToken,
      patientName: patientName.trim(),
      name: patientName.trim(),
      phoneNumber: phoneNumber ? String(phoneNumber).trim() : 'WALK_IN',
      phone: phoneNumber ? String(phoneNumber).trim() : 'WALK_IN',
      source: 'walk-in',
      isWalkIn: true,
      timeSlot,
      createdAt: new Date().toISOString(),
      timestamp: Date.now(),
      status: 'waiting',
    };

    // 4. Fetch existing list, insert, and keep sorted by token number
    const rawQueue = (await redis.lrange(queueKey, 0, -1)) || [];
    const records: any[] = [];

    for (const item of rawQueue) {
      const parsed = parseRecord(item);
      if (parsed) records.push(parsed);
    }
    records.push(tokenData);

    records.sort((a, b) => {
      const aNum = Number(String(a.token || a.tokenNumber || 0).replace(/\D/g, ''));
      const bNum = Number(String(b.token || b.tokenNumber || 0).replace(/\D/g, ''));
      return aNum - bNum;
    });

    await redis.del(queueKey);
    if (records.length > 0) {
      await redis.rpush(queueKey, ...records.map((r) => JSON.stringify(r)));
    }

    // 5. Update next_patient cache key
    if (records.length > 0) {
      await redis.set(`tenant:${tenantId}:next_patient`, JSON.stringify(records[0]));
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