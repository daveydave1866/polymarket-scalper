import { Router, type IRouter } from "express";
import { db, usersTable, botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

function getJwtSecret(): string {
  return process.env.JWT_SECRET ?? process.env.BOT_API_KEY ?? "polymarket-scalper-secret";
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username.trim().toLowerCase()));
    if (!user) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      getJwtSecret(),
      { expiresIn: "30d" },
    );

    logger.info({ username: user.username, role: user.role }, "User logged in");
    res.json({ token, userId: user.id, username: user.username, role: user.role });
  } catch (err) {
    logger.error({ err }, "Login failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/register", async (req, res): Promise<void> => {
  const { username, password, role } = req.body as { username?: string; password?: string; role?: string };

  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const cleanUsername = username.trim().toLowerCase();

  try {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.username, cleanUsername));
    if (existing) {
      res.status(409).json({ error: "Username already taken" });
      return;
    }

    const allUsers = await db.select({ id: usersTable.id }).from(usersTable);
    const isFirstUser = allUsers.length === 0;
    const assignedRole = isFirstUser ? "admin" : "user";

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = randomUUID();

    const [newUser] = await db.insert(usersTable).values({
      id: userId,
      username: cleanUsername,
      passwordHash,
      role: assignedRole,
    }).returning();

    await db.insert(botConfigTable).values({
      id: userId,
      userId,
      mode: "paper",
      minEdge: 0.05,
      maxPositionSize: 50,
      maxOpenPositions: 5,
      signalWindowSeconds: 300,
      enabledCategories: "sports,crypto,weather",
      running: false,
      paperBalance: 1000,
    });

    const token = jwt.sign(
      { userId: newUser.id, username: newUser.username, role: newUser.role },
      getJwtSecret(),
      { expiresIn: "30d" },
    );

    logger.info({ username: cleanUsername, role: assignedRole }, "New user registered");
    res.status(201).json({ token, userId: newUser.id, username: newUser.username, role: newUser.role });
  } catch (err) {
    logger.error({ err }, "Registration failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/verify", async (req, res): Promise<void> => {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    res.json({ ok: false });
    return;
  }
  try {
    jwt.verify(token, getJwtSecret());
    res.json({ ok: true });
  } catch {
    res.json({ ok: false });
  }
});

export default router;
export { getJwtSecret };
