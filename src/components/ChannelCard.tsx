import { StatusIndicator, StatusBadge, type ChannelStatus } from "./StatusIndicator";
import { Clock, Activity, ArrowUpRight } from "lucide-react";

export interface Channel {
  id: string;
  name: string;
  status: ChannelStatus;
  uptime?: string;
  lastCheck?: string;
  bitrate?: string;
  viewers?: number;
  source?: string;
}

export const ChannelCard = ({ channel }: { channel: Channel }) => {
  return (
    <div className={`group relative rounded-lg border bg-card p-5 transition-all duration-300 hover:border-muted-foreground/30 ${
      channel.status === "offline" ? "border-offline/30 glow-red" :
      channel.status === "degraded" ? "border-degraded/30 glow-yellow" :
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
        {channel.source && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Source</span>
            <span className="font-mono text-secondary-foreground truncate max-w-[140px]">{channel.source}</span>
          </div>
        )}
        {channel.bitrate && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1"><Activity className="h-3 w-3" /> Bitrate</span>
            <span className="font-mono text-secondary-foreground">{channel.bitrate}</span>
          </div>
        )}
        {channel.uptime && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1"><ArrowUpRight className="h-3 w-3" /> Uptime</span>
            <span className="font-mono text-secondary-foreground">{channel.uptime}</span>
          </div>
        )}
        {channel.lastCheck && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Última verificação</span>
            <span className="font-mono text-secondary-foreground">{channel.lastCheck}</span>
          </div>
        )}
      </div>
    </div>
  );
};
