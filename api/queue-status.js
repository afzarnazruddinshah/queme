import { redisCommand } from '../lib/redis.js';
import { getTokenTime } from '../lib/queue.js';

export default async function handler(req, res) {
  // Allow public read or embedded display
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    const currentServing = Number(await redisCommand(['GET', 'queue:currently_serving'])) || 0;
    const totalIssued = Number(await redisCommand(['GET', 'queue:token_counter'])) || 0;
    const listRaw = (await redisCommand(['LRANGE', 'queue:waiting_list', '0', '-1'])) || [];

    const parsedList = listRaw.map((item) => {
      try {
        return JSON.parse(item);
      } catch (_) {
        return null;
      }
    }).filter(Boolean);

    // Current serving record
    const servingRecord = parsedList.find((item) => Number(item.token) === currentServing && item.status === 'ACTIVE');

    // Upcoming active waiting list
    const upcoming = parsedList.filter((item) => {
      return Number(item.token) > currentServing && item.status === 'ACTIVE';
    });

    return res.status(200).json({
      serving: {
        token: currentServing,
        name: servingRecord ? servingRecord.name : (currentServing > 0 ? 'In Session' : 'Waiting to start'),
        timeSlot: currentServing > 0 ? getTokenTime(currentServing) : '--:--',
      },
      stats: {
        totalIssued,
        waitingCount: upcoming.length,
      },
      upcoming: upcoming.slice(0, 8), // Show next 8 people
      updatedAt: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    });
  } catch (error) {
    console.error('Queue status fetch failed:', error);
    return res.status(500).json({ error: 'Failed to fetch queue state' });
  }
}
