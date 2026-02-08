const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.API_PORT || 3001;

app.use(cors());
app.use(express.json());

// ==================== FETCH METRICS ====================
app.post('/api/fetch-metrics', async (req, res) => {
  try {
    const { dashboardUrl, username, password } = req.body;

    if (!dashboardUrl || !username || !password) {
      return res.json({ success: false, error: 'dashboardUrl, username e password são obrigatórios' });
    }

    console.log(`[fetch-metrics] Fazendo login em ${dashboardUrl}`);

    // Step 1: Get login page for CSRF token
    const loginPageRes = await fetch(`${dashboardUrl}/aaa/auth/login`, {
      method: 'GET',
      redirect: 'manual',
    });
    const loginPageHtml = await loginPageRes.text();
    const loginPageCookies = extractCookies(loginPageRes.headers);

    let csrfToken = '';
    const csrfMetaMatch = loginPageHtml.match(/name="csrf-token"\s+content="([^"]+)"/);
    const csrfInputMatch = loginPageHtml.match(/name="_csrf"\s+value="([^"]+)"/);
    const csrfYiiMatch = loginPageHtml.match(/name="_csrf-frontend"\s+value="([^"]+)"/);
    if (csrfMetaMatch) csrfToken = csrfMetaMatch[1];
    else if (csrfInputMatch) csrfToken = csrfInputMatch[1];
    else if (csrfYiiMatch) csrfToken = csrfYiiMatch[1];

    console.log('[fetch-metrics] CSRF token:', csrfToken ? 'sim' : 'não');

    // Step 2: Submit login
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
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieHeader,
        'Referer': `${dashboardUrl}/aaa/auth/login`,
      },
      body: formBody.toString(),
      redirect: 'manual',
    });

    const loginResponseCookies = extractCookies(loginRes.headers);
    let allCookies = { ...loginPageCookies, ...loginResponseCookies };

    console.log('[fetch-metrics] Login status:', loginRes.status);

    // Step 3: Follow redirect
    let finalCookies = allCookies;
    if (loginRes.status === 301 || loginRes.status === 302) {
      const redirectUrl = loginRes.headers.get('location');
      if (redirectUrl) {
        const fullRedirectUrl = redirectUrl.startsWith('http') ? redirectUrl : `${dashboardUrl}${redirectUrl}`;
        const redirectCookieHeader = Object.entries(finalCookies).map(([k, v]) => `${k}=${v}`).join('; ');
        const redirectRes = await fetch(fullRedirectUrl, {
          method: 'GET',
          headers: { 'Cookie': redirectCookieHeader },
          redirect: 'manual',
        });
        const redirectCookies = extractCookies(redirectRes.headers);
        finalCookies = { ...finalCookies, ...redirectCookies };
        await redirectRes.text();
      }
    } else {
      await loginRes.text();
    }

    // Step 4: Wait for session
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 5: Fetch metrics
    const metricsCookieHeader = Object.entries(finalCookies).map(([k, v]) => `${k}=${v}`).join('; ');

    const metricsRes = await fetch(`${dashboardUrl}/origin/channel/metrics`, {
      method: 'GET',
      headers: {
        'Cookie': metricsCookieHeader,
        'Accept': 'application/json, text/html, */*',
      },
    });

    const metricsText = await metricsRes.text();
    console.log('[fetch-metrics] Metrics status:', metricsRes.status);

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
      console.log(`[fetch-metrics] ${rawItems.length} total, ${activeItems.length} live, ${tvChannels.length} TV`);

      channels = tvChannels.map((item, idx) => parseChannel(item, idx));
    } catch {
      console.log('[fetch-metrics] Parsing HTML fallback');
      channels = parseHtmlMetrics(metricsText);
    }

    console.log(`[fetch-metrics] ${channels.length} canais retornados`);
    res.json({ success: true, channels, rawLength: metricsText.length });
  } catch (error) {
    console.error('[fetch-metrics] Erro:', error);
    res.json({ success: false, error: error.message || 'Erro desconhecido' });
  }
});

// ==================== SEND TELEGRAM ====================
app.post('/api/send-telegram', async (req, res) => {
  try {
    const { botToken, chatId, message } = req.body;
    if (!botToken || !chatId || !message) {
      return res.status(400).json({ success: false, error: 'botToken, chatId e message são obrigatórios' });
    }

    console.log('[send-telegram] Enviando para chat:', chatId);
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' }),
    });
    const data = await response.json();

    if (!response.ok) {
      console.error('[send-telegram] Erro:', data);
      return res.json({ success: false, error: data.description || 'Erro ao enviar' });
    }

    console.log('[send-telegram] Enviado com sucesso');
    res.json({ success: true });
  } catch (error) {
    console.error('[send-telegram] Erro:', error);
    res.json({ success: false, error: error.message || 'Erro desconhecido' });
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
    const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodedMessage}&apikey=${apiKey}`;

    console.log(`[send-whatsapp] Enviando para ${phone.substring(0, 6)}...`);
    const r = await fetch(url);
    const text = await r.text();
    console.log(`[send-whatsapp] Status: ${r.status}`);

    if (!r.ok) {
      return res.json({ success: false, error: `CallMeBot retornou status ${r.status}: ${text}` });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[send-whatsapp] Erro:', error);
    res.json({ success: false, error: error.message || 'Erro desconhecido' });
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
      if (eqIdx > 0) {
        cookies[parts.substring(0, eqIdx).trim()] = parts.substring(eqIdx + 1).trim();
      }
    });
  } else if (typeof raw === 'string') {
    raw.split(/,(?=\s*\w+=)/).forEach(cookie => {
      const parts = cookie.trim().split(';')[0];
      const eqIdx = parts.indexOf('=');
      if (eqIdx > 0) {
        cookies[parts.substring(0, eqIdx).trim()] = parts.substring(eqIdx + 1).trim();
      }
    });
  }
  // Fallback: use headers.getSetCookie if available (Node 20+)
  if (Object.keys(cookies).length === 0 && headers.getSetCookie) {
    headers.getSetCookie().forEach(cookie => {
      const parts = cookie.split(';')[0];
      const eqIdx = parts.indexOf('=');
      if (eqIdx > 0) {
        cookies[parts.substring(0, eqIdx).trim()] = parts.substring(eqIdx + 1).trim();
      }
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
  console.log(`✅ Signal Monitor API rodando na porta ${PORT}`);
});
