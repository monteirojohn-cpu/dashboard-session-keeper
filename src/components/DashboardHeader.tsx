import { Activity, Radio, Settings, RefreshCw, Bell } from "lucide-react";
import { Button } from "./ui/button";

interface DashboardHeaderProps {
  totalChannels: number;
  onlineCount: number;
  offlineCount: number;
  isRefreshing: boolean;
  onRefresh: () => void;
  onOpenSettings: () => void;
}

export const DashboardHeader = ({
  totalChannels,
  onlineCount,
  offlineCount,
  isRefreshing,
  onRefresh,
  onOpenSettings,
}: DashboardHeaderProps) => {
  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
      <div className="container flex items-center justify-between py-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10 text-primary">
            <Radio className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold font-mono tracking-tight text-foreground">
              Signal Monitor
            </h1>
            <p className="text-xs text-muted-foreground">
              Monitoramento de canais em tempo real
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="hidden sm:flex items-center gap-4 text-xs font-mono">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-online pulse-dot" />
              <span className="text-muted-foreground">{onlineCount} online</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-offline pulse-dot" />
              <span className="text-muted-foreground">{offlineCount} offline</span>
            </span>
            <span className="text-muted-foreground">
              {totalChannels} total
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="h-8 w-8"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={onOpenSettings}
              className="h-8 w-8"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
};
