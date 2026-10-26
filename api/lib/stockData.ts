import { getDb } from "../queries/connection";
import { stockPrices, stocks } from "@db/schema";
import { between, eq, and, like, sql } from "drizzle-orm";
import { proxyFetch } from "./proxyFetch";
import type { HistoricalData } from "@contracts/types";

/**
 * 搜索股票（从数据库）
 */
export async function searchStocks(query: string): Promise<Array<{ code: string; name: string; pinyin: string; market: string }>> {
  try {
    const db = getDb();
    const results = db
      .select()
      .from(stocks)
      .where(
        sql`(${like(stocks.name, "%" + query + "%")} OR ${like(stocks.pinyin, "%" + query + "%")} OR ${like(stocks.code, "%" + query + "%")})`
      )
      .limit(50)
      .all();
    return results;
  } catch {
    return [];
  }
}

/**
 * 获取单只股票信息
 */
export async function getStockInfo(ticker: string): Promise<{ code: string; name: string; pinyin: string; market: string } | null> {
  try {
    const db = getDb();
    const result = db.select().from(stocks).where(eq(stocks.code, ticker)).limit(1).all();
    return result[0] || null;
  } catch {
    return null;
  }
}

/**
 * 同步全A股到数据库（从新浪行情API）
 */
export async function syncAllStocks(): Promise<number> {
  try {
    const db = getDb();
    const allStocks: Array<{ code: string; name: string; pinyin: string; market: string }> = [];

    // 分页获取沪深A股（每页80只）
    const nodes = ["hs_a", "hs_b"];
    for (const node of nodes) {
      let page = 1;
      while (true) {
        const url = `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=${page}&num=80&node=${node}`;
        const res = await proxyFetch(url, { headers: { "User-Agent": "Mozilla/5.0", Referer: "https://finance.sina.com.cn/" } });
        if (!res.ok) break;
        const text = await res.text();
        const match = text.match(/\[.*\]/s);
        if (!match) break;
        let data: any[] = [];
        try {
          data = JSON.parse(match[0]);
        } catch { break; }
        if (data.length === 0) break;

        for (const item of data) {
          const code = item.code;
          const name = item.name || "";
          const market = item.symbol?.includes("sh") ? "SH" : "SZ";
          allStocks.push({ code: `${code}.${market}`, name, pinyin: "", market });
        }
        page++;
      }
    }

    let inserted = 0;
    for (const stock of allStocks) {
      try {
        db.insert(stocks).values(stock).onConflictDoNothing().run();
        inserted++;
      } catch { /* ignore */ }
    }
    return inserted;
  } catch (err) {
    console.error("[syncAllStocks] Error:", err);
    return 0;
  }
}

/**
 * 腾讯复权历史K线接口
 * 返回前复权数据，包含 open,close,high,low,volume
 */
interface TencentKlineResponse {
  code?: string;
  data?: Record<string, {
    qfqday?: string[][];
    day?: string[][];
  }>;
}

function toTencentCode(ticker: string): string {
  const [code, market] = ticker.split(".");
  return market === "SH" ? `sh${code}` : `sz${code}`;
}

/**
 * 从腾讯API获取历史K线
 */
export async function fetchTencentKline(
  ticker: string,
  startDate: string,
  endDate: string
): Promise<HistoricalData[]> {
  const tencentCode = toTencentCode(ticker);
  // 腾讯接口单次最多返回约640根K线：以endDate为锚向前翻页，
  // 直到覆盖startDate或已无更早数据（上市首日）
  const PAGE = 640;
  const MAX_PAGES = 12;
  const lineMap = new Map<string, string[]>();
  let pageEnd = endDate;
  // 服务器直连 ifzq.gtimg.cn 易被腾讯WAF按频率拦截（返回501 HTML）；
  // proxy.finance.qq.com 同服务且对服务器友好，作为主通道，ifzq 作为备用
  const HOSTS = [
    "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get",
    "https://ifzq.gtimg.cn/appstock/app/fqkline/get",
  ];
  for (let p = 0; p < MAX_PAGES; p++) {
    const qs = `?param=${tencentCode},day,,${pageEnd},${PAGE},qfq`;
    let json: TencentKlineResponse | null = null;
    for (const host of HOSTS) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        let res;
        try {
          res = await proxyFetch(host + qs, {
            signal: ctrl.signal,
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              Referer: "https://stockapp.finance.qq.com/",
            },
          });
        } finally {
          clearTimeout(timer);
        }
        if (!res.ok) continue;
        const text = await res.text();
        if (!text.startsWith("{")) continue; // WAF HTML页面，换下一个host
        json = JSON.parse(text) as TencentKlineResponse;
        break;
      } catch { /* 换下一个host */ }
    }
    if (!json) throw new Error("Tencent fetch blocked/all hosts failed");
    const stockData = json.data?.[tencentCode];
    const pageLines = stockData?.qfqday || stockData?.day || [];
    if (pageLines.length === 0) break;
    for (const line of pageLines) lineMap.set(line[0], line);
    const earliest = pageLines[0][0];
    if (earliest <= startDate || pageLines.length < PAGE) break;
    const d = new Date(earliest + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    pageEnd = d.toISOString().slice(0, 10);
  }
  const lines = [...lineMap.values()].sort((a, b) => a[0].localeCompare(b[0]));
  if (lines.length === 0) throw new Error("No kline data");

  const raw: HistoricalData[] = lines.map((line) => {
    const [date, open, close, high, low, volume] = line;
    return {
      date,
      open: parseFloat(open),
      high: parseFloat(high),
      low: parseFloat(low),
      close: parseFloat(close),
      volume: Math.round(parseFloat(volume) * 100),
      turnoverRate: 0,
      volumeRatio: 1,
    };
  });

  const filtered = raw
    .filter((d) => d.date >= startDate && d.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (filtered.length === 0) throw new Error("No data in date range");

  for (let i = 0; i < filtered.length; i++) {
    if (i >= 5) {
      const avg = filtered.slice(i - 5, i).reduce((s, d) => s + d.volume, 0) / 5;
      filtered[i].volumeRatio = avg > 0 ? parseFloat((filtered[i].volume / avg).toFixed(2)) : 1;
    }
  }

  return filtered;
}

/**
 * 将获取到的K线数据保存到数据库缓存
 */
export async function saveToCache(ticker: string, data: HistoricalData[]) {
  try {
    const db = getDb();
    for (const d of data) {
      db.insert(stockPrices)
        .values({
          code: ticker,
          date: d.date,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
          volume: d.volume,
          turnoverRate: d.turnoverRate,
          volumeRatio: d.volumeRatio,
        })
        .onConflictDoNothing().run();
    }
  } catch {
    // 缓存失败不影响主流程
  }
}

/**
 * 计算两个日期之间的交易日数量
 */
function countTradingDays(start: string, end: string): number {
  let count = 0;
  const s = new Date(start);
  const e = new Date(end);
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

/**
 * 获取历史行情数据（优先数据库缓存）
 * 
 * 缓存策略：不要求完整覆盖 endDate（可能是未来日期/节假日），
 * 只要缓存覆盖了日期范围内 ≥80% 的交易日即可使用
 */
export async function getHistoricalData(
  ticker: string,
  startDate: string,
  endDate: string
): Promise<HistoricalData[]> {
  // 1. 从数据库读取缓存
  try {
    const db = getDb();
    const cached = db
      .select()
      .from(stockPrices)
      .where(
        and(
          eq(stockPrices.code, ticker),
          between(stockPrices.date, startDate, endDate)
        )
      )
      .orderBy(stockPrices.date)
      .all();

    if (cached.length > 0) {
      // 灵活覆盖检查：缓存交易天数 / 期望交易天数 >= 80%
      const expectedTradingDays = countTradingDays(startDate, endDate);
      const coverRatio = cached.length / Math.max(expectedTradingDays, 1);
      if (coverRatio >= 0.8) {
        return cached.map((c) => ({
          date: c.date,
          open: c.open || 0,
          high: c.high || 0,
          low: c.low || 0,
          close: c.close || 0,
          volume: c.volume || 0,
          turnoverRate: c.turnoverRate || 0,
          volumeRatio: c.volumeRatio || 1,
        }));
      }
    }
  } catch {
    // DB not ready
  }

  // 2. 从腾讯获取完整数据
  try {
    const realData = await fetchTencentKline(ticker, startDate, endDate);
    if (realData.length > 0) {
      saveToCache(ticker, realData);
      return realData;
    }
  } catch (err) {
    console.warn(`[StockData] Tencent fetch failed for ${ticker}:`, err);
  }

  // 3. 回退到模拟数据
  console.warn(`[StockData] Falling back to mock data for ${ticker}`);
  return generateMockData(ticker, startDate, endDate);
}

/**
 * 批量获取多只股票的K线数据（带缓存）
 * 用于分析时并发获取候选股票数据
 */
export async function batchGetHistoricalData(
  tickers: string[],
  startDate: string,
  endDate: string,
  concurrency: number = 50
): Promise<Record<string, HistoricalData[]>> {
  const result: Record<string, HistoricalData[]> = {};
  if (tickers.length === 0) return result;

  // ── 阶段1: 批量缓存查询（2-3次SQL，替代5500次单独查询）──
  try {
    const db = getDb();
    const conn = (db as any).$client as { prepare: (sql: string) => { all: (...params: any[]) => any[] } };
    const BATCH_IN = 800;

    for (let i = 0; i < tickers.length; i += BATCH_IN) {
      const batch = tickers.slice(i, i + BATCH_IN);
      const ph = batch.map(() => '?').join(',');
      const sql = `SELECT code, date, open, high, low, close, volume, 
                          turnover_rate as turnoverRate, volume_ratio as volumeRatio
                   FROM stock_prices
                   WHERE code IN (${ph}) AND date >= ? AND date <= ?
                   ORDER BY code, date`;
      const rows = conn.prepare(sql).all(...batch, startDate, endDate);
      if (rows?.length) {
        for (const row of rows) {
          if (!result[row.code]) result[row.code] = [];
          result[row.code].push({
            date: row.date, open: row.open || 0, high: row.high || 0,
            low: row.low || 0, close: row.close || 0, volume: row.volume || 0,
            turnoverRate: row.turnoverRate || 0, volumeRatio: row.volumeRatio || 1,
          });
        }
      }
    }
  } catch (err) {
    console.error('[batchGetHistoricalData] Batch cache query failed:', (err as Error).message);
  }

  // ── 阶段2: 缓存缺失的通过API补充（高并发+低延迟）──
  const missing = tickers.filter(t => !result[t] || result[t].length === 0);
  if (missing.length > 0) {
    const CONCURRENCY = 100; // 从50提升到100
    const DELAY = 100;       // 从200ms降到100ms
    for (let i = 0; i < missing.length; i += CONCURRENCY) {
      const batch = missing.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (ticker) => {
          try {
            const data = await fetchTencentKline(ticker, startDate, endDate);
            return { ticker, data, ok: true };
          } catch { return { ticker, data: [] as HistoricalData[], ok: false }; }
        })
      );
      for (const { ticker, data, ok } of batchResults) {
        if (ok && data.length > 0) {
          result[ticker] = data;
          saveToCache(ticker, data).catch(() => {});
        }
      }
      if (i + CONCURRENCY < missing.length) {
        await new Promise(r => setTimeout(r, DELAY));
      }
    }
  }

  return result;
}

// ─────────────────────────────────────────────
//  模拟数据生成（回退用）
// ─────────────────────────────────────────────

interface StockPersonality {
  basePrice: number;
  trendBias: number;
  amplitude: number;
  volatility: number;
  cycle1: number;
  cycle2: number;
  volumeBase: number;
  volumeSpike: number;
  turnoverBase: number;
  noiseLevel: number;
  sector: string;
}

function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function getPersonality(ticker: string): StockPersonality {
  const code = ticker.split(".")[0];
  const h = hashCode(ticker);
  const h2 = hashCode(code + "salt");

  let sector = "";
  let basePrice: number;
  let trendBias = ((h % 200) - 100) / 100;
  let amplitude = 0.01 + (h % 40) / 1000;

  if (code.startsWith("600519")) {
    sector = "白酒";
    basePrice = 1500 + (h % 300);
  } else if (code.startsWith("688")) {
    sector = "科创板";
    basePrice = 30 + (h % 120);
    trendBias = Math.min(0.5, trendBias + 0.3);
    amplitude = 0.03 + (h % 30) / 1000;
  } else if (code.startsWith("60")) {
    sector = "沪市主板";
    basePrice = 8 + (h % 40);
  } else if (code.startsWith("30")) {
    sector = "创业板";
    basePrice = 15 + (h % 50);
    amplitude = 0.025 + (h % 25) / 1000;
  } else {
    sector = "深市主板";
    basePrice = 10 + (h % 45);
  }

  return {
    basePrice,
    trendBias,
    amplitude,
    volatility: 0.005 + (h2 % 25) / 1000,
    cycle1: 15 + (h % 25),
    cycle2: 5 + (h2 % 15),
    volumeBase: 500000 + (h % 5000000),
    volumeSpike: 1.5 + (h2 % 100) / 50,
    turnoverBase: 0.5 + (h % 40) / 10,
    noiseLevel: (h2 % 30) / 1000,
    sector,
  };
}

function generateMockData(
  ticker: string,
  startDate: string,
  endDate: string
): HistoricalData[] {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const p = getPersonality(ticker);
  const data: HistoricalData[] = [];

  let price = p.basePrice;
  const totalDays = Math.ceil((end.getTime() - start.getTime()) / 86400000);

  for (let d = new Date(start), dayIdx = 0; d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;

    const t1 = dayIdx / p.cycle1 * Math.PI * 2;
    const t2 = dayIdx / p.cycle2 * Math.PI * 2;
    const trend = (dayIdx / Math.max(totalDays, 1)) * p.trendBias * 0.3;
    const cycle = Math.sin(t1) * p.amplitude * 0.6 + Math.sin(t2) * p.volatility * 0.4;
    const noise = (Math.random() - 0.5) * p.noiseLevel * 2;
    const change = cycle + trend + noise;

    const open = price;
    const close = price * (1 + change);
    const high = Math.max(open, close) * (1 + Math.abs(Math.sin(dayIdx * 1.7)) * p.volatility * 2);
    const low = Math.min(open, close) * (1 - Math.abs(Math.sin(dayIdx * 2.3)) * p.volatility * 2);
    const priceMove = Math.abs(close - open) / open;
    const volPulse = priceMove > p.amplitude * 0.8 ? p.volumeSpike : 1.0;
    const volume = Math.floor(p.volumeBase * (0.7 + Math.random() * 0.6) * volPulse);
    const turnoverRate = parseFloat((p.turnoverBase * (0.5 + Math.random()) * volPulse).toFixed(2));

    data.push({
      date: d.toISOString().split("T")[0],
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(close.toFixed(2)),
      volume,
      turnoverRate,
      volumeRatio: 1,
    });

    price = close;
    dayIdx++;
  }

  for (let i = 0; i < data.length; i++) {
    if (i >= 5) {
      const avg = data.slice(i - 5, i).reduce((s, d) => s + d.volume, 0) / 5;
      data[i].volumeRatio = avg > 0 ? parseFloat((data[i].volume / avg).toFixed(2)) : 1;
    }
  }

  return data;
}
