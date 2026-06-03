import { db, marketsTable, signalsTable, botConfigTable, positionsTable, balanceSnapshotsTable } from "@workspace/db";
import { eq, gte, desc, and, inArray, notInArray, ne } from "drizzle-orm";
import { logger } from "./logger.js";
import { randomUUID } from "crypto";
import { resolvePolymarketCredentials } from "./credentials.js";
import { ethers } from "ethers";
import { notifyTrade, notifySignalDigest, notifyError, sendDailyReport } from "./telegram.js";
import { generateWeatherSignals } from "./weather-signals.js";

export { resolvePolymarketCredentials };

const POLYMARKET_GAMMA_API = "https://gamma-api.polymarket.com";
const CLOB_HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;

const TAKE_PROFIT_RATIO = 0.06;
const STOP_LOSS_RATIO = 0.04;
const MAX_POSITION_AGE_MS = 24 * 60 * 60 * 1000;
const STALE_ORDER_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export const CYCLE_INTERVAL_MS = 5 * 60 * 1000;

const tradingLoopTimers = new Map<string, ReturnType<typeof setInterval>>();
const lastCycleTimes = new Map<string, Date>();
const lastDiscoveryTimes = new Map<string, Date>();
const lastDailyReportDates = new Map<string, string>();

export function getLastDiscoveryAt(userId: string): Date | null {
  return lastDiscoveryTimes.get(userId) ?? null;
}
export function getLastCycleAt(userId: string): Date | null {
  return lastCycleTimes.get(userId) ?? null;
}
export function isTradingLoopRunning(userId: string): boolean {
  return tradingLoopTimers.has(userId);
}

interface GammaMarket {
  id: string;
  question: string;
  category?: string;
  slug?: string;
  conditionId?: string;
  endDate?: string;
  tokens?: Array<{ outcome: string; price: string }>;
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
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

export async function runDiscovery(userId: string): Promise<{ synced: number; total: number; lastSyncAt: string }> {
  logger.info({ userId }, "Starting market discovery...");
  const markets = await fetchPolymarkets();

  if (markets.length === 0) {
    logger.warn("No markets fetched — using fallback seed data");
    return { synced: 0, total: 0, lastSyncAt: new Date().toISOString() };
  }

  let synced = 0;

  for (const m of markets) {
    if (!m.id || !m.question) continue;

    const yesToken = m.tokens?.find((t) => t.outcome.toLowerCase() === "yes");
    const noToken = m.tokens?.find((t) => t.outcome.toLowerCase() === "no");

    let yesPrice = yesToken ? parseFloat(yesToken.price) : 0.5;
    let noPrice = noToken ? parseFloat(noToken.price) : 0.5;

    if (m.outcomePrices) {
      try {
        const prices = JSON.parse(m.outcomePrices) as string[];
        if (prices.length >= 2) {
          yesPrice = parseFloat(prices[0]);
          noPrice = parseFloat(prices[1]);
        }
      } catch { /* use token prices */ }
    }

    const volume = parseFloat(m.volume ?? "0") || 0;
    const liquidity = parseFloat(m.liquidity ?? "0") || 0;
    const category = categorize(m.question);

    try {
      await db
        .insert(marketsTable)
        .values({
          id: m.id,
          question: m.question,
          category,
          yesPrice: isNaN(yesPrice) ? 0.5 : yesPrice,
          noPrice: isNaN(noPrice) ? 0.5 : noPrice,
          volume,
          liquidity,
          endDate: m.endDate,
          conditionId: m.conditionId,
          slug: m.slug,
          outcomes: m.outcomes,
          clobTokenIds: m.clobTokenIds,
          isTracked: true,
          lastSyncAt: new Date(),
        })
        .onConflictDoUpdate({
          target: marketsTable.id,
          set: {
            question: m.question,
            category,
            yesPrice: isNaN(yesPrice) ? 0.5 : yesPrice,
            noPrice: isNaN(noPrice) ? 0.5 : noPrice,
            volume,
            liquidity,
            endDate: m.endDate,
            conditionId: m.conditionId,
            slug: m.slug,
            outcomes: m.outcomes,
            clobTokenIds: m.clobTokenIds,
            isTracked: true,
            lastSyncAt: new Date(),
          },
        });
      synced++;
    } catch (err) {
      logger.error({ err, marketId: m.id }, "Failed to upsert market");
    }
  }

  const now = new Date();
  lastDiscoveryTimes.set(userId, now);
  logger.info({ synced, total: markets.length }, "Market discovery complete");

  const [cfg] = await db.select().from(botConfigTable).where(eq(botConfigTable.id, userId));
  const minEdge = cfg?.minEdge ?? 0.05;

  await generateSignals(userId);
  const weatherSignals = await generateWeatherSignals(minEdge, userId);
  if (weatherSignals > 0) {
    logger.info({ weatherSignals }, "NWS weather signals generated");
  }

  return { synced, total: markets.length, lastSyncAt: now.toISOString() };
}

async function generateSignals(userId: string) {
  const [config] = await db.select().from(botConfigTable).where(eq(botConfigTable.id, userId));
  if (!config) return;

  const priceMin = config.priceMin ?? 0.05;
  const priceMax = config.priceMax ?? 0.95;
  const minTtrHours = config.minTtrHours ?? 24;

  const markets = await db.select().from(marketsTable).where(
    and(eq(marketsTable.isTracked, true), ne(marketsTable.category, "weather"))
  );

  const pendingNotifications: Array<{ id: string; question: string; side: string; edge: number; confidence: number }> = [];

  for (const market of markets) {
    if (
      market.yesPrice < priceMin || market.yesPrice > priceMax ||
      market.noPrice < priceMin || market.noPrice > priceMax
    ) {
      logger.debug(
        { marketId: market.id, yesPrice: market.yesPrice, noPrice: market.noPrice, priceMin, priceMax },
        `Signal skipped: price outside tradeable range`
      );
      await db.update(marketsTable).set({ skipReason: "Price out of range" }).where(eq(marketsTable.id, market.id));
      continue;
    }

    if (market.endDate) {
      const endsAt = new Date(market.endDate).getTime();
      if (!isFinite(endsAt)) {
        await db.update(marketsTable).set({ skipReason: "Invalid end date" }).where(eq(marketsTable.id, market.id));
        continue;
      }
      const hoursLeft = (endsAt - Date.now()) / (1000 * 60 * 60);
      if (hoursLeft < minTtrHours) {
        await db.update(marketsTable).set({ skipReason: "Expiring soon" }).where(eq(marketsTable.id, market.id));
        continue;
      }
    }

    if (market.skipReason) {
      await db.update(marketsTable).set({ skipReason: null }).where(eq(marketsTable.id, market.id));
    }

    const priceSkew = Math.abs(market.yesPrice - 0.5);
    if (priceSkew > 0.05 && market.liquidity > 5000) {
      const side = market.yesPrice > 0.5 ? "yes" : "no";
      const edge = priceSkew * 2;

      if (edge >= config.minEdge) {
        const confidence = Math.min(priceSkew * 4, 1);
        const id = randomUUID();
        await db.insert(signalsTable).values({
          id,
          userId,
          marketId: market.id,
          side,
          confidence,
          edge,
          source: "price_skew",
          notified: false,
        });
        pendingNotifications.push({ id, question: market.question, side, edge, confidence });
      }
    }
  }

  const notifyMinEdge = config.notifyMinEdge ?? 0.10;
  const notifyMaxPerCycle = config.notifyMaxPerCycle ?? 5;

  const toNotify = pendingNotifications
    .filter((s) => s.edge >= notifyMinEdge)
    .sort((a, b) => b.edge - a.edge)
    .slice(0, notifyMaxPerCycle);

  await notifySignalDigest(
    toNotify.map((s) => ({ market: s.question, side: s.side, edge: s.edge, confidence: s.confidence }))
  ).catch(() => {});

  if (toNotify.length > 0) {
    const notifiedIds = toNotify.map((s) => s.id);
    await db
      .update(signalsTable)
      .set({ notified: true })
      .where(inArray(signalsTable.id, notifiedIds));
  }

  if (pendingNotifications.length > 0) {
    logger.info(
      { total: pendingNotifications.length, notified: toNotify.length },
      "Signal generation complete",
    );
  }
}

type MarketForOrdering = {
  conditionId: string | null;
  clobTokenIds: string | null;
  outcomes: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildClobClient(userId: string): Promise<any | null> {
  const creds = await resolvePolymarketCredentials(userId);
  if (!creds) {
    logger.warn({ userId }, "No Polymarket credentials available");
    await notifyError("API auth failure: Polymarket credentials are missing or incomplete. Live trading is paused.").catch(() => {});
    return null;
  }
  try {
    const { ClobClient } = await import("@polymarket/clob-client");
    let pk = creds.privateKey.trim();
    if (!pk.startsWith("0x")) pk = `0x${pk}`;
    const wallet = new ethers.Wallet(pk);
    const l2Creds = { key: creds.apiKey, secret: creds.apiSecret, passphrase: creds.apiPassphrase };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new ClobClient(CLOB_HOST, CHAIN_ID, wallet as any, l2Creds as any);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Failed to build CLOB client");
    await notifyError("API auth failure: Could not initialise Polymarket CLOB client.", message).catch(() => {});
    return null;
  }
}

function isOrderAlreadyGone(message: string): boolean {
  return /not.?found|404|already.cancel|does.not.exist|unknown.order|no.such.order/i.test(message);
}

function resolveTokenId(market: MarketForOrdering, side: string): string | undefined {
  if (market.clobTokenIds) {
    try {
      const tokenIds = JSON.parse(market.clobTokenIds) as string[];
      const outcomes = market.outcomes ? (JSON.parse(market.outcomes) as string[]) : [];
      const sideIdx = outcomes.findIndex((o) => o.toLowerCase() === side.toLowerCase());
      if (sideIdx !== -1 && tokenIds[sideIdx]) return tokenIds[sideIdx];
      return side === "yes" ? tokenIds[0] : tokenIds[1];
    } catch {
      // fall through
    }
  }
  return undefined;
}

async function placeLiveOrder(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  market: MarketForOrdering,
  side: string,
  clobSide: "BUY" | "SELL",
  price: number,
  size: number,
): Promise<string | null> {
  try {
    let tokenId = resolveTokenId(market, side);

    if (!tokenId && market.conditionId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clobMarket: any = await client.getMarket(market.conditionId);
      const tokens: Array<{ outcome: string; token_id: string }> = clobMarket?.tokens ?? [];
      const token = tokens.find((t) => t.outcome.toLowerCase() === side.toLowerCase());
      tokenId = token?.token_id;
    }

    if (!tokenId) {
      logger.warn({ conditionId: market.conditionId, side }, "Token ID not found");
      return null;
    }

    const order = await client.createOrder({ tokenID: tokenId, price, size, side: clobSide });
    const response = await client.postOrder(order, "GTC");
    const orderId: string = response?.orderID ?? response?.order_id ?? response?.id ?? randomUUID();
    logger.info({ conditionId: market.conditionId, side, clobSide, price, size, orderId }, "Live order submitted");
    return orderId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, conditionId: market.conditionId }, "Failed to place live order");
    const isAuthError = /401|403|unauthorized|forbidden|invalid.*key|authentication/i.test(message);
    if (isAuthError) {
      await notifyError("API auth failure: Live order rejected — check your Polymarket API credentials.", message).catch(() => {});
    } else {
      await notifyError(`Live order failed (${clobSide} ${side})`, message).catch(() => {});
    }
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseOrderFill(order: any, fallbackPrice: number, fallbackSize: number) {
  const status: string = order?.status ?? order?.orderStatus ?? "";
  const sizeMatched = parseFloat(order?.size_matched ?? order?.sizeMatched ?? "0");
  const orderSize   = parseFloat(order?.size ?? order?.originalSize ?? String(fallbackSize));
  const orderPrice  = parseFloat(order?.price ?? order?.originalPrice ?? String(fallbackPrice));
  const fillPrice   = isNaN(orderPrice) ? fallbackPrice : orderPrice;
  const filledSize  = sizeMatched > 0 ? sizeMatched : fallbackSize;
  const totalSize   = isNaN(orderSize) || orderSize <= 0 ? fallbackSize : orderSize;
  const fillRatio   = totalSize > 0 ? sizeMatched / totalSize : 0;
  const fullyFilled = (status === "MATCHED" || status === "MINED") || (sizeMatched > 0 && sizeMatched >= totalSize);
  const anyFilled   = sizeMatched > 0;
  const cancelled   = status === "CANCELLED" || status === "EXPIRED";
  return { fullyFilled, anyFilled, fillRatio, cancelled, fillPrice, filledSize, totalSize };
}

async function activatePendingPositions(userId: string): Promise<void> {
  const inflight = await db
    .select()
    .from(positionsTable)
    .where(
      and(
        eq(positionsTable.userId, userId),
        inArray(positionsTable.status, ["pending", "closing"]),
      ),
    );

  if (inflight.length === 0) return;

  const [config] = await db.select().from(botConfigTable).where(eq(botConfigTable.id, userId));
  const partialFillThreshold = config?.partialFillThreshold ?? 0.5;

  const client = await buildClobClient(userId);
  if (!client) return;

  for (const pos of inflight) {
    try {
      if (pos.status === "pending") {
        if (!pos.orderId) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const order: any = await client.getOrder(pos.orderId);
        const { fullyFilled, anyFilled, fillRatio, cancelled, fillPrice, filledSize } = parseOrderFill(order, pos.entryPrice, pos.size);

        const shouldActivate = fullyFilled || (anyFilled && fillRatio >= partialFillThreshold);

        if (cancelled) {
          await db.update(positionsTable).set({ status: "cancelled" }).where(eq(positionsTable.id, pos.id));
          logger.info({ positionId: pos.id }, "Live entry order cancelled/expired — position voided");
        } else if (shouldActivate) {
          if (!fullyFilled) {
            let residualCancelled = false;
            try {
              await client.cancelOrder({ orderID: pos.orderId });
              residualCancelled = true;
            } catch (cancelErr) {
              const errMsg = cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
              if (isOrderAlreadyGone(errMsg)) {
                residualCancelled = true;
              } else {
                logger.warn({ cancelErr, positionId: pos.id }, "Could not cancel residual entry order after partial fill — will retry next cycle");
              }
            }
            if (!residualCancelled) continue;
          }

          await db
            .update(positionsTable)
            .set({ status: "open", entryPrice: fillPrice, currentPrice: fillPrice, size: filledSize, pnl: 0 })
            .where(eq(positionsTable.id, pos.id));

          if (fullyFilled) {
            logger.info({ positionId: pos.id, fillPrice, filledSize }, "Live position activated on full entry fill");
          } else {
            logger.info(
              { positionId: pos.id, fillPrice, filledSize, fillRatio: fillRatio.toFixed(3) },
              "Live position activated on partial fill — residual order cancelled",
            );
          }

          const [mkt] = await db.select().from(marketsTable).where(eq(marketsTable.id, pos.marketId));
          if (mkt) {
            await notifyTrade("opened", mkt.question, pos.side, filledSize, fillPrice).catch(() => {});
          }
        } else {
          if (anyFilled) {
            logger.debug(
              { positionId: pos.id, fillRatio: fillRatio.toFixed(3) },
              "Partial fill below threshold — continuing to poll for more fills",
            );
          }
          const ageMs = Date.now() - new Date(pos.openedAt).getTime();
          if (ageMs > STALE_ORDER_TIMEOUT_MS) {
            logger.warn({ positionId: pos.id, orderId: pos.orderId, ageMs }, "Pending entry order stale — attempting cancel");
            let cancelConfirmed = false;
            try {
              await client.cancelOrder({ orderID: pos.orderId });
              cancelConfirmed = true;
            } catch (cancelErr) {
              const errMsg = cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
              if (isOrderAlreadyGone(errMsg)) {
                logger.warn({ positionId: pos.id }, "Stale pending order already gone — checking for partial fill");
                cancelConfirmed = true;
              } else {
                logger.warn({ cancelErr, positionId: pos.id }, "Cancel request for stale pending order failed — will retry next cycle");
              }
            }
            if (cancelConfirmed) {
              if (anyFilled) {
                await db
                  .update(positionsTable)
                  .set({ status: "open", entryPrice: fillPrice, currentPrice: fillPrice, size: filledSize, pnl: 0 })
                  .where(eq(positionsTable.id, pos.id));
                logger.info(
                  { positionId: pos.id, filledSize, fillRatio: fillRatio.toFixed(3) },
                  "Stale entry order cancelled with partial fill — activating position at matched size",
                );
                const [mkt] = await db.select().from(marketsTable).where(eq(marketsTable.id, pos.marketId));
                if (mkt) {
                  await notifyTrade("opened", mkt.question, pos.side, filledSize, fillPrice).catch(() => {});
                }
              } else {
                await db.update(positionsTable).set({ status: "cancelled" }).where(eq(positionsTable.id, pos.id));
              }
            }
          }
        }

      } else if (pos.status === "closing") {
        if (!pos.closeOrderId) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const order: any = await client.getOrder(pos.closeOrderId);
        const { fullyFilled, anyFilled, fillRatio, cancelled, fillPrice } = parseOrderFill(order, pos.currentPrice ?? pos.entryPrice, pos.size);

        const shouldClose = fullyFilled || (anyFilled && fillRatio >= partialFillThreshold);

        if (cancelled) {
          logger.warn({ positionId: pos.id, closeOrderId: pos.closeOrderId }, "Close order cancelled — resetting to open for re-close attempt next cycle");
          await db
            .update(positionsTable)
            .set({ status: "open", closeOrderId: null })
            .where(eq(positionsTable.id, pos.id));
        } else if (shouldClose) {
          if (fullyFilled) {
            const closingPnl = parseFloat(((fillPrice - pos.entryPrice) * pos.size).toFixed(4));
            const pnl = parseFloat((closingPnl + (pos.realizedPnl ?? 0)).toFixed(4));
            await db
              .update(positionsTable)
              .set({ status: "closed", closedAt: new Date(), closedPrice: fillPrice, pnl })
              .where(eq(positionsTable.id, pos.id));
            logger.info({ positionId: pos.id, fillPrice, pnl }, "Live position confirmed closed on full sell fill");

            const [mkt] = await db.select().from(marketsTable).where(eq(marketsTable.id, pos.marketId));
            if (mkt) {
              await notifyTrade("closed", mkt.question, pos.side, pos.size, fillPrice, pnl).catch(() => {});
            }
          } else {
            let residualCancelled = false;
            try {
              await client.cancelOrder({ orderID: pos.closeOrderId! });
              residualCancelled = true;
            } catch (cancelErr) {
              const errMsg = cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
              if (isOrderAlreadyGone(errMsg)) {
                residualCancelled = true;
              } else {
                logger.warn({ cancelErr, positionId: pos.id }, "Could not cancel residual close order after partial fill — will retry next cycle");
              }
            }

            if (residualCancelled) {
              const closedSize = parseFloat((pos.size * fillRatio).toFixed(8));
              const remainingSize = parseFloat((pos.size - closedSize).toFixed(8));
              const addedRealizedPnl = parseFloat(((fillPrice - pos.entryPrice) * closedSize).toFixed(4));
              const newRealizedPnl = parseFloat(((pos.realizedPnl ?? 0) + addedRealizedPnl).toFixed(4));
              await db
                .update(positionsTable)
                .set({
                  status: "open",
                  closeOrderId: null,
                  closeOrderPlacedAt: null,
                  size: remainingSize,
                  realizedPnl: newRealizedPnl,
                })
                .where(eq(positionsTable.id, pos.id));
              logger.info(
                { positionId: pos.id, fillPrice, closedSize, remainingSize, addedRealizedPnl, newRealizedPnl },
                "Partial close above threshold — residual order cancelled, size reduced",
              );
            }
          }
        } else {
          if (anyFilled) {
            logger.debug(
              { positionId: pos.id, fillRatio: fillRatio.toFixed(3) },
              "Partial close fill below threshold — continuing to poll",
            );
          }
          const placedAt = pos.closeOrderPlacedAt ?? pos.openedAt;
          const ageMs = Date.now() - new Date(placedAt).getTime();
          if (ageMs > STALE_ORDER_TIMEOUT_MS) {
            logger.warn({ positionId: pos.id, closeOrderId: pos.closeOrderId, ageMs }, "Closing order stale — attempting cancel");
            let cancelConfirmed = false;
            try {
              await client.cancelOrder({ orderID: pos.closeOrderId! });
              cancelConfirmed = true;
            } catch (cancelErr) {
              const errMsg = cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
              if (isOrderAlreadyGone(errMsg)) {
                logger.warn({ positionId: pos.id }, "Stale closing order already gone — checking for partial fill");
                cancelConfirmed = true;
              } else {
                logger.warn({ cancelErr, positionId: pos.id }, "Cancel request for stale closing order failed — will retry next cycle");
              }
            }
            if (cancelConfirmed) {
              if (anyFilled) {
                const closedSize = parseFloat((pos.size * fillRatio).toFixed(8));
                const remainingSize = parseFloat((pos.size - closedSize).toFixed(8));
                const addedRealizedPnl = parseFloat(((fillPrice - pos.entryPrice) * closedSize).toFixed(4));
                const newRealizedPnl = parseFloat(((pos.realizedPnl ?? 0) + addedRealizedPnl).toFixed(4));
                await db
                  .update(positionsTable)
                  .set({ status: "open", closeOrderId: null, closeOrderPlacedAt: null, size: remainingSize, realizedPnl: newRealizedPnl })
                  .where(eq(positionsTable.id, pos.id));
                logger.info(
                  { positionId: pos.id, closedSize, remainingSize, addedRealizedPnl },
                  "Stale closing order cancelled with partial fill — position size reduced",
                );
              } else {
                await db
                  .update(positionsTable)
                  .set({ status: "open", closeOrderId: null, closeOrderPlacedAt: null })
                  .where(eq(positionsTable.id, pos.id));
              }
            }
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, positionId: pos.id }, "Failed to check in-flight order status");
      const isAuthError = /401|403|unauthorized|forbidden|invalid.*key|authentication/i.test(message);
      if (isAuthError) {
        await notifyError("API auth failure: Could not check live order status — verify Polymarket credentials.", message).catch(() => {});
      }
    }
  }
}

export async function executeTrades(userId: string): Promise<void> {
  const [config] = await db.select().from(botConfigTable).where(eq(botConfigTable.id, userId));
  if (!config || !config.running) return;

  const openPositions = await db
    .select()
    .from(positionsTable)
    .where(
      and(
        eq(positionsTable.userId, userId),
        notInArray(positionsTable.status, ["closed", "cancelled"]),
      ),
    );

  if (openPositions.length >= config.maxOpenPositions) {
    logger.debug({ count: openPositions.length }, "Max open/pending positions reached, skipping execution");
    return;
  }

  const slots = config.maxOpenPositions - openPositions.length;
  const openMarketIds = new Set(openPositions.map((p) => p.marketId));

  const existingSignalIds = (
    await db
      .select({ signalId: positionsTable.signalId })
      .from(positionsTable)
      .where(eq(positionsTable.userId, userId))
  )
    .map((r) => r.signalId)
    .filter((id): id is string => id !== null && id !== undefined);

  const windowMs = (config.signalWindowSeconds ?? 300) * 1000;
  const cutoff = new Date(Date.now() - windowMs);

  const candidates = await db
    .select()
    .from(signalsTable)
    .where(
      and(
        eq(signalsTable.userId, userId),
        existingSignalIds.length > 0
          ? and(gte(signalsTable.createdAt, cutoff), notInArray(signalsTable.id, existingSignalIds))
          : gte(signalsTable.createdAt, cutoff),
      ),
    )
    .orderBy(desc(signalsTable.edge))
    .limit(slots * 3);

  let executed = 0;

  for (const signal of candidates) {
    if (executed >= slots) break;
    if (signal.edge < config.minEdge) continue;
    if (openMarketIds.has(signal.marketId)) continue;

    const [market] = await db
      .select()
      .from(marketsTable)
      .where(eq(marketsTable.id, signal.marketId));
    if (!market) continue;

    const entryPrice = signal.side === "yes" ? market.yesPrice : market.noPrice;
    const balance = config.paperBalance ?? 1000;
    const size = Math.min(config.maxPositionSize, config.mode === "paper" ? Math.max(0, balance * 0.1) : config.maxPositionSize);

    if (size <= 0) {
      logger.warn("Insufficient paper balance, skipping trade");
      continue;
    }

    if (config.mode === "paper") {
      await db.insert(positionsTable).values({
        id: randomUUID(),
        userId,
        marketId: signal.marketId,
        signalId: signal.id,
        side: signal.side,
        size,
        entryPrice,
        currentPrice: entryPrice,
        pnl: 0,
        status: "open",
      });

      await db
        .update(botConfigTable)
        .set({ paperBalance: balance - size })
        .where(eq(botConfigTable.id, userId));

      openMarketIds.add(signal.marketId);
      executed++;

      logger.info(
        { marketId: signal.marketId, side: signal.side, size, price: entryPrice, edge: signal.edge },
        "Paper trade opened",
      );

      await notifyTrade("opened", market.question, signal.side, size, entryPrice).catch(() => {});

    } else if (config.mode === "live") {
      if (!market.conditionId) {
        logger.warn({ marketId: market.id }, "Market has no conditionId, cannot place live order");
        continue;
      }

      const client = await buildClobClient(userId);
      if (!client) continue;

      const orderId = await placeLiveOrder(client, market, signal.side, "BUY", entryPrice, size);
      if (!orderId) continue;

      await db.insert(positionsTable).values({
        id: randomUUID(),
        userId,
        marketId: signal.marketId,
        signalId: signal.id,
        orderId,
        side: signal.side,
        size,
        entryPrice,
        currentPrice: entryPrice,
        pnl: 0,
        status: "pending",
      });

      openMarketIds.add(signal.marketId);
      executed++;

      logger.info(
        { marketId: signal.marketId, orderId, side: signal.side, size, price: entryPrice },
        "Live buy order submitted — position pending fill confirmation",
      );
    }
  }

  if (executed > 0) {
    logger.info({ executed, mode: config.mode }, "Trade execution cycle complete");
  }
}

export async function monitorPositions(userId: string): Promise<void> {
  await activatePendingPositions(userId);

  const openPositions = await db
    .select()
    .from(positionsTable)
    .where(
      and(
        eq(positionsTable.userId, userId),
        eq(positionsTable.status, "open"),
      ),
    );

  if (openPositions.length === 0) return;

  const [config] = await db
    .select()
    .from(botConfigTable)
    .where(eq(botConfigTable.id, userId));
  if (!config) return;

  const marketIds = [...new Set(openPositions.map((p) => p.marketId))];
  const markets = marketIds.length > 0
    ? await db.select().from(marketsTable).where(inArray(marketsTable.id, marketIds))
    : [];
  const marketMap = new Map(markets.map((m) => [m.id, m]));

  let liveClient: unknown = null;

  for (const pos of openPositions) {
    const market = marketMap.get(pos.marketId);
    if (!market) continue;

    const currentPrice = pos.side === "yes" ? market.yesPrice : market.noPrice;
    const priceDelta = currentPrice - pos.entryPrice;
    const unrealizedPnl = parseFloat((priceDelta * pos.size).toFixed(4));
    const pnl = parseFloat((unrealizedPnl + (pos.realizedPnl ?? 0)).toFixed(4));
    const returnRatio = pos.entryPrice > 0 ? priceDelta / pos.entryPrice : 0;

    const ageMs = Date.now() - new Date(pos.openedAt).getTime();
    const shouldClose =
      returnRatio >= TAKE_PROFIT_RATIO ||
      returnRatio <= -STOP_LOSS_RATIO ||
      ageMs > MAX_POSITION_AGE_MS;

    if (shouldClose) {
      const reason =
        returnRatio >= TAKE_PROFIT_RATIO ? "take-profit" :
        returnRatio <= -STOP_LOSS_RATIO  ? "stop-loss"   :
        "max-age";

      if (config.mode === "live") {
        if (!liveClient) liveClient = await buildClobClient(userId);

        const closeOrderId = await placeLiveOrder(
          liveClient,
          market,
          pos.side,
          "SELL",
          currentPrice,
          pos.size,
        );

        if (!closeOrderId) {
          logger.warn({ positionId: pos.id }, "Could not submit live close order — retrying next cycle");
          await db.update(positionsTable).set({ currentPrice, pnl }).where(eq(positionsTable.id, pos.id));
          continue;
        }

        logger.info({ positionId: pos.id, closeOrderId, reason }, "Live close order submitted — awaiting fill confirmation");
        await db
          .update(positionsTable)
          .set({ currentPrice, pnl, status: "closing", closeOrderId, closeOrderPlacedAt: new Date() })
          .where(eq(positionsTable.id, pos.id));
      } else {
        await db.update(positionsTable).set({ currentPrice, pnl }).where(eq(positionsTable.id, pos.id));
        continue;
      }
    } else {
      await db
        .update(positionsTable)
        .set({ currentPrice, pnl, status: "closed", closedAt: new Date(), closedPrice: currentPrice })
        .where(eq(positionsTable.id, pos.id));

      const refund = pos.size + pnl;
      const newBalance = (config.paperBalance ?? 0) + Math.max(0, refund);
      await db
        .update(botConfigTable)
        .set({ paperBalance: parseFloat(newBalance.toFixed(4)) })
        .where(eq(botConfigTable.id, userId));

      logger.info({ positionId: pos.id, pnl, reason: shouldClose ? "tp/sl/age" : "update", mode: config.mode }, "Position close initiated");
      if (config.mode === "paper") {
        await notifyTrade("closed", market.question, pos.side, pos.size, currentPrice, pnl).catch(() => {});
      }
    }

    await db
      .update(positionsTable)
      .set({ currentPrice, pnl })
      .where(eq(positionsTable.id, pos.id));
  }
}

const BALANCE_SNAPSHOT_LIMIT = 100;

async function recordBalanceSnapshot(userId: string): Promise<void> {
  try {
    const [config] = await db.select().from(botConfigTable).where(eq(botConfigTable.id, userId));
    if (!config || config.mode !== "paper") return;

    const balance = config.paperBalance ?? 1000;
    await db.insert(balanceSnapshotsTable).values({ id: randomUUID(), userId, balance, recordedAt: new Date() });

    const allSnapshots = await db
      .select({ id: balanceSnapshotsTable.id })
      .from(balanceSnapshotsTable)
      .where(eq(balanceSnapshotsTable.userId, userId))
      .orderBy(desc(balanceSnapshotsTable.recordedAt));

    if (allSnapshots.length > BALANCE_SNAPSHOT_LIMIT) {
      const toDelete = allSnapshots.slice(BALANCE_SNAPSHOT_LIMIT).map((s) => s.id);
      await db.delete(balanceSnapshotsTable).where(inArray(balanceSnapshotsTable.id, toDelete));
    }
  } catch (err) {
    logger.error({ err }, "Failed to record balance snapshot");
  }
}

async function maybeSendDailyReport(userId: string): Promise<void> {
  try {
    const [config] = await db.select().from(botConfigTable).where(eq(botConfigTable.id, userId));
    if (!config) return;

    const reportHour = config.dailyReportHour ?? 8;
    const now = new Date();
    const currentHour = now.getUTCHours();
    const todayKey = `${userId}:${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;

    if (currentHour === reportHour && lastDailyReportDates.get(userId) !== todayKey) {
      await sendDailyReport();
      lastDailyReportDates.set(userId, todayKey);
    }
  } catch (err) {
    logger.error({ err }, "Failed to send scheduled daily report");
  }
}

async function runTradingCycle(userId: string): Promise<void> {
  try {
    lastCycleTimes.set(userId, new Date());
    logger.info({ userId }, "Trading cycle start");
    await runDiscovery(userId);
    await executeTrades(userId);
    await monitorPositions(userId);
    await recordBalanceSnapshot(userId);
    await maybeSendDailyReport(userId);
    logger.info({ userId }, "Trading cycle complete");
  } catch (err) {
    logger.error({ err }, "Unhandled error in trading cycle");
    const message = err instanceof Error ? err.message : String(err);
    await notifyError("Unhandled error in trading cycle", message).catch(() => {});
  }
}

export function startTradingLoop(userId: string): void {
  if (tradingLoopTimers.has(userId)) return;
  logger.info({ userId }, "Starting trading loop");
  runTradingCycle(userId);
  const timer = setInterval(() => runTradingCycle(userId), CYCLE_INTERVAL_MS);
  tradingLoopTimers.set(userId, timer);
}

export function stopTradingLoop(userId: string): void {
  const timer = tradingLoopTimers.get(userId);
  if (timer) {
    clearInterval(timer);
    tradingLoopTimers.delete(userId);
    logger.info({ userId }, "Trading loop stopped");
  }
}
