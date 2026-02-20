import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Server, ArrowLeft, Wrench } from "lucide-react";
import { Link } from "react-router-dom";

import { API_URL } from "@/lib/api";

const DAYS_OF_WEEK = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
];

interface ServerItem {
  id: string;
  name: string;
  base_url: string;
  username: string;
  password: string;
  type: string;
  status: string;
  created_at: string;
  maintenance_enabled: number;
  maintenance_start: string | null;
  maintenance_end: string | null;
  maintenance_days: string | null;
  maintenance_silence_down: number;
  maintenance_silence_up: number;
  maintenance_tz: string;
}

interface ServerForm {
  name: string;
  base_url: string;
  username: string;
  password: string;
  type: string;
  maintenance_enabled: boolean;
  maintenance_start: string;
  maintenance_end: string;
  maintenance_days: number[];
  maintenance_silence_down: boolean;
  maintenance_silence_up: boolean;
}

const Servers = () => {
  const [servers, setServers] = useState<ServerItem[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ServerItem | null>(null);
  const [form, setForm] = useState<ServerForm>({
    name: "", base_url: "", username: "admin", password: "", type: "flussonic",
    maintenance_enabled: false, maintenance_start: "", maintenance_end: "",
    maintenance_days: [], maintenance_silence_down: true, maintenance_silence_up: false,
  });

  const fetchServers = async () => {
    try {
      const res = await fetch(`${API_URL}/api/servers`);
      const data = await res.json();
      if (data.success) setServers(data.servers);
    } catch (err) {
      console.error("Erro ao buscar servidores:", err);
    }
  };

  useEffect(() => { fetchServers(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm({
      name: "", base_url: "", username: "admin", password: "", type: "flussonic",
      maintenance_enabled: false, maintenance_start: "", maintenance_end: "",
      maintenance_days: [], maintenance_silence_down: true, maintenance_silence_up: false,
    });
    setDialogOpen(true);
  };

  const openEdit = (srv: ServerItem) => {
    setEditing(srv);
    setForm({
      name: srv.name, base_url: srv.base_url, username: srv.username, password: srv.password, type: srv.type,
      maintenance_enabled: !!srv.maintenance_enabled,
      maintenance_start: srv.maintenance_start || "",
      maintenance_end: srv.maintenance_end || "",
      maintenance_days: srv.maintenance_days ? JSON.parse(srv.maintenance_days) : [],
      maintenance_silence_down: srv.maintenance_silence_down !== 0,
      maintenance_silence_up: !!srv.maintenance_silence_up,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.base_url.trim()) {
      toast.error("Nome e URL são obrigatórios");
      return;
    }

    const payload = {
      name: form.name, base_url: form.base_url, username: form.username, password: form.password, type: form.type,
      maintenance_enabled: form.maintenance_enabled ? 1 : 0,
      maintenance_start: form.maintenance_start || null,
      maintenance_end: form.maintenance_end || null,
      maintenance_days: form.maintenance_days.length > 0 ? JSON.stringify(form.maintenance_days) : null,
      maintenance_silence_down: form.maintenance_silence_down ? 1 : 0,
      maintenance_silence_up: form.maintenance_silence_up ? 1 : 0,
    };

    try {
      if (editing) {
        await fetch(`${API_URL}/api/servers/${editing.id}`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        toast.success("Servidor atualizado!");
      } else {
        await fetch(`${API_URL}/api/servers`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        toast.success("Servidor adicionado!");
      }
      setDialogOpen(false);
      fetchServers();
    } catch (err) {
      toast.error("Erro ao salvar servidor");
    }
  };

  const handleDelete = async (id: string) => {
    if (id === "default") {
      toast.error("Não é possível deletar o servidor padrão");
      return;
    }
    try {
      await fetch(`${API_URL}/api/servers/${id}`, { method: "DELETE" });
      toast.success("Servidor removido");
      fetchServers();
    } catch {
      toast.error("Erro ao deletar");
    }
  };

  const toggleDay = (day: number) => {
    setForm(prev => ({
      ...prev,
      maintenance_days: prev.maintenance_days.includes(day)
        ? prev.maintenance_days.filter(d => d !== day)
        : [...prev.maintenance_days, day].sort(),
    }));
  };

  return (
    <div className="min-h-screen bg-background grid-bg">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <Server className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold font-mono text-foreground">Servidores</h1>
          </div>
          <Button onClick={openNew} className="font-mono text-xs gap-1">
            <Plus className="h-3 w-3" /> Novo Servidor
          </Button>
        </div>
      </header>

      <main className="container py-6">
        {servers.length === 0 ? (
          <div className="text-center py-20">
            <Server className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground font-mono">Nenhum servidor cadastrado</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {servers.map((srv) => (
              <div key={srv.id} className="rounded-lg border border-border bg-card p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-mono text-sm font-semibold text-foreground">{srv.name}</h3>
                    <p className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">{srv.base_url}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {srv.maintenance_enabled ? (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 flex items-center gap-1">
                        <Wrench className="h-3 w-3" /> MANUTENÇÃO
                      </span>
                    ) : null}
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                      srv.status === "active" ? "bg-online/20 text-online" : "bg-offline/20 text-offline"
                    }`}>
                      {srv.status === "active" ? "ATIVO" : "INATIVO"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                  <span>Tipo: {srv.type}</span>
                  <span>User: {srv.username}</span>
                </div>
                {srv.maintenance_enabled && srv.maintenance_start && srv.maintenance_end && (
                  <div className="text-xs text-yellow-400/80 font-mono">
                    🔧 Janela: {srv.maintenance_start} — {srv.maintenance_end}
                    {srv.maintenance_days && JSON.parse(srv.maintenance_days).length > 0 && JSON.parse(srv.maintenance_days).length < 7 && (
                      <> ({JSON.parse(srv.maintenance_days).map((d: number) => DAYS_OF_WEEK.find(dw => dw.value === d)?.label).join(', ')})</>
                    )}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => openEdit(srv)} className="text-xs font-mono h-7 gap-1">
                    <Pencil className="h-3 w-3" /> Editar
                  </Button>
                  {srv.id !== "default" && (
                    <Button variant="outline" size="sm" onClick={() => handleDelete(srv.id)}
                      className="text-xs font-mono h-7 gap-1 text-destructive hover:text-destructive">
                      <Trash2 className="h-3 w-3" /> Remover
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg bg-card border-border max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono">{editing ? "Editar Servidor" : "Novo Servidor"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground font-mono">Nome</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Servidor Principal" className="font-mono text-sm bg-secondary border-border" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground font-mono">URL Base</Label>
              <Input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                placeholder="http://192.168.1.1:8089" className="font-mono text-sm bg-secondary border-border" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground font-mono">Usuário</Label>
                <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
                  className="font-mono text-sm bg-secondary border-border" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground font-mono">Senha</Label>
                <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="font-mono text-sm bg-secondary border-border" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground font-mono">Tipo</Label>
              <Input value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                placeholder="flussonic" className="font-mono text-sm bg-secondary border-border" />
            </div>

            {/* Maintenance Window Section */}
            <div className="border-t border-border pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-yellow-400" />
                <Label className="text-sm font-mono font-semibold text-foreground">Janela de Manutenção</Label>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="maintenance_enabled"
                  checked={form.maintenance_enabled}
                  onCheckedChange={(checked) => setForm({ ...form, maintenance_enabled: !!checked })}
                />
                <Label htmlFor="maintenance_enabled" className="text-xs text-muted-foreground font-mono cursor-pointer">
                  Ativar janela de manutenção
                </Label>
              </div>

              {form.maintenance_enabled && (
                <div className="space-y-3 pl-1">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground font-mono">Início (HH:MM)</Label>
                      <Input type="time" value={form.maintenance_start}
                        onChange={(e) => setForm({ ...form, maintenance_start: e.target.value })}
                        className="font-mono text-sm bg-secondary border-border" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground font-mono">Fim (HH:MM)</Label>
                      <Input type="time" value={form.maintenance_end}
                        onChange={(e) => setForm({ ...form, maintenance_end: e.target.value })}
                        className="font-mono text-sm bg-secondary border-border" />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground font-mono">Dias da semana (vazio = todos)</Label>
                    <div className="flex gap-1 flex-wrap">
                      {DAYS_OF_WEEK.map((day) => (
                        <button
                          key={day.value}
                          type="button"
                          onClick={() => toggleDay(day.value)}
                          className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
                            form.maintenance_days.includes(day.value)
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-secondary text-muted-foreground border-border hover:border-primary/50"
                          }`}
                        >
                          {day.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground font-mono">Silenciar durante a janela:</Label>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="silence_down"
                        checked={form.maintenance_silence_down}
                        onCheckedChange={(checked) => setForm({ ...form, maintenance_silence_down: !!checked })}
                      />
                      <Label htmlFor="silence_down" className="text-xs text-muted-foreground font-mono cursor-pointer">
                        Alertas de QUEDA (DOWN)
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="silence_up"
                        checked={form.maintenance_silence_up}
                        onCheckedChange={(checked) => setForm({ ...form, maintenance_silence_up: !!checked })}
                      />
                      <Label htmlFor="silence_up" className="text-xs text-muted-foreground font-mono cursor-pointer">
                        Alertas de RECUPERAÇÃO (UP)
                      </Label>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <Button onClick={handleSave} className="w-full font-mono">Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Servers;
