import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { toast } from "sonner";
import { ConnectionTab } from "./settings/ConnectionTab";
import { NotificationsTab, type TelegramDest, type WhatsappDest } from "./settings/NotificationsTab";
import { ChannelsTab } from "./settings/ChannelsTab";
import { TemplatesTab } from "./settings/TemplatesTab";
import type { Channel } from "./ChannelCard";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channels?: Channel[];
}

function loadJsonArray<T>(key: string, fallback: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

// Migrate old single-destination format to array format
function migrateLegacyDestinations() {
  // Telegram
  const oldToken = localStorage.getItem("telegram_bot_token");
  const oldChatId = localStorage.getItem("telegram_chat_id");
  if (oldToken && oldChatId && !localStorage.getItem("telegram_destinations")) {
    localStorage.setItem("telegram_destinations", JSON.stringify([{ botToken: oldToken, chatId: oldChatId }]));
    localStorage.removeItem("telegram_bot_token");
    localStorage.removeItem("telegram_chat_id");
  }
  // WhatsApp
  const oldPhone = localStorage.getItem("whatsapp_phone");
  const oldApiKey = localStorage.getItem("whatsapp_apikey");
  if (oldPhone && oldApiKey && !localStorage.getItem("whatsapp_destinations")) {
    localStorage.setItem("whatsapp_destinations", JSON.stringify([{ phone: oldPhone, apiKey: oldApiKey }]));
    localStorage.removeItem("whatsapp_phone");
    localStorage.removeItem("whatsapp_apikey");
  }
}

// Run migration on module load
migrateLegacyDestinations();

export const SettingsDialog = ({ open, onOpenChange, channels = [] }: SettingsDialogProps) => {
  const [dashboardUrl, setDashboardUrl] = useState(() => localStorage.getItem("dashboard_url") || "http://157.254.55.203:8089");
  const [dashboardUser, setDashboardUser] = useState(() => localStorage.getItem("dashboard_user") || "admin");
  const [dashboardPass, setDashboardPass] = useState(() => localStorage.getItem("dashboard_pass") || "");
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(() => localStorage.getItem("auto_refresh_interval") || "30");
  const [sessionRenewalInterval, setSessionRenewalInterval] = useState(() => localStorage.getItem("session_renewal_interval") || "5");
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => localStorage.getItem("notifications_enabled") === "true");

  const [telegramDestinations, setTelegramDestinations] = useState<TelegramDest[]>(
    () => loadJsonArray<TelegramDest>("telegram_destinations", [])
  );
  const [whatsappDestinations, setWhatsappDestinations] = useState<WhatsappDest[]>(
    () => loadJsonArray<WhatsappDest>("whatsapp_destinations", [])
  );

  // Legacy ignored_channels no longer needed - managed server-side

  const [messageTemplate, setMessageTemplate] = useState(
    () => localStorage.getItem("message_template") || ""
  );

  const handleSave = () => {
    // Validate: no duplicate telegram chat ids
    const tgChatIds = telegramDestinations.filter(d => d.chatId).map(d => d.chatId);
    if (new Set(tgChatIds).size !== tgChatIds.length) {
      toast.error("Chat IDs Telegram duplicados detectados!");
      return;
    }
    // Validate: no duplicate whatsapp phones
    const waPhones = whatsappDestinations.filter(d => d.phone).map(d => d.phone);
    if (new Set(waPhones).size !== waPhones.length) {
      toast.error("Telefones WhatsApp duplicados detectados!");
      return;
    }

    // Filter out empty destinations
    const validTg = telegramDestinations.filter(d => d.botToken.trim() && d.chatId.trim());
    const validWa = whatsappDestinations.filter(d => d.phone.trim() && d.apiKey.trim());

    localStorage.setItem("dashboard_url", dashboardUrl);
    localStorage.setItem("dashboard_user", dashboardUser);
    localStorage.setItem("dashboard_pass", dashboardPass);
    localStorage.setItem("auto_refresh_interval", autoRefreshInterval);
    localStorage.setItem("session_renewal_interval", sessionRenewalInterval);
    localStorage.setItem("notifications_enabled", String(notificationsEnabled));
    localStorage.setItem("telegram_destinations", JSON.stringify(validTg));
    localStorage.setItem("whatsapp_destinations", JSON.stringify(validWa));
    // ignored_channels now managed server-side
    localStorage.setItem("message_template", messageTemplate);

    setTelegramDestinations(validTg);
    setWhatsappDestinations(validWa);

    toast.success("Configurações salvas com sucesso!");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-card border-border max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="font-mono text-foreground">Configurações</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="connection" className="w-full flex-1 flex flex-col min-h-0 overflow-hidden">
          <TabsList className="w-full bg-muted shrink-0">
            <TabsTrigger value="connection" className="flex-1 text-[10px] font-mono">Conexão</TabsTrigger>
            <TabsTrigger value="notifications" className="flex-1 text-[10px] font-mono">Notificações</TabsTrigger>
            <TabsTrigger value="channels" className="flex-1 text-[10px] font-mono">Canais</TabsTrigger>
            <TabsTrigger value="templates" className="flex-1 text-[10px] font-mono">Mensagem</TabsTrigger>
          </TabsList>

          <TabsContent value="connection" className="mt-4 overflow-y-auto flex-1">
            <ConnectionTab
              dashboardUrl={dashboardUrl} setDashboardUrl={setDashboardUrl}
              dashboardUser={dashboardUser} setDashboardUser={setDashboardUser}
              dashboardPass={dashboardPass} setDashboardPass={setDashboardPass}
              autoRefreshInterval={autoRefreshInterval} setAutoRefreshInterval={setAutoRefreshInterval}
              sessionRenewalInterval={sessionRenewalInterval} setSessionRenewalInterval={setSessionRenewalInterval}
            />
          </TabsContent>

          <TabsContent value="notifications" className="mt-4 flex-1 min-h-0">
            <NotificationsTab
              notificationsEnabled={notificationsEnabled} setNotificationsEnabled={setNotificationsEnabled}
              telegramDestinations={telegramDestinations} setTelegramDestinations={setTelegramDestinations}
              whatsappDestinations={whatsappDestinations} setWhatsappDestinations={setWhatsappDestinations}
            />
          </TabsContent>

          <TabsContent value="channels" className="mt-4 flex-1 flex flex-col min-h-0">
            <ChannelsTab channels={channels} />
          </TabsContent>

          <TabsContent value="templates" className="mt-4 flex-1 min-h-0">
            <TemplatesTab
              messageTemplate={messageTemplate}
              setMessageTemplate={setMessageTemplate}
            />
          </TabsContent>
        </Tabs>

        <Button onClick={handleSave} className="w-full mt-2 font-mono shrink-0">
          Salvar Configurações
        </Button>
      </DialogContent>
    </Dialog>
  );
};
