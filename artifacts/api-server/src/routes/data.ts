import { Router, type IRouter, type Request } from "express";
import { db, signalsTable, positionsTable, marketsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router: IRouter = Router();

interface AuthRequest extends Request {
  userId?: string;
}

router.get("/signals", async (req: AuthRequest, res): Promise<void> => {
  try {
    const userId = req.userId!;
    const signals = await db.select().from(signalsTable).where(eq(signalsTable.userId, userId));
    res.json(signals);
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/positions", async (req: AuthRequest, res): Promise<void> => {
  try {
    const userId = req.userId!;
    const positions = await db.select().from(positionsTable).where(eq(positionsTable.userId, userId));

    const marketIds = [...new Set(positions.map((p) => p.marketId))];
    const questionMap = new Map<string, string>();

    for (const mid of marketIds) {
      try {
        const [market] = await db
          .select({ question: marketsTable.question })
          .from(marketsTable)
          .where(eq(marketsTable.id, mid));
        if (market) questionMap.set(mid, market.question);
      } catch {
        // leave undefined
      }
    }

    const enriched = positions.map((p) => ({
      ...p,
      question: questionMap.get(p.marketId),
    }));

    res.json(enriched);
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
