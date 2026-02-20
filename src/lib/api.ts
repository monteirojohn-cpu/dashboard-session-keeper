/**
 * API URL centralizada.
 * Em produção (Lovable preview / site publicado) usa a Edge Function como proxy HTTPS,
 * eliminando problemas de Mixed Content e CORS.
 * Em desenvolvimento local (localhost) aponta direto para a API da VPS.
 */
const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID || "uxxjmzdjsfovvwsegwvi";

function getApiUrl(): string {
  // Se VITE_API_URL estiver explicitamente definido (ex: build na VPS), usa ele
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  // No Lovable preview / produção: usa a edge function como proxy HTTPS
  // Isso resolve Mixed Content (HTTPS → HTTP) e CORS
  return `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1/api-proxy`;
}

export const API_URL = getApiUrl();
