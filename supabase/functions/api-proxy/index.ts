import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

// VPS API base URL
const VPS_API = "http://76.13.171.218:3101";

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Extract the path after /api-proxy
    const url = new URL(req.url);
    
    // The path from the function call: everything after the function name
    // e.g. /api/fetch-metrics, /api/servers, etc.
    let targetPath = url.pathname;
    
    // Remove the /api-proxy prefix if present (Supabase routes like /functions/v1/api-proxy/api/...)
    const funcPrefixMatch = targetPath.match(/\/api-proxy(\/.*)?$/);
    if (funcPrefixMatch) {
      targetPath = funcPrefixMatch[1] || '/';
    }

    // Rebuild target URL with query string
    const targetUrl = `${VPS_API}${targetPath}${url.search}`;
    
    console.log(`[proxy] ${req.method} ${targetUrl}`);

    // Forward the request to VPS
    const proxyResponse = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.text(),
    });

    const responseText = await proxyResponse.text();
    
    console.log(`[proxy] Response status: ${proxyResponse.status}`);

    return new Response(responseText, {
      status: proxyResponse.status,
      headers: {
        ...corsHeaders,
        'Content-Type': proxyResponse.headers.get('Content-Type') || 'application/json',
      },
    });

  } catch (error) {
    console.error('[proxy] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: `Proxy error: ${error.message}` }),
      {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
