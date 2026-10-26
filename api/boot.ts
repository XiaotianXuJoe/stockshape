import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { syncAllStocks } from "./lib/stockData";
import { getDb } from "./queries/connection";
import { stocks } from "@db/schema";
import { sql } from "drizzle-orm";
import { startScheduler } from "./lib/scheduler";
import { syncIndustryAndConcept, countMissingIndustry } from "./lib/industrySync";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.use("/api/trpc/*", async (c) => {
  const req = c.req.raw;
  // tRPC v11 requires lowercase "content-type" header
  const ctValue = req.headers.get("content-type") || req.headers.get("Content-Type");
  if (ctValue && !req.headers.get("content-type")) {
    const headers = new Headers(req.headers);
    headers.set("content-type", ctValue);
    const newReq = new Request(req.url, {
      method: req.method,
      headers,
      body: req.body,
      duplex: "half",
    } as RequestInit);
    return fetchRequestHandler({
      endpoint: "/api/trpc",
      req: newReq,
      router: appRouter,
      createContext,
    });
  }
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");

  // 确保数据库表字段已就绪（SQLite 不支持 ALTER TABLE ADD COLUMN IF NOT EXISTS）
  try {
    const db = getDb();
    // concept 字段
    try {
      db.run(sql`SELECT concept FROM stocks LIMIT 1`);
    } catch {
      console.log("[Boot] Adding missing 'concept' column to stocks table...");
      db.run(sql`ALTER TABLE stocks ADD COLUMN concept text`);
      console.log("[Boot] Column 'concept' added successfully");
    }
    // market_cap 字段
    try {
      db.run(sql`SELECT market_cap FROM stocks LIMIT 1`);
    } catch {
      console.log("[Boot] Adding missing 'market_cap' column to stocks table...");
      db.run(sql`ALTER TABLE stocks ADD COLUMN market_cap real`);
      console.log("[Boot] Column 'market_cap' added successfully");
    }
  } catch (err) {
    console.error("[Boot] Schema migration check failed:", err);
  }

  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  // 后台异步同步全A股列表到数据库（仅当数据库股票不足时）
  try {
    const db = getDb();
    const countResult = db.select({ count: sql<number>`COUNT(*)` }).from(stocks).all();
    const currentCount = countResult[0]?.count || 0;
    if (currentCount >= 1000) {
      console.log(`[Boot] Database already has ${currentCount} stocks, skipping sync.`);
    } else {
      syncAllStocks().then((count) => {
        console.log(`[Boot] Stock sync complete: ${count} stocks in database`);
      }).catch((err) => {
        console.error("[Boot] Stock sync failed:", err);
      });
    }
  } catch (err) {
    console.error("[Boot] Failed to check stock count:", err);
  }

  // 启动定时任务（每日收盘数据同步）
  try {
    startScheduler();
  } catch (err) {
    console.error("[Boot] Failed to start scheduler:", err);
  }

  // 行业/概念同步（每次启动后台异步补全）
  try {
    const missingCount = countMissingIndustry();
    const totalCount = getDb().select({ count: sql<number>`COUNT(*)` }).from(stocks).all()[0]?.count || 0;
    console.log(`[Boot] Industry data check: ${missingCount}/${totalCount} stocks missing`);
    
    // 即使缺失不多，也后台异步执行一次（幂等更新）
    syncIndustryAndConcept().then((result) => {
      console.log(`[Boot] Industry sync: ${result.updated}/${result.total} updated`);
    }).catch((err) => {
      console.error("[Boot] Industry sync failed:", err);
    });
  } catch (err) {
    console.error("[Boot] Failed to check industry count:", err);
  }
}