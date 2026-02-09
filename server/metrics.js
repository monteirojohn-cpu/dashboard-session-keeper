/**
 * Extracted metrics fetching logic — shared by API route and background worker.
 */

const SESSION_MAX_AGE_MS = 5 * 60 * 1000;
const sessionCache = {};

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

const RADIO_NAMES = new Set([
  "Punk Rock","TOP Brasil","Sertanejo Raiz","Rádio Torres","Metal","TOP Internacional",
  "Forro","Rock Baladas","Barzinho","Vibe","Relax","Jazz","Rádio 104","Axe Anos 90",
  "Rádio Grenal","Rádio Capão","MPB","Rádio Continental","Pagode Anos 90","Hits FM",
  "Romantica","Academia","Funk","POP Brasil","Rádio Express","Party","HeartBreak",
  "Super Rock","POP Rock","Rádio Cidreira","Time","Rádio Premium","Rádio Tramandaí",
  "Infantil","Rádio Eldorado","Funcional HIT","Rádio Boa Nova","Rádio Xangri-lá",
  "Rádio Liberdade","POP Anos 80","Alma Sertaneja","Rádio Pampa","Rádio Evangelizar",
  "Flash Back","Reggae","ClipStation Rádio","Allteen","Hip Hop","Rádio Imbé","Rádio Caiçara",
]);

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

/**
 * Fetch channels from a server object { base_url, username, password }.
 * Returns parsed channel array.
 */
async function fetchChannelsFromServer(server) {
  const dashboardUrl = server.base_url;
  const username = server.username || 'admin';
  const password = server.password || '';

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
    throw new Error(`Sessão inválida (status ${metricsRes.status})`);
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
    const tvChannels = activeItems.filter(item => !RADIO_NAMES.has(item.name));
    channels = tvChannels.map((item, idx) => parseChannel(item, idx));
  } catch {
    channels = parseHtmlMetrics(metricsText);
  }

  return channels;
}

module.exports = {
  getAuthenticatedCookies,
  extractCookies,
  fetchChannelsFromServer,
  parseChannel,
  parseHtmlMetrics,
  RADIO_NAMES,
};
