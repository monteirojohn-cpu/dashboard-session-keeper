import { useState, useEffect } from "react";
import { StatusIndicator, StatusBadge, type ChannelStatus } from "./StatusIndicator";
import { Clock, Activity, ArrowUpRight, Heart, Timer } from "lucide-react";

export interface Channel {
  id: string;
  name: string;
  status: ChannelStatus;
  uptime?: string;
  lastCheck?: string;
  bitrate?: string;
  viewers?: number;
  source?: string;
  health?: number;
  group?: string;
  statusSince?: number; // timestamp (ms) when status was set
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const ChannelCard = ({ channel }: { channel: Channel }) => {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    if (!channel.statusSince) return;
    const update = () => {
      setElapsed(formatElapsed(Date.now() - channel.statusSince!));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [channel.statusSince]);

  return (
    <div className={`group relative rounded-lg border bg-card p-5 transition-all duration-300 hover:border-muted-foreground/30 ${
      channel.status === "offline" ? "border-offline/30 glow-red" :
      channel.status === "degraded" ? "border-offline/30 glow-red" :
      "border-border"
    }`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <StatusIndicator status={channel.status} size="md" />
          <h3 className="font-mono text-sm font-semibold text-foreground truncate max-w-[180px]">
            {channel.name}
          </h3>
        </div>
        <StatusBadge status={channel.status} />
      </div>

      <div className="space-y-2.5">
        {channel.health !== undefined && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1"><Heart className="h-3 w-3" /> Health</span>
            <span className={`font-mono font-semibold ${
              channel.health > 70 ? "text-online" : channel.health > 40 ? "text-degraded" : "text-offline"
            }`}>{channel.health}%</span>
          </div>
        )}
        {channel.source && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Protocolo</span>
            <span className="font-mono text-secondary-foreground truncate max-w-[140px]">{channel.source}</span>
          </div>
        )}
        {channel.bitrate && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1"><Activity className="h-3 w-3" /> Bitrate</span>
            <span className="font-mono text-secondary-foreground">{channel.bitrate}</span>
          </div>
        )}
        {channel.statusSince && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1"><Timer className="h-3 w-3" /> Tempo {channel.status === "online" ? "Online" : "Fora"}</span>
            <span className="font-mono text-secondary-foreground">{elapsed}</span>
          </div>
        )}
        {channel.lastCheck && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Atualizado</span>
            <span className="font-mono text-secondary-foreground">{channel.lastCheck}</span>
          </div>
        )}
      </div>
    </div>
  );
};
