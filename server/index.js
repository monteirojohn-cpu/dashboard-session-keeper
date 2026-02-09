const express = require('express');
const cors = require('cors');
const { getDb } = require('./db');
const { fetchChannelsFromServer } = require('./metrics');
const { startWorker, getWeeklyReportData, buildSummaryMessage, generateReportPDF, formatDuration, toBRTime, toBRDate } = require('./worker');

const app = express();
const PORT = process.env.API_PORT || 3001;

app.use(cors());
app.use(express.json());

// Initialize DB on startup
const db = getDb();

// ==================== FETCH METRICS (API for frontend) ====================
app.post('/api/fetch-metrics', async (req, res) => {
  try {
    const { dashboardUrl, username, password, serverId } = req.body;
    if (!dashboardUrl || !username || !password) {
      return res.json({ success: false, error: 'dashboardUrl, username e password são obrigatórios' });
    }

    // Resolve server ID: use explicit serverId, or look up by base_url, or fallback to 'default'
    let sid = serverId || null;
    if (!sid) {
      // Try exact match first, then partial match (ignore trailing slash)
      const normalizedUrl = dashboardUrl.replace(/\/+$/, '');
      const allServers = db.prepare('SELECT id, base_url FROM servers').all();
      const match = allServers.find(s => s.base_url.replace(/\/+$/, '') === normalizedUrl);
      sid = match ? match.id : 'default';
      console.log(`[fetch-metrics] URL="${dashboardUrl}" → server_id="${sid}" (matched: ${!!match})`);
    }

    const server = { base_url: dashboardUrl, username, password };
    const channels = await fetchChannelsFromServer(server);
    console.log(`[fetch-metrics] Fetched ${channels.length} live channels from server`);

    // Filter by monitored_channels if any selection exists for this server
    const monitoredRows = db.prepare('SELECT * FROM monitored_channels WHERE server_id = ?').all(sid);
    let filteredChannels = channels;
    if (monitoredRows.length > 0) {
      // Normalize IDs: remove trailing ".0", convert to string for consistent comparison
      const normalizeId = (id) => String(id).replace(/\.0$/, '');
      const enabledIds = new Set(monitoredRows.filter(r => r.enabled).map(r => normalizeId(r.channel_id)));
      const disabledIds = new Set(monitoredRows.filter(r => !r.enabled).map(r => normalizeId(r.channel_id)));
      filteredChannels = channels.filter(ch => {
        const nid = normalizeId(ch.id);
        // If channel is explicitly disabled, exclude it
        if (disabledIds.has(nid)) return false;
        // If channel is in enabled list, include it
        if (enabledIds.has(nid)) return true;
        // If channel is not in DB at all (new channel), include it by default
        return true;
      });
      console.log(`[fetch-metrics] Monitored: ${monitoredRows.length} total, ${enabledIds.size} enabled, ${disabledIds.size} disabled, ${filteredChannels.length} after filter`);
    } else {
      console.log(`[fetch-metrics] No monitored_channels for server_id="${sid}", showing all`);
    }

    // Enrich channels with persisted status data
    const allStatuses = db.prepare('SELECT * FROM channel_status WHERE server_id = ?').all(sid);
    const statusMap = new Map(allStatuses.map(s => [s.channel_id, s]));

    const enrichedChannels = filteredChannels.map(ch => {
      const persisted = statusMap.get(ch.id);
      return {
        ...ch,
        onlineSince: persisted?.online_since || null,
        offlineSince: persisted?.offline_since || null,
        serverId: sid,
      };
    });

    res.json({ success: true, channels: enrichedChannels, totalChannels: channels.length, rawLength: 0 });
  } catch (error) {
    console.error('[fetch-metrics] Erro:', error);
    res.json({ success: false, error: error.message || 'Erro desconhecido' });
  }
});

// ==================== SERVERS CRUD ====================
app.get('/api/servers', (req, res) => {
  const servers = db.prepare('SELECT * FROM servers ORDER BY created_at').all();
  res.json({ success: true, servers });
});

app.post('/api/servers', (req, res) => {
  const { id, name, base_url, username, password, type } = req.body;
  if (!name || !base_url) return res.status(400).json({ success: false, error: 'name e base_url obrigatórios' });
  const serverId = id || `srv_${Date.now()}`;
  db.prepare('INSERT INTO servers (id, name, base_url, username, password, type) VALUES (?, ?, ?, ?, ?, ?)')
    .run(serverId, name, base_url, username || 'admin', password || '', type || 'flussonic');
  res.json({ success: true, id: serverId });
});

app.put('/api/servers/:id', (req, res) => {
  const { name, base_url, username, password, type, status,
    maintenance_enabled, maintenance_start, maintenance_end, maintenance_days,
    maintenance_silence_down, maintenance_silence_up, maintenance_tz } = req.body;
  db.prepare(`UPDATE servers SET
    name=COALESCE(?,name), base_url=COALESCE(?,base_url), username=COALESCE(?,username),
    password=COALESCE(?,password), type=COALESCE(?,type), status=COALESCE(?,status),
    maintenance_enabled=COALESCE(?,maintenance_enabled), maintenance_start=COALESCE(?,maintenance_start),
    maintenance_end=COALESCE(?,maintenance_end), maintenance_days=COALESCE(?,maintenance_days),
    maintenance_silence_down=COALESCE(?,maintenance_silence_down), maintenance_silence_up=COALESCE(?,maintenance_silence_up),
    maintenance_tz=COALESCE(?,maintenance_tz)
    WHERE id=?`)
    .run(name, base_url, username, password, type, status,
      maintenance_enabled ?? null, maintenance_start ?? null, maintenance_end ?? null,
      maintenance_days ?? null, maintenance_silence_down ?? null, maintenance_silence_up ?? null,
      maintenance_tz ?? null, req.params.id);
  res.json({ success: true });
});

app.delete('/api/servers/:id', (req, res) => {
  if (req.params.id === 'default') return res.status(400).json({ success: false, error: 'Não pode deletar servidor padrão' });
  db.prepare('DELETE FROM servers WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== OUTAGE EVENTS / REPORTS ====================
app.get('/api/outages', (req, res) => {
  const { start, end, server_id, channel_id, limit } = req.query;
  let sql = `
    SELECT o.*, s.name as server_name
    FROM channel_outage_events o
    LEFT JOIN servers s ON s.id = o.server_id
    WHERE 1=1
  `;
  const params = [];

  if (start) { sql += ' AND o.started_at >= ?'; params.push(start); }
  if (end) { sql += ' AND (o.started_at <= ? OR o.started_at IS NULL)'; params.push(end); }
  if (server_id) { sql += ' AND o.server_id = ?'; params.push(server_id); }
  if (channel_id) { sql += ' AND o.channel_id = ?'; params.push(channel_id); }

  sql += ' ORDER BY o.started_at DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit)); }

  const outages = db.prepare(sql).all(...params);

  // Aggregations
  const totalOutages = outages.length;
  const totalOfflineSeconds = outages.reduce((sum, o) => sum + (o.duration_seconds || 0), 0);
  const openOutages = outages.filter(o => !o.ended_at).length;

  const countMap = {};
  const durationMap = {};
  for (const o of outages) {
    const key = o.channel_name || o.channel_id;
    countMap[key] = (countMap[key] || 0) + 1;
    durationMap[key] = (durationMap[key] || 0) + (o.duration_seconds || 0);
  }
  const topByCount = Object.entries(countMap).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));
  const topByDuration = Object.entries(durationMap).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, duration]) => ({ name, duration }));

  res.json({
    success: true,
    outages,
    stats: { totalOutages, totalOfflineSeconds, openOutages, topByCount, topByDuration },
  });
});

// ==================== CHANNEL STATUS (persisted) ====================
app.get('/api/channel-status', (req, res) => {
  const { server_id } = req.query;
  let statuses;
  if (server_id) {
    statuses = db.prepare('SELECT * FROM channel_status WHERE server_id = ?').all(server_id);
  } else {
    statuses = db.prepare('SELECT * FROM channel_status').all();
  }
  res.json({ success: true, statuses });
});

// ==================== MONITORED CHANNELS CRUD ====================
app.get('/api/monitored-channels', (req, res) => {
  const { server_id } = req.query;
  let rows;
  if (server_id) {
    rows = db.prepare('SELECT * FROM monitored_channels WHERE server_id = ?').all(server_id);
  } else {
    rows = db.prepare('SELECT * FROM monitored_channels').all();
  }
  res.json({ success: true, channels: rows });
});

app.post('/api/monitored-channels', (req, res) => {
  const { server_id, channels } = req.body;
  if (!server_id || !Array.isArray(channels)) {
    return res.status(400).json({ success: false, error: 'server_id e channels[] obrigatórios' });
  }
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO monitored_channels (server_id, channel_id, channel_name, enabled, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(server_id, channel_id) DO UPDATE SET
      channel_name = excluded.channel_name,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `);
  const tx = db.transaction((list) => {
    for (const ch of list) {
      upsert.run(server_id, ch.channel_id, ch.channel_name || '', ch.enabled ? 1 : 0, now);
    }
  });
  tx(channels);
  res.json({ success: true });
});

app.post('/api/monitored-channels/copy', (req, res) => {
  const { source_server_id, target_server_id } = req.body;
  if (!source_server_id || !target_server_id) {
    return res.status(400).json({ success: false, error: 'source_server_id e target_server_id obrigatórios' });
  }
  const sourceChannels = db.prepare('SELECT * FROM monitored_channels WHERE server_id = ? AND enabled = 1').all(source_server_id);
  // Get target channel_ids that exist
  const targetChannelIds = new Set(
    db.prepare('SELECT channel_id FROM channel_status WHERE server_id = ?').all(target_server_id).map(r => r.channel_id)
  );
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO monitored_channels (server_id, channel_id, channel_name, enabled, updated_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(server_id, channel_id) DO UPDATE SET enabled = 1, updated_at = excluded.updated_at
  `);
  let copied = 0;
  const tx = db.transaction(() => {
    for (const ch of sourceChannels) {
      // Apply if target has this channel or if no target channels exist yet (copy blindly)
      if (targetChannelIds.size === 0 || targetChannelIds.has(ch.channel_id)) {
        upsert.run(target_server_id, ch.channel_id, ch.channel_name, now);
        copied++;
      }
    }
  });
  tx();
  res.json({ success: true, copied });
});

// ==================== NOTIFICATION DESTINATIONS CRUD ====================
app.get('/api/notification-destinations', (req, res) => {
  const destinations = db.prepare('SELECT * FROM notification_destinations ORDER BY created_at').all();
  res.json({ success: true, destinations });
});

app.post('/api/notification-destinations', (req, res) => {
  const { type, config } = req.body;
  if (!type || !config) return res.status(400).json({ success: false, error: 'type e config obrigatórios' });
  const result = db.prepare('INSERT INTO notification_destinations (type, config) VALUES (?, ?)').run(type, JSON.stringify(config));
  res.json({ success: true, id: result.lastInsertRowid });
});

app.delete('/api/notification-destinations/:id', (req, res) => {
  db.prepare('DELETE FROM notification_destinations WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Bulk sync: replace all destinations at once
app.put('/api/notification-destinations/sync', (req, res) => {
  const { destinations } = req.body;
  if (!Array.isArray(destinations)) return res.status(400).json({ success: false, error: 'destinations[] obrigatório' });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM notification_destinations').run();
    const insert = db.prepare('INSERT INTO notification_destinations (type, config) VALUES (?, ?)');
    for (const dest of destinations) {
      if (dest.type && dest.config) {
        insert.run(dest.type, JSON.stringify(dest.config));
      }
    }
  });
  tx();
  res.json({ success: true });
});

// ==================== MESSAGE TEMPLATES ====================
app.get('/api/templates', (req, res) => {
  const templates = db.prepare('SELECT * FROM message_templates ORDER BY scope').all();
  res.json({ success: true, templates });
});

app.post('/api/templates', (req, res) => {
  const { scope, scope_id, template } = req.body;
  if (!template) return res.status(400).json({ success: false, error: 'template obrigatório' });
  db.prepare(`INSERT INTO message_templates (scope, scope_id, template) VALUES (?, ?, ?)
    ON CONFLICT(scope, scope_id) DO UPDATE SET template = excluded.template`)
    .run(scope || 'global', scope_id || null, template);
  res.json({ success: true });
});

app.delete('/api/templates/:id', (req, res) => {
  db.prepare('DELETE FROM message_templates WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== TEST NOTIFICATION ====================
app.post('/api/test-notification', async (req, res) => {
  try {
    const db = getDb();
    const destinations = db.prepare('SELECT * FROM notification_destinations').all();
    if (destinations.length === 0) {
      return res.json({ success: false, error: 'Nenhum destino de notificação configurado' });
    }

    const message = '🔔 *TESTE - Signal Monitor*\n\nEsta é uma mensagem de teste.\nSe você recebeu, as notificações estão funcionando corretamente! ✅';
    const results = [];

    for (const dest of destinations) {
      const config = JSON.parse(dest.config);
      try {
        if (dest.type === 'telegram') {
          const r = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: config.chatId, text: message, parse_mode: 'Markdown' }),
          });
          const data = await r.json();
          results.push({ type: 'telegram', id: dest.id, success: r.ok, error: r.ok ? null : data.description });
        } else if (dest.type === 'whatsapp') {
          const encoded = encodeURIComponent(message);
          const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(config.phone)}&text=${encoded}&apikey=${encodeURIComponent(config.apiKey)}`;
          const r = await fetch(url);
          results.push({ type: 'whatsapp', id: dest.id, success: r.ok, error: r.ok ? null : `Status ${r.status}` });
        }
      } catch (err) {
        results.push({ type: dest.type, id: dest.id, success: false, error: err.message });
      }
    }

    const allOk = results.every(r => r.success);
    res.json({ success: allOk, results });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ==================== SEND TELEGRAM ====================
app.post('/api/send-telegram', async (req, res) => {
  try {
    const { botToken, chatId, message } = req.body;
    if (!botToken || !chatId || !message) {
      return res.status(400).json({ success: false, error: 'botToken, chatId e message são obrigatórios' });
    }
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' }),
    });
    const data = await response.json();
    if (!response.ok) return res.json({ success: false, error: data.description || 'Erro ao enviar' });
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ==================== SEND WHATSAPP ====================
app.post('/api/send-whatsapp', async (req, res) => {
  try {
    const { phone, apiKey, message } = req.body;
    if (!phone || !apiKey || !message) {
      return res.status(400).json({ success: false, error: 'phone, apiKey e message são obrigatórios' });
    }
    const encodedMessage = encodeURIComponent(message);
    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodedMessage}&apikey=${encodeURIComponent(apiKey)}`;
    const r = await fetch(url);
    const text = await r.text();
    if (!r.ok) return res.json({ success: false, error: `CallMeBot status ${r.status}: ${text}` });
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ==================== DEBUG: FETCH METRICS (no body needed) ====================
app.get('/api/debug/metrics', async (req, res) => {
  try {
    const serverId = req.query.server_id || 'default';
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    if (!server) return res.json({ success: false, error: `Servidor "${serverId}" não encontrado` });

    console.log(`[debug/metrics] Fetching from server "${server.name}" (${server.base_url})`);
    const channels = await fetchChannelsFromServer(server);

    // Also include channel_status from DB for comparison
    const statuses = db.prepare('SELECT * FROM channel_status WHERE server_id = ?').all(serverId);
    const statusMap = Object.fromEntries(statuses.map(s => [s.channel_id, s]));

    const enriched = channels.map(ch => ({
      ...ch,
      db_status: statusMap[ch.id] || null,
    }));

    res.json({
      success: true,
      server: { id: server.id, name: server.name, base_url: server.base_url },
      live_channels: enriched.length,
      channels: enriched,
      db_statuses_count: statuses.length,
      down_channels: statuses.filter(s => s.is_down).map(s => ({
        channel_id: s.channel_id,
        fail_count: s.fail_count,
        down_since: s.down_since,
      })),
    });
  } catch (error) {
    console.error('[debug/metrics] Erro:', error);
    res.json({ success: false, error: error.message });
  }
});

// ==================== WEEKLY REPORT ENDPOINTS ====================
app.get('/api/reports/weekly', (req, res) => {
  try {
    const { start, end, serverId } = req.query;
    if (!start || !end) return res.status(400).json({ success: false, error: 'start e end obrigatórios (YYYY-MM-DD)' });
    const data = getWeeklyReportData(db, start, end, serverId || 'all');
    res.json({ success: true, ...data });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/reports/weekly.pdf', async (req, res) => {
  try {
    const { start, end, serverId } = req.query;
    if (!start || !end) return res.status(400).json({ success: false, error: 'start e end obrigatórios (YYYY-MM-DD)' });
    const sid = serverId || 'all';
    const data = getWeeklyReportData(db, start, end, sid);
    const startStr = toBRDate(new Date(start));
    const endStr = toBRDate(new Date(end));
    const pdfBuffer = await generateReportPDF(data, sid, startStr, endStr);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="relatorio-semanal-${start}-${end}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ==================== REPORT SETTINGS ====================
app.get('/api/report-settings', (req, res) => {
  const keys = ['enable_auto_reports', 'report_frequency', 'report_day_of_week', 'report_time',
    'report_timezone', 'report_server_id', 'report_send_pdf', 'report_send_summary', 'last_weekly_report_key'];
  const settings = {};
  for (const key of keys) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    settings[key] = row ? row.value : null;
  }
  res.json({ success: true, settings });
});

app.put('/api/report-settings', (req, res) => {
  const allowed = ['enable_auto_reports', 'report_frequency', 'report_day_of_week', 'report_time',
    'report_timezone', 'report_server_id', 'report_send_pdf', 'report_send_summary'];
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(req.body)) {
      if (allowed.includes(k)) upsert.run(k, String(v));
    }
  });
  tx();
  res.json({ success: true });
});

// ==================== ADMIN: RESET HISTORY ====================
app.get('/api/admin/reset-history/dry', (req, res) => {
  const { serverId } = req.query;
  const sid = serverId || 'all';
  let outageCount, statusCount;
  if (sid === 'all') {
    outageCount = db.prepare('SELECT COUNT(*) as c FROM channel_outage_events').get().c;
    statusCount = db.prepare('SELECT COUNT(*) as c FROM channel_status').get().c;
  } else {
    outageCount = db.prepare('SELECT COUNT(*) as c FROM channel_outage_events WHERE server_id = ?').get(sid).c;
    statusCount = db.prepare('SELECT COUNT(*) as c FROM channel_status WHERE server_id = ?').get(sid).c;
  }
  res.json({ success: true, dry: true, serverId: sid, counts: { channel_outage_events: outageCount, channel_status: statusCount } });
});

app.post('/api/admin/reset-history', (req, res) => {
  const { serverId, confirm } = req.body;
  if (confirm !== 'RESET') {
    return res.status(400).json({ success: false, error: 'Confirmação inválida. Envie confirm: "RESET"' });
  }
  const sid = serverId || 'all';
  const now = new Date().toISOString();
  console.log(`[admin] RESET_HISTORY requested serverId=${sid} at=${now}`);

  const tx = db.transaction(() => {
    let outageResult, statusResult;
    if (sid === 'all') {
      outageResult = db.prepare('DELETE FROM channel_outage_events').run();
      statusResult = db.prepare('DELETE FROM channel_status').run();
    } else {
      outageResult = db.prepare('DELETE FROM channel_outage_events WHERE server_id = ?').run(sid);
      statusResult = db.prepare('DELETE FROM channel_status WHERE server_id = ?').run(sid);
    }
    return { channel_outage_events: outageResult.changes, channel_status: statusResult.changes };
  });

  const deleted = tx();
  console.log(`[admin] RESET_HISTORY completed serverId=${sid} deleted_outages=${deleted.channel_outage_events} deleted_status=${deleted.channel_status}`);
  res.json({ success: true, deleted });
});

// ==================== START ====================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Signal Monitor API v3.0 rodando na porta ${PORT}`);
  console.log(`📦 SQLite DB: ${require('path').join(__dirname, 'signal-monitor.db')}`);

  // Start background worker for anti-false-positive polling
  startWorker();
});
