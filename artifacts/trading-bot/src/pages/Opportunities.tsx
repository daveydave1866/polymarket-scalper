import { useState } from "react";
import { useGetOpportunities, useSyncMarkets } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, ExternalLink, TrendingUp, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OpportunityType } from "@workspace/api-zod";

const CATEGORY_COLORS: Record<string, string> = {
  sports:   "text-sky-400 border-sky-400/30 bg-sky-400/5",
  crypto:   "text-amber-400 border-amber-400/30 bg-amber-400/5",
  weather:  "text-blue-400 border-blue-400/30 bg-blue-400/5",
  politics: "text-purple-400 border-purple-400/30 bg-purple-400/5",
  other:    "text-muted-foreground border-border bg-muted/5",
};

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-muted/30 overflow-hidden">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${Math.min(pct * 1.5, 100)}%` }}
        />
      </div>
      <span className="font-mono text-[10px] tabular-nums w-8 text-right">{score.toFixed(2)}</span>
    </div>
  );
}

function OpportunityRow({ opp, rank }: { opp: OpportunityType; rank: number }) {
  const catColor = CATEGORY_COLORS[opp.category] ?? CATEGORY_COLORS.other;
  const yesPct = (opp.yesPrice * 100).toFixed(1);
  const noPct  = (opp.noPrice  * 100).toFixed(1);

  return (
    <div
      className="border border-border bg-card hover:border-primary/20 transition-colors p-4 space-y-3"
      data-testid={`card-opportunity-${opp.marketId}`}
    >
      <div className="flex items-start gap-3">
        <span className="font-mono text-[10px] text-muted-foreground/30 tabular-nums pt-0.5 w-5 text-right">
          {rank}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-xs text-foreground/90 leading-snug line-clamp-2">
            {opp.question}
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className={cn("font-mono text-[9px] border px-1.5 py-0.5 uppercase tracking-wider", catColor)}>
              {opp.category}
            </span>
            {opp.polymarketUrl && (
              <a
                href={opp.polymarketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[9px] text-muted-foreground/40 hover:text-primary flex items-center gap-0.5"
              >
                polymarket <ExternalLink className="w-2.5 h-2.5" />
              </a>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 space-y-1 text-right">
          <div className="font-mono text-[10px] tabular-nums">
            <span className="text-primary">{yesPct}¢</span>
            <span className="text-muted-foreground/40 mx-1">/</span>
            <span className="text-red-400">{noPct}¢</span>
          </div>
          <div className="font-mono text-[9px] text-muted-foreground/40">yes / no</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 ml-8">
        <div>
          <div className="font-mono text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Score</div>
          <ScoreBar score={opp.opportunityScore} />
        </div>
        <div>
          <div className="font-mono text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Volume</div>
          <div className="font-mono text-[10px] tabular-nums">
            ${opp.volume >= 1000 ? `${(opp.volume / 1000).toFixed(1)}k` : opp.volume.toFixed(0)}
          </div>
        </div>
        <div>
          <div className="font-mono text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Liquidity</div>
          <div className="font-mono text-[10px] tabular-nums">
            ${opp.liquidity >= 1000 ? `${(opp.liquidity / 1000).toFixed(1)}k` : opp.liquidity.toFixed(0)}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Opportunities() {
  const { toast } = useToast();
  const [filter, setFilter] = useState("");
  const [syncing, setSyncing] = useState(false);

  const { data, isLoading, refetch } = useGetOpportunities({ query: { refetchInterval: 60000 } });
  const syncMarkets = useSyncMarkets();

  const handleSync = () => {
    setSyncing(true);
    syncMarkets.mutate(undefined as never, {
      onSuccess: (result) => {
        toast({ title: "Markets synced", description: `${result.synced} markets updated.` });
        refetch();
        setSyncing(false);
      },
      onError: () => {
        toast({ variant: "destructive", title: "Sync failed", description: "Could not reach Polymarket API." });
        setSyncing(false);
      },
    });
  };

  const opportunities = data?.opportunities ?? [];
  const filtered = filter
    ? opportunities.filter((o) =>
        o.question.toLowerCase().includes(filter.toLowerCase()) ||
        o.category.toLowerCase().includes(filter.toLowerCase())
      )
    : opportunities;

  return (
    <div className="space-y-6 animate-fade-up">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-mono tracking-tight">OPPORTUNITIES</h1>
          <p className="font-mono text-xs text-muted-foreground/60 mt-1 uppercase tracking-wider">
            {data?.totalTracked ?? 0} markets tracked
            {data?.lastSyncAt && ` · synced ${new Date(data.lastSyncAt).toLocaleTimeString()}`}
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={syncing}
          className="font-mono text-[10px] tracking-widest rounded-none h-8 border-border hover:border-primary/40"
          data-testid="button-sync-opportunities"
        >
          {syncing
            ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />SYNCING…</>
            : <><RefreshCw className="w-3 h-3 mr-1.5" />SYNC NOW</>
          }
        </Button>
      </div>

      {/* Empty state — prompt to sync */}
      {!isLoading && opportunities.length === 0 && (
        <div className="border border-border bg-card p-10 text-center space-y-4">
          <TrendingUp className="w-8 h-8 text-muted-foreground/30 mx-auto" />
          <div>
            <div className="font-mono text-xs font-bold uppercase tracking-wider">No markets yet</div>
            <div className="font-mono text-[10px] text-muted-foreground/50 mt-1">
              Click "Sync Now" to fetch live markets from Polymarket.
            </div>
          </div>
          <Button
            size="sm"
            onClick={handleSync}
            disabled={syncing}
            className="font-mono text-[10px] tracking-widest rounded-none"
            data-testid="button-sync-empty"
          >
            {syncing ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1.5" />}
            FETCH MARKETS
          </Button>
        </div>
      )}

      {/* Filter */}
      {opportunities.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
          <input
            type="text"
            placeholder="Filter by question or category…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full h-9 bg-card border border-border pl-9 pr-4 font-mono text-xs placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40"
            data-testid="input-filter"
          />
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="flex items-center gap-2 p-8 font-mono text-muted-foreground text-xs">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading opportunities…
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((opp, idx) => (
            <OpportunityRow key={opp.marketId} opp={opp} rank={idx + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
