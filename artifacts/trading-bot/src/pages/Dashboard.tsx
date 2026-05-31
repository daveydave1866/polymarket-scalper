import { useState } from "react";
import {
  useGetBotStatus,
  useStartBot,
  useStopBot,
  useSyncMarkets,
  getGetBotStatusQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Play, Square, RefreshCw, Activity, Zap, TrendingUp,
  Clock, Radio, BarChart2, Loader2, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

function StatCard({
  label, value, sub, icon: Icon, accent,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; accent?: string;
}) {
  return (
    <div className={cn(
      "border border-border bg-card p-4 space-y-3 hover:border-primary/20 transition-colors"
    )}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
        <div className={cn("p-1.5 border", accent ?? "border-border/60 bg-muted/10 text-muted-foreground")}>
          <Icon className="w-3.5 h-3.5" />
        </div>
      </div>
      <div>
        <div className="font-mono text-2xl font-bold tabular-nums">{value}</div>
        {sub && <div className="font-mono text-[10px] text-muted-foreground/50 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function formatUptime(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatRelative(iso?: string): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export default function Dashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const { data: status, isLoading } = useGetBotStatus({ query: { refetchInterval: 3000 } });
  const startBot = useStartBot();
  const stopBot = useStopBot();
  const syncMarkets = useSyncMarkets();

  const handleStart = () => {
    startBot.mutate(undefined as never, {
      onSuccess: () => {
        toast({ title: "Bot started", description: "Market monitoring active." });
        queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
      },
      onError: () => toast({ variant: "destructive", title: "Error", description: "Failed to start bot." }),
    });
  };

  const handleStop = () => {
    stopBot.mutate(undefined as never, {
      onSuccess: () => {
        toast({ title: "Bot stopped" });
        queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
      },
      onError: () => toast({ variant: "destructive", title: "Error", description: "Failed to stop bot." }),
    });
  };

  const handleSync = async () => {
    setSyncing(true);
    syncMarkets.mutate(undefined as never, {
      onSuccess: (result) => {
        toast({ title: "Markets synced", description: `${result.synced} markets updated from Polymarket.` });
        setSyncing(false);
      },
      onError: () => {
        toast({ variant: "destructive", title: "Sync failed", description: "Could not reach Polymarket API." });
        setSyncing(false);
      },
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 font-mono text-muted-foreground text-xs">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading status…
      </div>
    );
  }

  const modeColor =
    status?.mode === "live"   ? "text-amber-400"
    : status?.mode === "paper" ? "text-sky-400"
    : "text-muted-foreground";

  return (
    <div className="space-y-6 animate-fade-up">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-mono tracking-tight">DASHBOARD</h1>
          <p className="font-mono text-xs text-muted-foreground/60 mt-1 uppercase tracking-wider">
            Bot status &amp; overview
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing}
            className="font-mono text-[10px] tracking-widest rounded-none h-8 border-border hover:border-primary/40"
            data-testid="button-sync-markets"
          >
            {syncing
              ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />SYNCING…</>
              : <><RefreshCw className="w-3 h-3 mr-1.5" />SYNC MARKETS</>
            }
          </Button>

          {status?.running ? (
            <Button
              size="sm"
              onClick={handleStop}
              disabled={stopBot.isPending}
              className="font-mono text-[10px] tracking-widest rounded-none h-8 bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
              data-testid="button-stop-bot"
            >
              {stopBot.isPending
                ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                : <Square className="w-3 h-3 mr-1.5" />
              }
              STOP BOT
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleStart}
              disabled={startBot.isPending}
              className="font-mono text-[10px] tracking-widest rounded-none h-8"
              data-testid="button-start-bot"
            >
              {startBot.isPending
                ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                : <Play className="w-3 h-3 mr-1.5" />
              }
              START BOT
            </Button>
          )}
        </div>
      </div>

      {/* Status banner */}
      <div className={cn(
        "border px-5 py-4 flex items-center gap-4",
        status?.running
          ? "border-primary/30 bg-primary/5"
          : "border-border bg-card"
      )}>
        <div className={cn(
          "w-2 h-2 rounded-full",
          status?.running ? "bg-primary shadow-[0_0_8px_hsl(142_76%_48%/0.8)] animate-pulse" : "bg-muted-foreground/30"
        )} />
        <div className="flex-1">
          <div className="font-mono text-xs font-bold uppercase tracking-wider">
            {status?.running ? "Bot is running" : "Bot is stopped"}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground/60 mt-0.5">
            Mode: <span className={cn("font-bold", modeColor)}>{(status?.mode ?? "—").toUpperCase()}</span>
            {status?.running && status?.uptime > 0 && (
              <> · Uptime: {formatUptime(status.uptime)}</>
            )}
          </div>
        </div>
        {!status?.running && (
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/50">
            <AlertTriangle className="w-3 h-3" /> Idle
          </div>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard
          label="Signals Generated"
          value={status?.signalsGenerated ?? 0}
          sub={`Last: ${formatRelative(status?.lastSignalAt)}`}
          icon={Zap}
          accent="border-primary/30 bg-primary/8 text-primary"
        />
        <StatCard
          label="Trades Executed"
          value={status?.tradesExecuted ?? 0}
          sub={`Last: ${formatRelative(status?.lastTradeAt)}`}
          icon={TrendingUp}
          accent="border-sky-400/30 bg-sky-400/8 text-sky-400"
        />
        <StatCard
          label="Active Feeds"
          value={status?.feedsActive ?? 0}
          sub={status?.running ? "sports · crypto · weather" : "Bot not running"}
          icon={Radio}
          accent="border-amber-400/30 bg-amber-400/8 text-amber-400"
        />
        <StatCard
          label="Markets Tracked"
          value={status?.marketsTracked ?? 0}
          sub="From Polymarket Gamma API"
          icon={BarChart2}
        />
        <StatCard
          label="Uptime"
          value={status?.running ? formatUptime(status.uptime) : "—"}
          sub={status?.running ? "Session uptime" : "Not running"}
          icon={Clock}
        />
        <StatCard
          label="Status"
          value={status?.running ? "ACTIVE" : "IDLE"}
          sub={`Mode: ${(status?.mode ?? "—").toUpperCase()}`}
          icon={Activity}
          accent={status?.running ? "border-primary/30 bg-primary/8 text-primary" : undefined}
        />
      </div>

      {/* Quick actions */}
      <div className="border border-border bg-card p-5">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-4">
          Quick Actions
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing}
            className="font-mono text-[10px] tracking-widest rounded-none h-9 border-border hover:border-primary/40 justify-start gap-2"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Sync markets from Polymarket
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled
            className="font-mono text-[10px] tracking-widest rounded-none h-9 border-border justify-start gap-2 opacity-40"
          >
            <BarChart2 className="w-3.5 h-3.5" /> View P&amp;L report
          </Button>
        </div>
      </div>
    </div>
  );
}
