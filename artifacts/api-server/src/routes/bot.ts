import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, botConfigTable, signalsTable, positionsTable, marketsTable, feedEventsTable } from "@workspace/db";
import {
  GetBotStatusResponse,
  StartBotResponse,
  StopBotResponse,
  GetBotConfigResponse,
  UpdateBotConfigBody,
  UpdateBotConfigResponse,
  SyncMarketsResponse,
  GetOpportunitiesResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { runDiscovery, lastDiscoveryAt } from "../lib/engine";
import { sendDailyReport } from "../lib/telegram";
import {
  checkPolymarketBalance,
  getPolymarketCreds,
  placeLimitOrder,
  cancelOrder,
} from "../lib/engine/polymarket";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount, mnemonicToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

const router: IRouter = Router();

let botStartTime: Date | null = null;

async function getOrCreateConfig() {
  const [existing] = await db
    .select()
    .from(botConfigTable)
    .where(eq(botConfigTable.id, "singleton"));

  if (existing) return existing;

  const [created] = await db
    .insert(botConfigTable)
    .values({
      id: "singleton",
      mode: "paper",
      minEdge: 0.05,
      maxPositionSize: 50,
      maxOpenPositions: 5,
      signalWindowSeconds: 300,
      enabledCategories: "sports,crypto,weather",
      running: false,
    })
    .returning();

  return created;
}

router.get("/bot/status", async (req, res): Promise<void> => {
  try {
    const config = await getOrCreateConfig();

    const signals = await db.select().from(signalsTable);
    const positions = await db.select().from(positionsTable);

    const uptime =
      config.running && config.startedAt
        ? Math.floor((Date.now() - new Date(config.startedAt).getTime()) / 1000)
        : 0;

    const trackedMarkets = await db.select().from(marketsTable).where(eq(marketsTable.isTracked, true));
    const feedEvents = await db.select().from(feedEventsTable).limit(1000);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const activeFeedIds = new Set(feedEvents.filter(e => e.timestamp >= today).map(e => e.feedId));

    res.json(
      GetBotStatusResponse.parse({
        running: config.running,
        mode: config.running ? config.mode : "paused",
        uptime,
        signalsGenerated: signals.length,
        tradesExecuted: positions.length,
        lastSignalAt: signals.length > 0 ? signals[signals.length - 1].createdAt.toISOString() : undefined,
        lastTradeAt: positions.length > 0 ? positions[positions.length - 1].openedAt.toISOString() : undefined,
        feedsActive: config.running ? activeFeedIds.size : 0,
        marketsTracked: trackedMarkets.length,
      })
    );
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    req.log?.error({ err: msg }, "bot/status failed");
    res.status(500).json({ error: "Internal server error", detail: msg });
  }
});

router.post("/bot/start", async (_req, res): Promise<void> => {
  const now = new Date();
  await db
    .update(botConfigTable)
    .set({ running: true, startedAt: now.toISOString() })
    .where(eq(botConfigTable.id, "singleton"));

  logger.info("Bot started");

  const config = await getOrCreateConfig();
  const signals = await db.select().from(signalsTable);
  const positions = await db.select().from(positionsTable);

  res.json(
    StartBotResponse.parse({
      running: true,
      mode: config.mode as "live" | "paper",
      uptime: 0,
      signalsGenerated: signals.length,
      tradesExecuted: positions.length,
      feedsActive: 3,
      marketsTracked: 8,
    })
  );
});

router.post("/bot/stop", async (_req, res): Promise<void> => {
  await db
    .update(botConfigTable)
    .set({ running: false, startedAt: null })
    .where(eq(botConfigTable.id, "singleton"));

  logger.info("Bot stopped");

  const signals = await db.select().from(signalsTable);
  const positions = await db.select().from(positionsTable);

  res.json(
    StopBotResponse.parse({
      running: false,
      mode: "paused",
      uptime: 0,
      signalsGenerated: signals.length,
      tradesExecuted: positions.length,
      feedsActive: 0,
      marketsTracked: 8,
    })
  );
});

router.post("/bot/sync-markets", async (req, res): Promise<void> => {
  try {
    const result = await runDiscovery();
    if (!result) {
      res.status(500).json({ error: "Market sync failed" });
      return;
    }
    res.json(SyncMarketsResponse.parse(result));
  } catch (err) {
    req.log.error({ err }, "Sync markets failed");
    res.status(500).json({ error: "Market sync failed" });
  }
});

router.get("/bot/opportunities", async (_req, res): Promise<void> => {
  const markets = await db
    .select()
    .from(marketsTable)
    .where(eq(marketsTable.isTracked, true))
    .orderBy(desc(marketsTable.liquidity));

  const opportunities = markets
    .map((m) => {
      // Price skew: how far from 50/50. 0 = perfectly even, 0.5 = one side is certain
      const priceSkew = Math.abs(m.yesPrice - 0.5);
      // Opportunity score: prefer liquid markets near 50/50 with decent volume
      // Near-50/50 markets are most susceptible to real-world data edge
      const liquidityScore = Math.log10(Math.max(m.liquidity, 1));
      const skewBonus = 1 - priceSkew * 2; // near-50/50 gets bonus
      const volumeScore = Math.log10(Math.max(m.volume, 1));
      const opportunityScore = parseFloat(((liquidityScore + skewBonus + volumeScore * 0.3) / 2.3).toFixed(4));

      return {
        marketId: m.id,
        question: m.question,
        category: m.category,
        yesPrice: m.yesPrice,
        noPrice: m.noPrice,
        volume: m.volume,
        liquidity: m.liquidity,
        endDate: m.endDate ?? undefined,
        conditionId: m.conditionId ?? undefined,
        slug: m.slug ?? undefined,
        opportunityScore,
        priceSkew: parseFloat(priceSkew.toFixed(4)),
        polymarketUrl: m.slug
          ? `https://polymarket.com/event/${m.slug}`
          : m.conditionId
          ? `https://polymarket.com/event/${m.conditionId}`
          : undefined,
      };
    })
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 20);

  res.json(
    GetOpportunitiesResponse.parse({
      opportunities,
      lastSyncAt: lastDiscoveryAt?.toISOString(),
      totalTracked: markets.length,
    })
  );
});

router.get("/bot/config", async (_req, res): Promise<void> => {
  const config = await getOrCreateConfig();

  res.json(
    GetBotConfigResponse.parse({
      mode: config.mode as "live" | "paper",
      minEdge: config.minEdge,
      maxPositionSize: config.maxPositionSize,
      maxOpenPositions: config.maxOpenPositions,
      signalWindowSeconds: config.signalWindowSeconds,
      enabledCategories: config.enabledCategories.split(","),
      paperBalance: config.paperBalance,
      polymarketPrivateKey: config.polymarketPrivateKey ? "••••••••" : undefined,
      polymarketApiKey: config.polymarketApiKey ? "••••••••" : undefined,
      polymarketApiSecret: config.polymarketApiSecret ? "••••••••" : undefined,
      polymarketApiPassphrase: config.polymarketApiPassphrase ? "••••••••" : undefined,
      telegramBotToken: config.telegramBotToken ? "••••••••" : undefined,
      telegramChatId: config.telegramChatId ?? undefined,
      sportsApiKey: config.sportsApiKey ? "••••••••" : undefined,
      weatherApiKey: config.weatherApiKey ? "••••••••" : undefined,
    })
  );
});

router.put("/bot/config", async (req, res): Promise<void> => {
  const parsed = UpdateBotConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { enabledCategories, ...rest } = parsed.data;

  const SENTINEL = "••••••••";
  const secretFields = ["polymarketPrivateKey", "polymarketApiKey", "polymarketApiSecret", "polymarketApiPassphrase", "telegramBotToken", "sportsApiKey", "weatherApiKey"] as const;
  const safeRest = { ...rest };
  for (const field of secretFields) {
    if (safeRest[field] === SENTINEL || safeRest[field] === "") {
      delete safeRest[field];
    }
  }

  const [updated] = await db
    .update(botConfigTable)
    .set({
      ...safeRest,
      enabledCategories: enabledCategories ? enabledCategories.join(",") : undefined,
    })
    .where(eq(botConfigTable.id, "singleton"))
    .returning();

  if (!updated) {
    await getOrCreateConfig();
    res.status(500).json({ error: "Config not found" });
    return;
  }

  res.json(
    UpdateBotConfigResponse.parse({
      mode: updated.mode as "live" | "paper",
      minEdge: updated.minEdge,
      maxPositionSize: updated.maxPositionSize,
      maxOpenPositions: updated.maxOpenPositions,
      signalWindowSeconds: updated.signalWindowSeconds,
      enabledCategories: updated.enabledCategories.split(","),
      paperBalance: updated.paperBalance,
      polymarketPrivateKey: updated.polymarketPrivateKey ? "••••••••" : undefined,
      polymarketApiKey: updated.polymarketApiKey ? "••••••••" : undefined,
      polymarketApiSecret: updated.polymarketApiSecret ? "••••••••" : undefined,
      polymarketApiPassphrase: updated.polymarketApiPassphrase ? "••••••••" : undefined,
      telegramBotToken: updated.telegramBotToken ? "••••••••" : undefined,
      telegramChatId: updated.telegramChatId ?? undefined,
      sportsApiKey: updated.sportsApiKey ? "••••••••" : undefined,
      weatherApiKey: updated.weatherApiKey ? "••••••••" : undefined,
    })
  );
});

router.post("/bot/send-report", async (_req, res): Promise<void> => {
  try {
    await sendDailyReport();
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Send report failed");
    res.status(500).json({ error: "Failed to send report" });
  }
});

router.post("/bot/diagnostics", async (_req, res): Promise<void> => {
  const results: Record<string, unknown> = {};

  // 1. Credentials present
  const creds = getPolymarketCreds();
  results.credentials = {
    privateKey: !!process.env["POLYMARKET_PRIVATE_KEY"],
    apiKey:     !!process.env["POLYMARKET_API_KEY"],
    secret:     !!process.env["POLYMARKET_API_SECRET"],
    passphrase: !!process.env["POLYMARKET_API_PASSPHRASE"],
    allSet:     !!creds,
  };

  // 2. Wallet address + MATIC balance
  try {
    let pk = (process.env["POLYMARKET_PRIVATE_KEY"] ?? "").trim();
    let address = "unknown";
    if (pk) {
      const hasSpaces = pk.includes(" ");
      if (hasSpaces) {
        const hexMatch = pk.match(/[0-9a-fA-F]{64}/);
        if (hexMatch) pk = `0x${hexMatch[0]}`;
        else {
          const acct = mnemonicToAccount(pk);
          address = acct.address;
          pk = "";
        }
      }
      if (pk) {
        if (!/^(0x)?[0-9a-fA-F]{64}$/.test(pk)) {
          pk = `0x${Buffer.from(pk, "base64").toString("hex")}`;
        } else if (!pk.startsWith("0x")) {
          pk = `0x${pk}`;
        }
        const acct = privateKeyToAccount(pk as `0x${string}`);
        address = acct.address;
      }
    }
    results.wallet = { address };

    // MATIC via Polygon RPC
    const rpcRes = await fetch("https://polygon-rpc.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getBalance", params: [address, "latest"], id: 1 }),
      signal: AbortSignal.timeout(8000),
    });
    const rpcData = await rpcRes.json() as { result?: string };
    const maticWei = rpcData.result ? BigInt(rpcData.result) : 0n;
    const matic = Number(maticWei) / 1e18;
    (results.wallet as Record<string, unknown>).maticBalance = matic.toFixed(6);
    (results.wallet as Record<string, unknown>).maticOk = matic >= 0.01;
  } catch (err: any) {
    results.wallet = { error: err?.message ?? String(err) };
  }

  // 3. pUSD balance + allowance (proves API auth works)
  try {
    const balance = await checkPolymarketBalance();
    results.polymarketBalance = {
      pUSD: balance,
      ok: balance > 0,
      note: balance === 0 ? "Either zero balance or auth failed — check logs" : "Auth confirmed ✅",
    };
  } catch (err: any) {
    results.polymarketBalance = { error: err?.message ?? String(err) };
  }

  // 4. Time sync vs NTP
  try {
    const ntpRes = await fetch("https://worldtimeapi.org/api/timezone/UTC", {
      signal: AbortSignal.timeout(5000),
    });
    const ntpData = await ntpRes.json() as { unixtime?: number };
    const ntpEpoch = ntpData.unixtime ?? 0;
    const localEpoch = Math.floor(Date.now() / 1000);
    const skewMs = Math.abs(ntpEpoch - localEpoch) * 1000;
    results.timeSync = { skewMs, ok: skewMs < 100, ntpEpoch, localEpoch };
  } catch (err: any) {
    results.timeSync = { error: err?.message ?? String(err) };
  }

  // 5. Test order — place a tiny GTC limit at penny price, cancel immediately
  const testOrderEnabled = true;
  if (testOrderEnabled && creds) {
    try {
      // Find a tracked market with a condition_id
      const [market] = await db
        .select()
        .from(marketsTable)
        .where(eq(marketsTable.isTracked, true))
        .limit(1);

      if (!market?.conditionId) {
        results.testOrder = { skipped: true, reason: "No tracked market with conditionId found" };
      } else {
        // Fetch token IDs for this condition
        const mktRes = await fetch(`https://clob.polymarket.com/markets/${market.conditionId}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!mktRes.ok) {
          results.testOrder = { skipped: true, reason: `Market fetch ${mktRes.status}` };
        } else {
          const mktData = await mktRes.json() as { tokens?: Array<{ token_id: string; outcome: string }> };
          const yesToken = mktData.tokens?.find(t => t.outcome === "Yes")?.token_id
            ?? mktData.tokens?.[0]?.token_id;

          if (!yesToken) {
            results.testOrder = { skipped: true, reason: "No token_id in market response" };
          } else {
            // Place a $0.01 BUY limit at $0.01 (way below market — won't fill)
            const order = await placeLimitOrder(creds, yesToken, "BUY", 0.01, 1);
            if (!order.success) {
              results.testOrder = { success: false, error: order.error };
            } else {
              // Cancel immediately
              const cancelled = await cancelOrder(creds, order.orderId!);
              results.testOrder = {
                success: true,
                orderId: order.orderId,
                cancelled,
                note: "Placed and cancelled test order ✅",
              };
            }
          }
        }
      }
    } catch (err: any) {
      results.testOrder = { error: err?.message ?? String(err) };
    }
  } else if (!creds) {
    results.testOrder = { skipped: true, reason: "No credentials" };
  }

  const allOk =
    (results.credentials as any)?.allSet &&
    (results.wallet as any)?.maticOk &&
    (results.timeSync as any)?.ok;

  res.json({ allOk, ...results });
});

export default router;
