import { useState, useEffect } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { AlertTriangle, Trash2, Info } from "lucide-react";
import { toast } from "sonner";

import { API_URL } from "@/lib/api";

interface Server {
  id: string;
  name: string;
}

export const MaintenanceTab = () => {
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedServer, setSelectedServer] = useState("all");
  const [confirmText, setConfirmText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<{ channel_outage_events: number; channel_status: number } | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/servers`)
      .then(r => r.json())
      .then(data => { if (data.success) setServers(data.servers); })
      .catch(() => {});
  }, []);

  const handleDryRun = async () => {
    try {
      const r = await fetch(`${API_URL}/api/admin/reset-history/dry?serverId=${selectedServer}`);
      const data = await r.json();
      if (data.success) {
        setDryRunResult(data.counts);
      }
    } catch {
      toast.error("Erro ao consultar contagens");
    }
  };

  const handleReset = async () => {
    if (confirmText !== "RESET") return;
    setIsLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/admin/reset-history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverId: selectedServer, confirm: "RESET" }),
      });
      const data = await r.json();
      if (data.success) {
        toast.success(`Histórico apagado. ${data.deleted.channel_outage_events} quedas e ${data.deleted.channel_status} status removidos. Monitoramento reiniciará a contagem a partir de agora.`);
        setConfirmText("");
        setDryRunResult(null);
      } else {
        toast.error(data.error || "Erro ao resetar");
      }
    } catch (err: any) {
      toast.error("Erro de conexão: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setDryRunResult(null);
  }, [selectedServer]);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
        <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
        <div className="text-xs text-destructive space-y-1">
          <p className="font-bold">Atenção: Ação irreversível!</p>
          <p>Isso apagará o histórico de quedas e resetará contadores de status. Configurações, servidores e canais monitorados <strong>NÃO</strong> serão afetados.</p>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-mono">Servidor</Label>
        <Select value={selectedServer} onValueChange={setSelectedServer}>
          <SelectTrigger className="font-mono text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os servidores</SelectItem>
            {servers.map(s => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button variant="outline" size="sm" onClick={handleDryRun} className="font-mono text-xs w-full">
        <Info className="h-3.5 w-3.5 mr-1.5" />
        Simular (ver o que será apagado)
      </Button>

      {dryRunResult && (
        <div className="p-3 rounded-lg bg-muted border border-border text-xs font-mono space-y-1">
          <p>📋 Registros que serão apagados:</p>
          <p>• Eventos de queda: <strong>{dryRunResult.channel_outage_events}</strong></p>
          <p>• Status de canais: <strong>{dryRunResult.channel_status}</strong></p>
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-xs font-mono">
          Digite <span className="text-destructive font-bold">RESET</span> para confirmar
        </Label>
        <Input
          value={confirmText}
          onChange={e => setConfirmText(e.target.value)}
          placeholder="Digite RESET"
          className="font-mono text-sm tracking-widest"
        />
      </div>

      <Button
        variant="destructive"
        className="w-full font-mono"
        disabled={confirmText !== "RESET" || isLoading}
        onClick={handleReset}
      >
        <Trash2 className="h-4 w-4 mr-2" />
        {isLoading ? "Apagando..." : "Resetar Histórico de Quedas"}
      </Button>
    </div>
  );
};
