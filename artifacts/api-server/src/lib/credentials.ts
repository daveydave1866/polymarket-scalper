import { db, botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";
import type { GetCredentialsStatusResponseType } from "@workspace/api-zod";

const SENTINEL = "••••••••";

type DbConfig = typeof botConfigTable.$inferSelect;

async function getConfig(): Promise<DbConfig | null> {
  try {
    const [config] = await db
      .select()
      .from(botConfigTable)
      .where(eq(botConfigTable.id, "singleton"));
    return config ?? null;
  } catch {
    return null;
  }
}

export async function seedCredentialsFromEnv(): Promise<void> {
  try {
    const [config] = await db
      .select()
      .from(botConfigTable)
      .where(eq(botConfigTable.id, "singleton"));

    if (!config) return;

    const updates: Partial<typeof botConfigTable.$inferInsert> = {};

    if (process.env.POLYMARKET_PRIVATE_KEY && !config.polymarketPrivateKey)
      updates.polymarketPrivateKey = SENTINEL;
    if (process.env.POLYMARKET_API_KEY && !config.polymarketApiKey)
      updates.polymarketApiKey = SENTINEL;
    if (process.env.POLYMARKET_API_SECRET && !config.polymarketApiSecret)
      updates.polymarketApiSecret = SENTINEL;
    if (process.env.POLYMARKET_API_PASSPHRASE && !config.polymarketApiPassphrase)
      updates.polymarketApiPassphrase = SENTINEL;
    if (process.env.TELEGRAM_BOT_TOKEN && !config.telegramBotToken)
      updates.telegramBotToken = SENTINEL;
    if (process.env.TELEGRAM_CHAT_ID && !config.telegramChatId)
      updates.telegramChatId = SENTINEL;
    if (process.env.SPORTS_API_KEY && !config.sportsApiKey)
      updates.sportsApiKey = SENTINEL;
    if (process.env.WEATHER_API_KEY && !config.weatherApiKey)
      updates.weatherApiKey = SENTINEL;

    if (Object.keys(updates).length === 0) return;

    await db
      .update(botConfigTable)
      .set(updates)
      .where(eq(botConfigTable.id, "singleton"));

    logger.info(
      { fields: Object.keys(updates) },
      "Seeded masked sentinels for env-var credentials"
    );
  } catch (err) {
    logger.warn({ err }, "Could not seed credentials from env vars");
  }
}

export interface PolymarketCredentials {
  privateKey: string;
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
}

export interface TelegramCredentials {
  botToken: string;
  chatId: string;
}

export async function resolvePolymarketCredentials(): Promise<PolymarketCredentials | null> {
  const envPrivateKey = process.env.POLYMARKET_PRIVATE_KEY;
  const envApiKey = process.env.POLYMARKET_API_KEY;
  const envApiSecret = process.env.POLYMARKET_API_SECRET;
  const envApiPassphrase = process.env.POLYMARKET_API_PASSPHRASE;

  if (envPrivateKey && envApiKey && envApiSecret && envApiPassphrase) {
    logger.debug("Polymarket credentials resolved from environment variables");
    return {
      privateKey: envPrivateKey,
      apiKey: envApiKey,
      apiSecret: envApiSecret,
      apiPassphrase: envApiPassphrase,
    };
  }

  const config = await getConfig();
  if (!config) return null;

  const privateKey = envPrivateKey ?? config.polymarketPrivateKey;
  const apiKey = envApiKey ?? config.polymarketApiKey;
  const apiSecret = envApiSecret ?? config.polymarketApiSecret;
  const apiPassphrase = envApiPassphrase ?? config.polymarketApiPassphrase;

  if (!privateKey || !apiKey || !apiSecret || !apiPassphrase) return null;

  logger.debug("Polymarket credentials resolved from DB config (with optional env override)");
  return { privateKey, apiKey, apiSecret, apiPassphrase };
}

export async function getCredentialsStatus(): Promise<GetCredentialsStatusResponseType> {
  const config = await getConfig();

  // ── Polymarket ──────────────────────────────────────────────────────────────
  const pmEnv = !!(
    process.env.POLYMARKET_PRIVATE_KEY &&
    process.env.POLYMARKET_API_KEY &&
    process.env.POLYMARKET_API_SECRET &&
    process.env.POLYMARKET_API_PASSPHRASE
  );
  const pmDb = !!(
    config?.polymarketPrivateKey &&
    config?.polymarketApiKey &&
    config?.polymarketApiSecret &&
    config?.polymarketApiPassphrase
  );
  const polymarket = pmEnv
    ? { configured: true, source: "env" as const }
    : pmDb
    ? { configured: true, source: "db" as const }
    : { configured: false, source: "none" as const };

  // ── Telegram ────────────────────────────────────────────────────────────────
  const tgEnv = !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  const tgDb = !!(config?.telegramBotToken && config?.telegramChatId);
  const telegram = tgEnv
    ? { configured: true, source: "env" as const }
    : tgDb
    ? { configured: true, source: "db" as const }
    : { configured: false, source: "none" as const };

  // ── Sports API ──────────────────────────────────────────────────────────────
  const saEnv = !!process.env.SPORTS_API_KEY;
  const saDb = !!config?.sportsApiKey;
  const sportsApi = saEnv
    ? { configured: true, source: "env" as const }
    : saDb
    ? { configured: true, source: "db" as const }
    : { configured: false, source: "none" as const };

  // ── Weather API ─────────────────────────────────────────────────────────────
  const waEnv = !!process.env.WEATHER_API_KEY;
  const waDb = !!config?.weatherApiKey;
  const weatherApi = waEnv
    ? { configured: true, source: "env" as const }
    : waDb
    ? { configured: true, source: "db" as const }
    : { configured: false, source: "none" as const };

  return { polymarket, telegram, sportsApi, weatherApi };
}

export async function resolveTelegramCredentials(): Promise<TelegramCredentials | null> {
  const envBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const envChatId = process.env.TELEGRAM_CHAT_ID;

  if (envBotToken && envChatId) {
    logger.debug("Telegram credentials resolved from environment variables");
    return { botToken: envBotToken, chatId: envChatId };
  }

  const config = await getConfig();
  if (!config) return null;

  const botToken = envBotToken ?? config.telegramBotToken;
  const chatId = envChatId ?? config.telegramChatId;

  if (!botToken || !chatId) return null;

  logger.debug("Telegram credentials resolved from DB config (with optional env override)");
  return { botToken, chatId };
}
