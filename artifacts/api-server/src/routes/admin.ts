import { Router, type IRouter } from "express";
import { db, usersTable, botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger.js";
import { stopTradingLoop } from "../lib/engine.js";

const router: IRouter = Router();

router.use((req, res, next) => {
  if ((req as { role?: string }).role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
});

router.get("/admin/users", async (_req, res): Promise<void> => {
  try {
    const users = await db
      .select({ id: usersTable.id, username: usersTable.username, role: usersTable.role, createdAt: usersTable.createdAt })
      .from(usersTable)
      .orderBy(usersTable.createdAt);
    res.json({ users });
  } catch (err) {
    logger.error({ err }, "GET /admin/users failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/users", async (req, res): Promise<void> => {
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

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = randomUUID();
    const assignedRole = role === "admin" ? "admin" : "user";

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

    logger.info({ username: cleanUsername, role: assignedRole }, "Admin created new user");
    res.status(201).json({
      user: { id: newUser.id, username: newUser.username, role: newUser.role, createdAt: newUser.createdAt },
    });
  } catch (err) {
    logger.error({ err }, "POST /admin/users failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/users/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const requesterId = (req as { userId?: string }).userId;

  if (id === requesterId) {
    res.status(400).json({ error: "Cannot delete your own account" });
    return;
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    stopTradingLoop(id);
    await db.delete(botConfigTable).where(eq(botConfigTable.id, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));

    logger.info({ deletedUserId: id, username: user.username }, "Admin deleted user");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "DELETE /admin/users/:id failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/admin/users/:id/password", async (req, res): Promise<void> => {
  const { id } = req.params;
  const { password } = req.body as { password?: string };

  if (!password || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, id));
    logger.info({ userId: id }, "Admin reset user password");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "PUT /admin/users/:id/password failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
