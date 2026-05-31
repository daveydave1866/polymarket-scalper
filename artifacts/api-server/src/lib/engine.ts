import { db, marketsTable, signalsTable, botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";
import { randomUUID } from "crypto";
import { resolvePolymarketCredentials } from "./credentials.js";

export { resolvePolymarketCredentials };

export let lastDiscoveryAt: Date | null = null;

const POLYMARKET_GAMMA_API = "https://gamma-api.polymarket.com";

interface GammaMarket {
  id: string;
  question: string;
  category?: string;
  slug?: string;
  conditionId?: string;
  endDate?: string;
  tokens?: Array<{ outcome: string; price: string }>;
  volume?: string;
  liquidity?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
}

async function fetchPolymarkets(): Promise<GammaMarket[]> {
  try {
    const url = `${POLYMARKET_GAMMA_API}/markets?active=true&closed=false&archived=false&limit=50&order=volume&ascending=false`;
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Gamma API returned non-200");
      return [];
    }
    const data = await res.json() as GammaMarket[];
    return Array.isArray(data) ? data : [];
  } catch (err) {
    logger.error({ err }, "Failed to fetch from Polymarket Gamma API");
    return [];
  }
}

function categorize(question: string): string {
  const q = question.toLowerCase();
  if (/\b(nba|nfl|mlb|nhl|soccer|football|basketball|baseball|hockey|sport|game|match|championship|league|cup|tournament|team|player|win|score)\b/.test(q)) return "sports";
  if (/\b(bitcoin|btc|eth|ethereum|crypto|token|defi|nft|blockchain|coin|market cap|price)\b/.test(q)) return "crypto";
  if (/\b(rain|temperature|weather|storm|hurricane|snow|flood|drought)\b/.test(q)) return "weather";
  if (/\b(election|president|congress|senate|vote|poll|candidate|democrat|republican|political|government|law|policy|regulation)\b/.test(q)) return "politics";
  return "other";
}

export async function runDiscovery(): Promise<{ synced: number; total: number; lastSyncAt: string }> {
  logger.info("Starting market discovery...");
  const markets = await fetchPolymarkets();

  if (markets.length === 0) {
    logger.warn("No markets fetched — using fallback seed data");
    return { synced: 0, total: 0, lastSyncAt: new Date().toISOString() };
  }

  let synced = 0;

  for (const m of markets.slice(0, 30)) {
    try {
      const yesToken = m.tokens?.find((t) => t.outcome.toLowerCase() === "yes");
      const noToken  = m.tokens?.find((t) => t.outcome.toLowerCase() === "no");
      const yesPrice = yesToken ? parseFloat(yesToken.price) : 0.5;
      const noPrice  = noToken  ? parseFloat(noToken.price)  : 1 - yesPrice;

      await db
        .insert(marketsTable)
        .values({
          id: m.id ?? randomUUID(),
          question: m.question,
          category: categorize(m.question),
          yesPrice: isNaN(yesPrice) ? 0.5 : yesPrice,
          noPrice:  isNaN(noPrice)  ? 0.5 : noPrice,
          volume:    parseFloat(m.volume    ?? "0") || 0,
          liquidity: parseFloat(m.liquidity ?? "0") || 0,
          endDate:   m.endDate   ?? null,
          conditionId: m.conditionId ?? null,
          slug: m.slug ?? null,
          isTracked: true,
        })
        .onConflictDoUpdate({
          target: marketsTable.id,
          set: {
            yesPrice: isNaN(yesPrice) ? 0.5 : yesPrice,
            noPrice:  isNaN(noPrice)  ? 0.5 : noPrice,
            volume:    parseFloat(m.volume    ?? "0") || 0,
            liquidity: parseFloat(m.liquidity ?? "0") || 0,
            lastSyncAt: new Date(),
          },
        });

      synced++;
    } catch (err) {
      logger.error({ err, marketId: m.id }, "Failed to upsert market");
    }
  }

  lastDiscoveryAt = new Date();
  logger.info({ synced, total: markets.length }, "Market discovery complete");

  // Generate signals for tracked markets
  await generateSignals();

  return { synced, total: markets.length, lastSyncAt: lastDiscoveryAt.toISOString() };
}

async function generateSignals() {
  const [config] = await db.select().from(botConfigTable).where(eq(botConfigTable.id, "singleton"));
  if (!config) return;

  const markets = await db.select().from(marketsTable).where(eq(marketsTable.isTracked, true));

  for (const market of markets) {
    const priceSkew = Math.abs(market.yesPrice - 0.5);
    if (priceSkew > 0.02 && market.liquidity > 1000) {
      const side = market.yesPrice > 0.5 ? "no" : "yes";
      const edge = priceSkew * 2;

      if (edge >= config.minEdge) {
        await db.insert(signalsTable).values({
          id: randomUUID(),
          marketId: market.id,
          side,
          confidence: Math.min(priceSkew * 4, 1),
          edge,
          source: "price_skew",
        });
      }
    }
  }
}
