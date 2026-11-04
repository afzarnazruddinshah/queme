import { redisCommand } from './redis.js';
import { sendWhatsAppText } from './whatsapp.js';
import { getTokenTime, registerWalkInToken, getMaxTokens, isClinicPastClosing, adminCancelToken } from './queue.js';

// Helper to extract clean token number string or integer from string/JSON
function extractServingToken(rawServing) {
  if (!rawServing) return 0;
  if (typeof rawServing === 'object') {
    return Number(String(rawServing.tokenNumber || rawServing.token || 0).replace(/\D/g, '')) || 0;
  }
  try {
    const parsed = JSON.parse(rawServing);
    return Number(String(parsed.tokenNumber || parsed.token || 0).replace(/\D/g, '')) || 0;
  } catch (_) {
    return Number(String(rawServing).replace(/\D/g, '')) || 0;
  }
}

export async function handleAdminCommand(adminPhone, commandText, tenantId = 'neefa') {
  const trimmed = commandText.trim();
  const lowerCmd = trimmed.toLowerCase();

  // Multi-tenant key namespace
  const keyCounter = `tenant:${tenantId}:counter`;
  const keyQueue = `tenant:${tenantId}:queue`;
  const keyServing = `tenant:${tenantId}:now_serving`;

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

    const result = await registerWalkInToken(name, optionalPhone, tenantId);
    let reply = `✅ *Walk-In Token Added!*\n\n• Token: *#${result.token}*\n• Name: *${name}*\n• Estimated Slot: *${result.timeSlot}*`;
    
    if (optionalPhone) {
      reply += `\n• Notified: +${optionalPhone}`;
    }

    if (result.isOverCapacity || isClinicPastClosing()) {
      reply += `\n\n⚠️ *Notice:* This token falls beyond standard operating hours (10:00 AM – 9:00 PM / Max ${result.maxTokens} tokens).`;
    }

    await sendWhatsAppText(adminPhone, reply);
    return;
  }

  // 2. COMMAND: /status
  if (lowerCmd === '/status') {
    const rawServing = await redisCommand(['GET', keyServing]);
    const currentServing = extractServingToken(rawServing);
    const totalIssued = Number(await redisCommand(['GET', keyCounter])) || 0;
    const maxTokens = getMaxTokens();
    const list = (await redisCommand(['LRANGE', keyQueue, '0', '-1'])) || [];

    const activeWaiting = list.filter((item) => {
      try {
        const parsed = JSON.parse(item);
        const tokenNum = Number(String(parsed.token || parsed.tokenNumber || 0).replace(/\D/g, ''));
        return tokenNum > currentServing && parsed.status !== 'CANCELLED';
      } catch (_) {
        return false;
      }
    }).length;

    const servingTime = currentServing > 0 ? getTokenTime(currentServing) : 'Not started';
    const statusMsg = `📊 *Queue Status Report*\n\n• Currently Serving: *#${currentServing}* (${servingTime})\n• Total Issued: *#${totalIssued} / ${maxTokens}*\n• Active Waiting: *${activeWaiting}*`;
    await sendWhatsAppText(adminPhone, statusMsg);

  // 3. COMMAND: /queue
  } else if (lowerCmd === '/queue') {
    const list = (await redisCommand(['LRANGE', keyQueue, '0', '-1'])) || [];
    const rawServing = await redisCommand(['GET', keyServing]);
    const currentServing = extractServingToken(rawServing);

    if (list.length === 0 && currentServing === 0) {
      await sendWhatsAppText(adminPhone, '📋 Queue is currently empty.');
      return;
    }

    let queueRoster = `📋 *Active Queue List* (Serving: #${currentServing || 'None'}):\n\n`;
    list.forEach((item) => {
      try {
        const record = JSON.parse(item);
        const tokenNum = record.token || record.tokenNumber;
        const patientName = record.name || record.patientName;
        const phone = record.phone || record.phoneNumber;

        let prefix = '• ';
        let tag = phone === 'WALK_IN' || record.source === 'walk-in' ? ' [Walk-in]' : '';

        if (record.status === 'CANCELLED') {
          prefix = '❌ ';
          tag += ' [CANCELLED]';
        } else if (Number(String(tokenNum).replace(/\D/g, '')) === currentServing) {
          prefix = '👉 ';
        }

        queueRoster += `${prefix}*#${tokenNum}* [${record.timeSlot || getTokenTime(tokenNum)}] - ${patientName}${tag}\n`;
      } catch (_) {}
    });

    await sendWhatsAppText(adminPhone, queueRoster);

  // 4. COMMAND: /next
  } else if (lowerCmd === '/next') {
    const list = (await redisCommand(['LRANGE', keyQueue, '0', '-1'])) || [];

    let nextUser = null;
    let nextIndex = -1;

    for (let i = 0; i < list.length; i++) {
      try {
        const parsed = JSON.parse(list[i]);
        if (parsed.status === 'ACTIVE' || parsed.status === 'waiting') {
          nextUser = parsed;
          nextIndex = i;
          break;
        }
      } catch (_) {}
    }

    if (!nextUser) {
      await sendWhatsAppText(adminPhone, '⚠️ No active tokens remaining in line.');
      return;
    }

    const nextTokenNum = nextUser.tokenNumber || (nextUser.token ? `A${String(nextUser.token).padStart(3, '0')}` : 'A001');
    const nextUserName = nextUser.patientName || nextUser.name || 'Patient';
    const nextPhone = nextUser.phoneNumber || nextUser.phone;

    const servingPayload = {
      tokenNumber: nextTokenNum,
      patientName: nextUserName,
      phoneNumber: nextPhone || '—',
      source: nextUser.source || (nextUser.isWalkIn ? 'walk-in' : 'whatsapp'),
      status: 'serving',
      calledAt: new Date().toISOString(),
    };

    // Store for Desk UI and redundant keys
    await redisCommand(['SET', keyServing, JSON.stringify(servingPayload)]);
    await redisCommand(['SET', `tenant:${tenantId}:currently_serving`, JSON.stringify(servingPayload)]);

    // Remove from waiting queue list
    await redisCommand(['LREM', keyQueue, '1', list[nextIndex]]);

    if (nextPhone && nextPhone !== 'WALK_IN' && nextPhone !== '—') {
      const userTurnMsg = `🎉 *Hi ${nextUserName}!*\n\nIt is now *YOUR TURN* (Token *#${nextTokenNum}*).\nPlease proceed to the consultation room.`;
      await sendWhatsAppText(nextPhone, userTurnMsg);
    }

    const walkInLabel = (nextPhone === 'WALK_IN' || servingPayload.source === 'walk-in') ? ' [Walk-in]' : '';
    await sendWhatsAppText(
      adminPhone,
      `✅ Now serving: *#${nextTokenNum}* (${nextUserName})${walkInLabel}.`
    );

  // 5. COMMAND: /cancel <Phone or Token#>
  } else if (lowerCmd.startsWith('/cancel')) {
    const target = trimmed.slice(7).trim();
    if (!target) {
      await sendWhatsAppText(
        adminPhone,
        '⚠️ Please specify a phone number or token number.\nExamples:\n• */cancel 9876543210*\n• */cancel 4*'
      );
      return;
    }

    const result = await adminCancelToken(target, tenantId);
    if (!result.success) {
      await sendWhatsAppText(adminPhone, `⚠️ ${result.reason}`);
      return;
    }

    // Check if the cancelled token happens to be currently in now_serving; clear if so
    const rawServing = await redisCommand(['GET', keyServing]);
    if (rawServing) {
      const servingTokenClean = extractServingToken(rawServing);
      const targetClean = Number(String(result.token).replace(/\D/g, ''));
      if (servingTokenClean === targetClean && targetClean > 0) {
        await redisCommand(['DEL', keyServing, `tenant:${tenantId}:currently_serving`]);
      }
    }

    const phoneNote = result.phone && result.phone !== 'WALK_IN' ? ` (+${result.phone})` : ' [Walk-in]';
    await sendWhatsAppText(
      adminPhone,
      `✅ *Token #${result.token} Cancelled*\n• Patient: *${result.name}*${phoneNote}\n• Notified via WhatsApp: ${result.phone && result.phone !== 'WALK_IN' ? 'Yes' : 'No'}`
    );
    return;

  // 6. COMMAND: /reset
  } else if (lowerCmd === '/reset') {
    // 1. Delete all queue, counter, and serving keys
    await redisCommand([
      'DEL',
      keyCounter,
      keyQueue,
      keyServing,
      `tenant:${tenantId}:currently_serving`,
      `tenant:${tenantId}:next_patient`,
      'queue:waiting_list',
      'queue:token_counter',
      'queue:currently_serving',
    ]);

    // 2. Remove all active patient phone session locks for this tenant
    const userKeys = (await redisCommand(['KEYS', `tenant:${tenantId}:user:*`])) || [];
    if (userKeys.length > 0) {
      await redisCommand(['DEL', ...userKeys]);
    }

    // 3. Remove legacy user keys
    const legacyUserKeys = (await redisCommand(['KEYS', 'user:*'])) || [];
    if (legacyUserKeys.length > 0) {
      await redisCommand(['DEL', ...legacyUserKeys]);
    }

    await sendWhatsAppText(
      adminPhone,
      '🔄 *Queue has been completely reset.*\n• Waiting list cleared\n• Now serving cleared\n• Counter reset to 0'
    );
    return;

  } else {
    const helpMsg = `❓ *Admin Commands:*\n• */add <Name> [Phone]* - Add walk-in visitor\n• */cancel <Phone/Token#>* - Cancel spam or no-show token\n• */next* - Call next token\n• */status* - Queue overview\n• */queue* - Full roster\n• */reset* - Clear today's queue`;
    await sendWhatsAppText(adminPhone, helpMsg);
  }
}
