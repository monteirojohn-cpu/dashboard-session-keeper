import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ConnectionTabProps {
  dashboardUrl: string;
  setDashboardUrl: (v: string) => void;
  dashboardUser: string;
  setDashboardUser: (v: string) => void;
  dashboardPass: string;
  setDashboardPass: (v: string) => void;
  autoRefreshInterval: string;
  setAutoRefreshInterval: (v: string) => void;
  sessionRenewalInterval: string;
  setSessionRenewalInterval: (v: string) => void;
}

export const ConnectionTab = ({
  dashboardUrl, setDashboardUrl,
  dashboardUser, setDashboardUser,
  dashboardPass, setDashboardPass,
  autoRefreshInterval, setAutoRefreshInterval,
  sessionRenewalInterval, setSessionRenewalInterval,
}: ConnectionTabProps) => {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground font-mono">URL do Dashboard</Label>
        <Input
          value={dashboardUrl}
          onChange={(e) => setDashboardUrl(e.target.value)}
          placeholder="http://157.254.55.203:8089"
          className="font-mono text-sm bg-secondary border-border"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground font-mono">Usuário</Label>
        <Input
          value={dashboardUser}
          onChange={(e) => setDashboardUser(e.target.value)}
          placeholder="admin"
          className="font-mono text-sm bg-secondary border-border"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground font-mono">Senha</Label>
        <Input
          type="password"
          value={dashboardPass}
          onChange={(e) => setDashboardPass(e.target.value)}
          placeholder="••••••••"
          className="font-mono text-sm bg-secondary border-border"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground font-mono">Intervalo de refresh (segundos)</Label>
        <Input
          type="number"
          value={autoRefreshInterval}
          onChange={(e) => setAutoRefreshInterval(e.target.value)}
          min="10"
          max="300"
          className="font-mono text-sm bg-secondary border-border"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground font-mono">Renovação de sessão (minutos)</Label>
        <Input
          type="number"
          value={sessionRenewalInterval}
          onChange={(e) => setSessionRenewalInterval(e.target.value)}
          min="1"
          max="60"
          className="font-mono text-sm bg-secondary border-border"
        />
        <p className="text-[10px] text-muted-foreground font-mono">
          A cada X minutos o sistema refaz o login automaticamente para manter a sessão ativa
        </p>
      </div>
    </div>
  );
};
