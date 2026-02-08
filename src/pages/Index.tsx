import { useState, useEffect, useCallback } from "react";
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

      const parsedChannels: Channel[] = (data.channels || []).map((ch: any) => ({
        id: ch.id || ch.name,
        name: ch.name || "Canal desconhecido",
        status: ch.status as Channel["status"],
        bitrate: ch.bitrate,
        uptime: ch.uptime,
        source: ch.source,
        viewers: ch.viewers,
        lastCheck: new Date().toLocaleTimeString("pt-BR"),
      }));

      // Check for newly offline channels and notify
      const notificationsEnabled = localStorage.getItem("notifications_enabled") === "true";
      if (notificationsEnabled && channels.length > 0) {
        const newlyOffline = parsedChannels.filter(
          (ch) => ch.status === "offline" && channels.find((prev) => prev.id === ch.id && prev.status === "online")
        );
        if (newlyOffline.length > 0) {
          notifyOfflineChannels(newlyOffline);
        }
      }

      setChannels(parsedChannels);
      setLastUpdate(new Date().toLocaleTimeString("pt-BR"));
    } catch (err: any) {
      console.error("Erro ao buscar métricas:", err);
      setError(err.message);
      toast.error("Erro ao buscar métricas: " + err.message);
    } finally {
      setIsRefreshing(false);
      setInitialLoad(false);
    }
  }, [channels]);

  const notifyOfflineChannels = async (offlineChannels: Channel[]) => {
    const telegramBotToken = localStorage.getItem("telegram_bot_token");
    const telegramChatId = localStorage.getItem("telegram_chat_id");

    if (!telegramBotToken || !telegramChatId) return;

    const message = `🚨 *ALERTA - Canal(is) Offline*\n\n${offlineChannels
      .map((ch) => `❌ *${ch.name}*`)
      .join("\n")}\n\n⏰ ${new Date().toLocaleString("pt-BR")}`;

    try {
      await supabase.functions.invoke("send-telegram", {
        body: { botToken: telegramBotToken, chatId: telegramChatId, message },
      });
    } catch (err) {
      console.error("Erro ao enviar notificação Telegram:", err);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, []);

  useEffect(() => {
    const intervalSec = parseInt(localStorage.getItem("auto_refresh_interval") || "30", 10);
    const interval = setInterval(fetchMetrics, intervalSec * 1000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  const onlineCount = channels.filter((c) => c.status === "online").length;
  const offlineCount = channels.filter((c) => c.status === "offline").length;

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

        {lastUpdate && (
          <p className="text-xs text-muted-foreground font-mono">
            Última atualização: {lastUpdate}
          </p>
        )}

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
            {channels.map((channel) => (
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
