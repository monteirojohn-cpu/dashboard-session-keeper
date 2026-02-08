import { type ChannelStatus } from "@/components/StatusIndicator";
import { type Channel } from "@/components/ChannelCard";

interface StatsBarProps {
  channels: Channel[];
}

export const StatsBar = ({ channels }: StatsBarProps) => {
  const online = channels.filter(c => c.status === "online").length;
  const offline = channels.filter(c => c.status === "offline").length;
  const degraded = channels.filter(c => c.status === "degraded").length;
  const total = channels.length;
  const uptimePercent = total > 0 ? Math.round((online / total) * 100) : 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <StatCard label="Total de Canais" value={String(total)} />
      <StatCard label="Online" value={String(online)} accent="online" />
      <StatCard label="Offline" value={String(offline)} accent="offline" />
      <StatCard label="Uptime Geral" value={`${uptimePercent}%`} accent={uptimePercent > 90 ? "online" : uptimePercent > 50 ? "degraded" : "offline"} />
    </div>
  );
};

const StatCard = ({ label, value, accent }: { label: string; value: string; accent?: string }) => (
  <div className="rounded-lg border border-border bg-card p-4">
    <p className="text-xs text-muted-foreground font-mono mb-1">{label}</p>
    <p className={`text-2xl font-bold font-mono ${
      accent === "online" ? "text-online" :
      accent === "offline" ? "text-offline" :
      accent === "degraded" ? "text-degraded" :
      "text-foreground"
    }`}>{value}</p>
  </div>
);
