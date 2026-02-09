import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { StatusIndicator } from "@/components/StatusIndicator";
import type { Channel } from "@/components/ChannelCard";

interface ChannelsTabProps {
  channels: Channel[];
  ignoredChannels: string[];
  setIgnoredChannels: (v: string[]) => void;
}

export const ChannelsTab = ({ channels, ignoredChannels, setIgnoredChannels }: ChannelsTabProps) => {
  const toggleChannel = (channelId: string) => {
    setIgnoredChannels(
      ignoredChannels.includes(channelId)
        ? ignoredChannels.filter((id) => id !== channelId)
        : [...ignoredChannels, channelId]
    );
  };

  const selectAll = () => setIgnoredChannels([]);
  const deselectAll = () => setIgnoredChannels(channels.map((c) => c.id));

  const monitoredCount = channels.length - ignoredChannels.length;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground font-mono">
          Monitorando <span className="text-foreground font-semibold">{monitoredCount}</span> de {channels.length} canais
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={selectAll} className="text-xs font-mono h-7">
            Todos
          </Button>
          <Button variant="outline" size="sm" onClick={deselectAll} className="text-xs font-mono h-7">
            Nenhum
          </Button>
        </div>
      </div>

      {channels.length === 0 ? (
        <p className="text-xs text-muted-foreground font-mono text-center py-8">
          Nenhum canal carregado ainda. Aguarde o primeiro refresh.
        </p>
      ) : (
        <div className="overflow-y-auto max-h-[45vh] pr-1 -mr-1 space-y-1">
          {channels.map((channel) => {
            const isMonitored = !ignoredChannels.includes(channel.id);
            return (
              <label
                key={channel.id}
                className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors ${
                  isMonitored ? "bg-secondary/50 hover:bg-secondary" : "opacity-50 hover:opacity-70"
                }`}
              >
                <Checkbox
                  checked={isMonitored}
                  onCheckedChange={() => toggleChannel(channel.id)}
                />
                <StatusIndicator status={channel.status} size="sm" />
                <span className="font-mono text-xs text-foreground flex-1 truncate">
                  {channel.name}
                </span>
                <span className={`text-[10px] font-mono ${
                  channel.status === "online" ? "text-online" :
                  channel.status === "degraded" ? "text-degraded" : "text-offline"
                }`}>
                  {channel.status === "online" ? "ON" : channel.status === "degraded" ? "DEG" : "OFF"}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
};
