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
const FAIL_THRESHOLD = 3;

let running = false;

const normalizeId = (id) => String(id).replace(/\.0$/, '');

async function pollAllServers() {
  if (running) return; // guard against overlap
  running = true;

  const db = getDb();
  const now = new Date().toISOString();

  try {
    const servers = db.prepare("SELECT * FROM servers WHERE status = 'active'").all();

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

        processChannels(db, filteredChannels, server, now);
      } catch (err) {
        console.error(`[worker] Erro ao verificar servidor ${server.name}:`, err.message);
      }
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

  const notifications = []; // collect notifications to send after transaction

  const transaction = db.transaction((channelsList) => {
    for (const ch of channelsList) {
      const prev = getStatus.get(ch.id, sid);
      const isOnline = ch.status === 'online';

      let failCount = prev ? prev.fail_count : 0;
      let isDown = prev ? prev.is_down : 0;
      let downSince = prev ? prev.down_since : null;
      let onlineSince = prev ? prev.online_since : null;
      let offlineSince = prev ? prev.offline_since : null;

      if (isOnline) {
        // Channel is online
        if (isDown) {
          // Was confirmed down → close outage event, notify recovery
          closeOutage.run(now, now, ch.id, sid);
          console.log(`[rule] channel="${ch.name}" id=${ch.id} server="${server.name}" status=ONLINE is_down=1 => RECOVERED => notifying UP`);
          notifications.push({ type: 'recovery', channel: ch, server, downSince });
        } else if (failCount > 0) {
          console.log(`[rule] channel="${ch.name}" id=${ch.id} server="${server.name}" status=ONLINE fail_count=${failCount} => RESET (back before threshold)`);
        }
        failCount = 0;
        isDown = 0;
        downSince = null;
        // Set online_since only on transition
        if (!prev || prev.status !== 'online') {
          onlineSince = now;
        }
        offlineSince = null;
      } else {
        // Channel is offline/degraded
        failCount += 1;
        console.log(`[rule] channel="${ch.name}" id=${ch.id} server="${server.name}" status=${ch.status.toUpperCase()} fail_count=${failCount} is_down=${isDown}`);

        if (!isDown && failCount >= FAIL_THRESHOLD) {
          // Confirmed down after 3 consecutive failures
          isDown = 1;
          downSince = now;
          openOutage.run(ch.id, ch.name, sid, now);
          console.log(`[rule] channel="${ch.name}" id=${ch.id} FAIL_THRESHOLD reached (${FAIL_THRESHOLD}) => CONFIRMED_DOWN => notifying DOWN`);
          notifications.push({ type: 'down', channel: ch, server, downSince: now });
        }

        // Set offline_since on transition
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

  // Send notifications outside transaction
  for (const n of notifications) {
    sendNotification(n).catch(err => {
      console.error(`[worker] Erro ao enviar notificação:`, err.message);
    });
  }
}

async function sendNotification({ type, channel, server, downSince }) {
  const db = getDb();
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Sao_Paulo' });
  const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  let message;
  if (type === 'down') {
    message = `🚨 *SIGNAL MONITOR - CANAL CAIU*\n\n📡 *Canal:* ${channel.name}\n🖥️ *Servidor:* ${server.name}\n🕐 *Horário:* ${hora}\n📅 *Data:* ${data}\n\n⚠️ Queda confirmada após 3 verificações consecutivas.`;
  } else {
    const durSec = downSince ? Math.round((Date.now() - new Date(downSince).getTime()) / 1000) : 0;
    const durStr = durSec > 3600 ? `${Math.floor(durSec / 3600)}h ${Math.floor((durSec % 3600) / 60)}m` : `${Math.floor(durSec / 60)}m ${durSec % 60}s`;
    message = `✅ *SIGNAL MONITOR - CANAL VOLTOU*\n\n📡 *Canal:* ${channel.name}\n🖥️ *Servidor:* ${server.name}\n🕐 *Horário:* ${hora}\n📅 *Data:* ${data}\n⏱️ *Tempo fora:* ${durStr}`;
  }

  // Get notification destinations from DB
  const destinations = db.prepare('SELECT * FROM notification_destinations').all();

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
        console.log(`[notify] telegram type=${type.toUpperCase()} channel="${channel.name}" chatId=${config.chatId} success=${r.ok} ${r.ok ? '' : 'error=' + (result.description || '')}`);
      } else if (dest.type === 'whatsapp' && config.phone && config.apiKey) {
        const encodedMessage = encodeURIComponent(message);
        const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(config.phone)}&text=${encodedMessage}&apikey=${encodeURIComponent(config.apiKey)}`;
        const r = await fetch(url);
        console.log(`[notify] whatsapp type=${type.toUpperCase()} channel="${channel.name}" phone=${config.phone} success=${r.ok}`);
      }
    } catch (err) {
      console.error(`[notify] ${dest.type} type=${type.toUpperCase()} channel="${channel.name}" error=${err.message}`);
    }
  }
}

function startWorker() {
  console.log(`[worker] Monitoring started – interval=${POLL_INTERVAL_MS / 1000}s threshold=${FAIL_THRESHOLD}x`);
  // Run immediately on startup
  pollAllServers();
  // Then every 30s
  setInterval(pollAllServers, POLL_INTERVAL_MS);
}

module.exports = { startWorker };
