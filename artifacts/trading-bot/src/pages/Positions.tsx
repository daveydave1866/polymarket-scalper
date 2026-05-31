import { useQuery } from "@tanstack/react-query";
import { BarChart2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Position {
  id: string;
  marketId: string;
  side: string;
  size: number;
  entryPrice: number;
  currentPrice?: number;
  pnl?: number;
  status: string;
  openedAt: string;
  closedAt?: string;
}

async function fetchPositions(): Promise<Position[]> {
  const res = await fetch("/api/positions");
  if (!res.ok) return [];
  return res.json();
}

export default function Positions() {
  const { data: positions = [], isLoading } = useQuery({
    queryKey: ["positions"],
    queryFn: fetchPositions,
    refetchInterval: 10000,
  });

  const open   = positions.filter((p) => p.status === "open");
  const closed = positions.filter((p) => p.status === "closed");
  const totalPnl = closed.reduce((sum, p) => sum + (p.pnl ?? 0), 0);

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold font-mono tracking-tight">POSITIONS</h1>
          <p className="font-mono text-xs text-muted-foreground/60 mt-1 uppercase tracking-wider">
            {open.length} open · {closed.length} closed
          </p>
        </div>
        <div className="border border-border bg-card px-4 py-3 text-right">
          <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest">Total P&amp;L</div>
          <div className={cn(
            "font-mono text-lg font-bold tabular-nums",
            totalPnl >= 0 ? "text-primary" : "text-red-400"
          )}>
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
          <div className="font-mono text-[10px] text-muted-foreground/50">
            Positions will appear here when the bot executes trades.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {positions.map((pos) => (
            <div
              key={pos.id}
              className={cn(
                "border bg-card p-4 grid grid-cols-6 gap-4 items-center",
                pos.status === "open" ? "border-primary/20" : "border-border"
              )}
              data-testid={`row-position-${pos.id}`}
            >
              <div className="col-span-2">
                <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Market</div>
                <div className="font-mono text-xs truncate">{pos.marketId}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Side</div>
                <div className={cn("font-mono text-xs font-bold uppercase", pos.side === "yes" ? "text-primary" : "text-red-400")}>
                  {pos.side}
                </div>
              </div>
              <div>
                <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Size / Entry</div>
                <div className="font-mono text-xs tabular-nums">${pos.size} @ {(pos.entryPrice * 100).toFixed(1)}¢</div>
              </div>
              <div>
                <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">P&amp;L</div>
                <div className={cn("font-mono text-xs tabular-nums font-bold", (pos.pnl ?? 0) >= 0 ? "text-primary" : "text-red-400")}>
                  {(pos.pnl ?? 0) >= 0 ? "+" : ""}{(pos.pnl ?? 0).toFixed(2)}
                </div>
              </div>
              <div>
                <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Status</div>
                <div className={cn(
                  "font-mono text-[9px] border px-1.5 py-0.5 uppercase tracking-wider inline-block",
                  pos.status === "open"
                    ? "border-primary/30 text-primary bg-primary/5"
                    : "border-border text-muted-foreground bg-muted/5"
                )}>
                  {pos.status}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
