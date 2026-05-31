import { useQuery } from "@tanstack/react-query";
import { Zap, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Signal {
  id: string;
  marketId: string;
  side: string;
  confidence: number;
  edge: number;
  source: string;
  createdAt: string;
}

async function fetchSignals(): Promise<Signal[]> {
  const res = await fetch("/api/signals");
  if (!res.ok) return [];
  return res.json();
}

export default function Signals() {
  const { data: signals = [], isLoading } = useQuery({
    queryKey: ["signals"],
    queryFn: fetchSignals,
    refetchInterval: 5000,
  });

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <h1 className="text-3xl font-bold font-mono tracking-tight">SIGNALS</h1>
        <p className="font-mono text-xs text-muted-foreground/60 mt-1 uppercase tracking-wider">
          {signals.length} signals generated
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 p-8 font-mono text-muted-foreground text-xs">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading signals…
        </div>
      ) : signals.length === 0 ? (
        <div className="border border-border bg-card p-10 text-center space-y-2">
          <Zap className="w-8 h-8 text-muted-foreground/30 mx-auto" />
          <div className="font-mono text-xs font-bold uppercase tracking-wider">No signals yet</div>
          <div className="font-mono text-[10px] text-muted-foreground/50">
            Signals are generated when the bot detects market edge after a sync.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {signals.map((sig) => (
            <div
              key={sig.id}
              className="border border-border bg-card p-4 grid grid-cols-5 gap-4 items-center"
              data-testid={`row-signal-${sig.id}`}
            >
              <div className="col-span-2">
                <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Market</div>
                <div className="font-mono text-xs truncate">{sig.marketId}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Side</div>
                <div className={cn(
                  "font-mono text-xs font-bold uppercase",
                  sig.side === "yes" ? "text-primary" : "text-red-400"
                )}>
                  {sig.side}
                </div>
              </div>
              <div>
                <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Edge</div>
                <div className="font-mono text-xs tabular-nums text-amber-400">
                  {(sig.edge * 100).toFixed(1)}%
                </div>
              </div>
              <div>
                <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Source</div>
                <div className="font-mono text-[10px] text-muted-foreground">{sig.source}</div>
                <div className="font-mono text-[9px] text-muted-foreground/40">
                  {new Date(sig.createdAt).toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
