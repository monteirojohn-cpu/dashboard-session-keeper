/**
 * Background polling worker — checks all active servers every 30s.
 * Implements 3-strike anti-false-positive rule:
 *   - Channel only marked as DOWN after 3 consecutive offline checks
 *   - Notification sent ONCE per outage event
 *   - Recovery notification when channel comes back online after confirmed down
 *   - State persisted in SQLite (survives restarts)
 */

const { getDb } = require('./db');
const { fetchChannelsFromServer } = require('./metrics');

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const FAIL_THRESHOLD = 7;

let running = false;

const normalizeId = (id) => String(id).replace(/\.0$/, '');

function toBRTime(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Sao_Paulo' });
}

function toBRDate(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function isWithinMaintenanceWindow(server) {
  if (!server.maintenance_enabled) return false;
  if (!server.maintenance_start || !server.maintenance_end) return false;

  const tz = server.maintenance_tz || 'America/Sao_Paulo';
  const now = new Date();
  const nowStr = now.toLocaleString('en-US', { timeZone: tz });
  const localNow = new Date(nowStr);

  const [startH, startM] = server.maintenance_start.split(':').map(Number);
  const [endH, endM] = server.maintenance_end.split(':').map(Number);
  const currentMinutes = localNow.getHours() * 60 + localNow.getMinutes();
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  // Check days of week if configured
  if (server.maintenance_days) {
    const days = JSON.parse(server.maintenance_days); // e.g. [0,1,2,3,4,5,6]
    if (days.length > 0 && !days.includes(localNow.getDay())) return false;
  }

  // Handle overnight windows (e.g. 23:00 - 05:00)
  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

async function pollAllServers() {
  if (running) return; // guard against overlap
  running = true;

  const db = getDb();
  const now = new Date().toISOString();

  try {
    const servers = db.prepare("SELECT * FROM servers WHERE status = 'active'").all();
    const allDownEvents = [];
    const allUpEvents = [];

    for (const server of servers) {
      try {
        const channels = await fetchChannelsFromServer(server);
        console.log(`[worker] server="${server.name}" fetched ${channels.length} live channels`);

        // Filter by monitored_channels if any selection exists for this server
        const monitoredRows = db.prepare('SELECT * FROM monitored_channels WHERE server_id = ?').all(server.id);
        let filteredChannels = channels;
        if (monitoredRows.length > 0) {
          const disabledIds = new Set(monitoredRows.filter(r => !r.enabled).map(r => normalizeId(r.channel_id)));
          filteredChannels = channels.filter(ch => !disabledIds.has(normalizeId(ch.id)));
          console.log(`[worker] server="${server.name}" monitored filter: ${channels.length} -> ${filteredChannels.length} (${disabledIds.size} disabled)`);
        }

        // Auto-discover new channels into monitored_channels
        const upsertDiscovered = db.prepare(`
          INSERT INTO monitored_channels (server_id, channel_id, channel_name, enabled, updated_at)
          VALUES (?, ?, ?, 1, ?)
          ON CONFLICT(server_id, channel_id) DO UPDATE SET channel_name = excluded.channel_name, updated_at = excluded.updated_at
        `);
        const txDiscover = db.transaction(() => {
          for (const ch of channels) {
            const existing = db.prepare('SELECT 1 FROM monitored_channels WHERE server_id = ? AND channel_id = ?').get(server.id, ch.id);
            if (!existing) {
              upsertDiscovered.run(server.id, ch.id, ch.name, now);
            }
          }
        });
        txDiscover();

        const events = processChannels(db, filteredChannels, server, now);
        
        // Apply maintenance window suppression per server
        const inMaintenance = isWithinMaintenanceWindow(server);
        
        if (inMaintenance) {
          if (events.downEvents.length > 0 && server.maintenance_silence_down) {
            console.log(`[maintenance] SUPPRESS_BATCH_DOWN server="${server.name}" count=${events.downEvents.length}`);
            for (const e of events.downEvents) {
              console.log(`[maintenance] SUPPRESS_DOWN server="${server.name}" channel="${e.channel_name}" reason="within window"`);
            }
          } else {
            allDownEvents.push(...events.downEvents.map(e => ({ ...e, server_id: server.id })));
          }
          
          if (events.upEvents.length > 0 && server.maintenance_silence_up) {
            console.log(`[maintenance] SUPPRESS_BATCH_UP server="${server.name}" count=${events.upEvents.length}`);
            for (const e of events.upEvents) {
              console.log(`[maintenance] SUPPRESS_UP server="${server.name}" channel="${e.channel_name}" reason="within window"`);
            }
          } else {
            allUpEvents.push(...events.upEvents.map(e => ({ ...e, server_id: server.id })));
          }
        } else {
          allDownEvents.push(...events.downEvents.map(e => ({ ...e, server_id: server.id })));
          allUpEvents.push(...events.upEvents.map(e => ({ ...e, server_id: server.id })));
        }
      } catch (err) {
        console.error(`[worker] Erro ao verificar servidor ${server.name}:`, err.message);
      }
    }

    // Batch notifications
    if (allDownEvents.length > 0 || allUpEvents.length > 0) {
      console.log(`[batch] downEvents=${allDownEvents.length} upEvents=${allUpEvents.length} => sending batched notifications`);
      await sendBatchNotifications(allDownEvents, allUpEvents);
    }
  } catch (err) {
    console.error('[worker] Erro geral:', err.message);
  } finally {
    running = false;
  }
}

function processChannels(db, channels, server, now) {
  const sid = server.id;

  const getStatus = db.prepare('SELECT * FROM channel_status WHERE channel_id = ? AND server_id = ?');
  const upsertStatus = db.prepare(`
    INSERT INTO channel_status (channel_id, server_id, channel_name, status, online_since, offline_since, fail_count, is_down, down_since, last_check_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_id, server_id) DO UPDATE SET
      channel_name = excluded.channel_name,
      status = excluded.status,
      online_since = excluded.online_since,
      offline_since = excluded.offline_since,
      fail_count = excluded.fail_count,
      is_down = excluded.is_down,
      down_since = excluded.down_since,
      last_check_at = excluded.last_check_at,
      updated_at = excluded.updated_at
  `);

  const openOutage = db.prepare(`
    INSERT INTO channel_outage_events (channel_id, channel_name, server_id, started_at)
    VALUES (?, ?, ?, ?)
  `);

  const closeOutage = db.prepare(`
    UPDATE channel_outage_events
    SET ended_at = ?, duration_seconds = CAST((julianday(?) - julianday(started_at)) * 86400 AS INTEGER)
    WHERE channel_id = ? AND server_id = ? AND ended_at IS NULL
  `);

  const downEvents = [];
  const upEvents = [];

  const transaction = db.transaction((channelsList) => {
    for (const ch of channelsList) {
      const prev = getStatus.get(ch.id, sid);
      const isFail = ch.status === 'offline' || ch.status === 'degraded';

      let failCount = prev ? prev.fail_count : 0;
      let isDown = prev ? prev.is_down : 0;
      let downSince = prev ? prev.down_since : null;
      let onlineSince = prev ? prev.online_since : null;
      let offlineSince = prev ? prev.offline_since : null;

      if (!isFail) {
        // Channel is online — check recovery
        if (isDown) {
          closeOutage.run(now, now, ch.id, sid);
          const durSec = downSince ? Math.round((Date.now() - new Date(downSince).getTime()) / 1000) : 0;
          console.log(`[rule] channel="${ch.name}" id=${ch.id} server="${server.name}" status=ONLINE is_down=1 => RECOVERED => notifying UP`);
          upEvents.push({ channel_name: ch.name, channel_id: ch.id, server_name: server.name, downtime_seconds: durSec, down_at: downSince });
        } else if (failCount > 0) {
          console.log(`[rule] channel="${ch.name}" id=${ch.id} server="${server.name}" status=ONLINE fail_count=${failCount} => RESET (back before threshold)`);
        }
        failCount = 0;
        isDown = 0;
        downSince = null;
        if (!prev || prev.status !== 'online') {
          onlineSince = now;
        }
        offlineSince = null;
      } else {
        // Channel is failing (offline or degraded)
        failCount += 1;
        console.log(`[rule] channel="${ch.name}" id=${ch.id} server="${server.name}" status=${ch.status.toUpperCase()} isFail=true fail_count=${failCount} is_down=${isDown}`);

        if (!isDown && failCount >= FAIL_THRESHOLD) {
          isDown = 1;
          downSince = now;
          openOutage.run(ch.id, ch.name, sid, now);
          console.log(`[rule] channel="${ch.name}" id=${ch.id} FAIL_THRESHOLD reached (${FAIL_THRESHOLD}) => CONFIRMED_DOWN => notifying DOWN`);
          downEvents.push({ channel_name: ch.name, channel_id: ch.id, server_name: server.name, down_at: now });
        }

        if (!prev || prev.status === 'online') {
          offlineSince = now;
        }
        onlineSince = null;
      }

      upsertStatus.run(
        ch.id, sid, ch.name, ch.status,
        onlineSince, offlineSince,
        failCount, isDown, downSince,
        now, now
      );
    }
  });

  transaction(channels);

  return { downEvents, upEvents };
}

function formatDuration(seconds) {
  if (seconds > 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

async function sendBatchNotifications(downEvents, upEvents) {
  const db = getDb();
  const hora = toBRTime();
  const data = toBRDate();

  const messages = [];

  if (downEvents.length > 0) {
    const lines = downEvents.map((e, i) => `${i + 1}) 📡 ${e.channel_name} — 🖥️ ${e.server_name} — 🕐 ${toBRTime(e.down_at)}`).join('\n');
    messages.push(`🚨 *SIGNAL MONITOR — ${downEvents.length} ${downEvents.length === 1 ? 'CANAL CAIU' : 'CANAIS CAÍRAM'}*\n\n📅 ${data} 🕐 ${hora}\n\n${lines}\n\n⚠️ Queda confirmada após 3 minutos e 30 segundos de indisponibilidade contínua.`);
  }

  if (upEvents.length > 0) {
    const lines = upEvents.map((e, i) => `${i + 1}) 📡 ${e.channel_name} — 🖥️ ${e.server_name} — ⏱️ ${formatDuration(e.downtime_seconds)} — 🕐 caiu ${toBRTime(e.down_at)}`).join('\n');
    messages.push(`✅ *SIGNAL MONITOR — ${upEvents.length} ${upEvents.length === 1 ? 'CANAL VOLTOU' : 'CANAIS VOLTARAM'}*\n\n📅 ${data} 🕐 ${hora}\n\n${lines}`);
  }

  const destinations = db.prepare('SELECT * FROM notification_destinations').all();

  for (const message of messages) {
    const type = message.startsWith('🚨') ? 'DOWN' : 'UP';
    const count = type === 'DOWN' ? downEvents.length : upEvents.length;

    for (const dest of destinations) {
      try {
        const config = JSON.parse(dest.config);
        if (dest.type === 'telegram' && config.botToken && config.chatId) {
          const r = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: config.chatId, text: message, parse_mode: 'Markdown' }),
          });
          const result = await r.json();
          console.log(`[notify] telegram batch type=${type} count=${count} success=${r.ok} ${r.ok ? '' : 'error=' + (result.description || '')}`);
        } else if (dest.type === 'whatsapp' && config.phone && config.apiKey) {
          const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(config.phone)}&text=${encodeURIComponent(message)}&apikey=${encodeURIComponent(config.apiKey)}`;
          const r = await fetch(url);
          console.log(`[notify] whatsapp batch type=${type} count=${count} success=${r.ok}`);
        }
      } catch (err) {
        console.error(`[notify] ${dest.type} batch type=${type} count=${count} error=${err.message}`);
      }
    }
  }
}

function startWorker() {
  console.log(`[worker] Monitoring started – interval=${POLL_INTERVAL_MS / 1000}s threshold=${FAIL_THRESHOLD}x (~${Math.round(FAIL_THRESHOLD * POLL_INTERVAL_MS / 1000 / 60)}m${(FAIL_THRESHOLD * POLL_INTERVAL_MS / 1000) % 60}s)`);
  // Run immediately on startup
  pollAllServers();
  // Then every 30s
  setInterval(pollAllServers, POLL_INTERVAL_MS);
}

module.exports = { startWorker };
