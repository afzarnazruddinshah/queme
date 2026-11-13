import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenantId') || 'neefa';

  try {
    const rawServing = await redis.get(`tenant:${tenantId}:now_serving`);
    let currentServing = 0;

    if (rawServing) {
      if (typeof rawServing === 'object') {
        currentServing = Number(String((rawServing as any).tokenNumber || (rawServing as any).token || 0).replace(/\D/g, '')) || 0;
      } else {
        const parsed = JSON.parse(String(rawServing));
        currentServing = Number(String(parsed.tokenNumber || parsed.token || 0).replace(/\D/g, '')) || 0;
      }
    }

    return NextResponse.json({ success: true, currentServing });
  } catch (err) {
    return NextResponse.json({ success: false, currentServing: 0 }, { status: 500 });
  }
}
