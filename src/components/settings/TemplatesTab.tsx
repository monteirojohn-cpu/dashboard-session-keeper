import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface TemplatesTabProps {
  messageTemplate: string;
  setMessageTemplate: (v: string) => void;
}

const DEFAULT_TEMPLATE = `🚨 *SIGNAL MONITOR - ALERTA*

📡 *{total_canais} canal(is) caíram:*

{lista_canais}

🕐 *Horário:* {hora}
📅 *Data:* {data}
🖥️ *Servidor:* {servidor_nome}`;

const VARIABLES = [
  { var: "{canal_nome}", desc: "Nome do canal" },
  { var: "{servidor_nome}", desc: "Nome do servidor" },
  { var: "{status}", desc: "Status do canal (offline/degraded)" },
  { var: "{data}", desc: "Data atual" },
  { var: "{hora}", desc: "Horário atual" },
  { var: "{total_canais}", desc: "Total de canais afetados" },
  { var: "{lista_canais}", desc: "Lista formatada dos canais" },
  { var: "{url}", desc: "URL do dashboard" },
];

export const TemplatesTab = ({ messageTemplate, setMessageTemplate }: TemplatesTabProps) => {
  const insertVariable = (v: string) => {
    setMessageTemplate(messageTemplate + v);
  };

  return (
    <div className="space-y-4 overflow-y-auto max-h-[55vh] pr-1">
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground font-mono">Template de Mensagem</Label>
        <Textarea
          value={messageTemplate}
          onChange={(e) => setMessageTemplate(e.target.value)}
          placeholder={DEFAULT_TEMPLATE}
          className="font-mono text-xs bg-secondary border-border min-h-[150px] resize-y"
          rows={8}
        />
      </div>

      <div className="space-y-2">
        <Label className="text-[10px] text-muted-foreground font-mono font-semibold">Variáveis disponíveis</Label>
        <div className="flex flex-wrap gap-1.5">
          {VARIABLES.map((v) => (
            <button
              key={v.var}
              type="button"
              onClick={() => insertVariable(v.var)}
              className="text-[10px] font-mono px-2 py-1 rounded border border-border bg-muted hover:bg-secondary transition-colors text-foreground"
              title={v.desc}
            >
              {v.var}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-border pt-3">
        <p className="text-[10px] text-muted-foreground font-mono">
          💡 Deixe em branco para usar o template padrão. O template será usado para todas as notificações (Telegram e WhatsApp).
        </p>
      </div>

      {/* Preview */}
      <div className="space-y-2">
        <Label className="text-[10px] text-muted-foreground font-mono font-semibold">Pré-visualização</Label>
        <div className="rounded-md border border-border bg-muted/50 p-3 text-xs font-mono text-foreground whitespace-pre-wrap">
          {(messageTemplate || DEFAULT_TEMPLATE)
            .replace("{canal_nome}", "Canal Exemplo")
            .replace("{servidor_nome}", "Servidor Principal")
            .replace("{status}", "offline")
            .replace("{data}", new Date().toLocaleDateString("pt-BR"))
            .replace("{hora}", new Date().toLocaleTimeString("pt-BR"))
            .replace("{total_canais}", "2")
            .replace("{lista_canais}", "• Canal Exemplo\n• Canal Teste")
            .replace("{url}", "http://192.168.1.1:8089")}
        </div>
      </div>
    </div>
  );
};

export const DEFAULT_MESSAGE_TEMPLATE = DEFAULT_TEMPLATE;
