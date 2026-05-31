import { db, botConfigTable, positionsTable, signalsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

async function sendMessage(token: string, chatId: string, text: string) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram API error: ${err}`);
  }
}

export async function sendDailyReport() {
  const [config] = await db.select().from(botConfigTable).where(eq(botConfigTable.id, "singleton"));
  if (!config?.telegramBotToken || !config?.telegramChatId) {
    throw new Error("Telegram not configured");
  }

  const positions = await db.select().from(positionsTable);
  const signals = await db.select().from(signalsTable);

  const openPositions = positions.filter((p) => p.status === "open");
  const closedPositions = positions.filter((p) => p.status === "closed");
  const totalPnl = closedPositions.reduce((acc, p) => acc + (p.pnl ?? 0), 0);

  const report = [
    `*📊 Polymarket Bot — Daily Report*`,
    ``,
    `Mode: \`${config.mode}\``,
    `Running: \`${config.running ? "Yes" : "No"}\``,
    ``,
    `*Signals generated:* ${signals.length}`,
    `*Trades executed:* ${positions.length}`,
    `*Open positions:* ${openPositions.length}`,
    `*Closed positions:* ${closedPositions.length}`,
    `*Total P&L:* \`${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)} USDC\``,
    ``,
    `_Generated at ${new Date().toUTCString()}_`,
  ].join("\n");

  await sendMessage(config.telegramBotToken, config.telegramChatId, report);
  logger.info("Daily report sent via Telegram");
}

export async function notifyTrade(
  action: "opened" | "closed",
  market: string,
  side: string,
  size: number,
  price: number,
  pnl?: number
) {
  const [config] = await db.select().from(botConfigTable).where(eq(botConfigTable.id, "singleton"));
  if (!config?.telegramBotToken || !config?.telegramChatId) return;

  const emoji = action === "opened" ? "🟢" : pnl && pnl >= 0 ? "✅" : "🔴";
  const msg = [
    `${emoji} *Trade ${action.toUpperCase()}*`,
    `Market: ${market}`,
    `Side: \`${side.toUpperCase()}\`  |  Size: \`$${size}\`  |  Price: \`${(price * 100).toFixed(1)}¢\``,
    ...(pnl !== undefined ? [`P&L: \`${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDC\``] : []),
  ].join("\n");

  try {
    await sendMessage(config.telegramBotToken, config.telegramChatId, msg);
  } catch (err) {
    logger.error({ err }, "Failed to send trade notification");
  }
}
