import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardHeader } from "@/components/DashboardHeader";
import { ChannelCard, type Channel } from "@/components/ChannelCard";
import { StatsBar } from "@/components/StatsBar";
import { SettingsDialog } from "@/components/SettingsDialog";
import { toast } from "sonner";
import { Loader2, ServerOff } from "lucide-react";

const Index = () => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialLoad, setInitialLoad] = useState(true);
  const [countdown, setCountdown] = useState(0);
  const channelsRef = useRef<Channel[]>([]);

  // Keep ref in sync
  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  const fetchMetrics = useCallback(async () => {
    setIsRefreshing(true);
    setError(null);

    const dashboardUrl = localStorage.getItem("dashboard_url") || "http://157.254.55.203:8089";
    const dashboardUser = localStorage.getItem("dashboard_user") || "admin";
    const dashboardPass = localStorage.getItem("dashboard_pass") || "admin@signal.2025";

    try {
      const { data, error: fnError } = await supabase.functions.invoke("fetch-metrics", {
        body: {
          dashboardUrl,
          username: dashboardUser,
          password: dashboardPass,
        },
      });

      if (fnError) throw new Error(fnError.message);
      if (!data?.success) throw new Error(data?.error || "Falha ao buscar métricas");

      const now = new Date().toLocaleTimeString("pt-BR");
      const parsedChannels: Channel[] = (data.channels || []).map((ch: any) => ({
        id: String(ch.id || ch.name),
        name: ch.name || "Canal desconhecido",
        status: ch.status as Channel["status"],
        bitrate: ch.bitrate,
        uptime: ch.uptime,
        source: ch.source,
        viewers: ch.viewers,
        health: ch.health,
        group: ch.group,
        lastCheck: now,
      }));

      // Check for newly offline channels and notify
      const prevChannels = channelsRef.current;
      const notificationsEnabled = localStorage.getItem("notifications_enabled") === "true";
      if (notificationsEnabled && prevChannels.length > 0) {
        // Degraded OR offline = canal caiu, alertar
        const newlyDown = parsedChannels.filter(
          (ch) => (ch.status === "offline" || ch.status === "degraded") &&
            prevChannels.find((prev) => prev.id === ch.id && prev.status === "online")
        );
        if (newlyDown.length > 0) {
          notifyOfflineChannels(newlyDown);
          toast.error(`🚨 ${newlyDown.length} canal(is) caíram!`);
        }
      }

      setChannels(parsedChannels);
      setLastUpdate(now);

      // Reset countdown
      const intervalSec = parseInt(localStorage.getItem("auto_refresh_interval") || "30", 10);
      setCountdown(intervalSec);
    } catch (err: any) {
      console.error("Erro ao buscar métricas:", err);
      setError(err.message);
      if (!initialLoad) {
        toast.error("Erro ao buscar métricas: " + err.message);
      }
    } finally {
      setIsRefreshing(false);
      setInitialLoad(false);
    }
  }, [initialLoad]);

  const notifyOfflineChannels = async (offlineChannels: Channel[]) => {
    const telegramBotToken = localStorage.getItem("telegram_bot_token");
    const telegramChatId = localStorage.getItem("telegram_chat_id");

    if (!telegramBotToken || !telegramChatId) return;

    const message = `🚨 *ALERTA - Canal(is) com Problema*\n\n${offlineChannels
      .map((ch) => `${ch.status === "offline" ? "❌" : "⚠️"} *${ch.name}* — ${ch.status === "offline" ? "OFFLINE" : "DEGRADADO"}`)
      .join("\n")}\n\n⏰ ${new Date().toLocaleString("pt-BR")}`;

    try {
      await supabase.functions.invoke("send-telegram", {
        body: { botToken: telegramBotToken, chatId: telegramChatId, message },
      });
      toast.info("Notificação Telegram enviada!");
    } catch (err) {
      console.error("Erro ao enviar notificação Telegram:", err);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchMetrics();
  }, []);

  // Auto-refresh interval
  useEffect(() => {
    const intervalSec = parseInt(localStorage.getItem("auto_refresh_interval") || "30", 10);
    setCountdown(intervalSec);
    const interval = setInterval(() => {
      fetchMetrics();
    }, intervalSec * 1000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  // Countdown ticker
  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  const onlineCount = channels.filter((c) => c.status === "online").length;
  const offlineCount = channels.filter((c) => c.status === "offline").length;

  // Sort: offline first, then degraded, then online
  const sortedChannels = [...channels].sort((a, b) => {
    const order = { offline: 0, degraded: 1, online: 2 };
    return order[a.status] - order[b.status];
  });

  return (
    <div className="min-h-screen bg-background grid-bg">
      <DashboardHeader
        totalChannels={channels.length}
        onlineCount={onlineCount}
        offlineCount={offlineCount}
        isRefreshing={isRefreshing}
        onRefresh={fetchMetrics}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="container py-6 space-y-6">
        <StatsBar channels={channels} />

        <div className="flex items-center justify-between">
          {lastUpdate && (
            <p className="text-xs text-muted-foreground font-mono">
              Última atualização: {lastUpdate}
            </p>
          )}
          <p className="text-xs text-muted-foreground font-mono flex items-center gap-2">
            {isRefreshing ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                Atualizando...
              </>
            ) : (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-primary pulse-dot inline-block" />
                Próximo refresh em {countdown}s
              </>
            )}
          </p>
        </div>

        {initialLoad && isRefreshing ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground font-mono">Conectando ao dashboard...</p>
          </div>
        ) : error && channels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <ServerOff className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground font-mono text-center max-w-md">
              {error}
            </p>
            <p className="text-xs text-muted-foreground font-mono">
              Verifique as configurações de conexão
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {sortedChannels.map((channel) => (
              <ChannelCard key={channel.id} channel={channel} />
            ))}
          </div>
        )}
      </main>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
};

export default Index;
