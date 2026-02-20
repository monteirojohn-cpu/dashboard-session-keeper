import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Download, BarChart3, Clock, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";

import { API_URL } from "@/lib/api";

interface OutageEvent {
  id: number;
  channel_id: string;
  channel_name: string;
  server_id: string;
  server_name: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
}

interface OutageStats {
  totalOutages: number;
  totalOfflineSeconds: number;
  openOutages: number;
  topByCount: { name: string; count: number }[];
  topByDuration: { name: string; duration: number }[];
}

function formatDuration(seconds: number): string {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "Em andamento";
  return new Date(iso).toLocaleString("pt-BR");
}

const Reports = () => {
  const [outages, setOutages] = useState<OutageEvent[]>([]);
  const [stats, setStats] = useState<OutageStats | null>(null);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(false);

  const fetchOutages = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("start", startDate);
      if (endDate) params.set("end", endDate + "T23:59:59");
      const res = await fetch(`${API_URL}/api/outages?${params}`);
      const data = await res.json();
      if (data.success) {
        setOutages(data.outages);
        setStats(data.stats);
      }
    } catch (err) {
      console.error("Erro ao buscar relatórios:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOutages(); }, []);

  const exportCSV = () => {
    const headers = "Canal,Servidor,Início,Fim,Duração (s)\n";
    const rows = outages.map(o =>
      `"${o.channel_name || o.channel_id}","${o.server_name || o.server_id}","${o.started_at}","${o.ended_at || ""}","${o.duration_seconds || ""}"`
    ).join("\n");
    const blob = new Blob([headers + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `outages_${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
            <BarChart3 className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold font-mono text-foreground">Relatórios</h1>
          </div>
          <Button variant="outline" onClick={exportCSV} className="font-mono text-xs gap-1">
            <Download className="h-3 w-3" /> Exportar CSV
          </Button>
        </div>
      </header>

      <main className="container py-6 space-y-6">
        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground font-mono">Data início</label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="font-mono text-xs bg-secondary border-border h-8 w-40" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground font-mono">Data fim</label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="font-mono text-xs bg-secondary border-border h-8 w-40" />
          </div>
          <Button onClick={fetchOutages} className="font-mono text-xs h-8" disabled={loading}>
            {loading ? "Buscando..." : "Filtrar"}
          </Button>
        </div>

        {/* Stats cards */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Total de Quedas" value={String(stats.totalOutages)} icon={<AlertTriangle className="h-4 w-4" />} />
            <StatCard label="Tempo Total Offline" value={formatDuration(stats.totalOfflineSeconds)} icon={<Clock className="h-4 w-4" />} />
            <StatCard label="Quedas em Aberto" value={String(stats.openOutages)} accent="offline" />
            <StatCard label="Canais Afetados" value={String(stats.topByCount.length)} />
          </div>
        )}

        {/* Top channels */}
        {stats && stats.topByCount.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-xs font-mono text-muted-foreground mb-3 font-semibold">Top 10 — Mais Quedas</h3>
              <div className="space-y-2">
                {stats.topByCount.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-xs font-mono">
                    <span className="text-foreground truncate max-w-[180px]">{i + 1}. {item.name}</span>
                    <span className="text-offline font-semibold">{item.count}x</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-xs font-mono text-muted-foreground mb-3 font-semibold">Top 10 — Maior Tempo Offline</h3>
              <div className="space-y-2">
                {stats.topByDuration.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-xs font-mono">
                    <span className="text-foreground truncate max-w-[180px]">{i + 1}. {item.name}</span>
                    <span className="text-offline font-semibold">{formatDuration(item.duration)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Outage table */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left p-3 text-muted-foreground">Canal</th>
                  <th className="text-left p-3 text-muted-foreground">Servidor</th>
                  <th className="text-left p-3 text-muted-foreground">Início</th>
                  <th className="text-left p-3 text-muted-foreground">Fim</th>
                  <th className="text-left p-3 text-muted-foreground">Duração</th>
                  <th className="text-left p-3 text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {outages.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-muted-foreground">
                      Nenhuma queda registrada no período
                    </td>
                  </tr>
                ) : (
                  outages.map((o) => (
                    <tr key={o.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="p-3 text-foreground">{o.channel_name || o.channel_id}</td>
                      <td className="p-3 text-muted-foreground">{o.server_name || o.server_id}</td>
                      <td className="p-3 text-muted-foreground">{formatDate(o.started_at)}</td>
                      <td className="p-3 text-muted-foreground">{formatDate(o.ended_at)}</td>
                      <td className="p-3 text-foreground">{o.duration_seconds ? formatDuration(o.duration_seconds) : "—"}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                          o.ended_at ? "bg-online/20 text-online" : "bg-offline/20 text-offline"
                        }`}>
                          {o.ended_at ? "Resolvido" : "Em aberto"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
};

const StatCard = ({ label, value, icon, accent }: { label: string; value: string; icon?: React.ReactNode; accent?: string }) => (
  <div className="rounded-lg border border-border bg-card p-4">
    <div className="flex items-center gap-2 mb-1">
      {icon && <span className="text-muted-foreground">{icon}</span>}
      <p className="text-[10px] text-muted-foreground font-mono">{label}</p>
    </div>
    <p className={`text-xl font-bold font-mono ${accent === "offline" ? "text-offline" : "text-foreground"}`}>{value}</p>
  </div>
);

export default Reports;
