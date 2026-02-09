const express = require('express');
const cors = require('cors');
const { getDb } = require('./db');

const app = express();
const PORT = process.env.API_PORT || 3001;

app.use(cors());
app.use(express.json());

// Initialize DB on startup
const db = getDb();

// ==================== SESSION CACHE ====================
const sessionCache = {};
const SESSION_MAX_AGE_MS = 5 * 60 * 1000;

async function getAuthenticatedCookies(dashboardUrl, username, password, forceRenew = false) {
  const cacheKey = `${dashboardUrl}|${username}`;
  const cached = sessionCache[cacheKey];

  if (!forceRenew && cached && (Date.now() - cached.timestamp < SESSION_MAX_AGE_MS)) {
    return { cookies: cached.cookies, fromCache: true };
  }

  console.log(`[session] ${forceRenew ? 'Forçando renovação' : 'Login'} em ${dashboardUrl}`);

  const loginPageRes = await fetch(`${dashboardUrl}/aaa/auth/login`, { method: 'GET', redirect: 'manual' });
  const loginPageHtml = await loginPageRes.text();
  const loginPageCookies = extractCookies(loginPageRes.headers);

  let csrfToken = '';
  const csrfMetaMatch = loginPageHtml.match(/name="csrf-token"\s+content="([^"]+)"/);
  const csrfInputMatch = loginPageHtml.match(/name="_csrf"\s+value="([^"]+)"/);
  const csrfYiiMatch = loginPageHtml.match(/name="_csrf-frontend"\s+value="([^"]+)"/);
  if (csrfMetaMatch) csrfToken = csrfMetaMatch[1];
  else if (csrfInputMatch) csrfToken = csrfInputMatch[1];
  else if (csrfYiiMatch) csrfToken = csrfYiiMatch[1];

  const formBody = new URLSearchParams();
  formBody.append('LoginForm[username]', username);
  formBody.append('LoginForm[password]', password);
  if (csrfToken) {
    formBody.append('_csrf-frontend', csrfToken);
    formBody.append('_csrf', csrfToken);
  }

  const cookieHeader = Object.entries(loginPageCookies).map(([k, v]) => `${k}=${v}`).join('; ');
  const loginRes = await fetch(`${dashboardUrl}/aaa/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookieHeader, 'Referer': `${dashboardUrl}/aaa/auth/login` },
    body: formBody.toString(),
    redirect: 'manual',
  });

  const loginResponseCookies = extractCookies(loginRes.headers);
  let finalCookies = { ...loginPageCookies, ...loginResponseCookies };

  if (loginRes.status === 301 || loginRes.status === 302) {
    const redirectUrl = loginRes.headers.get('location');
    if (redirectUrl) {
      const fullUrl = redirectUrl.startsWith('http') ? redirectUrl : `${dashboardUrl}${redirectUrl}`;
      const rCookie = Object.entries(finalCookies).map(([k, v]) => `${k}=${v}`).join('; ');
      const redirectRes = await fetch(fullUrl, { method: 'GET', headers: { 'Cookie': rCookie }, redirect: 'manual' });
      finalCookies = { ...finalCookies, ...extractCookies(redirectRes.headers) };
      await redirectRes.text();
    }
  } else {
    await loginRes.text();
  }

  await new Promise(resolve => setTimeout(resolve, 1000));
  sessionCache[cacheKey] = { cookies: finalCookies, timestamp: Date.now() };
  return { cookies: finalCookies, fromCache: false };
}

// ==================== FETCH METRICS (with uptime persistence) ====================
app.post('/api/fetch-metrics', async (req, res) => {
  try {
    const { dashboardUrl, username, password, serverId } = req.body;
    if (!dashboardUrl || !username || !password) {
      return res.json({ success: false, error: 'dashboardUrl, username e password são obrigatórios' });
    }

    const sid = serverId || 'default';
    let { cookies: finalCookies, fromCache } = await getAuthenticatedCookies(dashboardUrl, username, password);
    let metricsCookieHeader = Object.entries(finalCookies).map(([k, v]) => `${k}=${v}`).join('; ');

    let metricsRes = await fetch(`${dashboardUrl}/origin/channel/metrics`, {
      method: 'GET',
      headers: { 'Cookie': metricsCookieHeader, 'Accept': 'application/json, text/html, */*' },
    });

    if (fromCache && [401, 403].includes(metricsRes.status)) {
      const renewed = await getAuthenticatedCookies(dashboardUrl, username, password, true);
      metricsCookieHeader = Object.entries(renewed.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
      metricsRes = await fetch(`${dashboardUrl}/origin/channel/metrics`, {
        method: 'GET',
        headers: { 'Cookie': metricsCookieHeader, 'Accept': 'application/json, text/html, */*' },
      });
    }

    const metricsText = await metricsRes.text();
    if ([500, 403, 401].includes(metricsRes.status)) {
      return res.json({ success: false, error: `Sessão inválida (status ${metricsRes.status})` });
    }

    let channels = [];
    try {
      const metricsData = JSON.parse(metricsText);
      let rawItems = [];
      if (Array.isArray(metricsData)) rawItems = metricsData;
      else if (metricsData.channels) rawItems = metricsData.channels;
      else if (metricsData.data) rawItems = Array.isArray(metricsData.data) ? metricsData.data : [metricsData.data];
      else rawItems = [metricsData];

      const activeItems = rawItems.filter(item => item.live === true);
      const radioNames = new Set([
        "Punk Rock","TOP Brasil","Sertanejo Raiz","Rádio Torres","Metal","TOP Internacional",
        "Forro","Rock Baladas","Barzinho","Vibe","Relax","Jazz","Rádio 104","Axe Anos 90",
        "Rádio Grenal","Rádio Capão","MPB","Rádio Continental","Pagode Anos 90","Hits FM",
        "Romantica","Academia","Funk","POP Brasil","Rádio Express","Party","HeartBreak",
        "Super Rock","POP Rock","Rádio Cidreira","Time","Rádio Premium","Rádio Tramandaí",
        "Infantil","Rádio Eldorado","Funcional HIT","Rádio Boa Nova","Rádio Xangri-lá",
        "Rádio Liberdade","POP Anos 80","Alma Sertaneja","Rádio Pampa","Rádio Evangelizar",
        "Flash Back","Reggae","ClipStation Rádio","Allteen","Hip Hop","Rádio Imbé","Rádio Caiçara",
      ]);
      const tvChannels = activeItems.filter(item => !radioNames.has(item.name));
      channels = tvChannels.map((item, idx) => parseChannel(item, idx));
    } catch {
      channels = parseHtmlMetrics(metricsText);
    }

    // Persist status transitions & outage events
    const now = new Date().toISOString();
    const upsertStatus = db.prepare(`
      INSERT INTO channel_status (channel_id, server_id, status, online_since, offline_since, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel_id, server_id) DO UPDATE SET
        status = excluded.status,
        online_since = CASE 
          WHEN excluded.status = 'online' AND channel_status.status != 'online' THEN excluded.online_since
          WHEN excluded.status = 'online' THEN channel_status.online_since
          ELSE NULL
        END,
        offline_since = CASE
          WHEN excluded.status != 'online' AND channel_status.status = 'online' THEN excluded.offline_since
          WHEN excluded.status != 'online' THEN channel_status.offline_since
          ELSE NULL
        END,
        updated_at = excluded.updated_at
    `);

    const openOutage = db.prepare(`
      INSERT INTO channel_outage_events (channel_id, channel_name, server_id, started_at)
      SELECT ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM channel_outage_events 
        WHERE channel_id = ? AND server_id = ? AND ended_at IS NULL
      )
    `);

    const closeOutage = db.prepare(`
      UPDATE channel_outage_events 
      SET ended_at = ?, duration_seconds = CAST((julianday(?) - julianday(started_at)) * 86400 AS INTEGER)
      WHERE channel_id = ? AND server_id = ? AND ended_at IS NULL
    `);

    const getStatus = db.prepare('SELECT * FROM channel_status WHERE channel_id = ? AND server_id = ?');

    const transaction = db.transaction((channelsList) => {
      for (const ch of channelsList) {
        const prev = getStatus.get(ch.id, sid);
        const isOnline = ch.status === 'online';

        if (prev) {
          // Transition: online -> offline
          if (prev.status === 'online' && !isOnline) {
            openOutage.run(ch.id, ch.name, sid, now, ch.id, sid);
          }
          // Transition: offline -> online
          if (prev.status !== 'online' && isOnline) {
            closeOutage.run(now, now, ch.id, sid);
          }
        } else if (!isOnline) {
          // First time seeing channel and it's offline
          openOutage.run(ch.id, ch.name, sid, now, ch.id, sid);
        }

        upsertStatus.run(
          ch.id, sid, ch.status,
          isOnline ? now : null,
          !isOnline ? now : null,
          now
        );
      }
    });

    transaction(channels);

    // Enrich channels with persisted online_since
    const allStatuses = db.prepare('SELECT * FROM channel_status WHERE server_id = ?').all(sid);
    const statusMap = new Map(allStatuses.map(s => [s.channel_id, s]));

    const enrichedChannels = channels.map(ch => {
      const persisted = statusMap.get(ch.id);
      return {
        ...ch,
        onlineSince: persisted?.online_since || null,
        offlineSince: persisted?.offline_since || null,
      };
    });

    res.json({ success: true, channels: enrichedChannels, rawLength: metricsText.length });
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
  let sql = 'SELECT * FROM channel_outage_events WHERE 1=1';
  const params = [];

  if (start) { sql += ' AND started_at >= ?'; params.push(start); }
  if (end) { sql += ' AND (started_at <= ? OR started_at IS NULL)'; params.push(end); }
  if (server_id) { sql += ' AND server_id = ?'; params.push(server_id); }
  if (channel_id) { sql += ' AND channel_id = ?'; params.push(channel_id); }

  sql += ' ORDER BY started_at DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit)); }

  const outages = db.prepare(sql).all(...params);
  
  // Aggregations
  const totalOutages = outages.length;
  const totalOfflineSeconds = outages.reduce((sum, o) => sum + (o.duration_seconds || 0), 0);
  const openOutages = outages.filter(o => !o.ended_at).length;

  // Top channels by outage count
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

// ==================== FETCH ALL SERVERS (polling helper) ====================
app.post('/api/fetch-all-servers', async (req, res) => {
  try {
    const servers = db.prepare("SELECT * FROM servers WHERE status = 'active'").all();
    const results = [];

    for (const server of servers) {
      try {
        // Re-use the fetch-metrics logic internally
        const internalRes = await new Promise((resolve) => {
          const mockReq = {
            body: {
              dashboardUrl: server.base_url,
              username: server.username,
              password: server.password,
              serverId: server.id,
            }
          };
          const mockRes = {
            json: (data) => resolve(data),
            status: () => ({ json: (data) => resolve(data) }),
          };
          app._router.handle(
            Object.assign(new (require('http').IncomingMessage)(), {
              method: 'POST',
              url: '/api/fetch-metrics',
              headers: { 'content-type': 'application/json' },
              body: mockReq.body,
            }),
            mockRes,
            () => resolve({ success: false, error: 'Route not found' })
          );
        });
        results.push({ serverId: server.id, serverName: server.name, ...internalRes });
      } catch (err) {
        results.push({ serverId: server.id, serverName: server.name, success: false, error: err.message });
      }
    }

    res.json({ success: true, results });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ==================== HELPERS ====================
function extractCookies(headers) {
  const cookies = {};
  const raw = headers.raw?.()?.['set-cookie'] || [];
  if (Array.isArray(raw)) {
    raw.forEach(cookie => {
      const parts = cookie.split(';')[0];
      const eqIdx = parts.indexOf('=');
      if (eqIdx > 0) cookies[parts.substring(0, eqIdx).trim()] = parts.substring(eqIdx + 1).trim();
    });
  } else if (typeof raw === 'string') {
    raw.split(/,(?=\s*\w+=)/).forEach(cookie => {
      const parts = cookie.trim().split(';')[0];
      const eqIdx = parts.indexOf('=');
      if (eqIdx > 0) cookies[parts.substring(0, eqIdx).trim()] = parts.substring(eqIdx + 1).trim();
    });
  }
  if (Object.keys(cookies).length === 0 && headers.getSetCookie) {
    headers.getSetCookie().forEach(cookie => {
      const parts = cookie.split(';')[0];
      const eqIdx = parts.indexOf('=');
      if (eqIdx > 0) cookies[parts.substring(0, eqIdx).trim()] = parts.substring(eqIdx + 1).trim();
    });
  }
  return cookies;
}

function parseChannel(item, idx) {
  const name = item.name || item.channel_name || item.title || item.stream || `Canal ${idx + 1}`;
  const isOnline = item.live === true || item.status === 'online' || item.status === 'active' ||
    item.active === true || item.status === 1 || item.running === true || item.state === 'running';
  const health = item.health ?? 100;
  const hasBitrate = item.pipes ? Object.values(item.pipes).some(p => p?.vin?.bitrate > 0) : true;
  const isDegraded = isOnline && (health < 50 || !hasBitrate);

  let bitrate;
  if (item.pipes) {
    const firstPipe = Object.values(item.pipes)[0];
    if (firstPipe?.vin?.bitrate) {
      const kbps = Math.round(firstPipe.vin.bitrate / 1000);
      bitrate = kbps > 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${kbps} kbps`;
    }
  } else if (item.bitrate) {
    bitrate = `${item.bitrate} kbps`;
  }

  let source;
  if (item.pipes) {
    const firstPipe = Object.values(item.pipes)[0];
    source = firstPipe?.vin?.protocol || undefined;
  }
  source = source || item.source || item.input || item.url || undefined;

  return {
    id: item.id || item.channel_id || String(idx),
    name,
    status: isDegraded ? 'degraded' : isOnline ? 'online' : 'offline',
    bitrate,
    uptime: item.uptime || item.runtime || undefined,
    source,
    viewers: item.viewers || item.clients || undefined,
    health: isOnline ? health : undefined,
    group: item.group || undefined,
  };
}

function parseHtmlMetrics(html) {
  const channels = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let rowMatch, idx = 0;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const cells = [];
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
    }
    if (cells.length >= 2) {
      channels.push({
        id: String(idx),
        name: cells[0] || `Canal ${idx + 1}`,
        status: inferStatus(cells),
        bitrate: cells.find(c => c.includes('kbps') || c.includes('Mbps')) || undefined,
        source: cells.find(c => c.includes('://')) || undefined,
      });
      idx++;
    }
  }
  return channels;
}

function inferStatus(cells) {
  const text = cells.join(' ').toLowerCase();
  if (text.includes('offline') || text.includes('stopped') || text.includes('error') || text.includes('down')) return 'offline';
  if (text.includes('degraded') || text.includes('warning')) return 'degraded';
  return 'online';
}

// ==================== START ====================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Signal Monitor API v2.0 rodando na porta ${PORT}`);
  console.log(`📦 SQLite DB: ${require('path').join(__dirname, 'signal-monitor.db')}`);
});
