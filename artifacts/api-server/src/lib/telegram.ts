import { db, botConfigTable, positionsTable, signalsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";
import { resolveTelegramCredentials } from "./credentials.js";

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
  const creds = await resolveTelegramCredentials();
  if (!creds) {
    throw new Error("Telegram not configured");
  }

  const [config] = await db.select().from(botConfigTable).where(eq(botConfigTable.id, "singleton"));
  const positions = await db.select().from(positionsTable);
  const signals = await db.select().from(signalsTable);

  const openPositions = positions.filter((p) => p.status === "open");
  const closedPositions = positions.filter((p) => p.status === "closed");
  const totalPnl = closedPositions.reduce((acc, p) => acc + (p.pnl ?? 0), 0);

  const report = [
    `*📊 Polymarket Bot — Daily Report*`,
    ``,
    `Mode: \`${config?.mode ?? "unknown"}\``,
    `Running: \`${config?.running ? "Yes" : "No"}\``,
    ``,
    `*Signals generated:* ${signals.length}`,
    `*Trades executed:* ${positions.length}`,
    `*Open positions:* ${openPositions.length}`,
    `*Closed positions:* ${closedPositions.length}`,
    `*Total P&L:* \`${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)} USDC\``,
    ``,
    `_Generated at ${new Date().toUTCString()}_`,
  ].join("\n");

  await sendMessage(creds.botToken, creds.chatId, report);
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
  const creds = await resolveTelegramCredentials();
  if (!creds) return;

  const emoji = action === "opened" ? "🟢" : pnl && pnl >= 0 ? "✅" : "🔴";
  const msg = [
    `${emoji} *Trade ${action.toUpperCase()}*`,
    `Market: ${market}`,
    `Side: \`${side.toUpperCase()}\`  |  Size: \`$${size}\`  |  Price: \`${(price * 100).toFixed(1)}¢\``,
    ...(pnl !== undefined ? [`P&L: \`${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDC\``] : []),
  ].join("\n");

  try {
    await sendMessage(creds.botToken, creds.chatId, msg);
  } catch (err) {
    logger.error({ err }, "Failed to send trade notification");
  }
}

export async function notifySignal(
  market: string,
  side: string,
  edge: number,
  confidence: number
) {
  const creds = await resolveTelegramCredentials();
  if (!creds) return;

  const msg = [
    `📡 *Signal Fired*`,
    `Market: ${market}`,
    `Side: \`${side.toUpperCase()}\`  |  Edge: \`${(edge * 100).toFixed(1)}%\`  |  Confidence: \`${(confidence * 100).toFixed(0)}%\``,
  ].join("\n");

  try {
    await sendMessage(creds.botToken, creds.chatId, msg);
  } catch (err) {
    logger.error({ err }, "Failed to send signal notification");
  }
}

export async function notifyBotEvent(event: "started" | "stopped", mode?: string) {
  const creds = await resolveTelegramCredentials();
  if (!creds) return;

  const msg =
    event === "started"
      ? `🟢 *Bot started* (\`${mode ?? "unknown"}\` mode)`
      : `⏹ *Bot stopped*`;

  try {
    await sendMessage(creds.botToken, creds.chatId, msg);
  } catch (err) {
    logger.error({ err }, "Failed to send bot event notification");
  }
}

export async function notifyError(message: string, detail?: string) {
  const creds = await resolveTelegramCredentials();
  if (!creds) return;

  const msg = [
    `🚨 *Bot Error*`,
    message,
    ...(detail ? [`\`\`\`\n${detail.slice(0, 500)}\n\`\`\``] : []),
  ].join("\n");

  try {
    await sendMessage(creds.botToken, creds.chatId, msg);
  } catch (err) {
    logger.error({ err }, "Failed to send error notification");
  }
}
