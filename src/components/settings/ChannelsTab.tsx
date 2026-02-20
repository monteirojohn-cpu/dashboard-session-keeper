import { useState, useEffect, useCallback } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { StatusIndicator } from "@/components/StatusIndicator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Channel } from "@/components/ChannelCard";

import { API_URL } from "@/lib/api";

interface Server {
  id: string;
  name: string;
}

interface MonitoredChannel {
  channel_id: string;
  channel_name: string;
  enabled: number;
}

interface ChannelsTabProps {
  channels: Channel[];
}

export const ChannelsTab = ({ channels }: ChannelsTabProps) => {
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string>("");
  const [monitoredChannels, setMonitoredChannels] = useState<MonitoredChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copySourceId, setCopySourceId] = useState<string>("");

  // Fetch servers
  useEffect(() => {
    fetch(`${API_URL}/api/servers`).then(r => r.json()).then(data => {
      if (data.success && data.servers.length > 0) {
        setServers(data.servers);
        setSelectedServerId(data.servers[0].id);
      }
    }).catch(() => {});
  }, []);

  // Fetch monitored channels for selected server
  const fetchMonitored = useCallback(async () => {
    if (!selectedServerId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/monitored-channels?server_id=${selectedServerId}`);
      const data = await res.json();
      if (data.success) {
        setMonitoredChannels(data.channels);
      }
    } catch (err) {
      console.error("Erro ao buscar canais monitorados:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedServerId]);

  useEffect(() => { fetchMonitored(); }, [fetchMonitored]);

  // Merge: show channels from API (live) + persisted monitored_channels
  const mergedChannels = (() => {
    const monMap = new Map(monitoredChannels.map(m => [m.channel_id, m]));
    // Channels from the current fetch that match this server
    const serverChannels = channels.filter(ch => !ch.serverId || ch.serverId === selectedServerId);
    
    // Build unified list
    const seen = new Set<string>();
    const result: { id: string; name: string; status: string; enabled: boolean }[] = [];
    
    // First: live channels
    for (const ch of serverChannels) {
      seen.add(ch.id);
      const mon = monMap.get(ch.id);
      result.push({
        id: ch.id,
        name: ch.name,
        status: ch.status,
        enabled: mon ? mon.enabled === 1 : true, // default enabled if no record
      });
    }
    
    // Then: persisted channels not in live list
    for (const mon of monitoredChannels) {
      if (!seen.has(mon.channel_id)) {
        result.push({
          id: mon.channel_id,
          name: mon.channel_name || mon.channel_id,
          status: "unknown",
          enabled: mon.enabled === 1,
        });
      }
    }
    
    return result;
  })();

  const enabledCount = mergedChannels.filter(c => c.enabled).length;

  const toggleChannel = (channelId: string) => {
    setMonitoredChannels(prev => {
      const existing = prev.find(m => m.channel_id === channelId);
      if (existing) {
        return prev.map(m => m.channel_id === channelId ? { ...m, enabled: m.enabled === 1 ? 0 : 1 } : m);
      }
      // New channel, add as disabled (was defaulting to enabled)
      const ch = mergedChannels.find(c => c.id === channelId);
      return [...prev, { channel_id: channelId, channel_name: ch?.name || channelId, enabled: 0 }];
    });
  };

  const selectAll = () => {
    setMonitoredChannels(mergedChannels.map(c => ({ channel_id: c.id, channel_name: c.name, enabled: 1 })));
  };

  const deselectAll = () => {
    setMonitoredChannels(mergedChannels.map(c => ({ channel_id: c.id, channel_name: c.name, enabled: 0 })));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = mergedChannels.map(c => ({
        channel_id: c.id,
        channel_name: c.name,
        enabled: c.enabled,
      }));
      const res = await fetch(`${API_URL}/api/monitored-channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ server_id: selectedServerId, channels: payload }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Seleção salva com sucesso!");
        fetchMonitored();
      } else {
        toast.error("Erro ao salvar: " + (data.error || ""));
      }
    } catch (err) {
      toast.error("Erro ao salvar seleção");
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    if (!copySourceId || copySourceId === selectedServerId) {
      toast.error("Selecione um servidor de origem diferente");
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/monitored-channels/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_server_id: copySourceId, target_server_id: selectedServerId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`${data.copied} canais copiados com sucesso!`);
        fetchMonitored();
      } else {
        toast.error("Erro ao copiar: " + (data.error || ""));
      }
    } catch (err) {
      toast.error("Erro ao copiar seleção");
    }
  };

  const selectedServerName = servers.find(s => s.id === selectedServerId)?.name || selectedServerId;

  return (
    <div className="flex flex-col min-h-0 flex-1 gap-3">
      {/* Server selector */}
      <div className="space-y-2">
        <label className="text-[10px] text-muted-foreground font-mono font-semibold">Servidor</label>
        <Select value={selectedServerId} onValueChange={setSelectedServerId}>
          <SelectTrigger className="h-8 text-xs font-mono bg-secondary border-border">
            <SelectValue placeholder="Selecione o servidor" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border z-50">
            {servers.map(s => (
              <SelectItem key={s.id} value={s.id} className="text-xs font-mono">{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground font-mono">
          Monitorando <span className="text-foreground font-semibold">{enabledCount}</span> de {mergedChannels.length} canais
          <span className="text-muted-foreground/70"> ({selectedServerName})</span>
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

      {/* Channel list */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : mergedChannels.length === 0 ? (
        <p className="text-xs text-muted-foreground font-mono text-center py-8">
          Nenhum canal encontrado para este servidor.
        </p>
      ) : (
        <div className="overflow-y-auto max-h-[35vh] pr-1 -mr-1 space-y-1">
          {mergedChannels.map((channel) => (
            <label
              key={channel.id}
              className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors ${
                channel.enabled ? "bg-secondary/50 hover:bg-secondary" : "opacity-50 hover:opacity-70"
              }`}
            >
              <Checkbox
                checked={channel.enabled}
                onCheckedChange={() => toggleChannel(channel.id)}
              />
              <StatusIndicator status={channel.status as any} size="sm" />
              <span className="font-mono text-xs text-foreground flex-1 truncate">
                {channel.name}
              </span>
              <span className={`text-[10px] font-mono ${
                channel.status === "online" ? "text-online" :
                channel.status === "degraded" ? "text-degraded" : 
                channel.status === "offline" ? "text-offline" : "text-muted-foreground"
              }`}>
                {channel.status === "online" ? "ON" : channel.status === "degraded" ? "DEG" : channel.status === "offline" ? "OFF" : "?"}
              </span>
            </label>
          ))}
        </div>
      )}

      {/* Save button */}
      <Button onClick={handleSave} disabled={saving} className="w-full font-mono text-xs h-8">
        {saving ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Salvando...</> : "Salvar Seleção"}
      </Button>

      {/* Copy selection */}
      {servers.length > 1 && (
        <div className="border-t border-border pt-3 space-y-2">
          <p className="text-[10px] text-muted-foreground font-mono font-semibold">Copiar seleção de outro servidor</p>
          <div className="flex gap-2">
            <Select value={copySourceId} onValueChange={setCopySourceId}>
              <SelectTrigger className="h-8 text-xs font-mono bg-secondary border-border flex-1">
                <SelectValue placeholder="Servidor origem" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border z-50">
                {servers.filter(s => s.id !== selectedServerId).map(s => (
                  <SelectItem key={s.id} value={s.id} className="text-xs font-mono">{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={handleCopy} className="text-xs font-mono h-8 gap-1">
              <Copy className="h-3 w-3" /> Copiar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
