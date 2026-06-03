import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, botConfigTable, signalsTable, positionsTable, marketsTable, balanceSnapshotsTable } from "@workspace/db";
import {
  GetBotStatusResponse,
  StartBotBody,
  StartBotResponse,
  StopBotResponse,
  GetBotConfigResponse,
  UpdateBotConfigBody,
  UpdateBotConfigResponse,
  SyncMarketsResponse,
  GetOpportunitiesResponse,
  TestCredentialsResponse,
  GetBalanceHistoryResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger.js";
import { runDiscovery, lastDiscoveryAt, startTradingLoop, stopTradingLoop, lastCycleAt, CYCLE_INTERVAL_MS } from "../lib/engine.js";
import { sendDailyReport, notifyBotEvent } from "../lib/telegram.js";
import { getCredentialsStatus, resolvePolymarketCredentials } from "../lib/credentials.js";
import { GetCredentialsStatusResponse } from "@workspace/api-zod";
import { ethers } from "ethers";

const router: IRouter = Router();

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
      paperBalance: 1000,
    })
    .returning();

  return created;
}

router.get("/bot/status", async (_req, res): Promise<void> => {
  try {
    const config = await getOrCreateConfig();
    const signals = await db.select().from(signalsTable);
    const positions = await db.select().from(positionsTable);

    const uptime =
      config.running && config.startedAt
        ? Math.floor((Date.now() - new Date(config.startedAt).getTime()) / 1000)
        : 0;

    const nextCycleAt =
      config.running && lastCycleAt
        ? new Date(lastCycleAt.getTime() + CYCLE_INTERVAL_MS).toISOString()
        : undefined;

    res.json(
      GetBotStatusResponse.parse({
        running: config.running,
        mode: config.running ? config.mode : "paused",
        uptime,
        signalsGenerated: signals.length,
        tradesExecuted: positions.length,
        lastSignalAt: signals.length > 0 ? signals[signals.length - 1].createdAt?.toISOString() : undefined,
        lastTradeAt: positions.length > 0 ? positions[positions.length - 1].openedAt?.toISOString() : undefined,
        feedsActive: config.running ? 3 : 0,
        marketsTracked: 8,
        paperBalance: config.mode === "paper" ? (config.paperBalance ?? 1000) : undefined,
        paperStartingBalance: config.mode === "paper" ? 1000 : undefined,
        nextCycleAt,
      })
    );
  } catch (err) {
    logger.error({ err }, "GET /bot/status failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/bot/start", async (req, res): Promise<void> => {
  try {
    const parsed = StartBotBody.safeParse(req.body ?? {});
    const resetPaperBalance = parsed.success ? (parsed.data.resetPaperBalance ?? false) : false;

    const now = new Date();
    const updateFields: Partial<typeof botConfigTable.$inferInsert> = {
      running: true,
      startedAt: now.toISOString(),
    };

    if (resetPaperBalance) {
      const [cfg] = await db.select().from(botConfigTable).where(eq(botConfigTable.id, "singleton"));
      if (!cfg || cfg.mode === "paper") {
        updateFields.paperBalance = 1000;
      }
    }

    await db
      .update(botConfigTable)
      .set(updateFields)
      .where(eq(botConfigTable.id, "singleton"));

    startTradingLoop();
    logger.info({ resetPaperBalance }, "Bot started");

    const config = await getOrCreateConfig();
    notifyBotEvent("started", config.mode).catch(() => {});
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
  } catch (err) {
    logger.error({ err }, "POST /bot/start failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/bot/stop", async (_req, res): Promise<void> => {
  try {
    const [configBefore] = await db
      .select()
      .from(botConfigTable)
      .where(eq(botConfigTable.id, "singleton"));

    const startedAt = configBefore?.startedAt ? new Date(configBefore.startedAt) : null;
    const uptimeSeconds = startedAt
      ? Math.floor((Date.now() - startedAt.getTime()) / 1000)
      : undefined;

    await db
      .update(botConfigTable)
      .set({ running: false, startedAt: null })
      .where(eq(botConfigTable.id, "singleton"));

    stopTradingLoop();
    logger.info("Bot stopped");

    const allPositions = await db.select().from(positionsTable);
    const sessionTrades = startedAt
      ? allPositions.filter((p) => p.openedAt && new Date(p.openedAt) >= startedAt).length
      : allPositions.length;

    notifyBotEvent("stopped", undefined, uptimeSeconds, sessionTrades).catch(() => {});

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
  } catch (err) {
    logger.error({ err }, "POST /bot/stop failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/bot/sync-markets", async (req, res): Promise<void> => {
  try {
    const result = await runDiscovery();
    res.json(SyncMarketsResponse.parse(result));
  } catch (err) {
    logger.error({ err }, "Sync markets failed");
    res.status(500).json({ error: "Market sync failed" });
  }
});

router.get("/bot/opportunities", async (_req, res): Promise<void> => {
  try {
    const markets = await db
      .select()
      .from(marketsTable)
      .where(eq(marketsTable.isTracked, true))
      .orderBy(desc(marketsTable.liquidity));

    const opportunities = markets
      .map((m) => {
        const priceSkew = Math.abs(m.yesPrice - 0.5);
        const liquidityScore = Math.log10(Math.max(m.liquidity, 1));
        const skewBonus = 1 - priceSkew * 2;
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
          skipReason: m.skipReason ?? undefined,
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
  } catch (err) {
    logger.error({ err }, "GET /bot/opportunities failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/bot/config", async (_req, res): Promise<void> => {
  try {
    const config = await getOrCreateConfig();

    res.json(
      GetBotConfigResponse.parse({
        mode: config.mode as "live" | "paper",
        minEdge: config.minEdge,
        maxPositionSize: config.maxPositionSize,
        maxOpenPositions: config.maxOpenPositions,
        signalWindowSeconds: config.signalWindowSeconds,
        enabledCategories: config.enabledCategories.split(","),
        paperBalance: config.paperBalance ?? undefined,
        polymarketPrivateKey: config.polymarketPrivateKey ? "••••••••" : undefined,
        polymarketApiKey: config.polymarketApiKey ? "••••••••" : undefined,
        polymarketApiSecret: config.polymarketApiSecret ? "••••••••" : undefined,
        polymarketApiPassphrase: config.polymarketApiPassphrase ? "••••••••" : undefined,
        telegramBotToken: config.telegramBotToken ? "••••••••" : undefined,
        telegramChatId: config.telegramChatId ?? undefined,
        dailyReportHour: config.dailyReportHour ?? 8,
        sportsApiKey: config.sportsApiKey ? "••••••••" : undefined,
        weatherApiKey: config.weatherApiKey ? "••••••••" : undefined,
        notifyMinEdge: config.notifyMinEdge ?? 0.10,
        notifyMaxPerCycle: config.notifyMaxPerCycle ?? 5,
        partialFillThreshold: config.partialFillThreshold ?? 0.5,
        priceMin: config.priceMin ?? 0.05,
        priceMax: config.priceMax ?? 0.95,
        minTtrHours: config.minTtrHours ?? 24,
      })
    );
  } catch (err) {
    logger.error({ err }, "GET /bot/config failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/bot/config", async (req, res): Promise<void> => {
  try {
    const parsed = UpdateBotConfigBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { enabledCategories, ...rest } = parsed.data;
    const SENTINEL = "••••••••";
    const secretFields = [
      "polymarketPrivateKey", "polymarketApiKey", "polymarketApiSecret",
      "polymarketApiPassphrase", "telegramBotToken", "sportsApiKey", "weatherApiKey",
    ] as const;

    const safeRest = { ...rest } as Record<string, unknown>;
    for (const field of secretFields) {
      if (safeRest[field] === SENTINEL || safeRest[field] === undefined) {
        delete safeRest[field]; // unchanged — keep existing DB value
      } else if (safeRest[field] === "") {
        safeRest[field] = null; // user explicitly cleared — write NULL to remove
      }
      // else: non-empty string → save as new credential value
    }

    const [updated] = await db
      .update(botConfigTable)
      .set({
        ...(safeRest as unknown as Partial<typeof botConfigTable.$inferInsert>),
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
        paperBalance: updated.paperBalance ?? undefined,
        polymarketPrivateKey: updated.polymarketPrivateKey ? "••••••••" : undefined,
        polymarketApiKey: updated.polymarketApiKey ? "••••••••" : undefined,
        polymarketApiSecret: updated.polymarketApiSecret ? "••••••••" : undefined,
        polymarketApiPassphrase: updated.polymarketApiPassphrase ? "••••••••" : undefined,
        telegramBotToken: updated.telegramBotToken ? "••••••••" : undefined,
        telegramChatId: updated.telegramChatId ?? undefined,
        dailyReportHour: updated.dailyReportHour ?? 8,
        sportsApiKey: updated.sportsApiKey ? "••••••••" : undefined,
        weatherApiKey: updated.weatherApiKey ? "••••••••" : undefined,
        notifyMinEdge: updated.notifyMinEdge ?? 0.10,
        notifyMaxPerCycle: updated.notifyMaxPerCycle ?? 5,
        partialFillThreshold: updated.partialFillThreshold ?? 0.5,
        priceMin: updated.priceMin ?? 0.05,
        priceMax: updated.priceMax ?? 0.95,
        minTtrHours: updated.minTtrHours ?? 24,
      })
    );
  } catch (err) {
    logger.error({ err }, "PUT /bot/config failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/bot/credentials-status", async (_req, res): Promise<void> => {
  try {
    const status = await getCredentialsStatus();
    res.json(GetCredentialsStatusResponse.parse(status));
  } catch (err) {
    logger.error({ err }, "GET /bot/credentials-status failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/bot/test-credentials", async (_req, res): Promise<void> => {
  try {
    const creds = await resolvePolymarketCredentials();
    if (!creds) {
      res.json(TestCredentialsResponse.parse({ ok: false, error: "No Polymarket credentials configured." }));
      return;
    }

    let pk = creds.privateKey.trim();
    if (!pk.startsWith("0x")) pk = `0x${pk}`;

    const { ClobClient } = await import("@polymarket/clob-client");
    const wallet = new ethers.Wallet(pk);
    const client = new ClobClient(
      "https://clob.polymarket.com",
      137,
      wallet as never,
      { key: creds.apiKey, secret: creds.apiSecret, passphrase: creds.apiPassphrase }
    );

    await client.getApiKeys();

    logger.info({ address: wallet.address }, "Credential validation succeeded");
    res.json(TestCredentialsResponse.parse({ ok: true }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message }, "Credential validation failed");
    res.json(TestCredentialsResponse.parse({ ok: false, error: message }));
  }
});

router.get("/bot/balance-history", async (_req, res): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(balanceSnapshotsTable)
      .orderBy(desc(balanceSnapshotsTable.recordedAt))
      .limit(100);

    const snapshots = rows
      .reverse()
      .map((r) => ({ balance: r.balance, recordedAt: r.recordedAt.toISOString() }));

    res.json(GetBalanceHistoryResponse.parse({ snapshots }));
  } catch (err) {
    logger.error({ err }, "GET /bot/balance-history failed");
    res.status(500).json({ error: "Internal server error" });
  }
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

router.post("/bot/verify-l1-key", async (req, res): Promise<void> => {
  const { privateKey } = req.body as { privateKey?: string };
  if (!privateKey) {
    res.status(400).json({ error: "privateKey is required" });
    return;
  }
  try {
    let pk = privateKey.trim();
    if (!pk.startsWith("0x")) pk = `0x${pk}`;
    const wallet = new ethers.Wallet(pk);
    res.json({ ok: true, address: wallet.address });
  } catch {
    res.status(400).json({ ok: false, error: "Invalid private key." });
  }
});

router.post("/bot/generate-l2-keys", async (req, res): Promise<void> => {
  const { privateKey: bodyKey } = req.body as { privateKey?: string };
  try {
    let pk = bodyKey?.trim() ?? "";
    if (!pk) {
      const [config] = await db.select().from(botConfigTable).where(eq(botConfigTable.id, "singleton"));
      const stored = process.env.POLYMARKET_PRIVATE_KEY ?? config?.polymarketPrivateKey ?? "";
      if (!stored || stored === "••••••••") {
        res.status(400).json({ ok: false, error: "No L1 private key found. Please save your L1 wallet key first." });
        return;
      }
      pk = stored;
    }
    if (!pk.startsWith("0x")) pk = `0x${pk}`;
    const { ClobClient } = await import("@polymarket/clob-client");
    const wallet = new ethers.Wallet(pk);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = new ClobClient("https://clob.polymarket.com", 137, wallet as any);
    const creds = await client.createOrDeriveApiKey();
    logger.info({ address: wallet.address }, "L2 API credentials generated");
    res.json({
      ok: true,
      address: wallet.address,
      apiKey: creds.key,
      apiSecret: creds.secret,
      apiPassphrase: creds.passphrase,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, "L2 key generation failed");
    res.status(500).json({ ok: false, error: message ?? "Failed to generate L2 credentials." });
  }
});

export default router;
