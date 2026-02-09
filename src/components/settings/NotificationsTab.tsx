import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

export interface TelegramDest {
  botToken: string;
  chatId: string;
}

export interface WhatsappDest {
  phone: string;
  apiKey: string;
}

interface NotificationsTabProps {
  notificationsEnabled: boolean;
  setNotificationsEnabled: (v: boolean) => void;
  telegramDestinations: TelegramDest[];
  setTelegramDestinations: (v: TelegramDest[]) => void;
  whatsappDestinations: WhatsappDest[];
  setWhatsappDestinations: (v: WhatsappDest[]) => void;
}

export const NotificationsTab = ({
  notificationsEnabled, setNotificationsEnabled,
  telegramDestinations, setTelegramDestinations,
  whatsappDestinations, setWhatsappDestinations,
}: NotificationsTabProps) => {

  const addTelegram = () => {
    setTelegramDestinations([...telegramDestinations, { botToken: "", chatId: "" }]);
  };

  const removeTelegram = (idx: number) => {
    setTelegramDestinations(telegramDestinations.filter((_, i) => i !== idx));
  };

  const updateTelegram = (idx: number, field: keyof TelegramDest, value: string) => {
    const updated = [...telegramDestinations];
    updated[idx] = { ...updated[idx], [field]: value };
    setTelegramDestinations(updated);
  };

  const addWhatsapp = () => {
    setWhatsappDestinations([...whatsappDestinations, { phone: "", apiKey: "" }]);
  };

  const removeWhatsapp = (idx: number) => {
    setWhatsappDestinations(whatsappDestinations.filter((_, i) => i !== idx));
  };

  const updateWhatsapp = (idx: number, field: keyof WhatsappDest, value: string) => {
    const updated = [...whatsappDestinations];
    updated[idx] = { ...updated[idx], [field]: value };
    setWhatsappDestinations(updated);
  };

  return (
    <div className="space-y-4 overflow-y-auto max-h-[55vh] pr-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground font-mono">Notificações ativas</Label>
        <Switch checked={notificationsEnabled} onCheckedChange={setNotificationsEnabled} />
      </div>

      {/* Telegram Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground font-mono font-semibold">Telegram</p>
          <Button variant="outline" size="sm" onClick={addTelegram} className="h-7 text-xs font-mono gap-1">
            <Plus className="h-3 w-3" /> Adicionar
          </Button>
        </div>

        {telegramDestinations.length === 0 && (
          <p className="text-[10px] text-muted-foreground font-mono text-center py-2">
            Nenhum destino Telegram configurado
          </p>
        )}

        {telegramDestinations.map((dest, idx) => (
          <div key={idx} className="relative border border-border rounded-md p-3 space-y-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => removeTelegram(idx)}
              className="absolute top-1 right-1 h-6 w-6 text-muted-foreground hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </Button>
            <p className="text-[10px] text-muted-foreground font-mono font-semibold">Destino #{idx + 1}</p>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground font-mono">Bot Token</Label>
              <Input
                value={dest.botToken}
                onChange={(e) => updateTelegram(idx, "botToken", e.target.value)}
                placeholder="123456:ABC-DEF..."
                className="font-mono text-xs bg-secondary border-border h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground font-mono">Chat ID</Label>
              <Input
                value={dest.chatId}
                onChange={(e) => updateTelegram(idx, "chatId", e.target.value)}
                placeholder="-100123456789"
                className="font-mono text-xs bg-secondary border-border h-8"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-border my-3" />

      {/* WhatsApp Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground font-mono font-semibold">WhatsApp (CallMeBot)</p>
          <Button variant="outline" size="sm" onClick={addWhatsapp} className="h-7 text-xs font-mono gap-1">
            <Plus className="h-3 w-3" /> Adicionar
          </Button>
        </div>

        {whatsappDestinations.length === 0 && (
          <p className="text-[10px] text-muted-foreground font-mono text-center py-2">
            Nenhum destino WhatsApp configurado
          </p>
        )}

        {whatsappDestinations.map((dest, idx) => (
          <div key={idx} className="relative border border-border rounded-md p-3 space-y-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => removeWhatsapp(idx)}
              className="absolute top-1 right-1 h-6 w-6 text-muted-foreground hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </Button>
            <p className="text-[10px] text-muted-foreground font-mono font-semibold">Destino #{idx + 1}</p>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground font-mono">Telefone (com DDI)</Label>
              <Input
                value={dest.phone}
                onChange={(e) => updateWhatsapp(idx, "phone", e.target.value)}
                placeholder="5551999999999"
                className="font-mono text-xs bg-secondary border-border h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground font-mono">API Key</Label>
              <Input
                value={dest.apiKey}
                onChange={(e) => updateWhatsapp(idx, "apiKey", e.target.value)}
                placeholder="123456"
                className="font-mono text-xs bg-secondary border-border h-8"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
