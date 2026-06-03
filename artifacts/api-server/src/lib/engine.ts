import { db, marketsTable, signalsTable, botConfigTable, positionsTable, balanceSnapshotsTable } from "@workspace/db";
import { eq, gte, desc, and, inArray, notInArray } from "drizzle-orm";
import { logger } from "./logger.js";
import { randomUUID } from "crypto";
import { resolvePolymarketCredentials } from "./credentials.js";
import { ethers } from "ethers";
import { notifyTrade, notifySignal, notifyError, sendDailyReport } from "./telegram.js";

export { resolvePolymarketCredentials };

export let lastDiscoveryAt: Date | null = null;

const POLYMARKET_GAMMA_API = "https://gamma-api.polymarket.com";
const CLOB_HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;

const TAKE_PROFIT_RATIO = 0.08;
const STOP_LOSS_RATIO = 0.12;
const MAX_POSITION_AGE_MS = 24 * 60 * 60 * 1000;

const STALE_ORDER_TIMEOUT_MS = 2 * 60 * 60 * 1000;

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
      let yesPrice = 0.5;
      let noPrice  = 0.5;

      if (m.outcomePrices && m.outcomes) {
        try {
          const prices   = JSON.parse(m.outcomePrices) as string[];
          const outcomes = JSON.parse(m.outcomes) as string[];
          const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
          const noIdx  = outcomes.findIndex((o) => o.toLowerCase() === "no");

          if (yesIdx !== -1 && prices[yesIdx] !== undefined) {
            yesPrice = parseFloat(prices[yesIdx]);
          } else if (prices[0] !== undefined) {
            yesPrice = parseFloat(prices[0]);
          }

          if (noIdx !== -1 && prices[noIdx] !== undefined) {
            noPrice = parseFloat(prices[noIdx]);
          } else if (prices[1] !== undefined) {
            noPrice = parseFloat(prices[1]);
          } else {
            noPrice = 1 - yesPrice;
          }
        } catch {
          // keep defaults
        }
      } else if (m.tokens && m.tokens.length > 0) {
        const yesToken = m.tokens.find((t) => t.outcome.toLowerCase() === "yes");
        const noToken  = m.tokens.find((t) => t.outcome.toLowerCase() === "no");
        if (yesToken) yesPrice = parseFloat(yesToken.price);
        if (noToken)  noPrice  = parseFloat(noToken.price);
        else          noPrice  = 1 - yesPrice;
      }

      if (isNaN(yesPrice)) yesPrice = 0.5;
      if (isNaN(noPrice))  noPrice  = 1 - yesPrice;

      await db
        .insert(marketsTable)
        .values({
          id: m.id ?? randomUUID(),
          question: m.question,
          category: categorize(m.question),
          yesPrice,
          noPrice,
          volume:    parseFloat(m.volume    ?? "0") || 0,
          liquidity: parseFloat(m.liquidity ?? "0") || 0,
          endDate:   m.endDate   ?? null,
          conditionId: m.conditionId ?? null,
          slug: m.slug ?? null,
          outcomes: m.outcomes ?? null,
          clobTokenIds: m.clobTokenIds ?? null,
          isTracked: true,
        })
        .onConflictDoUpdate({
          target: marketsTable.id,
          set: {
            yesPrice,
            noPrice,
            volume:    parseFloat(m.volume    ?? "0") || 0,
            liquidity: parseFloat(m.liquidity ?? "0") || 0,
            outcomes: m.outcomes ?? null,
            clobTokenIds: m.clobTokenIds ?? null,
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

  await generateSignals();

  return { synced, total: markets.length, lastSyncAt: lastDiscoveryAt.toISOString() };
}

const PRICE_MIN = 0.05;
const PRICE_MAX = 0.95;
const MIN_TTR_HOURS = 24;

async function generateSignals() {
  const [config] = await db.select().from(botConfigTable).where(eq(botConfigTable.id, "singleton"));
  if (!config) return;

  const markets = await db.select().from(marketsTable).where(eq(marketsTable.isTracked, true));

  const pendingNotifications: Array<{ id: string; question: string; side: string; edge: number; confidence: number }> = [];

  for (const market of markets) {
    // Skip near-settled markets: both outcome prices must be within the tradeable range
    if (
      market.yesPrice < PRICE_MIN || market.yesPrice > PRICE_MAX ||
      market.noPrice < PRICE_MIN || market.noPrice > PRICE_MAX
    ) {
      logger.debug(
        { marketId: market.id, yesPrice: market.yesPrice, noPrice: market.noPrice, skip: "price_out_of_range" },
        "Signal skipped: one or both prices outside tradeable range [0.05, 0.95]"
      );
      continue;
    }

    // Skip markets expiring within 24 hours
    if (market.endDate) {
      const endsAt = new Date(market.endDate).getTime();
      if (!isFinite(endsAt)) {
        logger.debug(
          { marketId: market.id, endDate: market.endDate, skip: "unparseable_end_date" },
          "Signal skipped: endDate could not be parsed"
        );
        continue;
      }
      const hoursLeft = (endsAt - Date.now()) / (1000 * 60 * 60);
      if (hoursLeft < MIN_TTR_HOURS) {
        logger.debug(
          { marketId: market.id, endDate: market.endDate, hoursLeft: hoursLeft.toFixed(1), skip: "expiring_soon" },
          "Signal skipped: market expires within 24 hours"
        );
        continue;
      }
    }

    const priceSkew = Math.abs(market.yesPrice - 0.5);
    if (priceSkew > 0.02 && market.liquidity > 1000) {
      const side = market.yesPrice > 0.5 ? "no" : "yes";
      const edge = priceSkew * 2;

      if (edge >= config.minEdge) {
        const confidence = Math.min(priceSkew * 4, 1);
        const id = randomUUID();
        await db.insert(signalsTable).values({
          id,
          marketId: market.id,
          side,
          confidence,
          edge,
          source: "price_skew",
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

  for (const s of toNotify) {
    await notifySignal(s.question, s.side, s.edge, s.confidence).catch(() => {});
  }

  if (pendingNotifications.length > 0) {
    logger.info(
      { total: pendingNotifications.length, notified: toNotify.length, notifyMinEdge, notifyMaxPerCycle },
      "Signal generation complete — notifications sent for top signals above notify threshold",
    );
  }
}

type MarketForOrdering = {
  conditionId: string | null;
  clobTokenIds: string | null;
  outcomes: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildClobClient(): Promise<any | null> {
  const creds = await resolvePolymarketCredentials();
  if (!creds) {
    logger.warn("No Polymarket credentials available");
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

    const order = await client.createLimitOrder({ tokenID: tokenId, price, size, side: clobSide });
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

async function activatePendingPositions(): Promise<void> {
  const inflight = await db
    .select()
    .from(positionsTable)
    .where(
      inArray(positionsTable.status, ["pending", "closing"]),
    );

  if (inflight.length === 0) return;

  const [config] = await db.select().from(botConfigTable).where(eq(botConfigTable.id, "singleton"));
  const partialFillThreshold = config?.partialFillThreshold ?? 0.5;

  const client = await buildClobClient();
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
            // Partial fill above threshold: cancel remaining open order quantity
            // so no further fills can desync recorded position size from actual exposure.
            let residualCancelled = false;
            try {
              await client.cancelOrder(pos.orderId);
              residualCancelled = true;
            } catch (cancelErr) {
              const errMsg = cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
              if (isOrderAlreadyGone(errMsg)) {
                residualCancelled = true; // already gone — safe to proceed
              } else {
                logger.warn({ cancelErr, positionId: pos.id }, "Could not cancel residual entry order after partial fill — will retry next cycle");
              }
            }
            if (!residualCancelled) continue; // retry next cycle once cancel succeeds
          }

          await db
            .update(positionsTable)
            .set({ status: "open", entryPrice: fillPrice, currentPrice: fillPrice, size: filledSize, pnl: 0 })
            .where(eq(positionsTable.id, pos.id));

          if (fullyFilled) {
            logger.info({ positionId: pos.id, fillPrice, filledSize }, "Live position activated on full entry fill");
          } else {
            logger.info(
              { positionId: pos.id, fillPrice, filledSize, fillRatio: fillRatio.toFixed(3), threshold: partialFillThreshold },
              "Live position activated on partial fill (above threshold) — residual order cancelled",
            );
          }

          const [mkt] = await db.select().from(marketsTable).where(eq(marketsTable.id, pos.marketId));
          if (mkt) {
            await notifyTrade("opened", mkt.question, pos.side, filledSize, fillPrice).catch(() => {});
          }
        } else {
          if (anyFilled) {
            logger.debug(
              { positionId: pos.id, fillRatio: fillRatio.toFixed(3), threshold: partialFillThreshold },
              "Partial fill below threshold — continuing to poll for more fills",
            );
          }
          const ageMs = Date.now() - new Date(pos.openedAt).getTime();
          if (ageMs > STALE_ORDER_TIMEOUT_MS) {
            logger.warn({ positionId: pos.id, orderId: pos.orderId, ageMs }, "Pending entry order stale — attempting cancel");
            let cancelConfirmed = false;
            try {
              await client.cancelOrder(pos.orderId);
              cancelConfirmed = true;
            } catch (cancelErr) {
              const errMsg = cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
              if (isOrderAlreadyGone(errMsg)) {
                logger.warn({ positionId: pos.id }, "Stale pending order already gone on exchange — checking for partial fill");
                cancelConfirmed = true;
              } else {
                logger.warn({ cancelErr, positionId: pos.id }, "Cancel request for stale pending order failed transiently — will retry next cycle");
              }
            }
            if (cancelConfirmed) {
              if (anyFilled) {
                // Some quantity traded before we timed out — activate at matched size
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
            // Full close: record the position as closed, including any previously realized P&L.
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
            // Partial close above threshold: cancel the residual close order so no further
            // fills can occur on this stale order, then reduce the tracked position size to
            // the remaining exposure and accumulate realized P&L for future reference.
            let residualCancelled = false;
            try {
              await client.cancelOrder(pos.closeOrderId);
              residualCancelled = true;
            } catch (cancelErr) {
              const errMsg = cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
              if (isOrderAlreadyGone(errMsg)) {
                residualCancelled = true; // already gone — safe to finalise
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
                { positionId: pos.id, fillPrice, closedSize, remainingSize, addedRealizedPnl, newRealizedPnl, fillRatio: fillRatio.toFixed(3) },
                "Partial close above threshold — residual order cancelled, size reduced to remaining exposure, realized P&L accumulated",
              );
            }
          }
        } else {
          if (anyFilled) {
            logger.debug(
              { positionId: pos.id, fillRatio: fillRatio.toFixed(3), threshold: partialFillThreshold },
              "Partial close fill below threshold — continuing to poll",
            );
          }
          const placedAt = pos.closeOrderPlacedAt ?? pos.openedAt;
          const ageMs = Date.now() - new Date(placedAt).getTime();
          if (ageMs > STALE_ORDER_TIMEOUT_MS) {
            logger.warn({ positionId: pos.id, closeOrderId: pos.closeOrderId, ageMs }, "Closing order stale — attempting cancel");
            let cancelConfirmed = false;
            try {
              await client.cancelOrder(pos.closeOrderId);
              cancelConfirmed = true;
            } catch (cancelErr) {
              const errMsg = cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
              if (isOrderAlreadyGone(errMsg)) {
                logger.warn({ positionId: pos.id }, "Stale closing order already gone on exchange — checking for partial fill");
                cancelConfirmed = true;
              } else {
                logger.warn({ cancelErr, positionId: pos.id }, "Cancel request for stale closing order failed transiently — will retry next cycle");
              }
            }
            if (cancelConfirmed) {
              if (anyFilled) {
                // Some quantity closed before timeout — reduce size and accumulate realized P&L
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
                  "Stale closing order cancelled with partial fill — position size reduced, realized P&L recorded",
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

export async function executeTrades(): Promise<void> {
  const [config] = await db.select().from(botConfigTable).where(eq(botConfigTable.id, "singleton"));
  if (!config || !config.running) return;

  const openPositions = await db
    .select()
    .from(positionsTable)
    .where(notInArray(positionsTable.status, ["closed", "cancelled"]));

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
  )
    .map((r) => r.signalId)
    .filter((id): id is string => id !== null && id !== undefined);

  const windowMs = (config.signalWindowSeconds ?? 300) * 1000;
  const cutoff = new Date(Date.now() - windowMs);

  const candidates = await db
    .select()
    .from(signalsTable)
    .where(
      existingSignalIds.length > 0
        ? and(gte(signalsTable.createdAt, cutoff), notInArray(signalsTable.id, existingSignalIds))
        : gte(signalsTable.createdAt, cutoff),
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
        .where(eq(botConfigTable.id, "singleton"));

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

      const client = await buildClobClient();
      if (!client) continue;

      const orderId = await placeLiveOrder(client, market, signal.side, "BUY", entryPrice, size);
      if (!orderId) continue;

      await db.insert(positionsTable).values({
        id: randomUUID(),
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

export async function monitorPositions(): Promise<void> {
  await activatePendingPositions();

  const openPositions = await db
    .select()
    .from(positionsTable)
    .where(eq(positionsTable.status, "open"));

  if (openPositions.length === 0) return;

  const [config] = await db
    .select()
    .from(botConfigTable)
    .where(eq(botConfigTable.id, "singleton"));
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
        if (!liveClient) liveClient = await buildClobClient();

        if (liveClient) {
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
          .set({ currentPrice, pnl, status: "closed", closedAt: new Date() })
          .where(eq(positionsTable.id, pos.id));

        const refund = pos.size + pnl;
        const newBalance = (config.paperBalance ?? 0) + Math.max(0, refund);
        await db
          .update(botConfigTable)
          .set({ paperBalance: parseFloat(newBalance.toFixed(4)) })
          .where(eq(botConfigTable.id, "singleton"));
      }

      logger.info({ positionId: pos.id, pnl, reason, mode: config.mode }, "Position close initiated");
      if (config.mode === "paper") {
        await notifyTrade("closed", market.question, pos.side, pos.size, currentPrice, pnl).catch(() => {});
      }
    } else {
      await db
        .update(positionsTable)
        .set({ currentPrice, pnl })
        .where(eq(positionsTable.id, pos.id));
    }
  }
}

let tradingLoopTimer: ReturnType<typeof setInterval> | null = null;
export const CYCLE_INTERVAL_MS = 5 * 60 * 1000;
export let lastCycleAt: Date | null = null;

let lastDailyReportDate: string | null = null;

async function maybeSendDailyReport(): Promise<void> {
  try {
    const [config] = await db.select().from(botConfigTable).where(eq(botConfigTable.id, "singleton"));
    if (!config) return;

    const reportHour = config.dailyReportHour ?? 8;
    const now = new Date();
    const currentHour = now.getUTCHours();
    const todayKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;

    if (currentHour === reportHour && lastDailyReportDate !== todayKey) {
      await sendDailyReport();
      lastDailyReportDate = todayKey;
    }
  } catch (err) {
    logger.error({ err }, "Failed to send scheduled daily report");
  }
}

const BALANCE_SNAPSHOT_LIMIT = 100;

async function recordBalanceSnapshot(): Promise<void> {
  try {
    const [config] = await db.select().from(botConfigTable).where(eq(botConfigTable.id, "singleton"));
    if (!config || config.mode !== "paper") return;

    const balance = config.paperBalance ?? 1000;
    await db.insert(balanceSnapshotsTable).values({ id: randomUUID(), balance, recordedAt: new Date() });

    const allSnapshots = await db
      .select({ id: balanceSnapshotsTable.id })
      .from(balanceSnapshotsTable)
      .orderBy(desc(balanceSnapshotsTable.recordedAt));

    if (allSnapshots.length > BALANCE_SNAPSHOT_LIMIT) {
      const toDelete = allSnapshots.slice(BALANCE_SNAPSHOT_LIMIT).map((s) => s.id);
      await db.delete(balanceSnapshotsTable).where(inArray(balanceSnapshotsTable.id, toDelete));
    }
  } catch (err) {
    logger.error({ err }, "Failed to record balance snapshot");
  }
}

async function runTradingCycle(): Promise<void> {
  try {
    lastCycleAt = new Date();
    logger.info("Trading cycle start");
    await runDiscovery();
    await executeTrades();
    await monitorPositions();
    await recordBalanceSnapshot();
    await maybeSendDailyReport();
    logger.info("Trading cycle complete");
  } catch (err) {
    logger.error({ err }, "Unhandled error in trading cycle");
    const message = err instanceof Error ? err.message : String(err);
    await notifyError("Unhandled error in trading cycle", message).catch(() => {});
  }
}

export function startTradingLoop(): void {
  if (tradingLoopTimer) return;
  logger.info("Starting trading loop");
  runTradingCycle();
  tradingLoopTimer = setInterval(runTradingCycle, CYCLE_INTERVAL_MS);
}

export function stopTradingLoop(): void {
  if (tradingLoopTimer) {
    clearInterval(tradingLoopTimer);
    tradingLoopTimer = null;
    logger.info("Trading loop stopped");
  }
}

export function isTradingLoopRunning(): boolean {
  return tradingLoopTimer !== null;
}
