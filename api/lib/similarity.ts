/**
 * 股票走势相似度计算算法
 * 综合 Pearson 相关系数 + DTW 动态时间规整 + 成交量 + 波动率 + 趋势
 */

// 归一化价格序列到 [0, 1]
export function normalize(series: number[]): number[] {
  if (series.length === 0) return [];
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min;
  if (range === 0) return series.map(() => 0.5);
  return series.map((v) => (v - min) / range);
}

// 计算收益率序列
export function calculateReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  return returns;
}

// Pearson 相关系数 (-1 到 1)
export function pearsonCorrelation(a: number[], b: number[]): number {
  const n = a.length;
  if (n !== b.length || n === 0) return 0;

  const sumA = a.reduce((s, v) => s + v, 0);
  const sumB = b.reduce((s, v) => s + v, 0);
  const sumAB = a.reduce((s, v, i) => s + v * b[i], 0);
  const sumA2 = a.reduce((s, v) => s + v * v, 0);
  const sumB2 = b.reduce((s, v) => s + v * v, 0);

  const numerator = n * sumAB - sumA * sumB;
  const sqrtArg = (n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB);
  const denominator = Math.sqrt(Math.max(0, sqrtArg));

  return denominator === 0 ? 0 : numerator / denominator;
}

// 快速 DTW 近似（限制搜索窗口）
export function fastDtwDistance(
  a: number[],
  b: number[],
  windowSize: number = 5
): number {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return Infinity;

  const dp: number[][] = Array(n + 1)
    .fill(null)
    .map(() => Array(m + 1).fill(Infinity));
  dp[0][0] = 0;

  for (let i = 1; i <= n; i++) {
    const startJ = Math.max(1, i - windowSize);
    const endJ = Math.min(m, i + windowSize);
    for (let j = startJ; j <= endJ; j++) {
      const cost = Math.abs(a[i - 1] - b[j - 1]);
      dp[i][j] =
        cost + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[n][m];
}

// 计算波动率
export function calculateVolatility(prices: number[]): number {
  if (prices.length < 2) return 0;
  const returns = calculateReturns(prices);
  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const variance =
    returns.reduce((s, v) => s + (v - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

// 计算趋势方向得分 (0-100, 50=横盘)
export function calculateTrendScore(prices: number[]): number {
  if (prices.length < 10) return 50;
  const firstHalf = prices.slice(0, Math.floor(prices.length * 0.3));
  const secondHalf = prices.slice(Math.floor(prices.length * 0.7));
  const firstAvg = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
  const change = (secondAvg - firstAvg) / firstAvg;
  // 映射到 0-100: -0.3->0, 0->50, +0.3->100
  return Math.max(0, Math.min(100, 50 + change * 200));
}

// ─────────────────────────────────────────────
//  多维综合相似度计算（核心）
// ─────────────────────────────────────────────

export interface KlineData {
  close: number;
  volume: number;
  turnoverRate?: number;
  volumeRatio?: number;
}

export interface SimilarityResult {
  score: number;          // 0-100 综合相似度
  priceScore: number;     // 价格走势相似度
  volumeScore: number;    // 成交量相似度
  volatilityScore: number;// 波动率相似度
  trendScore: number;     // 趋势相似度
  maScore: number;        // 均线趋势相似度
  supportResistScore: number; // 支撑阻力位相似度
  volumePriceScore: number;   // 量价配合相似度
  klinePatternScore: number;  // K线形态相似度
  returnDistScore: number;    // 涨跌幅分布相似度
  descriptions: string[]; // 各维度具体匹配原因描述
}

/**
 * 多维综合相似度计算
 * 纳入：价格走势 + 成交量模式 + 波动率 + 趋势方向
 */
export function calculateMultiDimensionalSimilarity(
  target: KlineData[],
  candidate: KlineData[]
): SimilarityResult {
  if (target.length === 0 || candidate.length === 0) {
    return { score: 0, priceScore: 0, volumeScore: 0, volatilityScore: 0, trendScore: 0 };
  }

  const minLen = Math.min(target.length, candidate.length);
  const t = target.slice(0, minLen);
  const c = candidate.slice(0, minLen);

  // 1. 价格走势相似度 (Pearson + DTW)
  const tPrices = t.map((k) => k.close);
  const cPrices = c.map((k) => k.close);
  const normT = normalize(tPrices);
  const normC = normalize(cPrices);

  const pearson = pearsonCorrelation(normT, normC);
  const pearsonScore = Math.max(0, (pearson + 1) / 2 * 100);

  const dtw = fastDtwDistance(normT, normC, Math.max(5, Math.floor(minLen * 0.2)));
  const maxDtw = minLen;
  const dtwScore = Math.max(0, 100 - (dtw / maxDtw) * 100);

  const priceScore = Math.round(pearsonScore * 0.6 + dtwScore * 0.4);

  // 2. 成交量模式相似度
  const tVolumes = t.map((k) => k.volume);
  const cVolumes = c.map((k) => k.volume);
  const normTVol = normalize(tVolumes);
  const normCVol = normalize(cVolumes);
  const volPearson = pearsonCorrelation(normTVol, normCVol);
  const volumeScore = Math.max(0, (volPearson + 1) / 2 * 100);

  // 3. 波动率相似度
  const tVol = calculateVolatility(tPrices);
  const cVol = calculateVolatility(cPrices);
  const volDiff = Math.abs(tVol - cVol);
  const maxVol = Math.max(tVol, cVol, 0.001);
  const volatilityScore = Math.round(Math.max(0, 100 - (volDiff / maxVol) * 100));

  // 4. 趋势相似度
  const tTrend = calculateTrendScore(tPrices);
  const cTrend = calculateTrendScore(cPrices);
  const trendDiff = Math.abs(tTrend - cTrend);
  const trendScore = Math.round(Math.max(0, 100 - trendDiff));

  // 5. MA均线趋势相似度（MA5/MA10/MA20方向一致性）
  const tMA5 = maDirection(tPrices, 5);
  const tMA10 = maDirection(tPrices, 10);
  const tMA20 = maDirection(tPrices, 20);
  const cMA5 = maDirection(cPrices, 5);
  const cMA10 = maDirection(cPrices, 10);
  const cMA20 = maDirection(cPrices, 20);
  const maMatch = [tMA5 === cMA5, tMA10 === cMA10, tMA20 === cMA20].filter(Boolean).length;
  const maScore = Math.round((maMatch / 3) * 100);

  // 6. 支撑阻力位相似度（近期高低点比例）
  const tSR = supportResistanceRatio(tPrices);
  const cSR = supportResistanceRatio(cPrices);
  const supportResistScore = Math.round(100 - Math.min(100, Math.abs(tSR - cSR) * 100));

  // 7. 量价配合相似度（价涨量增/价跌量缩的一致性）
  const vpScore = volumePriceCoherence(t, c);
  const volumePriceScore = Math.round(vpScore);

  // 8. K线形态相似度（阳线/阴线排列模式）
  const tKP = klinePattern(tPrices);
  const cKP = klinePattern(cPrices);
  const klinePatternScore = Math.round(100 - Math.min(100, Math.abs(tKP - cKP) * 100));

  // 9. 涨跌幅分布相似度（收益率分布的Pearson相关）
  const tReturns = calculateReturns(tPrices);
  const cReturns = calculateReturns(cPrices);
  const minR = Math.min(tReturns.length, cReturns.length);
  const returnPearson = minR > 5 ? pearsonCorrelation(tReturns.slice(0, minR), cReturns.slice(0, minR)) : 0;
  const returnDistScore = Math.max(0, (returnPearson + 1) / 2 * 100);

  // 综合加权得分（价格走势为主，新增维度纳入）
  const score = Math.round(
    priceScore * 0.40 +
    volumeScore * 0.10 +
    volatilityScore * 0.05 +
    trendScore * 0.10 +
    maScore * 0.10 +
    supportResistScore * 0.05 +
    volumePriceScore * 0.05 +
    klinePatternScore * 0.05 +
    returnDistScore * 0.10
  );

  // ── 生成各维度具体匹配原因描述 ──
  const descriptions: string[] = [];

  // 价格走势
  const pDesc = pearsonScore >= 85 ? "高度一致" : pearsonScore >= 70 ? "较为相似" : pearsonScore >= 50 ? "大致相近" : "差异较大";
  descriptions.push(`价格走势${pDesc}（Pearson相关系数${pearson.toFixed(2)}）`);

  // 形态节奏
  const dDesc = dtwScore >= 85 ? "高度同步" : dtwScore >= 70 ? "较为接近" : dtwScore >= 50 ? "部分吻合" : "差异明显";
  descriptions.push(`形态变化节奏${dDesc}`);

  // 量能
  const vDesc = volumeScore >= 85 ? "高度同步" : volumeScore >= 70 ? "较为一致" : volumeScore >= 50 ? "有一定相似性" : "差异较大";
  descriptions.push(`成交量变化${vDesc}`);

  // 波动率
  const voDesc = volatilityScore >= 85 ? "高度相近" : volatilityScore >= 70 ? "较为相似" : volatilityScore >= 50 ? "有一定相似性" : "差异较大";
  descriptions.push(`波动幅度${voDesc}（波动率差异${(Math.abs(tVol-cVol)*100).toFixed(1)}%）`);

  // 趋势
  const tDir = tTrend > 55 ? "上升" : tTrend < 45 ? "下降" : "横盘";
  const cDir = cTrend > 55 ? "上升" : cTrend < 45 ? "下降" : "横盘";
  descriptions.push(`整体趋势${tDir === cDir ? `一致（均为${tDir}趋势）` : `不同（目标${tDir} vs 候选${cDir}）`}`);

  // 均线
  const maArr: string[] = [];
  if (tMA5 === cMA5) maArr.push("MA5");
  if (tMA10 === cMA10) maArr.push("MA10");
  if (tMA20 === cMA20) maArr.push("MA20");
  descriptions.push(`均线趋势${maArr.length >= 2 ? "高度一致" : "部分一致"}（${maArr.length > 0 ? maArr.join(",") + "方向相同" : "方向不同"}）`);

  // 量价配合
  const vpDesc = volumePriceScore >= 80 ? "良好" : volumePriceScore >= 60 ? "一般" : "较弱";
  descriptions.push(`量价配合程度${vpDesc}`);

  // 支撑阻力
  const srDesc = supportResistScore >= 80 ? "相近" : supportResistScore >= 60 ? "有一定相似性" : "差异较大";
  descriptions.push(`支撑阻力位置${srDesc}`);

  // K线形态
  const kpDesc = klinePatternScore >= 80 ? "高度相似" : klinePatternScore >= 60 ? "较为相似" : "差异较大";
  descriptions.push(`K线形态（阳线/阴线排列）${kpDesc}`);

  return {
    score,
    priceScore: Math.round(priceScore),
    volumeScore: Math.round(volumeScore),
    volatilityScore: Math.round(volatilityScore),
    trendScore: Math.round(trendScore),
    maScore,
    supportResistScore,
    volumePriceScore,
    klinePatternScore,
    returnDistScore: Math.round(returnDistScore),
    descriptions,
  };
}

// ── 新增维度辅助函数 ──

/** MA均线方向：1=上升, 0=下降 */
function maDirection(prices: number[], period: number): number {
  if (prices.length < period + 1) return 0;
  const sumEnd = prices.slice(-period).reduce((s, v) => s + v, 0);
  const sumStart = prices.slice(-period - 1, -1).reduce((s, v) => s + v, 0);
  return sumEnd >= sumStart ? 1 : 0;
}

/** 支撑阻力位：近期高低点范围占整体范围的比例 (0-1) */
function supportResistanceRatio(prices: number[]): number {
  if (prices.length < 10) return 0.5;
  const recent = prices.slice(-10);
  const recentRange = Math.max(...recent) - Math.min(...recent);
  const totalRange = Math.max(...prices) - Math.min(...prices);
  if (totalRange === 0) return 0.5;
  return recentRange / totalRange;
}

/** 量价配合：价涨量增/价跌量缩的一致性得分 (0-100) */
function volumePriceCoherence(target: KlineData[], candidate: KlineData[]): number {
  const n = Math.min(target.length, candidate.length);
  if (n < 2) return 50;
  let match = 0;
  for (let i = 1; i < n; i++) {
    const tPriceUp = target[i].close >= target[i-1].close;
    const tVolUp = target[i].volume >= target[i-1].volume;
    const cPriceUp = candidate[i].close >= candidate[i-1].close;
    const cVolUp = candidate[i].volume >= candidate[i-1].volume;
    // 价涨量增 或 价跌量缩 都算配合
    const tCoherent = (tPriceUp && tVolUp) || (!tPriceUp && !tVolUp);
    const cCoherent = (cPriceUp && cVolUp) || (!cPriceUp && !cVolUp);
    if (tCoherent === cCoherent) match++;
  }
  return (match / (n - 1)) * 100;
}

/** K线形态：阳线占比 (0-1)，用于比较形态 */
function klinePattern(prices: number[]): number {
  if (prices.length < 2) return 0.5;
  let upDays = 0;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] >= prices[i-1]) upDays++;
  }
  return upDays / (prices.length - 1);
}

/**
 * 兼容旧版的单维相似度计算
 */
export function calculateSimilarity(target: number[], candidate: number[]): number {
  if (target.length === 0 || candidate.length === 0) return 0;

  const normTarget = normalize(target);
  const normCandidate = normalize(candidate);

  const pearson = pearsonCorrelation(normTarget, normCandidate);
  const pearsonScore = Math.max(0, (pearson + 1) / 2 * 100);

  const dtw = fastDtwDistance(normTarget, normCandidate, Math.max(5, Math.floor(target.length * 0.2)));
  const maxDtw = target.length;
  const dtwScore = Math.max(0, 100 - (dtw / maxDtw) * 100);

  return Math.round(pearsonScore * 0.6 + dtwScore * 0.4);
}
