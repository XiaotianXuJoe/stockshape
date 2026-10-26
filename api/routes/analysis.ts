import type { Context } from "../context";
import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getHistoricalData, batchGetHistoricalData, fetchTencentKline, saveToCache } from "../lib/stockData";
import {
  checkMaAlignment,
  checkPlatformBreakout,
  checkNDayHigh,
  checkPullbackFromHigh,
  type FactorKline,
  type FactorResult,
} from "../lib/factors";
import { calculateMultiDimensionalSimilarity } from "../lib/similarity";
import { detectPatterns, getPatternName, getPatternSignal } from "../lib/patternRecognition";
import { getDb } from "../queries/connection";
import { stocks, stockPrices, strategyRuns, strategyResults } from "@db/schema";
import { like, and, between, eq } from "drizzle-orm";

// ─────────────────────────────────────────────
//  股票走势"个性"参数生成（模拟数据用）
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

// ─────────────────────────────────────────────
//  市场基准走势（所有股票共享，反映大盘方向）
//  基于日期生成，同一天的基准对所有股票一致
// ─────────────────────────────────────────────

function getMarketBaseTrend(dayIndex: number, totalDays: number): number {
  // 微弱的市场基准（所有股票共享），反映大盘大致方向
  const phase = dayIndex / totalDays;
  if (phase < 0.3) return -0.001;
  if (phase < 0.5) return -0.003;
  if (phase < 0.7) return -0.0005;
  return 0.0015;
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

/**
 * 快速K线生成（带市场基准走势）
 */
export function fastKline(
  ticker: string,
  startDate: string,
  endDate: string
): Array<{
  date: string; open: number; high: number; low: number;
  close: number; volume: number; turnoverRate: number; volumeRatio: number;
}> {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const p = getPersonality(ticker);
  const data: Array<{
    date: string; open: number; high: number; low: number;
    close: number; volume: number; turnoverRate: number; volumeRatio: number;
  }> = [];

  let price = p.basePrice;
  const totalDays = Math.ceil((end.getTime() - start.getTime()) / 86400000);

  for (let d = new Date(start), dayIdx = 0; d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;

    // 市场基准（所有股票共享）
    const marketTrend = getMarketBaseTrend(dayIdx, totalDays);

    // 个股个性
    const t1 = dayIdx / p.cycle1 * Math.PI * 2;
    const t2 = dayIdx / p.cycle2 * Math.PI * 2;
    const trend = (dayIdx / Math.max(totalDays, 1)) * p.trendBias * 0.3;
    const cycle = Math.sin(t1) * p.amplitude * 0.6 + Math.sin(t2) * p.volatility * 0.4;
    const noise = (Math.random() - 0.5) * p.noiseLevel * 2;
    
    // 最终变化 = 市场基准 + 个股趋势 + 个股周期 + 噪声
    const change = marketTrend + trend * 0.5 + cycle + noise;

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

// ─────────────────────────────────────────────
//  从数据库缓存直接读取K线（高性能）
// ─────────────────────────────────────────────

function getKlineFromCache(
  ticker: string,
  startDate: string,
  endDate: string
): Array<{ date: string; open: number; high: number; low: number; close: number; volume: number; turnoverRate: number; volumeRatio: number }> | null {
  try {
    const db = getDb();
    const rows = db
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

    if (rows.length === 0) return null;

    return rows.map((r) => ({
      date: r.date,
      open: r.open || 0,
      high: r.high || 0,
      low: r.low || 0,
      close: r.close || 0,
      volume: r.volume || 0,
      turnoverRate: r.turnoverRate || 0,
      volumeRatio: r.volumeRatio || 1,
    }));
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
//  扫描配置
// ─────────────────────────────────────────────
const MAX_CANDIDATES = 6000;
const TOP_N_RESULTS = 500;

// ─────────────────────────────────────────────
//  策略组合筛选（①②⑨ + ⑬ 形态条件 任意叠加）
// ─────────────────────────────────────────────

const strategyConditionSchema = z.object({
  type: z.enum(["ma_alignment", "platform_breakout", "n_day_high", "pullback_from_high", "pattern"]),
  patterns: z.array(z.string()).optional(),
  params: z.record(z.string(), z.number()).optional(),
});

function shiftDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayStr(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function pctChange(from: number, to: number): number {
  return from > 0 ? parseFloat(((to - from) / from * 100).toFixed(2)) : 0;
}

export interface StrategyScanItem {
  ticker: string; code: string; name: string;
  similarityScore: number; reasons: string[];
  detectedPattern: unknown;
  volume: number; turnoverRate: number; volumeRatio: number;
  sector: string; industry: string; concept: string; change: number;
  closePrice: number; // 信号日收盘价（落库/回测入场价）
}

/**
 * 策略扫描核心：对全市场股票评估条件组合（AND），endDate 为信号日
 */
async function runStrategyScan(
  conditions: z.infer<typeof strategyConditionSchema>[],
  endDate: string
): Promise<{ results: StrategyScanItem[]; totalScanned: number; realDataCount: number }> {
  const startDate = shiftDaysStr(endDate, -520); // 约340个交易日，覆盖250日窗口
  const MIN_BARS = 60;
  const CACHE_MIN = 120;

  const db = getDb();
  const dbStocks = db
    .select({ code: stocks.code, name: stocks.name, sector: stocks.sector, concept: stocks.concept })
    .from(stocks)
    .limit(MAX_CANDIDATES)
    .all();
  const candidateList = dbStocks.map((s) => ({
    code: s.code, name: s.name, sector: s.sector || "", concept: s.concept || "",
  }));
  const totalScanned = candidateList.length;
  if (totalScanned === 0) return { results: [], totalScanned: 0, realDataCount: 0 };

  // ── 取数：批量缓存（>=120根才算命中）→ 不足的直接腾讯API补取（不用mock，避免假信号）──
  const kmap: Record<string, FactorKline[]> = {};
  const codes = candidateList.map((c) => c.code);
  const batchResult = await batchGetHistoricalData(codes, startDate, endDate, 100);
  for (const code of codes) {
    const d = batchResult[code];
    if (d && d.length >= CACHE_MIN) kmap[code] = d;
  }
  const insufficient = codes.filter((c) => !kmap[c]);
  const CONC = 50;
  for (let i = 0; i < insufficient.length; i += CONC) {
    const batch = insufficient.slice(i, i + CONC);
    await Promise.all(
      batch.map(async (code) => {
        try {
          const d = await fetchTencentKline(code, startDate, endDate);
          if (d.length >= MIN_BARS) {
            kmap[code] = d;
            saveToCache(code, d).catch(() => { /* ignore */ });
          }
        } catch { /* 跳过取数失败的股票 */ }
      })
    );
    if (i + CONC < insufficient.length) await new Promise((r) => setTimeout(r, 100));
  }

  // ── 条件评估（AND 交集）──
  const results: StrategyScanItem[] = [];
  for (const { code, name, sector, concept } of candidateList) {
    const data = kmap[code];
    if (!data || data.length < MIN_BARS) continue;

    const reasons: string[] = [];
    const strengths: number[] = [];
    let detectedPattern: unknown = null;
    let allPass = true;

    for (const cond of conditions) {
      let r: FactorResult;
      const p = cond.params || {};
      switch (cond.type) {
        case "ma_alignment":
          r = checkMaAlignment(data, p.consecutiveDays);
          break;
        case "platform_breakout":
          r = checkPlatformBreakout(data, p.platformDays, p.maxRangePct, p.volumeSurge);
          break;
        case "n_day_high":
          r = checkNDayHigh(data, p.days);
          break;
        case "pullback_from_high":
          r = checkPullbackFromHigh(data, p.days, p.minPullbackPct, p.maxPullbackPct);
          break;
        case "pattern": {
          try {
            const pats = detectPatterns(
              data.map((k) => k.close),
              data.map((k) => k.date),
              data.map((k) => k.volume)
            ) || [];
            const filter = (cond.patterns || []).filter(Boolean);
            const sorted = [...pats].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
            const matched = filter.length > 0 ? sorted.find((pt) => filter.includes(pt.type)) : sorted[0];
            if (matched) {
              r = {
                pass: true,
                detail: `检测到形态「${getPatternName(matched.type)}」（置信度${matched.confidence}%）`,
                strength: Math.min(100, matched.confidence || 50),
              };
              detectedPattern = { ...matched, name: getPatternName(matched.type), signal: getPatternSignal(matched.type) };
            } else {
              r = { pass: false, detail: "未检测到要求的形态", strength: 0 };
            }
          } catch {
            r = { pass: false, detail: "形态检测失败", strength: 0 };
          }
          break;
        }
        default:
          r = { pass: false, detail: "未知条件", strength: 0 };
      }
      if (!r.pass) { allPass = false; break; }
      reasons.push(r.detail);
      strengths.push(r.strength);
    }
    if (!allPass) continue;

    const last = data[data.length - 1];
    const ago20 = data[Math.max(0, data.length - 21)];
    results.push({
      ticker: code, code, name,
      similarityScore: Math.round(strengths.reduce((a, b) => a + b, 0) / Math.max(strengths.length, 1)),
      reasons,
      detectedPattern,
      volume: last.volume || 0,
      turnoverRate: (last as { turnoverRate?: number }).turnoverRate || 0,
      volumeRatio: (last as { volumeRatio?: number }).volumeRatio || 1,
      sector, industry: sector, concept,
      change: pctChange(ago20.close, last.close), // 近20日涨跌幅
      closePrice: last.close,
    });
  }

  results.sort((a, b) => b.similarityScore - a.similarityScore);
  return {
    results: results.slice(0, TOP_N_RESULTS),
    totalScanned,
    realDataCount: Object.keys(kmap).length,
  };
}


export const analysisRouter = createRouter({
  /** 
   * 候选股票扫描（全部使用真实K线：优先缓存 → API补充 → 模拟回退）
   */
  findSimilarStocks: publicQuery
    .input(
      z.object({
        targetTicker: z.string().min(1).max(20),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
    )
    .mutation(async ({ input }) => {
      try {
        // ── 阶段0: 获取目标股票真实K线 ──
        let targetKline = await getHistoricalData(input.targetTicker, input.startDate, input.endDate);
        if (!targetKline || targetKline.length === 0) {
          targetKline = fastKline(input.targetTicker, input.startDate, input.endDate);
        }
        if (!targetKline || targetKline.length === 0) {
          return { results: [], totalScanned: 0 };
        }

        const targetForCompare = targetKline.map((k) => ({
          close: k.close,
          volume: k.volume,
          turnoverRate: k.turnoverRate || 0,
          volumeRatio: k.volumeRatio || 1,
        }));

        // ── 阶段1: 从数据库获取全部候选（含行业/概念） ──
        const db = getDb();
        const dbStocks = db.select({ code: stocks.code, name: stocks.name, sector: stocks.sector, concept: stocks.concept }).from(stocks).limit(MAX_CANDIDATES).all();
        const candidateList = dbStocks.map((s) => ({ code: s.code, name: s.name, sector: s.sector || "", concept: s.concept || "" })).filter((s) => s.code !== input.targetTicker);
        const totalCandidates = candidateList.length;
        if (totalCandidates === 0) return { results: [], totalScanned: 0 };

        // ── 阶段2: 获取所有候选的K线（优先缓存 → API补充 → 模拟回退） ──
        const candidateDataMap: Record<string, Array<{
          close: number; volume: number; turnoverRate: number; volumeRatio: number;
        }>> = {};

        // 先从缓存批量读取
        const needFetch: string[] = [];
        for (const { code } of candidateList) {
          const cached = getKlineFromCache(code, input.startDate, input.endDate);
          if (cached && cached.length >= 50) {
            candidateDataMap[code] = cached.map((k) => ({
              close: k.close, volume: k.volume,
              turnoverRate: k.turnoverRate || 0, volumeRatio: k.volumeRatio || 1,
            }));
          } else {
            needFetch.push(code);
          }
        }

        // 缓存缺失的通过API补充（分批并发）
        if (needFetch.length > 0) {
          const BATCH = 50;
          const DELAY = 200;
          for (let i = 0; i < needFetch.length; i += BATCH) {
            const batch = needFetch.slice(i, i + BATCH);
            const batchResults = await batchGetHistoricalData(
              batch, input.startDate, input.endDate, BATCH
            );
            for (const [code, data] of Object.entries(batchResults)) {
              if (data.length > 0) {
                candidateDataMap[code] = data.map((k) => ({
                  close: k.close, volume: k.volume,
                  turnoverRate: k.turnoverRate || 0, volumeRatio: k.volumeRatio || 1,
                }));
              }
            }
            if (i + BATCH < needFetch.length) {
              await new Promise((r) => setTimeout(r, DELAY));
            }
          }
        }

        // ── 阶段3: 计算相似度 ──
        const allResults: Array<{
          ticker: string; code: string; name: string;
          similarityScore: number; priceScore: number;
          volumeScore: number; volatilityScore: number; trendScore: number;
          reasons: string[];
          volume: number; turnoverRate: number; volumeRatio: number;
          sector: string; industry: string; concept: string; change: number;
        }> = [];

        for (const { code, name, sector: realSector, concept: realConcept } of candidateList) {
          const data = candidateDataMap[code];

          // 跳过没有真实K线数据的股票（不使用模拟数据，避免得分虚高）
          if (!data || data.length === 0) continue;

          try {
            if (code === '002230.SZ') console.log('[DEBUG KE] data.length:', data.length, 'target.length:', targetForCompare.length);
            const sim = calculateMultiDimensionalSimilarity(targetForCompare, data);
            if (code === '002230.SZ') console.log('[DEBUG KE] sim:', JSON.stringify(sim));
            const lastKline = data[data.length - 1];
            const firstClose = data[0]?.close || 1;
            const lastClose = lastKline?.close || 1;

            allResults.push({
              ticker: code,
              code,
              name,
              similarityScore: sim.score,
              priceScore: sim.priceScore,
              volumeScore: sim.volumeScore,
              volatilityScore: sim.volatilityScore,
              trendScore: sim.trendScore,
              reasons: [
                `综合相似度 ${sim.score} 分`,
                ...sim.descriptions,
              ],
              volume: lastKline?.volume || 0,
              turnoverRate: lastKline?.turnoverRate || 0,
              volumeRatio: lastKline?.volumeRatio || 1,
              sector: realSector || "",
              industry: realSector || "",
              concept: realConcept || "",
              change: parseFloat(((lastClose - firstClose) / firstClose * 100).toFixed(2)),
            });
          } catch { /* skip */ }
        }

        // 过滤NaN并按得分降序排序
        const validResults = allResults.filter(r => !isNaN(r.similarityScore));
        validResults.sort((a, b) => b.similarityScore - a.similarityScore);
        return {
          results: validResults.slice(0, TOP_N_RESULTS),
          totalScanned: totalCandidates,
          realDataCount: Object.keys(candidateDataMap).length,
        };
      } catch (error) {
        console.error("[findSimilarStocks] Error:", error);
        return { results: [], totalScanned: 0 };
      }
    }),

  /** 形态检测端点（单只股票） */
  detectPatterns: publicQuery
    .input(
      z.object({
        ticker: z.string().min(1).max(20),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
    )
    .mutation(async ({ input }) => {
      try {
        let kline = await getHistoricalData(input.ticker, input.startDate, input.endDate);
        if (!kline || kline.length === 0) {
          kline = fastKline(input.ticker, input.startDate, input.endDate);
        }
        if (!kline || kline.length === 0) {
          return { patterns: [], ticker: input.ticker, error: "无法获取K线数据" };
        }

        const prices = kline.map((k) => k.close);
        const dates = kline.map((k) => k.date);
        const volumes = kline.map((k) => k.volume);
        const patterns = detectPatterns(prices, dates, volumes);

        return {
          patterns: patterns.map((p) => ({
            type: p.type,
            name: getPatternName(p.type),
            confidence: p.confidence,
            signal: getPatternSignal(p.type),
            description: p.description,
            startIndex: p.startIndex,
            endIndex: p.endIndex,
            entryPrice: p.entryPrice,
            targetPrice: p.targetPrice,
            stopLoss: p.stopLoss,
          })),
          ticker: input.ticker,
          dateRange: `${input.startDate} ~ ${input.endDate}`,
          klineCount: kline.length,
          error: null,
        };
      } catch (error) {
        return {
          patterns: [],
          ticker: input.ticker,
          error: error instanceof Error ? error.message : "形态检测失败",
        };
      }
    }),

  /** 获取所有股票列表 */
  /**
   * 形态模式选股：相似度扫描 + K线形态检测
   * - patternFilter 为空：返回相似度结果，附带每只候选检测到的最高置信度形态
   * - patternFilter 非空：命中目标形态的股票获得加分并优先返回
   */
  findSimilarStocksWithPatterns: publicQuery
    .input(
      z.object({
        ticker: z.string().min(1).max(20),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        patternFilter: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const filter = (input.patternFilter || []).filter(Boolean);
        const hasFilter = filter.length > 0;

        // ── 阶段0: 获取目标股票真实K线 ──
        let targetKline = await getHistoricalData(input.ticker, input.startDate, input.endDate);
        if (!targetKline || targetKline.length === 0) {
          targetKline = fastKline(input.ticker, input.startDate, input.endDate);
        }
        if (!targetKline || targetKline.length === 0) {
          return { results: [], totalScanned: 0, error: "无法获取目标股票K线数据" };
        }
        const targetForCompare = targetKline.map((k) => ({
          close: k.close, volume: k.volume,
          turnoverRate: k.turnoverRate || 0, volumeRatio: k.volumeRatio || 1,
        }));

        // ── 阶段1: 从数据库获取全部候选 ──
        const db = getDb();
        const dbStocks = db.select({ code: stocks.code, name: stocks.name, sector: stocks.sector, concept: stocks.concept }).from(stocks).limit(MAX_CANDIDATES).all();
        const candidateList = dbStocks.map((s) => ({ code: s.code, name: s.name, sector: s.sector || "", concept: s.concept || "" })).filter((s) => s.code !== input.ticker);
        const totalCandidates = candidateList.length;
        if (totalCandidates === 0) return { results: [], totalScanned: 0, error: null };

        // ── 阶段2: 候选K线（保留日期字段，形态检测需要） ──
        type FullKline = { date: string; close: number; volume: number; turnoverRate: number; volumeRatio: number };
        const candidateDataMap: Record<string, FullKline[]> = {};
        const needFetch: string[] = [];
        for (const { code } of candidateList) {
          const cached = getKlineFromCache(code, input.startDate, input.endDate);
          if (cached && cached.length >= 50) {
            candidateDataMap[code] = cached.map((k) => ({
              date: k.date, close: k.close, volume: k.volume,
              turnoverRate: k.turnoverRate || 0, volumeRatio: k.volumeRatio || 1,
            }));
          } else {
            needFetch.push(code);
          }
        }
        if (needFetch.length > 0) {
          const BATCH = 50;
          const DELAY = 200;
          for (let i = 0; i < needFetch.length; i += BATCH) {
            const batch = needFetch.slice(i, i + BATCH);
            const batchResults = await batchGetHistoricalData(batch, input.startDate, input.endDate, BATCH);
            for (const [code, data] of Object.entries(batchResults)) {
              if (data.length > 0) {
                candidateDataMap[code] = data.map((k) => ({
                  date: k.date, close: k.close, volume: k.volume,
                  turnoverRate: k.turnoverRate || 0, volumeRatio: k.volumeRatio || 1,
                }));
              }
            }
            if (i + BATCH < needFetch.length) {
              await new Promise((r) => setTimeout(r, DELAY));
            }
          }
        }

        // ── 阶段3: 相似度计算 + 形态检测 ──
        const allResults: Array<{
          ticker: string; code: string; name: string;
          similarityScore: number; baseSimilarity: number; patternBonus: number;
          priceScore: number; volumeScore: number; volatilityScore: number; trendScore: number;
          reasons: string[]; detectedPattern: unknown;
          volume: number; turnoverRate: number; volumeRatio: number;
          sector: string; industry: string; concept: string; change: number;
        }> = [];

        for (const { code, name, sector: realSector, concept: realConcept } of candidateList) {
          const data = candidateDataMap[code];
          if (!data || data.length === 0) continue;

          try {
            const sim = calculateMultiDimensionalSimilarity(targetForCompare, data);

            // 形态检测（失败不影响相似度结果）
            let detectedPattern: unknown = null;
            let patternBonus = 0;
            let patternDesc = "";
            try {
              const pats = detectPatterns(
                data.map((k) => k.close),
                data.map((k) => k.date),
                data.map((k) => k.volume)
              ) || [];
              if (pats.length > 0) {
                const sorted = [...pats].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
                const matched = hasFilter ? sorted.find((pt) => filter.includes(pt.type)) : undefined;
                const best = matched || sorted[0];
                detectedPattern = {
                  ...best,
                  name: getPatternName(best.type),
                  signal: getPatternSignal(best.type),
                };
                if (matched) {
                  patternBonus = Math.min(15, Math.round((matched.confidence || 50) / 10));
                  patternDesc = `检测到目标形态「${getPatternName(matched.type)}」（置信度${matched.confidence}%，+${patternBonus}分）`;
                }
              }
            } catch { /* ignore pattern errors */ }

            const lastKline = data[data.length - 1];
            const firstClose = data[0]?.close || 1;
            const lastClose = lastKline?.close || 1;
            const finalScore = Math.min(100, sim.score + patternBonus);

            allResults.push({
              ticker: code,
              code,
              name,
              similarityScore: finalScore,
              baseSimilarity: sim.score,
              patternBonus,
              priceScore: sim.priceScore,
              volumeScore: sim.volumeScore,
              volatilityScore: sim.volatilityScore,
              trendScore: sim.trendScore,
              reasons: [
                `综合相似度 ${finalScore} 分${patternBonus > 0 ? `（基础 ${sim.score} + 形态加成 ${patternBonus}）` : ""}`,
                ...(patternDesc ? [patternDesc] : []),
                ...sim.descriptions,
              ],
              detectedPattern,
              volume: lastKline?.volume || 0,
              turnoverRate: lastKline?.turnoverRate || 0,
              volumeRatio: lastKline?.volumeRatio || 1,
              sector: realSector || "",
              industry: realSector || "",
              concept: realConcept || "",
              change: parseFloat(((lastClose - firstClose) / firstClose * 100).toFixed(2)),
            });
          } catch { /* skip */ }
        }

        // 过滤NaN；有过滤条件时命中形态的股票优先，其余按得分降序
        const validResults = allResults.filter((r) => !isNaN(r.similarityScore));
        validResults.sort((a, b) => {
          if (hasFilter) {
            const am = a.patternBonus > 0 ? 1 : 0;
            const bm = b.patternBonus > 0 ? 1 : 0;
            if (am !== bm) return bm - am;
          }
          return b.similarityScore - a.similarityScore;
        });

        return {
          results: validResults.slice(0, TOP_N_RESULTS),
          totalScanned: totalCandidates,
          realDataCount: Object.keys(candidateDataMap).length,
          patternFilter: filter,
          error: null,
        };
      } catch (error) {
        console.error("[findSimilarStocksWithPatterns] Error:", error);
        return { results: [], totalScanned: 0, error: error instanceof Error ? error.message : "形态模式分析失败" };
      }
    }),

  /** 策略组合筛选：①②⑨因子 + ⑬形态条件 任意叠加（AND），结果落库供回测追踪 */
  screenByStrategy: publicQuery
    .input(
      z.object({
        conditions: z.array(strategyConditionSchema).min(1),
        asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        saveRun: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const endDate = input.asOfDate || todayStr();
        const { results, totalScanned, realDataCount } = await runStrategyScan(input.conditions, endDate);

        // ⑭ 落库（默认开启；回测调用时关闭）
        let runId: number | null = null;
        if (input.saveRun !== false) {
          try {
            const db = getDb();
            const runRet = db
              .insert(strategyRuns)
              .values({
                conditionsJson: JSON.stringify(input.conditions),
                asOfDate: endDate,
                matchedCount: results.length,
              })
              .run();
            runId = Number(runRet.lastInsertRowid);
            for (const r of results) {
              db.insert(strategyResults)
                .values({ runId, code: r.code, name: r.name, closePrice: r.closePrice })
                .run();
            }
          } catch (err) {
            console.error("[screenByStrategy] 落库失败:", err);
          }
        }

        return {
          results: results.map(({ closePrice, ...rest }) => rest),
          totalScanned,
          realDataCount,
          asOfDate: endDate,
          runId,
          error: null,
        };
      } catch (error) {
        console.error("[screenByStrategy] Error:", error);
        return {
          results: [], totalScanned: 0, realDataCount: 0, asOfDate: null, runId: null,
          error: error instanceof Error ? error.message : "策略筛选失败",
        };
      }
    }),

  /** ⑭ 策略回测：以过去某日(asOfDate)为信号日重跑筛选，计算 horizonDays 后的收益与胜率 */
  backtestStrategy: publicQuery
    .input(
      z.object({
        conditions: z.array(strategyConditionSchema).min(1),
        asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        horizonDays: z.number().int().min(1).max(120).default(20),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const today = todayStr();
        if (input.asOfDate >= today) {
          return { results: [], summary: null, error: "回测信号日必须早于今天" };
        }
        const { results, totalScanned } = await runStrategyScan(input.conditions, input.asOfDate);

        // 前100只计算前瞻收益（控制耗时）
        const MAX_BT = 100;
        const btList = results.slice(0, MAX_BT);
        const returns: Array<{ code: string; ret: number; complete: boolean; exitDate: string; exitClose: number }> = [];

        for (const item of btList) {
          try {
            const afterStart = shiftDaysStr(input.asOfDate, 1);
            let fwd = getKlineFromCache(item.code, afterStart, today);
            if (!fwd || fwd.length === 0) {
              try {
                fwd = await fetchTencentKline(item.code, afterStart, today);
              } catch { fwd = null; }
            }
            if (!fwd || fwd.length === 0) continue;
            const exitBar = fwd[Math.min(input.horizonDays - 1, fwd.length - 1)];
            const complete = fwd.length >= input.horizonDays;
            returns.push({
              code: item.code,
              ret: pctChange(item.closePrice, exitBar.close),
              complete,
              exitDate: exitBar.date,
              exitClose: exitBar.close,
            });
          } catch { /* skip */ }
        }

        const retMap = new Map(returns.map((r) => [r.code, r]));
        const btResults = btList
          .filter((item) => retMap.has(item.code))
          .map((item) => {
            const r = retMap.get(item.code)!;
            return {
              ...item,
              change: r.ret, // 前瞻收益（%）
              reasons: [
                ...item.reasons,
                `回测：${input.asOfDate}以${item.closePrice.toFixed(2)}入场，${r.exitDate}以${r.exitClose.toFixed(2)}出场（${r.complete ? `满${input.horizonDays}日` : "未满期"}），收益${r.ret}%`,
              ],
            };
          });

        // 汇总：优先用满期样本
        const completeRets = returns.filter((r) => r.complete).map((r) => r.ret);
        const useRets = completeRets.length > 0 ? completeRets : returns.map((r) => r.ret);
        const sorted = [...useRets].sort((a, b) => a - b);
        const summary = {
          asOfDate: input.asOfDate,
          horizonDays: input.horizonDays,
          totalScanned,
          sampleCount: returns.length,
          completeCount: completeRets.length,
          winRate: useRets.length > 0 ? parseFloat((useRets.filter((r) => r > 0).length / useRets.length * 100).toFixed(1)) : 0,
          avgReturn: useRets.length > 0 ? parseFloat((useRets.reduce((a, b) => a + b, 0) / useRets.length).toFixed(2)) : 0,
          medianReturn: sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0,
          maxReturn: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
          minReturn: sorted.length > 0 ? sorted[0] : 0,
        };

        return { results: btResults, summary, error: null };
      } catch (error) {
        console.error("[backtestStrategy] Error:", error);
        return {
          results: [], summary: null,
          error: error instanceof Error ? error.message : "策略回测失败",
        };
      }
    }),

  getAllStocks: publicQuery.query(async () => {
    const db = getDb();
    return db.select().from(stocks).all();
  }),

  /** 批量插入股票 */
  bulkInsert: publicQuery
    .input(z.array(z.object({ code: z.string().min(1), name: z.string(), pinyin: z.string(), market: z.string() })))
    .mutation(async ({ input }) => {
      const db = getDb();
      let inserted = 0;
      for (const stock of input) {
        try {
          await db.insert(stocks).values(stock).onConflictDoUpdate({
            target: stocks.code,
            set: { name: stock.name, pinyin: stock.pinyin, market: stock.market },
          });
          inserted++;
        } catch { /* ignore */ }
      }
      return inserted;
    }),
});
