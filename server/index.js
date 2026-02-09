const express = require('express');
const cors = require('cors');
const { getDb } = require('./db');
const { fetchChannelsFromServer } = require('./metrics');
const { startWorker } = require('./worker');

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

    const sid = serverId || 'default';
    const server = { base_url: dashboardUrl, username, password };
    const channels = await fetchChannelsFromServer(server);

    // Enrich channels with persisted status data (fail_count driven)
    const allStatuses = db.prepare('SELECT * FROM channel_status WHERE server_id = ?').all(sid);
    const statusMap = new Map(allStatuses.map(s => [s.channel_id, s]));

    const enrichedChannels = channels.map(ch => {
      const persisted = statusMap.get(ch.id);
      return {
        ...ch,
        onlineSince: persisted?.online_since || null,
        offlineSince: persisted?.offline_since || null,
        serverId: sid,
      };
    });

    res.json({ success: true, channels: enrichedChannels, rawLength: 0 });
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
  const { name, base_url, username, password, type, status } = req.body;
  db.prepare('UPDATE servers SET name=COALESCE(?,name), base_url=COALESCE(?,base_url), username=COALESCE(?,username), password=COALESCE(?,password), type=COALESCE(?,type), status=COALESCE(?,status) WHERE id=?')
    .run(name, base_url, username, password, type, status, req.params.id);
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

// ==================== START ====================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Signal Monitor API v3.0 rodando na porta ${PORT}`);
  console.log(`📦 SQLite DB: ${require('path').join(__dirname, 'signal-monitor.db')}`);

  // Start background worker for anti-false-positive polling
  startWorker();
});
