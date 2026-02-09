import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Server, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

interface ServerItem {
  id: string;
  name: string;
  base_url: string;
  username: string;
  password: string;
  type: string;
  status: string;
  created_at: string;
}

const Servers = () => {
  const [servers, setServers] = useState<ServerItem[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ServerItem | null>(null);
  const [form, setForm] = useState({ name: "", base_url: "", username: "admin", password: "", type: "flussonic" });

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
    setForm({ name: "", base_url: "", username: "admin", password: "", type: "flussonic" });
    setDialogOpen(true);
  };

  const openEdit = (srv: ServerItem) => {
    setEditing(srv);
    setForm({ name: srv.name, base_url: srv.base_url, username: srv.username, password: srv.password, type: srv.type });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.base_url.trim()) {
      toast.error("Nome e URL são obrigatórios");
      return;
    }

    try {
      if (editing) {
        await fetch(`${API_URL}/api/servers/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        toast.success("Servidor atualizado!");
      } else {
        await fetch(`${API_URL}/api/servers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
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
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                    srv.status === "active" ? "bg-online/20 text-online" : "bg-offline/20 text-offline"
                  }`}>
                    {srv.status === "active" ? "ATIVO" : "INATIVO"}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                  <span>Tipo: {srv.type}</span>
                  <span>User: {srv.username}</span>
                </div>
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
        <DialogContent className="sm:max-w-md bg-card border-border">
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
            <Button onClick={handleSave} className="w-full font-mono">Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Servers;
