/**
 * 量化因子库 — 纯K线数据计算，与现有架构零冲突
 * 每个因子返回 { pass, detail, strength(0-100) }
 */

export interface FactorKline {
  date: string;
  close: number;
  volume: number;
  high?: number;
  low?: number;
}

export interface FactorResult {
  pass: boolean;
  detail: string;
  strength: number; // 0-100，用于综合打分
}

function ma(closes: number[], n: number, endIdx: number): number {
  if (endIdx - n + 1 < 0) return NaN;
  let s = 0;
  for (let i = endIdx - n + 1; i <= endIdx; i++) s += closes[i];
  return s / n;
}

function avg(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** ① 均线多头排列：MA5>MA10>MA20>MA60 持续 N 日，且 MA5 向上 */
export function checkMaAlignment(
  kline: FactorKline[],
  consecutiveDays = 3
): FactorResult {
  const closes = kline.map((k) => k.close);
  const n = closes.length;
  if (n < 65) return { pass: false, detail: "K线不足65根，无法计算MA60", strength: 0 };

  let consecutive = 0;
  for (let i = n - 1; i >= 60; i--) {
    const m5 = ma(closes, 5, i);
    const m10 = ma(closes, 10, i);
    const m20 = ma(closes, 20, i);
    const m60 = ma(closes, 60, i);
    if (m5 > m10 && m10 > m20 && m20 > m60) consecutive++;
    else break;
  }

  const m5Now = ma(closes, 5, n - 1);
  const m5Prev = ma(closes, 5, n - 2);
  const m20Now = ma(closes, 20, n - 1);
  const m20Prev = ma(closes, 20, n - 2);
  const rising = m5Now > m5Prev && m20Now >= m20Prev * 0.999;
  const pass = consecutive >= consecutiveDays && rising;

  const above60 = ((closes[n - 1] - m60Now(closes, n)) / m60Now(closes, n)) * 100;
  function m60Now(c: number[], len: number) { return ma(c, 60, len - 1); }
  const strength = pass
    ? Math.min(100, 60 + consecutive * 6 + (m5Now > m5Prev ? 8 : 0) + Math.min(10, Math.max(0, above60 / 2)))
    : 0;

  return {
    pass,
    detail: pass
      ? `均线多头排列已持续${consecutive}日（MA5>${consecutive > 0 ? "MA10>MA20>MA60" : ""}），收盘价高于MA60约${above60.toFixed(1)}%`
      : `均线未形成多头排列（连续${consecutive}日，要求≥${consecutiveDays}日${rising ? "" : "，且均线未向上"}）`,
    strength: Math.round(strength),
  };
}

/** ② 平台突破：前 N 日窄幅震荡（振幅≤X%），最近放量（≥Y倍平台均量）突破平台上沿 */
export function checkPlatformBreakout(
  kline: FactorKline[],
  platformDays = 30,
  maxRangePct = 15,
  volumeSurge = 1.5
): FactorResult {
  const n = kline.length;
  if (n < platformDays + 5)
    return { pass: false, detail: `K线不足${platformDays + 5}根，无法识别平台`, strength: 0 };

  // 平台 = 最近 platformDays 个交易日（不含最新1根）
  const platform = kline.slice(n - 1 - platformDays, n - 1);
  const latest = kline[n - 1];
  const platHigh = Math.max(...platform.map((k) => k.high ?? k.close));
  const platLow = Math.min(...platform.map((k) => k.low ?? k.close));
  const rangePct = ((platHigh - platLow) / platLow) * 100;
  const platAvgVol = avg(platform.map((k) => k.volume));
  const volRatio = platAvgVol > 0 ? latest.volume / platAvgVol : 0;

  // 突破：最新收盘站上平台上沿（容差0.5%），且放量
  const brokeOut = latest.close > platHigh * 1.005;
  const tight = rangePct <= maxRangePct;
  const surge = volRatio >= volumeSurge;
  const pass = tight && brokeOut && surge;

  const strength = pass
    ? Math.min(100, 55 + (maxRangePct - rangePct) + Math.min(25, (volRatio - volumeSurge) * 10) + 10)
    : 0;

  return {
    pass,
    detail: pass
      ? `${platformDays}日平台振幅${rangePct.toFixed(1)}%（≤${maxRangePct}%），放量${volRatio.toFixed(1)}倍突破平台上沿${platHigh.toFixed(2)}`
      : tight
        ? brokeOut
          ? `突破但量能不足（${volRatio.toFixed(1)}倍 < ${volumeSurge}倍）`
          : `平台振幅${rangePct.toFixed(1)}%达标，尚未突破上沿${platHigh.toFixed(2)}`
        : `平台振幅${rangePct.toFixed(1)}%超过${maxRangePct}%，不够紧凑`,
    strength: Math.round(strength),
  };
}

/** ⑨a N日新高：最新收盘价创近 N 日收盘新高 */
export function checkNDayHigh(kline: FactorKline[], days = 250): FactorResult {
  const closes = kline.map((k) => k.close);
  const n = closes.length;
  if (n < 20) return { pass: false, detail: "K线不足20根", strength: 0 };

  const window = closes.slice(Math.max(0, n - days));
  const last = closes[n - 1];
  const maxClose = Math.max(...window.slice(0, -1)); // 不含最新
  const pass = last > maxClose && window.length >= Math.min(days, 20);
  const actualDays = window.length;

  const strength = pass ? Math.min(100, 70 + Math.min(20, ((last - maxClose) / maxClose) * 400)) : 0;
  return {
    pass,
    detail: pass
      ? `收盘价${last.toFixed(2)}创近${actualDays}日新高（前高${maxClose.toFixed(2)}）`
      : `未创近${actualDays}日新高（前高${maxClose.toFixed(2)}，现价${last.toFixed(2)}）`,
    strength: Math.round(strength),
  };
}

/** ⑨b 高位回撤：最新收盘价距 N 日最高收盘价回撤 X%~Y%（抄底候选） */
export function checkPullbackFromHigh(
  kline: FactorKline[],
  days = 250,
  minPullbackPct = 20,
  maxPullbackPct = 60
): FactorResult {
  const closes = kline.map((k) => k.close);
  const n = closes.length;
  if (n < 20) return { pass: false, detail: "K线不足20根", strength: 0 };

  const window = closes.slice(Math.max(0, n - days));
  const maxClose = Math.max(...window);
  const last = closes[n - 1];
  const pullbackPct = ((maxClose - last) / maxClose) * 100;
  const pass = pullbackPct >= minPullbackPct && pullbackPct <= maxPullbackPct;

  // 回撤越深(靠近中位)分数越高
  const mid = (minPullbackPct + maxPullbackPct) / 2;
  const strength = pass ? Math.max(50, Math.round(85 - Math.abs(pullbackPct - mid))) : 0;
  return {
    pass,
    detail: pass
      ? `距近${window.length}日高点${maxClose.toFixed(2)}回撤${pullbackPct.toFixed(1)}%（在${minPullbackPct}%~${maxPullbackPct}%区间）`
      : `回撤${pullbackPct.toFixed(1)}%，不在${minPullbackPct}%~${maxPullbackPct}%区间`,
    strength,
  };
}
