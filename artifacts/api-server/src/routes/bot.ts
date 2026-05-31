import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, botConfigTable, signalsTable, positionsTable, marketsTable } from "@workspace/db";
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
import { logger } from "../lib/logger.js";
import { runDiscovery, lastDiscoveryAt } from "../lib/engine.js";
import { sendDailyReport } from "../lib/telegram.js";
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
      })
    );
  } catch (err) {
    logger.error({ err }, "GET /bot/status failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/bot/start", async (_req, res): Promise<void> => {
  try {
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
  } catch (err) {
    logger.error({ err }, "POST /bot/start failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/bot/stop", async (_req, res): Promise<void> => {
  try {
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
        sportsApiKey: config.sportsApiKey ? "••••••••" : undefined,
        weatherApiKey: config.weatherApiKey ? "••••••••" : undefined,
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
      if (safeRest[field] === SENTINEL || safeRest[field] === "") {
        delete safeRest[field];
      }
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
        sportsApiKey: updated.sportsApiKey ? "••••••••" : undefined,
        weatherApiKey: updated.weatherApiKey ? "••••••••" : undefined,
      })
    );
  } catch (err) {
    logger.error({ err }, "PUT /bot/config failed");
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
  const { privateKey } = req.body as { privateKey?: string };
  if (!privateKey) {
    res.status(400).json({ error: "privateKey is required" });
    return;
  }
  try {
    let pk = privateKey.trim();
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
