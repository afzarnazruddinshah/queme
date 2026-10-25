import { redisCommand } from './redis.js';
import { sendWhatsAppText } from './whatsapp.js';
import { getTokenTime, registerWalkInToken, getMaxTokens, isClinicPastClosing,adminCancelToken } from './queue.js';

export async function handleAdminCommand(adminPhone, commandText) {
  const trimmed = commandText.trim();
  const lowerCmd = trimmed.toLowerCase();

  // 1. COMMAND: /add <Name> [Phone]
  if (lowerCmd.startsWith('/add')) {
    const rawArgs = trimmed.slice(4).trim();
    if (!rawArgs) {
      await sendWhatsAppText(
        adminPhone,
        '⚠️ Please provide a name.\nExample:\n• */add Ramesh*\n• */add Priya 919876543210*'
      );
      return;
    }

    const parts = rawArgs.split(/\s+/);
    let name = rawArgs;
    let optionalPhone = null;

    const lastWord = parts[parts.length - 1].replace(/\D/g, '');
    if (lastWord.length >= 7 && lastWord.length <= 15) {
      optionalPhone = lastWord;
      name = parts.slice(0, -1).join(' ').trim();
    }

    if (!name) {
      await sendWhatsAppText(adminPhone, '⚠️ Name cannot be empty. Example: */add John*');
      return;
    }

    const result = await registerWalkInToken(name, optionalPhone);
    let reply = `✅ *Walk-In Token Added!*\n\n• Token: *#${result.token}*\n• Name: *${name}*\n• Estimated Slot: *${result.timeSlot}*`;
    
    if (optionalPhone) {
      reply += `\n• Notified: +${optionalPhone}`;
    }

    // Gentle warning if past closing time or beyond max slots
    if (result.isOverCapacity || isClinicPastClosing()) {
      reply += `\n\n⚠️ *Notice:* This token falls beyond the standard operating hours (10:00 AM – 9:00 PM / Max ${result.maxTokens} tokens).`;
    }

    await sendWhatsAppText(adminPhone, reply);
    return;
  }

  // 2. COMMAND: /status
  if (lowerCmd === '/status') {
    const currentServing = Number(await redisCommand(['GET', 'queue:currently_serving'])) || 0;
    const totalIssued = Number(await redisCommand(['GET', 'queue:token_counter'])) || 0;
    const maxTokens = getMaxTokens();
    const list = (await redisCommand(['LRANGE', 'queue:waiting_list', '0', '-1'])) || [];

    const activeWaiting = list.filter((item) => {
      try {
        const parsed = JSON.parse(item);
        return Number(parsed.token) > currentServing && parsed.status === 'ACTIVE';
      } catch (_) {
        return false;
      }
    }).length;

    const servingTime = currentServing > 0 ? getTokenTime(currentServing) : 'Not started';
    const statusMsg = `📊 *Queue Status Report*\n\n• Currently Serving: *#${currentServing}* (${servingTime})\n• Total Issued: *#${totalIssued} / ${maxTokens}*\n• Active Waiting: *${activeWaiting}*`;
    await sendWhatsAppText(adminPhone, statusMsg);

  // 3. COMMAND: /queue
  } else if (lowerCmd === '/queue') {
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
        let tag = record.phone === 'WALK_IN' ? ' [Walk-in]' : '';

        if (record.status === 'CANCELLED') {
          prefix = '❌ ';
          tag += ' [CANCELLED]';
        } else if (Number(record.token) === currentServing) {
          prefix = '👉 ';
        }

        queueRoster += `${prefix}*#${record.token}* [${record.timeSlot || getTokenTime(record.token)}] - ${record.name}${tag}\n`;
      } catch (_) {}
    });

    await sendWhatsAppText(adminPhone, queueRoster);

  // 4. COMMAND: /next
  } else if (lowerCmd === '/next') {
    const totalIssued = Number(await redisCommand(['GET', 'queue:token_counter'])) || 0;
    let currentServing = Number(await redisCommand(['GET', 'queue:currently_serving'])) || 0;
    const list = (await redisCommand(['LRANGE', 'queue:waiting_list', '0', '-1'])) || [];

    let nextUser = null;
    let targetToken = currentServing + 1;

    while (targetToken <= totalIssued) {
      const candidate = list.find((item) => {
        try {
          return Number(JSON.parse(item).token) === targetToken;
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

    await redisCommand(['SET', 'queue:currently_serving', String(nextUser.token)]);

    if (nextUser.phone && nextUser.phone !== 'WALK_IN') {
      const userTurnMsg = `🎉 *Hi ${nextUser.name}!*\n\nIt is now *YOUR TURN* (Token *#${nextUser.token}* - Slot: *${nextUser.timeSlot}*).\nPlease proceed to the counter.`;
      await sendWhatsAppText(nextUser.phone, userTurnMsg);
    }

    const skippedCount = Number(nextUser.token) - currentServing - 1;
    const skipNote = skippedCount > 0 ? ` (Skipped ${skippedCount} cancelled/inactive)` : '';
    const walkInLabel = nextUser.phone === 'WALK_IN' ? ' [Walk-in / In-person]' : '';

    await sendWhatsAppText(
      adminPhone,
      `✅ Now serving: *#${nextUser.token}* (${nextUser.name})${walkInLabel}${skipNote}.`
    );
}

  //
  // COMMAND: /cancel <Phone or Token#>
  // Examples: "/cancel 9876543210" or "/cancel
  else if (lowerCmd.startsWith('/cancel')) {
    const target = trimmed.slice(7).trim(); // remove "/cancel"
    if (!target) {
      await sendWhatsAppText(
        adminPhone,
        '⚠️ Please specify a phone number or token number.\nExamples:\n• */cancel 9876543210*\n• */cancel 4*'
      );
      return;
    }

    const result = await adminCancelToken(target);
    if (!result.success) {
      await sendWhatsAppText(adminPhone, `⚠️ ${result.reason}`);
      return;
    }

    const phoneNote = result.phone && result.phone !== 'WALK_IN' ? ` (+${result.phone})` : ' [Walk-in]';
    await sendWhatsAppText(
      adminPhone,
      `✅ *Token #${result.token} Cancelled*\n• Patient: *${result.name}*${phoneNote}\n• Notified via WhatsApp: ${result.phone && result.phone !== 'WALK_IN' ? 'Yes' : 'No'}`
    );
    return;
  }


  // 5. COMMAND: /reset
  else if (lowerCmd === '/reset') {
    await redisCommand(['DEL', 'queue:token_counter', 'queue:currently_serving', 'queue:waiting_list']);
    const userKeys = (await redisCommand(['KEYS', 'user:*'])) || [];
    if (userKeys.length > 0) {
      await redisCommand(['DEL', ...userKeys]);
    }
    await sendWhatsAppText(adminPhone, '🔄 *Queue has been completely reset to 0.*');

  } else {
  const helpMsg = `❓ *Admin Commands:*\n• */add <Name> [Phone]* - Add walk-in visitor\n• */cancel <Phone/Token#>* - Cancel spam or no-show token\n• */next* - Call next token\n• */status* - Queue overview\n• */queue* - Full roster\n• */reset* - Clear today's queue`;
  await sendWhatsAppText(adminPhone, helpMsg);

    
  }
}
