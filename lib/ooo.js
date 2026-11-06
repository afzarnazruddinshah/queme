import { redisCommand } from './redis.js';
import { sendWhatsAppText } from './whatsapp.js';

/**
 * Checks if the clinic is currently in an active OOO window.
 * OOO config structure in Redis:
 * {
 *   enabled: boolean,
 *   startDate: "YYYY-MM-DD",
 *   endDate: "YYYY-MM-DD",
 *   startTime: "HH:mm",
 *   endTime: "HH:mm",
 *   message: string
 * }
 */
export async function getClinicOooStatus(tenantId = 'neefa') {
  try {
    const rawConfig = await redisCommand(['GET', `tenant:${tenantId}:ooo`]);
    if (!rawConfig) return { isOoo: false, config: null };

    const config = typeof rawConfig === 'string' ? JSON.parse(rawConfig) : rawConfig;
    if (!config || !config.enabled) {
      return { isOoo: false, config };
    }

    // Evaluate against current IST time (UTC + 5:30)
    const now = new Date();
    const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
    const istNow = new Date(utcTime + 330 * 60000);

    const pad = (n) => String(n).padStart(2, '0');
    const todayStr = `${istNow.getFullYear()}-${pad(istNow.getMonth() + 1)}-${pad(istNow.getDate())}`;
    const currentMinutes = istNow.getHours() * 60 + istNow.getMinutes();

    // 1. Date Range Check
    if (config.startDate && todayStr < config.startDate) {
      return { isOoo: false, config };
    }
    if (config.endDate && todayStr > config.endDate) {
      return { isOoo: false, config };
    }

    // 2. Time Range Check (if specified)
    if (config.startTime && config.endTime) {
      const [startH, startM] = config.startTime.split(':').map(Number);
      const [endH, endM] = config.endTime.split(':').map(Number);
      const startMin = startH * 60 + startM;
      const endMin = endH * 60 + endM;

      if (currentMinutes < startMin || currentMinutes > endMin) {
        return { isOoo: false, config };
      }
    }

    return { isOoo: true, config };
  } catch (error) {
    console.error('Error evaluating OOO status:', error);
    return { isOoo: false, config: null };
  }
}

/**
 * Rule 1: Broadcasts the custom OOO message to all active waiting token holders.
 */
export async function broadcastOooToWaitingPatients(tenantId = 'neefa', message) {
  try {
    const keyQueue = `tenant:${tenantId}:queue`;
    const list = (await redisCommand(['LRANGE', keyQueue, '0', '-1'])) || [];
    if (list.length === 0) return { broadcastCount: 0 };

    let count = 0;
    const alertBody = `📢 *Clinic Update*\n\n${message}`;

    for (const item of list) {
      try {
        const record = typeof item === 'string' ? JSON.parse(item) : item;
        const phone = record.phoneNumber || record.phone;

        // Only send to valid phone numbers (skip manual counter walk-ins with no phone)
        if (phone && phone !== 'WALK_IN' && phone !== '—') {
          const cleanPhone = String(phone).replace(/\D/g, '');
          if (cleanPhone.length >= 10) {
            await sendWhatsAppText(cleanPhone, alertBody);
            count++;
          }
        }
      } catch (_) {}
    }

    return { broadcastCount: count };
  } catch (error) {
    console.error('Error broadcasting OOO to waiting patients:', error);
    return { broadcastCount: 0 };
  }
}
