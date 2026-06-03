import { useQuery } from "@tanstack/react-query";
import { BarChart2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Position {
  id: string;
  marketId: string;
  question?: string;
  side: string;
  size: number;
  entryPrice: number;
  currentPrice?: number;
  pnl?: number;
  status: string;
  orderId?: string | null;
  closeOrderId?: string | null;
  openedAt: string;
  closedAt?: string | null;
}

async function fetchPositions(): Promise<Position[]> {
  const res = await fetch("/api/positions");
  if (!res.ok) return [];
  return res.json();
}

function truncateOrderId(id?: string | null): string {
  if (!id) return "";
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

type StatusStyle = {
  badge: string;
  border: string;
  row: string;
};

function getStatusStyle(status: string): StatusStyle {
  switch (status) {
    case "pending":
      return {
        badge: "border-yellow-500/40 text-yellow-400 bg-yellow-500/5",
        border: "border-yellow-500/20",
        row: "",
      };
    case "open":
      return {
        badge: "border-primary/30 text-primary bg-primary/5",
        border: "border-primary/20",
        row: "",
      };
    case "closing":
      return {
        badge: "border-orange-500/40 text-orange-400 bg-orange-500/5",
        border: "border-orange-500/20",
        row: "",
      };
    case "closed":
      return {
        badge: "border-border text-muted-foreground bg-muted/5",
        border: "border-border",
        row: "",
      };
    case "cancelled":
      return {
        badge: "border-red-900/40 text-red-400/60 bg-red-900/5",
        border: "border-border",
        row: "opacity-50",
      };
    default:
      return {
        badge: "border-border text-muted-foreground bg-muted/5",
        border: "border-border",
        row: "",
      };
  }
}

function StatusLabel({ status }: { status: string }) {
  const style = getStatusStyle(status);
  const labels: Record<string, string> = {
    pending: "PENDING",
    open: "OPEN",
    closing: "CLOSING",
    closed: "CLOSED",
    cancelled: "CANCELLED",
  };
  return (
    <span
      className={cn(
        "font-mono text-[9px] border px-1.5 py-0.5 uppercase tracking-wider inline-block",
        style.badge
      )}
    >
      {labels[status] ?? status.toUpperCase()}
    </span>
  );
}

export default function Positions() {
  const { data: positions = [], isLoading } = useQuery({
    queryKey: ["positions"],
    queryFn: fetchPositions,
    refetchInterval: 5000,
  });

  const inFlight   = positions.filter((p) => p.status === "pending" || p.status === "closing");
  const open       = positions.filter((p) => p.status === "open");
  const closed     = positions.filter((p) => p.status === "closed");
  const cancelled  = positions.filter((p) => p.status === "cancelled");
  const totalPnl   = closed.reduce((sum, p) => sum + (p.pnl ?? 0), 0);

  const activeCount = open.length + inFlight.length;

  const statusSummary = [
    activeCount > 0 && `${activeCount} active`,
    inFlight.length > 0 && `${inFlight.length} in-flight`,
    closed.length > 0 && `${closed.length} closed`,
    cancelled.length > 0 && `${cancelled.length} cancelled`,
  ]
    .filter(Boolean)
    .join(" · ");

  const sections: { label: string; items: Position[] }[] = [
    { label: "ACTIVE", items: [...positions.filter((p) => p.status === "pending"), ...positions.filter((p) => p.status === "open"), ...positions.filter((p) => p.status === "closing")] },
    { label: "CLOSED", items: closed },
    { label: "CANCELLED", items: cancelled },
  ].filter((s) => s.items.length > 0);

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
        <div className="space-y-6">
          {sections.map(({ label, items }) => (
            <div key={label} className="space-y-1">
              <div className="font-mono text-[10px] text-muted-foreground/40 uppercase tracking-widest pb-1 border-b border-border/40">
                {label} ({items.length})
              </div>
              <div className="space-y-2 pt-1">
                {items.map((pos) => {
                  const style = getStatusStyle(pos.status);
                  const showOrderId =
                    (pos.status === "pending" && pos.orderId) ||
                    (pos.status === "closing" && pos.closeOrderId);
                  const orderId =
                    pos.status === "closing" ? pos.closeOrderId : pos.orderId;

                  return (
                    <div
                      key={pos.id}
                      className={cn(
                        "border bg-card p-4 grid grid-cols-6 gap-4 items-center",
                        style.border,
                        style.row
                      )}
                      data-testid={`row-position-${pos.id}`}
                    >
                      <div className="col-span-2">
                        <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Market</div>
                        <div className="font-mono text-xs truncate" title={pos.question ?? pos.marketId}>
                          {pos.question ?? pos.marketId}
                        </div>
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
                        <StatusLabel status={pos.status} />
                        {showOrderId && orderId && (
                          <div
                            className="font-mono text-[9px] text-muted-foreground/40 mt-1 truncate"
                            title={orderId}
                          >
                            {truncateOrderId(orderId)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
