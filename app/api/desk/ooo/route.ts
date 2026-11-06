import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { broadcastOooToWaitingPatients } from '../../../lib/ooo.js';

const redis = Redis.fromEnv();

// GET: Fetch current OOO schedule and message
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = (searchParams.get('tenantId') || 'neefa').toLowerCase().trim();

    const raw = await redis.get(`tenant:${tenantId}:ooo`);
    const config = typeof raw === 'string' ? JSON.parse(raw) : raw;

    return NextResponse.json({
      success: true,
      config: config || {
        enabled: false,
        startDate: '',
        endDate: '',
        startTime: '',
        endTime: '',
        message: 'The doctor is currently Out of Office. Consultation and token registrations are temporarily paused.',
      },
    });
  } catch (error) {
    console.error('Error fetching OOO config:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch OOO config' }, { status: 500 });
  }
}

// POST: Save OOO schedule, toggle state, and trigger broadcast
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      tenantId = 'neefa',
      enabled = false,
      startDate = '',
      endDate = '',
      startTime = '',
      endTime = '',
      message = '',
      notifyExisting = true,
    } = body;

    const cleanTenant = String(tenantId).toLowerCase().trim();
    const cleanMessage = String(message).trim() || 'The doctor is currently Out of Office. Token registrations are temporarily paused.';

    const oooPayload = {
      enabled: Boolean(enabled),
      startDate,
      endDate,
      startTime,
      endTime,
      message: cleanMessage,
      updatedAt: new Date().toISOString(),
    };

    // 1. Save config to Redis
    await redis.set(`tenant:${cleanTenant}:ooo`, JSON.stringify(oooPayload));

    // 2. Broadcast to existing queue holders if enabled and requested
    let broadcastCount = 0;
    if (enabled && notifyExisting) {
      const broadcastRes = await broadcastOooToWaitingPatients(cleanTenant, cleanMessage);
      broadcastCount = broadcastRes.broadcastCount;
    }

    return NextResponse.json({
      success: true,
      message: enabled
        ? `OOO activated successfully. ${broadcastCount > 0 ? `Alert sent to ${broadcastCount} waiting patient(s).` : ''}`
        : 'OOO deactivated. Clinic registrations are open.',
      config: oooPayload,
      broadcastCount,
    });
  } catch (error) {
    console.error('Error saving OOO config:', error);
    return NextResponse.json({ success: false, error: 'Failed to save OOO config' }, { status: 500 });
  }
}
