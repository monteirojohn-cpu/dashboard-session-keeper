const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { phone, apiKey, message } = await req.json();

    if (!phone || !apiKey || !message) {
      console.error('[send-whatsapp] Missing params:', { phone: !!phone, apiKey: !!apiKey, message: !!message });
      return new Response(
        JSON.stringify({ success: false, error: 'phone, apiKey e message são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const encodedMessage = encodeURIComponent(message);
    const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodedMessage}&apikey=${apiKey}`;

    console.log(`[send-whatsapp] Enviando para ${phone.substring(0, 6)}...`);

    const res = await fetch(url);
    const text = await res.text();

    console.log(`[send-whatsapp] Status: ${res.status}, Response: ${text.substring(0, 200)}`);

    if (!res.ok) {
      return new Response(
        JSON.stringify({ success: false, error: `CallMeBot retornou status ${res.status}: ${text}` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[send-whatsapp] Erro:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
