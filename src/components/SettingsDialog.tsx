import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { toast } from "sonner";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const SettingsDialog = ({ open, onOpenChange }: SettingsDialogProps) => {
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
    toast.success("Configurações salvas com sucesso!");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-mono text-foreground">Configurações</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="connection" className="w-full">
          <TabsList className="w-full bg-muted">
            <TabsTrigger value="connection" className="flex-1 text-xs font-mono">Conexão</TabsTrigger>
            <TabsTrigger value="notifications" className="flex-1 text-xs font-mono">Notificações</TabsTrigger>
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
        </Tabs>

        <Button onClick={handleSave} className="w-full mt-2 font-mono">
          Salvar Configurações
        </Button>
      </DialogContent>
    </Dialog>
  );
};
