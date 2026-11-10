import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { authorizeDeskRequest } from '../../../../lib/deskAuth';
import { CLINIC_CONFIG } from '../../../../lib/queue.js';

const redis = Redis.fromEnv();

function getTokenMinutesFromMidnight(tokenNumber: number): number {
  return (
    CLINIC_CONFIG.startHour * 60 +
    CLINIC_CONFIG.startMinute +
    (Number(tokenNumber) - 1) * CLINIC_CONFIG.slotDurationMinutes
  );
}

function getCurrentIstMinutes(): number {
  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (utcMinutes + 330) % 1440; // UTC + 5:30
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = (searchParams.get('tenantId') || 'neefa').toLowerCase().trim();

    // 1. Desk Session Authorization Check
    const auth = await authorizeDeskRequest(tenantId);
    if (!auth.authorized) {
      return auth.errorResponse!;
    }

    // 2. Fetch the first patient from waiting list
    const queueKey = `tenant:${tenantId}:queue`;
    const nowServingKey = `tenant:${tenantId}:now_serving`;
    const nextPatientKey = `tenant:${tenantId}:next_patient`;

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

    // 3. Set this patient as the new "Now Serving"
    await redis.set(nowServingKey, JSON.stringify(nextPatient));

    // 4. Dynamic Capacity Expansion Check (High-Water Mark)
    const tokenNum = Number(String(nextPatient.token || nextPatient.tokenNumber || 0).replace(/\D/g, ''));
    if (tokenNum > 0) {
      const scheduledStartMinutes = getTokenMinutesFromMidnight(tokenNum);
      const currentIstMinutes = getCurrentIstMinutes();
      const leadMinutes = scheduledStartMinutes - currentIstMinutes;

      // Check if we are running at least 1 full slot (15 mins) ahead of schedule
      if (leadMinutes >= CLINIC_CONFIG.slotDurationMinutes) {
        const earnedBonusSlots = Math.floor(leadMinutes / CLINIC_CONFIG.slotDurationMinutes);
        const cappedBonus = Math.min(earnedBonusSlots, 4); // Max 4 bonus slots/day

        const bonusKey = `tenant:${tenantId}:max_bonus_slots`;
        const currentHighest = Number(await redis.get(bonusKey)) || 0;

        // High-water mark rule: only increment if current lead exceeds previous peak
        if (cappedBonus > currentHighest) {
          await redis.set(bonusKey, String(cappedBonus));
          // Set 24h expiration on the bonus key so it resets cleanly each morning
          await redis.expire(bonusKey, 86400);
        }
      }
    }

    // 5. Peek at the new next patient in line (index 0 now)
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
