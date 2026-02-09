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

// ==================== WEEKLY REPORT ====================

function getWeekKey(date) {
  const d = new Date(date);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const days = Math.floor((d - jan1) / 86400000);
  const week = Math.ceil((days + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function getWeeklyReportData(db, startDate, endDate, serverId) {
  let sql = `
    SELECT o.*, s.name as server_name
    FROM channel_outage_events o
    LEFT JOIN servers s ON s.id = o.server_id
    WHERE o.started_at >= ? AND o.started_at <= ?
  `;
  const params = [startDate, endDate];
  if (serverId && serverId !== 'all') {
    sql += ' AND o.server_id = ?';
    params.push(serverId);
  }
  sql += ' ORDER BY o.started_at DESC';
  const outages = db.prepare(sql).all(...params);

  const totalOutages = outages.length;
  const totalOfflineSeconds = outages.reduce((sum, o) => sum + (o.duration_seconds || 0), 0);
  const openOutages = outages.filter(o => !o.ended_at).length;

  const durationMap = {};
  const countMap = {};
  for (const o of outages) {
    const key = o.channel_name || o.channel_id;
    durationMap[key] = (durationMap[key] || 0) + (o.duration_seconds || 0);
    countMap[key] = (countMap[key] || 0) + 1;
  }
  const topByDuration = Object.entries(durationMap).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, dur]) => ({ name, duration: dur }));
  const topByCount = Object.entries(countMap).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));

  return { outages, totalOutages, totalOfflineSeconds, openOutages, topByDuration, topByCount };
}

function buildSummaryMessage(data, serverId, startStr, endStr) {
  const serverLabel = (!serverId || serverId === 'all') ? 'TODOS' : serverId;
  const offH = Math.floor(data.totalOfflineSeconds / 3600);
  const offM = Math.floor((data.totalOfflineSeconds % 3600) / 60);

  let top10 = '';
  if (data.topByDuration.length > 0) {
    top10 = data.topByDuration.map((t, i) => `${i + 1}) ${t.name} — ${formatDuration(t.duration)}`).join('\n');
  } else {
    top10 = 'Nenhuma queda registrada 🎉';
  }

  return `📊 *SIGNAL MONITOR — RELATÓRIO SEMANAL*\n\n🖥️ Servidor: ${serverLabel}\n📅 Período: ${startStr} a ${endStr}\n\n✅ Total de quedas: ${data.totalOutages}\n⏱️ Offline total: ${offH}h ${offM}m\n\n🔥 *TOP 10 (tempo offline)*\n${top10}\n\n📎 PDF completo anexado.`;
}

async function generateReportPDF(data, serverId, startStr, endStr) {
  const PDFDocument = require('pdfkit');

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const serverLabel = (!serverId || serverId === 'all') ? 'TODOS' : serverId;
    const offH = Math.floor(data.totalOfflineSeconds / 3600);
    const offM = Math.floor((data.totalOfflineSeconds % 3600) / 60);

    doc.fontSize(20).text('SIGNAL MONITOR — Relatório Semanal', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Servidor: ${serverLabel}`);
    doc.text(`Período: ${startStr} a ${endStr}`);
    doc.text(`Total de quedas: ${data.totalOutages}`);
    doc.text(`Offline total: ${offH}h ${offM}m`);
    doc.text(`Quedas abertas: ${data.openOutages}`);
    doc.moveDown();

    doc.fontSize(14).text('TOP 10 — Maior tempo offline', { underline: true });
    doc.moveDown(0.5);
    if (data.topByDuration.length > 0) {
      data.topByDuration.forEach((t, i) => {
        doc.fontSize(11).text(`${i + 1}) ${t.name} — ${formatDuration(t.duration)}`);
      });
    } else {
      doc.fontSize(11).text('Nenhuma queda registrada.');
    }
    doc.moveDown();

    doc.fontSize(14).text('TOP 10 — Mais quedas', { underline: true });
    doc.moveDown(0.5);
    if (data.topByCount.length > 0) {
      data.topByCount.forEach((t, i) => {
        doc.fontSize(11).text(`${i + 1}) ${t.name} — ${t.count} queda(s)`);
      });
    } else {
      doc.fontSize(11).text('Nenhuma queda registrada.');
    }
    doc.moveDown();

    // Full outage list
    doc.fontSize(14).text('Detalhamento de quedas', { underline: true });
    doc.moveDown(0.5);
    if (data.outages.length > 0) {
      for (const o of data.outages) {
        const dur = o.duration_seconds ? formatDuration(o.duration_seconds) : 'em andamento';
        const start = toBRTime(o.started_at) + ' ' + toBRDate(o.started_at);
        const end = o.ended_at ? toBRTime(o.ended_at) + ' ' + toBRDate(o.ended_at) : '—';
        doc.fontSize(9).text(`• ${o.channel_name || o.channel_id} | ${o.server_name || o.server_id} | Início: ${start} | Fim: ${end} | Duração: ${dur}`);
      }
    } else {
      doc.fontSize(11).text('Nenhuma queda no período.');
    }

    doc.end();
  });
}

async function sendWeeklyReport() {
  const db = getDb();

  const enabled = getSetting(db, 'enable_auto_reports');
  if (enabled !== 'true') return;

  const tz = getSetting(db, 'report_timezone') || 'America/Sao_Paulo';
  const now = new Date();
  const nowStr = now.toLocaleString('en-US', { timeZone: tz });
  const localNow = new Date(nowStr);

  const dayOfWeek = localNow.getDay(); // 0=Sun, 1=Mon
  const targetDay = getSetting(db, 'report_day_of_week') || 'mon';
  const dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  if (dayOfWeek !== (dayMap[targetDay] ?? 1)) return;

  const targetTime = getSetting(db, 'report_time') || '08:00';
  const currentHHMM = `${String(localNow.getHours()).padStart(2, '0')}:${String(localNow.getMinutes()).padStart(2, '0')}`;
  if (currentHHMM !== targetTime) return;

  // Idempotency check
  const weekKey = getWeekKey(localNow);
  const lastKey = getSetting(db, 'last_weekly_report_key') || '';
  if (lastKey === weekKey) return;

  console.log(`[report] Weekly report triggered – weekKey=${weekKey}`);

  const serverId = getSetting(db, 'report_server_id') || 'all';
  const sendPdf = getSetting(db, 'report_send_pdf') !== 'false';
  const sendSummary = getSetting(db, 'report_send_summary') !== 'false';

  // Calculate previous week range (Mon 00:00 to Sun 23:59:59 in SP timezone)
  const endOfWeek = new Date(localNow);
  endOfWeek.setDate(endOfWeek.getDate() - 1); // Sunday
  endOfWeek.setHours(23, 59, 59, 999);

  const startOfWeek = new Date(endOfWeek);
  startOfWeek.setDate(startOfWeek.getDate() - 6); // Previous Monday
  startOfWeek.setHours(0, 0, 0, 0);

  const startISO = startOfWeek.toISOString();
  const endISO = endOfWeek.toISOString();
  const startStr = toBRDate(startOfWeek);
  const endStr = toBRDate(endOfWeek);

  const reportData = getWeeklyReportData(db, startISO, endISO, serverId);
  console.log(`[report] Data: outages=${reportData.totalOutages} offlineSec=${reportData.totalOfflineSeconds}`);

  const destinations = db.prepare("SELECT * FROM notification_destinations WHERE type = 'telegram'").all();
  if (destinations.length === 0) {
    console.warn('[report] No telegram destinations configured – skipping weekly report send');
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_weekly_report_key', ?)").run(weekKey);
    return;
  }

  for (const dest of destinations) {
    const config = JSON.parse(dest.config);
    if (!config.botToken || !config.chatId) continue;

    try {
      // 1) Send summary message
      if (sendSummary) {
        const summary = buildSummaryMessage(reportData, serverId, startStr, endStr);
        const r = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: config.chatId, text: summary, parse_mode: 'Markdown' }),
        });
        const result = await r.json();
        console.log(`[report] Telegram summary sent to chatId=${config.chatId} success=${r.ok} ${r.ok ? '' : result.description || ''}`);
      }

      // 2) Send PDF
      if (sendPdf) {
        const pdfBuffer = await generateReportPDF(reportData, serverId, startStr, endStr);
        const filename = `relatorio-semanal-${weekKey}.pdf`;

        // Use multipart/form-data for sendDocument
        const boundary = '----FormBoundary' + Date.now().toString(36);
        const parts = [];
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${config.chatId}`);
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`);

        const head = Buffer.from(parts.join('\r\n') + '\r\n', 'utf-8');
        const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
        const body = Buffer.concat([head, pdfBuffer, tail]);

        const r = await fetch(`https://api.telegram.org/bot${config.botToken}/sendDocument`, {
          method: 'POST',
          headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
          body: body,
        });
        const result = await r.json();
        console.log(`[report] Telegram PDF sent to chatId=${config.chatId} success=${r.ok} ${r.ok ? '' : result.description || ''}`);
      }
    } catch (err) {
      console.error(`[report] Error sending to chatId=${config.chatId}: ${err.message}`);
    }
  }

  // Mark as sent
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_weekly_report_key', ?)").run(weekKey);
  console.log(`[report] Weekly report completed – weekKey=${weekKey} marked as sent`);
}

// ==================== SCHEDULER ====================

const REPORT_CHECK_INTERVAL_MS = 60_000; // 60 seconds

function startWorker() {
  console.log(`[worker] Monitoring started – interval=${POLL_INTERVAL_MS / 1000}s threshold=${FAIL_THRESHOLD}x (~${Math.round(FAIL_THRESHOLD * POLL_INTERVAL_MS / 1000 / 60)}m${(FAIL_THRESHOLD * POLL_INTERVAL_MS / 1000) % 60}s)`);
  // Run immediately on startup
  pollAllServers();
  // Then every 30s
  setInterval(pollAllServers, POLL_INTERVAL_MS);

  // Weekly report scheduler - check every 60s
  console.log('[worker] Weekly report scheduler started – checking every 60s');
  setInterval(() => {
    sendWeeklyReport().catch(err => console.error('[report] Scheduler error:', err.message));
  }, REPORT_CHECK_INTERVAL_MS);
}

module.exports = { startWorker, getWeeklyReportData, buildSummaryMessage, generateReportPDF, formatDuration, toBRTime, toBRDate };
