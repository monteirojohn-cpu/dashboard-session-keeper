import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Checkbox } from "./ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { ScrollArea } from "./ui/scroll-area";
import { toast } from "sonner";
import { StatusIndicator } from "./StatusIndicator";
import type { Channel } from "./ChannelCard";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channels?: Channel[];
}

export const SettingsDialog = ({ open, onOpenChange, channels = [] }: SettingsDialogProps) => {
  const [dashboardUrl, setDashboardUrl] = useState(
    () => localStorage.getItem("dashboard_url") || "http://157.254.55.203:8089"
  );
  const [dashboardUser, setDashboardUser] = useState(
    () => localStorage.getItem("dashboard_user") || "admin"
  );
  const [dashboardPass, setDashboardPass] = useState(
    () => localStorage.getItem("dashboard_pass") || ""
  );
  const [telegramBotToken, setTelegramBotToken] = useState(
    () => localStorage.getItem("telegram_bot_token") || ""
  );
  const [telegramChatId, setTelegramChatId] = useState(
    () => localStorage.getItem("telegram_chat_id") || ""
  );
  const [whatsappPhone, setWhatsappPhone] = useState(
    () => localStorage.getItem("whatsapp_phone") || ""
  );
  const [whatsappApiKey, setWhatsappApiKey] = useState(
    () => localStorage.getItem("whatsapp_apikey") || ""
  );
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () => localStorage.getItem("notifications_enabled") === "true"
  );
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(
    () => localStorage.getItem("auto_refresh_interval") || "30"
  );
  const [sessionRenewalInterval, setSessionRenewalInterval] = useState(
    () => localStorage.getItem("session_renewal_interval") || "5"
  );

  // Ignored channels: stored as JSON array of channel IDs
  const [ignoredChannels, setIgnoredChannels] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("ignored_channels") || "[]");
    } catch {
      return [];
    }
  });

  const toggleChannel = (channelId: string) => {
    setIgnoredChannels((prev) =>
      prev.includes(channelId)
        ? prev.filter((id) => id !== channelId)
        : [...prev, channelId]
    );
  };

  const selectAll = () => setIgnoredChannels([]);
  const deselectAll = () => setIgnoredChannels(channels.map((c) => c.id));

  const handleSave = () => {
    localStorage.setItem("dashboard_url", dashboardUrl);
    localStorage.setItem("dashboard_user", dashboardUser);
    localStorage.setItem("dashboard_pass", dashboardPass);
    localStorage.setItem("telegram_bot_token", telegramBotToken);
    localStorage.setItem("telegram_chat_id", telegramChatId);
    localStorage.setItem("whatsapp_phone", whatsappPhone);
    localStorage.setItem("whatsapp_apikey", whatsappApiKey);
    localStorage.setItem("notifications_enabled", String(notificationsEnabled));
    localStorage.setItem("auto_refresh_interval", autoRefreshInterval);
    localStorage.setItem("session_renewal_interval", sessionRenewalInterval);
    localStorage.setItem("ignored_channels", JSON.stringify(ignoredChannels));
    toast.success("Configurações salvas com sucesso!");
    onOpenChange(false);
  };

  const monitoredCount = channels.length - ignoredChannels.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-card border-border max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-mono text-foreground">Configurações</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="connection" className="w-full flex-1 flex flex-col min-h-0">
          <TabsList className="w-full bg-muted">
            <TabsTrigger value="connection" className="flex-1 text-xs font-mono">Conexão</TabsTrigger>
            <TabsTrigger value="notifications" className="flex-1 text-xs font-mono">Notificações</TabsTrigger>
            <TabsTrigger value="channels" className="flex-1 text-xs font-mono">Canais</TabsTrigger>
          </TabsList>

          <TabsContent value="connection" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground font-mono">URL do Dashboard</Label>
              <Input
                value={dashboardUrl}
                onChange={(e) => setDashboardUrl(e.target.value)}
                placeholder="http://157.254.55.203:8089"
                className="font-mono text-sm bg-secondary border-border"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground font-mono">Usuário</Label>
              <Input
                value={dashboardUser}
                onChange={(e) => setDashboardUser(e.target.value)}
                placeholder="admin"
                className="font-mono text-sm bg-secondary border-border"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground font-mono">Senha</Label>
              <Input
                type="password"
                value={dashboardPass}
                onChange={(e) => setDashboardPass(e.target.value)}
                placeholder="••••••••"
                className="font-mono text-sm bg-secondary border-border"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground font-mono">Intervalo de refresh (segundos)</Label>
              <Input
                type="number"
                value={autoRefreshInterval}
                onChange={(e) => setAutoRefreshInterval(e.target.value)}
                min="10"
                max="300"
                className="font-mono text-sm bg-secondary border-border"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground font-mono">Renovação de sessão (minutos)</Label>
              <Input
                type="number"
                value={sessionRenewalInterval}
                onChange={(e) => setSessionRenewalInterval(e.target.value)}
                min="1"
                max="60"
                className="font-mono text-sm bg-secondary border-border"
              />
              <p className="text-[10px] text-muted-foreground font-mono">
                A cada X minutos o sistema refaz o login automaticamente para manter a sessão ativa
              </p>
            </div>
          </TabsContent>

          <TabsContent value="notifications" className="space-y-4 mt-4">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground font-mono">Notificações ativas</Label>
              <Switch checked={notificationsEnabled} onCheckedChange={setNotificationsEnabled} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground font-mono">Telegram Bot Token</Label>
              <Input
                value={telegramBotToken}
                onChange={(e) => setTelegramBotToken(e.target.value)}
                placeholder="123456:ABC-DEF..."
                className="font-mono text-sm bg-secondary border-border"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground font-mono">Telegram Chat ID</Label>
              <Input
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
                placeholder="-100123456789"
                className="font-mono text-sm bg-secondary border-border"
              />
            </div>
            <div className="border-t border-border my-3" />
            <p className="text-xs text-muted-foreground font-mono font-semibold">WhatsApp (CallMeBot)</p>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground font-mono">Telefone (com DDI, ex: 5551999999999)</Label>
              <Input
                value={whatsappPhone}
                onChange={(e) => setWhatsappPhone(e.target.value)}
                placeholder="5551999999999"
                className="font-mono text-sm bg-secondary border-border"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground font-mono">API Key (CallMeBot)</Label>
              <Input
                value={whatsappApiKey}
                onChange={(e) => setWhatsappApiKey(e.target.value)}
                placeholder="123456"
                className="font-mono text-sm bg-secondary border-border"
              />
            </div>
          </TabsContent>

          <TabsContent value="channels" className="mt-4 flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-muted-foreground font-mono">
                Monitorando <span className="text-foreground font-semibold">{monitoredCount}</span> de {channels.length} canais
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={selectAll} className="text-xs font-mono h-7">
                  Todos
                </Button>
                <Button variant="outline" size="sm" onClick={deselectAll} className="text-xs font-mono h-7">
                  Nenhum
                </Button>
              </div>
            </div>

            {channels.length === 0 ? (
              <p className="text-xs text-muted-foreground font-mono text-center py-8">
                Nenhum canal carregado ainda. Aguarde o primeiro refresh.
              </p>
            ) : (
              <ScrollArea className="flex-1 max-h-[300px] pr-2">
                <div className="space-y-1">
                  {channels.map((channel) => {
                    const isMonitored = !ignoredChannels.includes(channel.id);
                    return (
                      <label
                        key={channel.id}
                        className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors ${
                          isMonitored ? "bg-secondary/50 hover:bg-secondary" : "opacity-50 hover:opacity-70"
                        }`}
                      >
                        <Checkbox
                          checked={isMonitored}
                          onCheckedChange={() => toggleChannel(channel.id)}
                        />
                        <StatusIndicator status={channel.status} size="sm" />
                        <span className="font-mono text-xs text-foreground flex-1 truncate">
                          {channel.name}
                        </span>
                        <span className={`text-[10px] font-mono ${
                          channel.status === "online" ? "text-online" :
                          channel.status === "degraded" ? "text-degraded" : "text-offline"
                        }`}>
                          {channel.status === "online" ? "ON" : channel.status === "degraded" ? "DEG" : "OFF"}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>

        <Button onClick={handleSave} className="w-full mt-2 font-mono">
          Salvar Configurações
        </Button>
      </DialogContent>
    </Dialog>
  );
};
