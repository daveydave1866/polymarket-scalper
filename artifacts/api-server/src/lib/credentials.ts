import { db, botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";
import type { GetCredentialsStatusResponseType } from "@workspace/api-zod";

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
