import { Activity, Wifi, WifiOff, AlertTriangle, Clock } from "lucide-react";

export type ChannelStatus = "online" | "offline" | "degraded";

interface StatusIndicatorProps {
  status: ChannelStatus;
  size?: "sm" | "md" | "lg";
}

const statusConfig: Record<string, { color: string; glow: string; label: string; icon: typeof Wifi }> = {
  online: { color: "bg-online", glow: "glow-green", label: "Online", icon: Wifi },
  offline: { color: "bg-offline", glow: "glow-red", label: "Offline", icon: WifiOff },
  degraded: { color: "bg-destructive", glow: "glow-red", label: "Sem Conexão", icon: WifiOff },
  unknown: { color: "bg-muted-foreground", glow: "", label: "Desconhecido", icon: AlertTriangle },
};

const sizeMap = {
  sm: "h-2.5 w-2.5",
  md: "h-3.5 w-3.5",
  lg: "h-5 w-5",
};

export const StatusIndicator = ({ status, size = "md" }: { status: string; size?: "sm" | "md" | "lg" }) => {
  const config = statusConfig[status] || statusConfig.unknown;
  return (
    <span className={`inline-block rounded-full ${config.color} ${sizeMap[size]} pulse-dot ${config.glow}`} />
  );
};

export const StatusBadge = ({ status }: { status: string }) => {
  const config = statusConfig[status] || statusConfig.unknown;
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-mono font-medium ${
      status === "online" ? "bg-online/10 text-online" :
      "bg-offline/10 text-offline"
    }`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
};
