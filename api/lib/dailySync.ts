import { getDb } from "../queries/connection";
import { stockPrices, stocks } from "@db/schema";
import { sql } from "drizzle-orm";
import iconv from "iconv-lite";

/**
 * 将 ticker 格式转换为腾讯格式
 * 000001.SZ -> sz000001
 * 600000.SH -> sh600000
 */
function toTencentCode(ticker: string): string {
  const [code, market] = ticker.split(".");
  return market === "SH" ? `sh${code}` : `sz${code}`;
}

/**
 * 批量获取股票当天行情（腾讯接口）
 * 每次最多约80只，避免URL过长
 */
async function fetchTencentBatch(codes: string[]): Promise<Array<{
  ticker: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}> | null> {
  const tencentCodes = codes.map(toTencentCode).join(",");
  const url = `https://qt.gtimg.cn/q=${tencentCodes}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://stock.finance.qq.com/",
      },
    });

    if (!res.ok) {
      console.warn(`[DailySync] Tencent batch fetch failed: ${res.status}`);
      return null;
    }

    // 腾讯返回 GBK 编码，需要 iconv-lite 解码
    const buffer = await res.arrayBuffer();
    const text = iconv.decode(Buffer.from(buffer), "gbk");

    const results: Array<{
      ticker: string;
      date: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }> = [];

    // 兜底日期用北京时间（A股交易日历以北京时间为准）
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().split("T")[0];

    for (const line of text.split(";")) {
      const match = line.match(/v_(sh\d{6}|sz\d{6})="([^"]*)"/);
      if (!match) continue;

      const [, tencentCode, dataStr] = match;
      const parts = dataStr.split("~");
      if (parts.length < 37) continue;

      // 反向映射回 ticker 格式
      const code = tencentCode.slice(2);
      const market = tencentCode.startsWith("sh") ? "SH" : "SZ";
      const ticker = `${code}.${market}`;

      const name = parts[1];
      const close = parseFloat(parts[3]) || 0;   // 最新价 = 收盘价
      const open = parseFloat(parts[5]) || 0;    // 开盘价
      const volumeHands = parseFloat(parts[6]) || 0; // 成交量(手)
      const high = parseFloat(parts[33]) || 0;   // 最高价
      const low = parseFloat(parts[34]) || 0;    // 最低价
      const volume = Math.round(volumeHands * 100); // 转换为股数

      // 如果收盘价为0，说明停牌或无交易，跳过
      if (close === 0 || (open === 0 && high === 0 && low === 0)) continue;

      // 从响应时间戳（parts[30]，格式 YYYYMMDDHHMMSS）取真实行情日期，避免 UTC/周末错位
      const ts = parts[30] || "";
      const date = ts.length >= 8 ? `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}` : today;

      results.push({
        ticker,
        date,
        open,
        high,
        low,
        close,
        volume,
      });
    }

    return results;
  } catch (err) {
    console.warn("[DailySync] Tencent batch fetch error:", err);
    return null;
  }
}

/**
 * 同步所有股票的当天行情到数据库
 * 分批获取，每批80只，间隔300ms
 */
export async function syncDailyPrices(): Promise<{ inserted: number; failed: number; total: number }> {
  console.log("[DailySync] Starting daily price sync...");

  try {
    const db = getDb();
    const allStocks = db.select({ code: stocks.code }).from(stocks).all();
    const codes = allStocks.map((s) => s.code);
    const total = codes.length;

    if (total === 0) {
      console.warn("[DailySync] No stocks in database");
      return { inserted: 0, failed: 0, total: 0 };
    }

    let inserted = 0;
    let failed = 0;
    const BATCH = 80;
    const DELAY_MS = 300;

    for (let i = 0; i < codes.length; i += BATCH) {
      const batch = codes.slice(i, i + BATCH);
      const data = await fetchTencentBatch(batch);

      if (data && data.length > 0) {
        for (const item of data) {
          try {
            db.insert(stockPrices)
              .values({
                code: item.ticker,
                date: item.date,
                open: item.open,
                high: item.high,
                low: item.low,
                close: item.close,
                volume: item.volume,
                turnoverRate: 0,
                volumeRatio: 1,
              })
              .onConflictDoNothing().run();
            inserted++;
          } catch {
            failed++;
          }
        }
      }

      // 批次间延迟，避免触发限流
      if (i + BATCH < codes.length) {
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
    }

    console.log(`[DailySync] Complete: ${inserted}/${total} stocks synced (${failed} failed)`);
    return { inserted, failed, total };
  } catch (err) {
    console.error("[DailySync] Sync failed:", err);
    return { inserted: 0, failed: 0, total: 0 };
  }
}

/**
 * 检查某只股票在指定日期范围内是否有缓存数据
 */
export function hasCachedData(ticker: string, startDate: string, endDate: string): boolean {
  try {
    const db = getDb();
    const cached = db
      .select()
      .from(stockPrices)
      .where(sql`${stockPrices.code} = ${ticker} AND ${stockPrices.date} BETWEEN ${startDate} AND ${endDate}`)
      .all();

    if (cached.length === 0) return false;

    // 检查覆盖度：至少要有日期范围的70%交易日
    const start = new Date(startDate);
    const end = new Date(endDate);
    let tradingDays = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (d.getDay() !== 0 && d.getDay() !== 6) tradingDays++;
    }

    return cached.length >= tradingDays * 0.7;
  } catch {
    return false;
  }
}

/**
 * 获取单只股票最新缓存数据日期
 */
export function getLatestCacheDate(ticker: string): string | null {
  try {
    const db = getDb();
    const rows = db
      .select({ maxDate: sql<string>`MAX(date)` })
      .from(stockPrices)
      .where(sql`${stockPrices.code} = ${ticker}`)
      .all();
    return rows[0]?.maxDate || null;
  } catch {
    return null;
  }
}
