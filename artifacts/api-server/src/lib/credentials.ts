import { db, botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";
import type { GetCredentialsStatusResponseType } from "@workspace/api-zod";

const SENTINEL = "••••••••";

type DbConfig = typeof botConfigTable.$inferSelect;

async function getConfig(userId: string): Promise<DbConfig | null> {
  try {
    const [config] = await db
      .select()
      .from(botConfigTable)
      .where(eq(botConfigTable.id, userId));
    return config ?? null;
  } catch {
    return null;
  }
}

export async function seedCredentialsFromEnv(userId: string): Promise<void> {
  try {
    const [config] = await db
      .select()
      .from(botConfigTable)
      .where(eq(botConfigTable.id, userId));

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
      .where(eq(botConfigTable.id, userId));

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

export async function resolvePolymarketCredentials(userId: string): Promise<PolymarketCredentials | null> {
  const config = await getConfig(userId);

  const privateKey = process.env.POLYMARKET_PRIVATE_KEY ?? config?.polymarketPrivateKey;
  const apiKey = process.env.POLYMARKET_API_KEY ?? config?.polymarketApiKey;
  const apiSecret = process.env.POLYMARKET_API_SECRET ?? config?.polymarketApiSecret;
  const apiPassphrase = process.env.POLYMARKET_API_PASSPHRASE ?? config?.polymarketApiPassphrase;

  if (!privateKey || !apiKey || !apiSecret || !apiPassphrase) return null;

  return { privateKey, apiKey, apiSecret, apiPassphrase };
}

export async function getCredentialsStatus(userId: string): Promise<GetCredentialsStatusResponseType> {
  const config = await getConfig(userId);

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

  const tgEnv = !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  const tgDb = !!(config?.telegramBotToken && config?.telegramChatId);
  const telegram = tgEnv
    ? { configured: true, source: "env" as const }
    : tgDb
    ? { configured: true, source: "db" as const }
    : { configured: false, source: "none" as const };

  const saEnv = !!process.env.SPORTS_API_KEY;
  const saDb = !!config?.sportsApiKey;
  const sportsApi = saEnv
    ? { configured: true, source: "env" as const }
    : saDb
    ? { configured: true, source: "db" as const }
    : { configured: false, source: "none" as const };

  const waEnv = !!process.env.WEATHER_API_KEY;
  const waDb = !!config?.weatherApiKey;
  const weatherApi = waEnv
    ? { configured: true, source: "env" as const }
    : waDb
    ? { configured: true, source: "db" as const }
    : { configured: false, source: "none" as const };

  return { polymarket, telegram, sportsApi, weatherApi };
}

export async function resolveTelegramCredentials(userId: string): Promise<TelegramCredentials | null> {
  const envBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const envChatId = process.env.TELEGRAM_CHAT_ID;

  if (envBotToken && envChatId) {
    return { botToken: envBotToken, chatId: envChatId };
  }

  const config = await getConfig(userId);
  if (!config) return null;

  const botToken = envBotToken ?? config.telegramBotToken;
  const chatId = envChatId ?? config.telegramChatId;

  if (!botToken || !chatId) return null;

  return { botToken, chatId };
}
