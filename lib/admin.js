import { redisCommand } from './redis.js';
import { sendWhatsAppText } from './whatsapp.js';
import { getTokenTime } from './queue.js';

export async function handleAdminCommand(adminPhone, commandText) {
  const cmd = commandText.trim().toLowerCase();

  if (cmd === '/status') {
    const currentServing = Number(await redisCommand(['GET', 'queue:currently_serving'])) || 0;
    const totalIssued = Number(await redisCommand(['GET', 'queue:token_counter'])) || 0;
    const list = (await redisCommand(['LRANGE', 'queue:waiting_list', '0', '-1'])) || [];

    // Count only active (non-cancelled) users ahead
    const activeWaiting = list.filter((item) => {
      try {
        const parsed = JSON.parse(item);
        return parsed.token > currentServing && parsed.status === 'ACTIVE';
      } catch (_) {
        return false;
      }
    }).length;

    const servingTime = currentServing > 0 ? getTokenTime(currentServing) : 'Not started';
    const statusMsg = `📊 *Queue Status Report*\n\n• Currently Serving: *#${currentServing}* (${servingTime})\n• Total Tokens Issued: *#${totalIssued}*\n• Active Waiting: *${activeWaiting}*`;
    await sendWhatsAppText(adminPhone, statusMsg);

  } else if (cmd === '/queue') {
    const list = (await redisCommand(['LRANGE', 'queue:waiting_list', '0', '-1'])) || [];
    const currentServing = Number(await redisCommand(['GET', 'queue:currently_serving'])) || 0;

    if (list.length === 0) {
      await sendWhatsAppText(adminPhone, '📋 Queue is currently empty.');
      return;
    }

    let queueRoster = `📋 *Active Queue List* (Serving #${currentServing}):\n\n`;
    list.forEach((item) => {
      try {
        const record = JSON.parse(item);
        let prefix = '• ';
        let tag = '';

        if (record.status === 'CANCELLED') {
          prefix = '❌ ';
          tag = ' [CANCELLED]';
        } else if (record.token === currentServing) {
          prefix = '👉 ';
        }

        queueRoster += `${prefix}*#${record.token}* [${record.timeSlot || getTokenTime(record.token)}] - ${record.name}${tag}\n`;
      } catch (_) {}
    });

    await sendWhatsAppText(adminPhone, queueRoster);

  } else if (cmd === '/next') {
    const totalIssued = Number(await redisCommand(['GET', 'queue:token_counter'])) || 0;
    let currentServing = Number(await redisCommand(['GET', 'queue:currently_serving'])) || 0;
    const list = (await redisCommand(['LRANGE', 'queue:waiting_list', '0', '-1'])) || [];

    // Find the next ACTIVE token (skipping cancelled entries)
    let nextUser = null;
    let targetToken = currentServing + 1;

    while (targetToken <= totalIssued) {
      const candidate = list.find((item) => {
        try {
          return JSON.parse(item).token === targetToken;
        } catch (_) {
          return false;
        }
      });

      if (candidate) {
        const parsed = JSON.parse(candidate);
        if (parsed.status === 'ACTIVE') {
          nextUser = parsed;
          break;
        }
      }
      targetToken++;
    }

    if (!nextUser) {
      await sendWhatsAppText(adminPhone, '⚠️ No active tokens remaining in line.');
      return;
    }

    // Update pointer directly to the target token
    await redisCommand(['SET', 'queue:currently_serving', nextUser.token]);

    // 1. Notify user
    const userTurnMsg = `🎉 *Hi ${nextUser.name}!*\n\nIt is now *YOUR TURN* (Token *#${nextUser.token}* - Slot: *${nextUser.timeSlot}*).\nPlease proceed to the counter.`;
    await sendWhatsAppText(nextUser.phone, userTurnMsg);

    // 2. Confirm to Admin
    const skippedCount = nextUser.token - currentServing - 1;
    const skipNote = skippedCount > 0 ? ` (Skipped ${skippedCount} cancelled/inactive)` : '';
    await sendWhatsAppText(adminPhone, `✅ Now serving: *#${nextUser.token}* (${nextUser.name})${skipNote}.`);

  } else if (cmd === '/reset') {
    await redisCommand(['DEL', 'queue:token_counter', 'queue:currently_serving', 'queue:waiting_list']);
    const userKeys = (await redisCommand(['KEYS', 'user:*'])) || [];
    if (userKeys.length > 0) {
      await redisCommand(['DEL', ...userKeys]);
    }
    await sendWhatsAppText(adminPhone, '🔄 *Queue has been completely reset to 0.*');

  } else {
    const helpMsg = `❓ *Commands:*\n• */next* - Call next active token\n• */status* - Overview\n• */queue* - Full roster\n• */reset* - Clear queue`;
    await sendWhatsAppText(adminPhone, helpMsg);
  }
}