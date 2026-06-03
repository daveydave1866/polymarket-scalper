import { useQuery } from "@tanstack/react-query";
import { BarChart2, Loader2, TrendingUp, TrendingDown, Trophy, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { getStoredKey } from "@/lib/auth";

interface Position {
  id: string;
  marketId: string;
  question?: string;
  side: string;
  size: number;
  entryPrice: number;
  currentPrice?: number;
  closedPrice?: number | null;
  pnl?: number;
  realizedPnl?: number;
  status: string;
  orderId?: string | null;
  closeOrderId?: string | null;
  openedAt: string;
  closedAt?: string | null;
}

async function fetchPositions(): Promise<Position[]> {
  const key = getStoredKey();
  const res = await fetch("/api/positions", {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
  if (!res.ok) return [];
  return res.json();
}

function truncateOrderId(id?: string | null): string {
  if (!id) return "";
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

function holdTime(openedAt: string, closedAt?: string | null): string {
  const start = new Date(openedAt).getTime();
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  const ms = end - start;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

type StatusStyle = { badge: string; border: string; row: string };

function getStatusStyle(status: string): StatusStyle {
  switch (status) {
    case "pending":  return { badge: "border-yellow-500/40 text-yellow-400 bg-yellow-500/5", border: "border-yellow-500/20", row: "" };
    case "open":     return { badge: "border-primary/30 text-primary bg-primary/5", border: "border-primary/20", row: "" };
    case "closing":  return { badge: "border-orange-500/40 text-orange-400 bg-orange-500/5", border: "border-orange-500/20", row: "" };
    case "closed":   return { badge: "border-border text-muted-foreground bg-muted/5", border: "border-border", row: "" };
    case "cancelled":return { badge: "border-red-900/40 text-red-400/60 bg-red-900/5", border: "border-border", row: "opacity-50" };
    default:         return { badge: "border-border text-muted-foreground bg-muted/5", border: "border-border", row: "" };
  }
}

function StatusLabel({ status }: { status: string }) {
  const style = getStatusStyle(status);
  const labels: Record<string, string> = { pending: "PENDING", open: "OPEN", closing: "CLOSING", closed: "CLOSED", cancelled: "CANCELLED" };
  return (
    <span className={cn("font-mono text-[9px] border px-1.5 py-0.5 uppercase tracking-wider inline-block", style.badge)}>
      {labels[status] ?? status.toUpperCase()}
    </span>
  );
}

function PnlSummary({ trades }: { trades: Position[] }) {
  if (trades.length === 0) return null;

  const totalPnl   = trades.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const winners    = trades.filter((p) => (p.pnl ?? 0) > 0);
  const losers     = trades.filter((p) => (p.pnl ?? 0) < 0);
  const winRate    = Math.round((winners.length / trades.length) * 100);
  const bestTrade  = Math.max(...trades.map((p) => p.pnl ?? 0));
  const worstTrade = Math.min(...trades.map((p) => p.pnl ?? 0));
  const avgPnl     = totalPnl / trades.length;

  const stat = (label: string, value: string, color?: string) => (
    <div className="border border-border bg-card p-3 space-y-1">
      <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/50">{label}</div>
      <div className={cn("font-mono text-sm font-bold tabular-nums", color ?? "text-foreground")}>{value}</div>
    </div>
  );

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
      {stat("Total P&L", `${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)} USDC`, totalPnl >= 0 ? "text-primary" : "text-red-400")}
      {stat("Trades", `${trades.length}`, "text-foreground")}
      {stat("Win Rate", `${winRate}%`, winRate >= 50 ? "text-primary" : "text-red-400")}
      {stat("Avg P&L", `${avgPnl >= 0 ? "+" : ""}${avgPnl.toFixed(2)}`, avgPnl >= 0 ? "text-primary" : "text-red-400")}
      {stat("Best", `+${bestTrade.toFixed(2)}`, "text-primary")}
      {stat("Worst", `${worstTrade.toFixed(2)}`, worstTrade < 0 ? "text-red-400" : "text-primary")}
    </div>
  );
}

export default function Positions() {
  const { data: positions = [], isLoading } = useQuery({
    queryKey: ["positions"],
    queryFn: fetchPositions,
    refetchInterval: 5000,
  });

  const inFlight  = positions.filter((p) => p.status === "pending" || p.status === "closing");
  const open      = positions.filter((p) => p.status === "open");
  const closed    = positions.filter((p) => p.status === "closed").sort(
    (a, b) => new Date(b.closedAt ?? b.openedAt).getTime() - new Date(a.closedAt ?? a.openedAt).getTime()
  );
  const cancelled = positions.filter((p) => p.status === "cancelled");
  const totalPnl  = closed.reduce((sum, p) => sum + (p.pnl ?? 0), 0);
  const activeCount = open.length + inFlight.length;

  const statusSummary = [
    activeCount > 0   && `${activeCount} active`,
    inFlight.length > 0 && `${inFlight.length} in-flight`,
    closed.length > 0 && `${closed.length} closed`,
    cancelled.length > 0 && `${cancelled.length} cancelled`,
  ].filter(Boolean).join(" · ");

  const activeSections: Position[] = [
    ...positions.filter((p) => p.status === "pending"),
    ...positions.filter((p) => p.status === "open"),
    ...positions.filter((p) => p.status === "closing"),
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold font-mono tracking-tight">POSITIONS</h1>
          <p className="font-mono text-xs text-muted-foreground/60 mt-1 uppercase tracking-wider">
            {statusSummary || "No positions"}
          </p>
        </div>
        <div className="border border-border bg-card px-4 py-3 text-right">
          <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest">Realised P&amp;L</div>
          <div className={cn("font-mono text-lg font-bold tabular-nums", totalPnl >= 0 ? "text-primary" : "text-red-400")}>
            {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)} USDC
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 p-8 font-mono text-muted-foreground text-xs">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading positions…
        </div>
      ) : positions.length === 0 ? (
        <div className="border border-border bg-card p-10 text-center space-y-2">
          <BarChart2 className="w-8 h-8 text-muted-foreground/30 mx-auto" />
          <div className="font-mono text-xs font-bold uppercase tracking-wider">No positions yet</div>
          <div className="font-mono text-[10px] text-muted-foreground/50">Positions will appear here when the bot executes trades.</div>
        </div>
      ) : (
        <div className="space-y-8">

          {activeSections.length > 0 && (
            <div className="space-y-1">
              <div className="font-mono text-[10px] text-muted-foreground/40 uppercase tracking-widest pb-1 border-b border-border/40">
                ACTIVE ({activeSections.length})
              </div>
              <div className="space-y-2 pt-1">
                {activeSections.map((pos) => {
                  const style = getStatusStyle(pos.status);
                  const showOrderId = (pos.status === "pending" && pos.orderId) || (pos.status === "closing" && pos.closeOrderId);
                  const orderId = pos.status === "closing" ? pos.closeOrderId : pos.orderId;
                  return (
                    <div key={pos.id} className={cn("border bg-card p-4 grid grid-cols-6 gap-4 items-center", style.border, style.row)}>
                      <div className="col-span-2">
                        <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Market</div>
                        <div className="font-mono text-xs truncate" title={pos.question ?? pos.marketId}>{pos.question ?? pos.marketId}</div>
                      </div>
                      <div>
                        <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Side</div>
                        <div className={cn("font-mono text-xs font-bold uppercase", pos.side === "yes" ? "text-primary" : "text-red-400")}>{pos.side}</div>
                      </div>
                      <div>
                        <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Size / Entry</div>
                        <div className="font-mono text-xs tabular-nums">${pos.size} @ {(pos.entryPrice * 100).toFixed(1)}¢</div>
                      </div>
                      <div>
                        <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Unrealised P&amp;L</div>
                        <div className={cn("font-mono text-xs tabular-nums font-bold", (pos.pnl ?? 0) >= 0 ? "text-primary" : "text-red-400")}>
                          {(pos.pnl ?? 0) >= 0 ? "+" : ""}{(pos.pnl ?? 0).toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Status</div>
                        <StatusLabel status={pos.status} />
                        {showOrderId && orderId && (
                          <div className="font-mono text-[9px] text-muted-foreground/40 mt-1 truncate" title={orderId}>
                            {truncateOrderId(orderId)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {closed.length > 0 && (
            <div className="space-y-2">
              <div className="font-mono text-[10px] text-muted-foreground/40 uppercase tracking-widest pb-1 border-b border-border/40">
                COMPLETED TRADES ({closed.length})
              </div>
              <PnlSummary trades={closed} />
              <div className="space-y-1 pt-1">
                {closed.map((pos) => {
                  const pnl = pos.pnl ?? 0;
                  const isWin = pnl > 0;
                  return (
                    <div key={pos.id} className={cn(
                      "border bg-card p-4 grid gap-3 items-center",
                      "grid-cols-2 sm:grid-cols-4 lg:grid-cols-7",
                      isWin ? "border-primary/15" : "border-red-900/20"
                    )}>
                      <div className="col-span-2 lg:col-span-2">
                        <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Market</div>
                        <div className="font-mono text-xs truncate" title={pos.question ?? pos.marketId}>{pos.question ?? pos.marketId}</div>
                        <div className="font-mono text-[9px] text-muted-foreground/40 mt-0.5">{formatDate(pos.openedAt)}</div>
                      </div>
                      <div>
                        <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Side</div>
                        <div className={cn("font-mono text-xs font-bold uppercase", pos.side === "yes" ? "text-primary" : "text-red-400")}>{pos.side}</div>
                      </div>
                      <div>
                        <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Size</div>
                        <div className="font-mono text-xs tabular-nums">${pos.size.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Entry → Exit</div>
                        <div className="font-mono text-xs tabular-nums">
                          {(pos.entryPrice * 100).toFixed(1)}¢
                          {pos.closedPrice != null && (
                            <span className="text-muted-foreground/50"> → {(pos.closedPrice * 100).toFixed(1)}¢</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Hold</div>
                        <div className="font-mono text-xs tabular-nums flex items-center gap-1 text-muted-foreground/70">
                          <Clock className="w-2.5 h-2.5" />{holdTime(pos.openedAt, pos.closedAt)}
                        </div>
                      </div>
                      <div>
                        <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">P&amp;L</div>
                        <div className={cn("font-mono text-sm tabular-nums font-bold flex items-center gap-1", isWin ? "text-primary" : "text-red-400")}>
                          {isWin ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {cancelled.length > 0 && (
            <div className="space-y-1">
              <div className="font-mono text-[10px] text-muted-foreground/40 uppercase tracking-widest pb-1 border-b border-border/40">
                CANCELLED ({cancelled.length})
              </div>
              <div className="space-y-2 pt-1">
                {cancelled.map((pos) => {
                  const style = getStatusStyle(pos.status);
                  return (
                    <div key={pos.id} className={cn("border bg-card p-4 grid grid-cols-6 gap-4 items-center", style.border, style.row)}>
                      <div className="col-span-2">
                        <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Market</div>
                        <div className="font-mono text-xs truncate" title={pos.question ?? pos.marketId}>{pos.question ?? pos.marketId}</div>
                      </div>
                      <div>
                        <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Side</div>
                        <div className={cn("font-mono text-xs font-bold uppercase", pos.side === "yes" ? "text-primary" : "text-red-400")}>{pos.side}</div>
                      </div>
                      <div>
                        <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Size / Entry</div>
                        <div className="font-mono text-xs tabular-nums">${pos.size} @ {(pos.entryPrice * 100).toFixed(1)}¢</div>
                      </div>
                      <div>
                        <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Opened</div>
                        <div className="font-mono text-[10px] text-muted-foreground/50 tabular-nums">{formatDate(pos.openedAt)}</div>
                      </div>
                      <div>
                        <StatusLabel status={pos.status} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
