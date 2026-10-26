import { getDb } from "../queries/connection";
import { stocks } from "@db/schema";
import { sql } from "drizzle-orm";

/**
 * 从东方财富API获取全部A股的行业、概念、市值数据
 * API: https://push2.eastmoney.com/api/qt/clist/get
 * 字段: f12=代码, f14=名称, f100=所属行业, f103=所属概念, f20=总市值
 */
export async function syncIndustryAndConcept(): Promise<{
  updated: number;
  total: number;
  error?: string;
}> {
  console.log("[IndustrySync] Starting industry/concept/marketCap sync from Eastmoney...");

  try {
    const db = getDb();
    const allStocks = db.select({ code: stocks.code }).from(stocks).all();
    const total = allStocks.length;

    if (total === 0) {
      console.warn("[IndustrySync] No stocks in database, skipping");
      return { updated: 0, total: 0 };
    }

    // 东方财富分页获取（API限制每页最多100条）
    const PAGE_SIZE = 100;
    const map = new Map<string, { industry: string; concept: string; marketCap: number }>();
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 60) {
      const url =
        `https://push2.eastmoney.com/api/qt/clist/get` +
        `?pn=${page}&pz=${PAGE_SIZE}&po=1&np=1&fltt=2&invt=2&fid=f12` +
        `&fs=m:0+t:6,m:0+t:13,m:0+t:80,m:1+t:2,m:1+t:23` +
        `&fields=f12,f14,f100,f103,f20`;

      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: "https://quote.eastmoney.com/",
        },
      });

      if (!res.ok) {
        throw new Error(`Eastmoney HTTP ${res.status} (page ${page})`);
      }

      const json = (await res.json()) as {
        data?: { diff?: Array<{ f12?: string; f14?: string; f100?: string; f103?: string; f20?: number }> };
      };

      const items = json.data?.diff || [];
      if (items.length === 0) {
        hasMore = false;
        break;
      }

      for (const item of items) {
        const code = item.f12;
        const industry = item.f100 || "";
        const concept = item.f103 || "";
        const marketCap = typeof item.f20 === "number" ? item.f20 : 0;
        if (code) {
          map.set(code, { industry, concept, marketCap });
        }
      }

      console.log(`[IndustrySync] Page ${page}: fetched ${items.length}, total map: ${map.size}`);

      if (items.length < PAGE_SIZE) {
        hasMore = false;
      }
      page++;

      if (hasMore) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    let updated = 0;
    for (const stock of allStocks) {
      const pureCode = stock.code.split(".")[0];
      const info = map.get(pureCode);
      if (!info) continue;

      try {
        db.run(
          sql`UPDATE stocks SET sector = ${info.industry}, concept = ${info.concept}, market_cap = ${info.marketCap}, updated_at = ${new Date().toISOString()} WHERE code = ${stock.code}`
        );
        updated++;
      } catch (err) {
        console.warn(`[IndustrySync] Failed to update ${stock.code}:`, err);
      }
    }

    console.log(`[IndustrySync] Complete: ${updated}/${total} stocks updated`);
    return { updated, total };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[IndustrySync] Sync failed:", msg);
    return { updated: 0, total: 0, error: msg };
  }
}

export function countMissingIndustry(): number {
  try {
    const db = getDb();
    const rows = db
      .select({ count: sql<number>`COUNT(*)` })
      .from(stocks)
      .where(sql`${stocks.sector} IS NULL OR ${stocks.sector} = ''`)
      .all();
    return rows[0]?.count || 0;
  } catch {
    return 0;
  }
}
