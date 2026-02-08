const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { dashboardUrl, username, password } = await req.json();

    if (!dashboardUrl || !username || !password) {
      return new Response(
        JSON.stringify({ success: false, error: 'dashboardUrl, username e password são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[fetch-metrics] Fazendo login em ${dashboardUrl}`);

    // Step 1: Get the login page to obtain CSRF token
    const loginPageRes = await fetch(`${dashboardUrl}/aaa/auth/login`, {
      method: 'GET',
      redirect: 'manual',
    });
    const loginPageHtml = await loginPageRes.text();
    const loginPageCookies = extractCookies(loginPageRes.headers);
    console.log('[fetch-metrics] Cookies da página de login:', JSON.stringify(loginPageCookies));

    // Extract CSRF token from meta tag or hidden input
    let csrfToken = '';
    const csrfMetaMatch = loginPageHtml.match(/name="csrf-token"\s+content="([^"]+)"/);
    const csrfInputMatch = loginPageHtml.match(/name="_csrf"\s+value="([^"]+)"/);
    const csrfYiiMatch = loginPageHtml.match(/name="_csrf-frontend"\s+value="([^"]+)"/);
    
    if (csrfMetaMatch) csrfToken = csrfMetaMatch[1];
    else if (csrfInputMatch) csrfToken = csrfInputMatch[1];
    else if (csrfYiiMatch) csrfToken = csrfYiiMatch[1];

    console.log('[fetch-metrics] CSRF token encontrado:', csrfToken ? 'sim' : 'não');

    // Step 2: Submit login form
    const formBody = new URLSearchParams();
    formBody.append('LoginForm[username]', username);
    formBody.append('LoginForm[password]', password);
    if (csrfToken) {
      formBody.append('_csrf-frontend', csrfToken);
      formBody.append('_csrf', csrfToken);
    }

    const cookieHeader = Object.entries(loginPageCookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

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
    const allCookies = { ...loginPageCookies, ...loginResponseCookies };
    
    console.log('[fetch-metrics] Status do login:', loginRes.status);
    console.log('[fetch-metrics] Cookies após login:', JSON.stringify(Object.keys(allCookies)));

    // Step 3: Follow redirect if needed (302/301)
    let finalCookies = allCookies;
    if (loginRes.status === 301 || loginRes.status === 302) {
      const redirectUrl = loginRes.headers.get('location');
      console.log('[fetch-metrics] Redirecionando para:', redirectUrl);
      
      if (redirectUrl) {
        const fullRedirectUrl = redirectUrl.startsWith('http') ? redirectUrl : `${dashboardUrl}${redirectUrl}`;
        const redirectCookieHeader = Object.entries(finalCookies)
          .map(([k, v]) => `${k}=${v}`)
          .join('; ');

        const redirectRes = await fetch(fullRedirectUrl, {
          method: 'GET',
          headers: { 'Cookie': redirectCookieHeader },
          redirect: 'manual',
        });
        const redirectCookies = extractCookies(redirectRes.headers);
        finalCookies = { ...finalCookies, ...redirectCookies };
        await redirectRes.text(); // consume body
      }
    } else {
      await loginRes.text(); // consume body
    }

    // Step 4: Wait a moment for session to stabilize
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 5: Fetch metrics
    const metricsCookieHeader = Object.entries(finalCookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

    console.log('[fetch-metrics] Buscando métricas com cookies:', metricsCookieHeader.substring(0, 80) + '...');

    const metricsRes = await fetch(`${dashboardUrl}/origin/channel/metrics`, {
      method: 'GET',
      headers: {
        'Cookie': metricsCookieHeader,
        'Accept': 'application/json, text/html, */*',
      },
    });

    const metricsText = await metricsRes.text();
    console.log('[fetch-metrics] Status das métricas:', metricsRes.status);
    console.log('[fetch-metrics] Primeiros 500 chars da resposta:', metricsText.substring(0, 500));

    if (metricsRes.status === 500 || metricsRes.status === 403 || metricsRes.status === 401) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Sessão inválida ou expirada (status ${metricsRes.status}). Verifique credenciais.` 
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Try to parse as JSON first
    let channels: any[] = [];
    try {
      const metricsData = JSON.parse(metricsText);
      // Adapt based on the actual structure of the metrics response
      if (Array.isArray(metricsData)) {
        channels = metricsData.map((item: any, idx: number) => parseChannel(item, idx));
      } else if (metricsData.channels) {
        channels = metricsData.channels.map((item: any, idx: number) => parseChannel(item, idx));
      } else if (metricsData.data) {
        const data = Array.isArray(metricsData.data) ? metricsData.data : [metricsData.data];
        channels = data.map((item: any, idx: number) => parseChannel(item, idx));
      } else {
        // Single object, wrap it
        channels = [parseChannel(metricsData, 0)];
      }
    } catch {
      // Not JSON - try parsing HTML table or text
      console.log('[fetch-metrics] Resposta não é JSON, tentando parsear HTML/texto');
      channels = parseHtmlMetrics(metricsText);
    }

    console.log(`[fetch-metrics] ${channels.length} canais encontrados`);

    return new Response(
      JSON.stringify({ success: true, channels, rawLength: metricsText.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[fetch-metrics] Erro:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function extractCookies(headers: Headers): Record<string, string> {
  const cookies: Record<string, string> = {};
  const setCookieHeaders = headers.getSetCookie?.() || [];
  
  // Fallback for environments without getSetCookie
  if (setCookieHeaders.length === 0) {
    const raw = headers.get('set-cookie');
    if (raw) {
      // Simple split - may not handle all cases
      raw.split(/,(?=\s*\w+=)/).forEach(cookie => {
        const parts = cookie.trim().split(';')[0];
        const eqIdx = parts.indexOf('=');
        if (eqIdx > 0) {
          cookies[parts.substring(0, eqIdx).trim()] = parts.substring(eqIdx + 1).trim();
        }
      });
    }
  } else {
    setCookieHeaders.forEach(cookie => {
      const parts = cookie.split(';')[0];
      const eqIdx = parts.indexOf('=');
      if (eqIdx > 0) {
        cookies[parts.substring(0, eqIdx).trim()] = parts.substring(eqIdx + 1).trim();
      }
    });
  }
  
  return cookies;
}

function parseChannel(item: any, idx: number) {
  const name = item.name || item.channel_name || item.title || item.stream || `Canal ${idx + 1}`;
  const isOnline = item.status === 'online' || item.status === 'active' || item.active === true ||
    item.status === 1 || item.running === true || item.state === 'running';
  const isDegraded = item.status === 'degraded' || item.status === 'warning';

  return {
    id: item.id || item.channel_id || String(idx),
    name,
    status: isDegraded ? 'degraded' : isOnline ? 'online' : 'offline',
    bitrate: item.bitrate || item.input_bitrate || item.kbps ? `${item.kbps || item.bitrate} kbps` : undefined,
    uptime: item.uptime || item.runtime || undefined,
    source: item.source || item.input || item.url || undefined,
    viewers: item.viewers || item.clients || undefined,
  };
}

function parseHtmlMetrics(html: string): any[] {
  const channels: any[] = [];
  
  // Try to extract table rows
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  
  let rowMatch;
  let idx = 0;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const cells: string[] = [];
    let cellMatch;
    const rowContent = rowMatch[1];
    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
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

function inferStatus(cells: string[]): string {
  const text = cells.join(' ').toLowerCase();
  if (text.includes('offline') || text.includes('stopped') || text.includes('error') || text.includes('down')) {
    return 'offline';
  }
  if (text.includes('degraded') || text.includes('warning')) {
    return 'degraded';
  }
  return 'online';
}
