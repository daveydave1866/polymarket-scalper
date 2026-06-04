import { db, botConfigTable, marketsTable, oddsHistoryTable, feedEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { pollCryptoFeed } from "./feeds/crypto";
import { pollSportsFeed } from "./feeds/sports";
import { pollWeatherFeed } from "./feeds/weather";
import { pollScannerFeed } from "./feeds/scanner";
import { pollNewsFeed } from "./feeds/news";
import { pollArbitrageFeed } from "./feeds/arbitrage";
import { pollManifoldFeed } from "./feeds/manifold";
import { detectSignals, updateMarketOdds } from "./signal-detector";
import { executeSignals, updateOpenPositions, expireOldSignals } from "./position-manager";
import { discoverAllMarkets, refreshMarketPrices } from "./market-discovery";
import type { EngineConfig, FeedResult } from "./types";
import { logger } from "../logger";
import { nanoid } from "nanoid";
import { sendDailyReport, sendMessage, setupTelegram } from "../telegram";

const TICK_INTERVAL_MS = 15_000;           // main engine tick: 15 s
const DISCOVERY_INTERVAL_MS = 4 * 3600_000; // full market sweep: 4 h
const PRICE_REFRESH_INTERVAL_MS = 15 * 60_000; // price-only refresh: 15 min
const DAILY_REPORT_INTERVAL_MS = 24 * 3600_000;

// ── Active feed toggles ─────────────────────────────────────────────────────
// Set to true to enable, false to disable. Arbitrage is always on.
const FEED_ENABLED = {
  arbitrage: true,   // threshold & time arbitrage — pure mispricing
  scanner:   false,  // momentum across all markets
  manifold:  false,  // cross-platform Manifold divergence
  news:      false,  // RSS headline sentiment
  crypto:    false,  // Binance/CoinGecko implied probability
  sports:    false,  // in-play NBA/UFC live scores
  weather:   false,  // OpenWeatherMap weather markets
} as const;

const ALL_CATEGORIES = "sports,crypto,weather,politics,science,tech,entertainment,other";

let tickTimer: ReturnType<typeof setInterval> | null = null;
let discoveryTimer: ReturnType<typeof setInterval> | null = null;
let priceRefreshTimer: ReturnType<typeof setInterval> | null = null;
let dailyReportTimer: ReturnType<typeof setInterval> | null = null;
let engineRunning = false;
let lastDiscoveryAt: Date | null = null;
let lastTickAt: Date | null = null;

async function getConfig(): Promise<EngineConfig | null> {
  const [config] = await db
    .select()
    .from(botConfigTable)
    .where(eq(botConfigTable.id, "singleton"));

  if (!config || !config.running) return null;

  return {
    mode: (config.mode ?? "paper") as "live" | "paper",
    minEdge: config.minEdge,
    maxPositionSize: config.maxPositionSize,
    maxOpenPositions: config.maxOpenPositions,
    signalWindowSeconds: config.signalWindowSeconds,
    enabledCategories: config.enabledCategories.split(","),
    polymarketPrivateKey: process.env["POLYMARKET_PRIVATE_KEY"] ?? config.polymarketPrivateKey,
    polymarketApiKey: process.env["POLYMARKET_API_KEY"] ?? config.polymarketApiKey,
    polymarketApiSecret: process.env["POLYMARKET_API_SECRET"] ?? config.polymarketApiSecret,
    polymarketApiPassphrase: process.env["POLYMARKET_API_PASSPHRASE"] ?? config.polymarketApiPassphrase,
    sportsApiKey: process.env["SPORTS_API_KEY"] ?? config.sportsApiKey,
    weatherApiKey: process.env["WEATHER_API_KEY"] ?? config.weatherApiKey,
  };
}

async function processFeed(feed: FeedResult, config: EngineConfig): Promise<void> {
  for (const event of feed.events) {
    const eventId = `evt-${nanoid(10)}`;

    await db.insert(feedEventsTable).values({
      id: eventId,
      feedId: feed.feedId,
      feedName: feed.feedName,
      category: feed.category === "scanner" ? "other" : feed.category,
      summary: event.summary,
      data: event.data,
      triggeredSignal: false,
      timestamp: new Date(),
    });

    const signalIds = await detectSignals(event, feed.feedId, config);

    if (signalIds.length > 0) {
      await db
        .update(feedEventsTable)
        .set({ triggeredSignal: true, signalId: signalIds[0] })
        .where(eq(feedEventsTable.id, eventId));

      await executeSignals(signalIds, config);
    }

    for (const hint of event.fairValueHints) {
      const [market] = await db
        .select()
        .from(marketsTable)
        .where(eq(marketsTable.id, hint.marketId));

      if (!market) continue;

      const drift = 0.005;
      let newYes = market.yesPrice;
      let newNo = market.noPrice;

      if (hint.direction === "YES") {
        newYes = parseFloat((market.yesPrice + (hint.fairValue - market.yesPrice) * drift).toFixed(4));
        newNo = parseFloat((1 - newYes).toFixed(4));
      } else {
        newNo = parseFloat((market.noPrice + ((1 - hint.fairValue) - market.noPrice) * drift).toFixed(4));
        newYes = parseFloat((1 - newNo).toFixed(4));
      }

      await updateMarketOdds(hint.marketId, newYes, newNo);

      await db.insert(oddsHistoryTable).values({
        marketId: hint.marketId,
        yesPrice: newYes,
        noPrice: newNo,
        volume: market.volume + Math.floor(Math.random() * 500),
        timestamp: new Date(),
      });
    }
  }
}

async function tick(): Promise<void> {
  const config = await getConfig();
  if (!config) return;

  lastTickAt = new Date();

  try {
    const enabled = config.enabledCategories;

    const empty = (feedId: string, feedName: string, category: string): FeedResult =>
      ({ feedId, feedName, category, events: [] });

    const [cryptoFeed, sportsFeed, weatherFeed, scannerFeed, newsFeed, arbitrageFeed, manifoldFeed] = await Promise.all([
      FEED_ENABLED.crypto && enabled.includes("crypto")
        ? pollCryptoFeed(config.polymarketApiKey)
        : Promise.resolve(empty("feed-crypto", "Crypto Price Feed", "crypto")),
      FEED_ENABLED.sports && enabled.includes("sports")
        ? pollSportsFeed(config.sportsApiKey)
        : Promise.resolve(empty("feed-sports", "Sports Live Feed", "sports")),
      FEED_ENABLED.weather && enabled.includes("weather")
        ? pollWeatherFeed(config.weatherApiKey)
        : Promise.resolve(empty("feed-weather", "Weather API Feed", "weather")),
      FEED_ENABLED.scanner
        ? pollScannerFeed()
        : Promise.resolve(empty("feed-scanner", "Market Scanner", "other")),
      FEED_ENABLED.news
        ? pollNewsFeed()
        : Promise.resolve(empty("feed-news", "News Sentiment", "other")),
      FEED_ENABLED.arbitrage
        ? pollArbitrageFeed()
        : Promise.resolve(empty("feed-arbitrage", "Arbitrage", "other")),
      FEED_ENABLED.manifold
        ? pollManifoldFeed()
        : Promise.resolve(empty("feed-manifold", "Manifold Comparison", "other")),
    ]);

    await processFeed(cryptoFeed, config);
    await processFeed(sportsFeed, config);
    await processFeed(weatherFeed, config);
    await processFeed(scannerFeed, config);
    await processFeed(newsFeed, config);
    await processFeed(arbitrageFeed, config);
    await processFeed(manifoldFeed, config);

    await updateOpenPositions();
    await expireOldSignals(config.signalWindowSeconds);

    const totalEvents =
      cryptoFeed.events.length +
      sportsFeed.events.length +
      weatherFeed.events.length +
      scannerFeed.events.length +
      newsFeed.events.length +
      arbitrageFeed.events.length +
      manifoldFeed.events.length;

    if (totalEvents > 0) {
      logger.debug({ totalEvents }, "Engine tick processed events");
    }
  } catch (err) {
    logger.error({ err }, "Engine tick error");
  }
}

async function runDiscovery(): Promise<{ discovered: number; updated: number; categories: Record<string, number> } | undefined> {
  try {
    const result = await discoverAllMarkets();
    lastDiscoveryAt = new Date();
    logger.info(result, "Full market discovery complete");
    return result;
  } catch (err) {
    logger.error({ err }, "Market discovery failed");
    return undefined;
  }
}

async function runPriceRefresh(): Promise<void> {
  try {
    const result = await refreshMarketPrices();
    logger.debug(result, "Market price refresh complete");
  } catch (err) {
    logger.warn({ err }, "Market price refresh failed");
  }
}

function scheduleDailyReport(): void {
  const now = new Date();
  const next = new Date();
  next.setUTCHours(8, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const msUntilFirst = next.getTime() - now.getTime();

  setTimeout(() => {
    sendDailyReport().catch((err) => logger.error({ err }, "Daily report failed"));
    dailyReportTimer = setInterval(() => {
      sendDailyReport().catch((err) => logger.error({ err }, "Daily report failed"));
    }, DAILY_REPORT_INTERVAL_MS);
  }, msUntilFirst);

  logger.info({ nextReportAt: next.toISOString() }, "Daily Telegram report scheduled");
}

/** Seed one price-history entry per tracked market so the scanner has a
 *  baseline on the very first tick instead of waiting LOOKBACK_MINUTES. */
async function seedInitialHistory(): Promise<void> {
  try {
    const markets = await db.select().from(marketsTable);
    const now = new Date();
    // Write a slightly-older baseline entry so tick-1 can already compare
    const baseline = new Date(now.getTime() - 2 * 60 * 1000); // 2 min ago
    let seeded = 0;
    for (const market of markets) {
      // Only seed if there is no history yet for this market
      const existing = await db
        .select()
        .from(oddsHistoryTable)
        .where(eq(oddsHistoryTable.marketId, market.id))
        .limit(1);
      if (existing.length > 0) continue;
      await db.insert(oddsHistoryTable).values({
        marketId: market.id,
        yesPrice: market.yesPrice,
        noPrice: market.noPrice,
        volume: market.volume,
        timestamp: baseline,
      });
      seeded++;
    }
    if (seeded > 0) logger.info({ seeded }, "Seeded initial price history for scanner warm-up");
  } catch (err) {
    logger.warn({ err }, "Failed to seed initial price history");
  }
}

export function startEngine(): void {
  if (tickTimer) return;
  engineRunning = true;

  // Verify / auto-detect Telegram chat ID before first message
  setupTelegram().catch((err) => logger.warn({ err }, "Telegram setup failed"));

  // Upgrade DB config to full-scale settings on startup
  db.update(botConfigTable)
    .set({
      enabledCategories: ALL_CATEGORIES,
      maxOpenPositions: 25,
    })
    .where(eq(botConfigTable.id, "singleton"))
    .catch((err) => logger.warn({ err }, "Config upgrade failed"));

  // Prime the scanner with baseline history so it fires on tick 1
  seedInitialHistory().catch((err) => logger.warn({ err }, "History seed failed"));

  tickTimer = setInterval(tick, TICK_INTERVAL_MS);
  tick();

  // Full discovery immediately, then every 4 h
  runDiscovery();
  discoveryTimer = setInterval(runDiscovery, DISCOVERY_INTERVAL_MS);

  // Lightweight price refresh every 15 min
  priceRefreshTimer = setInterval(runPriceRefresh, PRICE_REFRESH_INTERVAL_MS);

  scheduleDailyReport();

  sendMessage(
    "⚡ <b>SCALPER_BOT started</b>\nFull-market mode — scanning ALL Polymarket categories\nDaily P&amp;L report at 08:00 UTC."
  ).catch(() => {});

  logger.info({ intervalMs: TICK_INTERVAL_MS }, "Bot engine started (full-market mode)");
}

export function stopEngine(): void {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  if (discoveryTimer) { clearInterval(discoveryTimer); discoveryTimer = null; }
  if (priceRefreshTimer) { clearInterval(priceRefreshTimer); priceRefreshTimer = null; }
  if (dailyReportTimer) { clearInterval(dailyReportTimer); dailyReportTimer = null; }
  engineRunning = false;
  sendMessage("🛑 <b>SCALPER_BOT stopped</b>").catch(() => {});
  logger.info("Bot engine stopped");
}

export function isEngineRunning(): boolean {
  return engineRunning;
}

export { runDiscovery, lastDiscoveryAt, lastTickAt };
