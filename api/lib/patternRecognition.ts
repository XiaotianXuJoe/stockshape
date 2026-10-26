/**
 * 股票K线形态识别算法库
 * 基于ZigZag极值点检测 + 几何模式匹配
 */

export type PatternType =
  | "W_BOTTOM"
  | "M_TOP"
  | "HEAD_SHOULDERS_TOP"
  | "HEAD_SHOULDERS_BOTTOM"
  | "ASCENDING_TRIANGLE"
  | "DESCENDING_TRIANGLE"
  | "SYMMETRICAL_TRIANGLE"
  | "FLAG"
  | "WEDGE"
  | "CHANNEL_UP"
  | "CHANNEL_DOWN";

export interface PatternResult {
  type: PatternType;
  confidence: number; // 0-100
  startIndex: number;
  endIndex: number;
  entryPrice?: number;
  targetPrice?: number;
  stopLoss?: number;
  description: string;
}

interface PricePoint {
  index: number;
  price: number;
  date: string;
  type: "peak" | "valley";
}

// ─────────────────────────────────────────────
//  ZigZag 极值点提取
// ─────────────────────────────────────────────

/**
 * 提取价格序列的ZigZag极值点
 * @param prices 收盘价序列
 * @param threshold 转折点阈值（百分比），默认3%
 */
export function zigzagPoints(
  prices: number[],
  threshold: number = 0.03
): PricePoint[] {
  if (prices.length < 3) return [];

  const points: PricePoint[] = [];
  let lastExtremeIndex = 0;
  let lastExtremePrice = prices[0];
  let direction: "up" | "down" | null = null;

  for (let i = 1; i < prices.length; i++) {
    const change = (prices[i] - lastExtremePrice) / lastExtremePrice;

    if (direction === null) {
      if (Math.abs(change) >= threshold) {
        direction = change > 0 ? "up" : "down";
        points.push({
          index: lastExtremeIndex,
          price: lastExtremePrice,
          date: "",
          type: direction === "up" ? "valley" : "peak",
        });
        lastExtremeIndex = i;
        lastExtremePrice = prices[i];
      }
    } else if (direction === "up") {
      if (prices[i] > lastExtremePrice) {
        lastExtremeIndex = i;
        lastExtremePrice = prices[i];
      } else if ((lastExtremePrice - prices[i]) / lastExtremePrice >= threshold) {
        points.push({
          index: lastExtremeIndex,
          price: lastExtremePrice,
          date: "",
          type: "peak",
        });
        direction = "down";
        lastExtremeIndex = i;
        lastExtremePrice = prices[i];
      }
    } else {
      if (prices[i] < lastExtremePrice) {
        lastExtremeIndex = i;
        lastExtremePrice = prices[i];
      } else if ((prices[i] - lastExtremePrice) / lastExtremePrice >= threshold) {
        points.push({
          index: lastExtremeIndex,
          price: lastExtremePrice,
          date: "",
          type: "valley",
        });
        direction = "up";
        lastExtremeIndex = i;
        lastExtremePrice = prices[i];
      }
    }
  }

  // 添加最后一个点
  if (lastExtremeIndex > (points[points.length - 1]?.index ?? -1)) {
    points.push({
      index: lastExtremeIndex,
      price: lastExtremePrice,
      date: "",
      type: direction === "up" ? "peak" : "valley",
    });
  }

  return points;
}

// ─────────────────────────────────────────────
//  形态检测主函数
// ─────────────────────────────────────────────

export function detectPatterns(
  prices: number[],
  dates: string[],
  volumes: number[] = []
): PatternResult[] {
  const patterns: PatternResult[] = [];
  const points = zigzagPoints(prices, 0.025); // 2.5%阈值

  if (points.length < 3) return patterns;

  // 为每个极值点添加日期
  points.forEach((p) => {
    p.date = dates[p.index] || "";
  });

  // 检测各种形态
  const wBottom = detectWBottom(points, prices, volumes);
  if (wBottom) patterns.push(wBottom);

  const mTop = detectMTop(points, prices, volumes);
  if (mTop) patterns.push(mTop);

  const hsTop = detectHeadShouldersTop(points, prices, volumes);
  if (hsTop) patterns.push(hsTop);

  const hsBottom = detectHeadShouldersBottom(points, prices, volumes);
  if (hsBottom) patterns.push(hsBottom);

  const triangle = detectTriangle(points, prices);
  if (triangle) patterns.push(triangle);

  const flag = detectFlag(points, prices);
  if (flag) patterns.push(flag);

  const wedge = detectWedge(points, prices);
  if (wedge) patterns.push(wedge);

  const channel = detectChannel(points, prices);
  if (channel) patterns.push(channel);

  // 按置信度排序
  patterns.sort((a, b) => b.confidence - a.confidence);

  return patterns.slice(0, 3); // 最多返回3个形态
}

// ─────────────────────────────────────────────
//  W底检测
// ─────────────────────────────────────────────

function detectWBottom(
  points: PricePoint[],
  prices: number[],
  volumes: number[]
): PatternResult | null {
  // 需要至少4个点：低-高-低-高
  if (points.length < 4) return null;

  // 寻找最后一个低点开始的模式
  for (let i = points.length - 1; i >= 3; i--) {
    const p4 = points[i];     // 最后一个高点（突破点）
    const p3 = points[i - 1]; // 第二个低点
    const p2 = points[i - 2]; // 中间高点（颈线）
    const p1 = points[i - 3]; // 第一个低点

    // 必须是：valley - peak - valley - peak
    if (p1.type !== "valley" || p2.type !== "peak" || p3.type !== "valley" || p4.type !== "peak") {
      continue;
    }

    // 条件1：两个低点价格相近（第二个不低于第一个的98%）
    const bottomSimilarity = p3.price >= p1.price * 0.98;

    // 条件2：第二个低点不低于第一个太多（不超过3%）
    const secondNotLower = p3.price >= p1.price * 0.97;

    // 条件3：颈线（中间高点）明显高于两个低点
    const necklineHeight = (p2.price - Math.min(p1.price, p3.price)) / Math.min(p1.price, p3.price);
    const hasValidNeckline = necklineHeight > 0.02;

    // 条件4：突破颈线（最后一个高点高于颈线）
    const breakout = p4.price > p2.price;

    // 条件5：两个低点之间有一定时间间隔（至少5根K线）
    const timeBetweenBottoms = p3.index - p1.index;
    const hasTimeGap = timeBetweenBottoms >= 5;

    if (bottomSimilarity && secondNotLower && hasValidNeckline && hasTimeGap) {
      // 计算突破后的目标价位：颈线 + (颈线 - 最低点)
      const neckline = p2.price;
      const lowest = Math.min(p1.price, p3.price);
      const targetPrice = neckline + (neckline - lowest);

      // 计算置信度
      let confidence = 50;
      if (breakout) confidence += 20;
      if (Math.abs(p1.price - p3.price) / p1.price < 0.01) confidence += 15; // 两个低点几乎相等
      if (necklineHeight > 0.05) confidence += 10;
      if (hasVolumeConfirmation(p1.index, p3.index, p4.index, volumes)) confidence += 5;

      return {
        type: "W_BOTTOM",
        confidence: Math.min(100, confidence),
        startIndex: p1.index,
        endIndex: p4.index,
        entryPrice: p2.price, // 颈线突破点
        targetPrice: Math.round(targetPrice * 100) / 100,
        stopLoss: Math.round(p3.price * 0.98 * 100) / 100,
        description: `W底形态：两次探底后突破颈线，目标价${targetPrice.toFixed(2)}`,
      };
    }
  }

  return null;
}

// ─────────────────────────────────────────────
//  M头检测
// ─────────────────────────────────────────────

function detectMTop(
  points: PricePoint[],
  prices: number[],
  volumes: number[]
): PatternResult | null {
  if (points.length < 4) return null;

  for (let i = points.length - 1; i >= 3; i--) {
    const p4 = points[i];     // 最后一个低点（跌破颈线）
    const p3 = points[i - 1]; // 第二个高点
    const p2 = points[i - 2]; // 中间低点（颈线）
    const p1 = points[i - 3]; // 第一个高点

    if (p1.type !== "peak" || p2.type !== "valley" || p3.type !== "peak" || p4.type !== "valley") {
      continue;
    }

    // 条件1：两个高点价格相近
    const topSimilarity = p3.price >= p1.price * 0.98;

    // 条件2：第二个高点不超过第一个太多（不超过2%）
    const secondNotHigher = p3.price <= p1.price * 1.02;

    // 条件3：颈线（中间低点）明显低于两个高点
    const necklineDepth = (Math.min(p1.price, p3.price) - p2.price) / p2.price;
    const hasValidNeckline = necklineDepth > 0.02;

    // 条件4：跌破颈线
    const breakdown = p4.price < p2.price;

    // 条件5：时间间隔
    const timeBetweenTops = p3.index - p1.index;
    const hasTimeGap = timeBetweenTops >= 5;

    if (topSimilarity && secondNotHigher && hasValidNeckline && hasTimeGap) {
      const neckline = p2.price;
      const highest = Math.max(p1.price, p3.price);
      const targetPrice = neckline - (highest - neckline);

      let confidence = 50;
      if (breakdown) confidence += 20;
      if (Math.abs(p1.price - p3.price) / p1.price < 0.01) confidence += 15;
      if (necklineDepth > 0.05) confidence += 10;

      return {
        type: "M_TOP",
        confidence: Math.min(100, confidence),
        startIndex: p1.index,
        endIndex: p4.index,
        entryPrice: neckline,
        targetPrice: Math.round(Math.max(targetPrice, neckline * 0.85) * 100) / 100,
        stopLoss: Math.round(highest * 1.02 * 100) / 100,
        description: `M头形态：两次冲顶后跌破颈线，目标价${targetPrice.toFixed(2)}`,
      };
    }
  }

  return null;
}

// ─────────────────────────────────────────────
//  头肩顶检测
// ─────────────────────────────────────────────

function detectHeadShouldersTop(
  points: PricePoint[],
  prices: number[],
  volumes: number[]
): PatternResult | null {
  if (points.length < 5) return null;

  for (let i = points.length - 1; i >= 4; i--) {
    const p5 = points[i];     // 右肩后的低点（跌破颈线）
    const p4 = points[i - 1]; // 右肩
    const p3 = points[i - 2]; // 头（最高点）
    const p2 = points[i - 3]; // 左肩后的低点
    const p1 = points[i - 4]; // 左肩

    if (
      p1.type !== "peak" ||
      p2.type !== "valley" ||
      p3.type !== "peak" ||
      p4.type !== "peak" ||
      p5.type !== "valley"
    ) {
      continue;
    }

    // 头明显高于两肩
    const headAboveLeft = p3.price > p1.price * 1.02;
    const headAboveRight = p3.price > p4.price * 1.02;

    // 两肩高度相近
    const shouldersSimilar = Math.abs(p1.price - p4.price) / p1.price < 0.05;

    // 颈线（连接两个谷底）
    const neckline = (p2.price + p5.price) / 2;

    // 跌破颈线
    const breakdown = p5.price < neckline * 0.99;

    if (headAboveLeft && headAboveRight && shouldersSimilar) {
      const targetPrice = neckline - (p3.price - neckline);

      let confidence = 60;
      if (breakdown) confidence += 20;
      if (p3.price > Math.max(p1.price, p4.price) * 1.05) confidence += 10;

      return {
        type: "HEAD_SHOULDERS_TOP",
        confidence: Math.min(100, confidence),
        startIndex: p1.index,
        endIndex: p5.index,
        entryPrice: Math.round(neckline * 100) / 100,
        targetPrice: Math.round(Math.max(targetPrice, neckline * 0.8) * 100) / 100,
        stopLoss: Math.round(p3.price * 1.02 * 100) / 100,
        description: `头肩顶形态：左肩-头-右肩，跌破颈线后目标价${targetPrice.toFixed(2)}`,
      };
    }
  }

  return null;
}

// ─────────────────────────────────────────────
//  头肩底检测
// ─────────────────────────────────────────────

function detectHeadShouldersBottom(
  points: PricePoint[],
  prices: number[],
  volumes: number[]
): PatternResult | null {
  if (points.length < 5) return null;

  for (let i = points.length - 1; i >= 4; i--) {
    const p5 = points[i];     // 右肩后的高点（突破颈线）
    const p4 = points[i - 1]; // 右肩
    const p3 = points[i - 2]; // 头（最低点）
    const p2 = points[i - 3]; // 左肩后的高点
    const p1 = points[i - 4]; // 左肩

    if (
      p1.type !== "valley" ||
      p2.type !== "peak" ||
      p3.type !== "valley" ||
      p4.type !== "valley" ||
      p5.type !== "peak"
    ) {
      continue;
    }

    // 头明显低于两肩
    const headBelowLeft = p3.price < p1.price * 0.98;
    const headBelowRight = p3.price < p4.price * 0.98;

    // 两肩高度相近
    const shouldersSimilar = Math.abs(p1.price - p4.price) / p1.price < 0.05;

    // 颈线
    const neckline = (p2.price + p5.price) / 2;

    // 突破颈线
    const breakout = p5.price > neckline * 1.01;

    if (headBelowLeft && headBelowRight && shouldersSimilar) {
      const targetPrice = neckline + (neckline - p3.price);

      let confidence = 60;
      if (breakout) confidence += 20;
      if (p3.price < Math.min(p1.price, p4.price) * 0.95) confidence += 10;

      return {
        type: "HEAD_SHOULDERS_BOTTOM",
        confidence: Math.min(100, confidence),
        startIndex: p1.index,
        endIndex: p5.index,
        entryPrice: Math.round(neckline * 100) / 100,
        targetPrice: Math.round(targetPrice * 100) / 100,
        stopLoss: Math.round(p3.price * 0.98 * 100) / 100,
        description: `头肩底形态：左肩-头-右肩，突破颈线后目标价${targetPrice.toFixed(2)}`,
      };
    }
  }

  return null;
}

// ─────────────────────────────────────────────
//  三角形检测
// ─────────────────────────────────────────────

function detectTriangle(
  points: PricePoint[],
  prices: number[]
): PatternResult | null {
  if (points.length < 5) return null;

  // 取最近5个极值点分析
  const recent = points.slice(-5);

  const peaks = recent.filter((p) => p.type === "peak");
  const valleys = recent.filter((p) => p.type === "valley");

  if (peaks.length < 2 || valleys.length < 2) return null;

  // 上升三角形：高点平齐，低点递增
  const peakPrices = peaks.map((p) => p.price);
  const valleyPrices = valleys.map((p) => p.price);

  const maxPeak = Math.max(...peakPrices);
  const minPeak = Math.min(...peakPrices);
  const peakFlatness = (maxPeak - minPeak) / maxPeak < 0.03;

  const valleyTrend = valleyPrices[valleyPrices.length - 1] > valleyPrices[0];
  const valleyIncrease = (valleyPrices[valleyPrices.length - 1] - valleyPrices[0]) / valleyPrices[0];

  if (peakFlatness && valleyTrend && valleyIncrease > 0.02) {
    return {
      type: "ASCENDING_TRIANGLE",
      confidence: Math.min(100, 60 + valleyIncrease * 1000),
      startIndex: recent[0].index,
      endIndex: recent[recent.length - 1].index,
      entryPrice: maxPeak,
      targetPrice: Math.round((maxPeak + (maxPeak - valleyPrices[0])) * 100) / 100,
      stopLoss: Math.round(valleyPrices[valleyPrices.length - 1] * 0.98 * 100) / 100,
      description: `上升三角形：高点平齐，低点抬高，突破后目标价${(maxPeak + (maxPeak - valleyPrices[0])).toFixed(2)}`,
    };
  }

  // 下降三角形：低点平齐，高点递减
  const maxValley = Math.max(...valleyPrices);
  const minValley = Math.min(...valleyPrices);
  const valleyFlatness = (maxValley - minValley) / maxValley < 0.03;

  const peakTrend = peakPrices[peakPrices.length - 1] < peakPrices[0];
  const peakDecrease = (peakPrices[0] - peakPrices[peakPrices.length - 1]) / peakPrices[0];

  if (valleyFlatness && peakTrend && peakDecrease > 0.02) {
    return {
      type: "DESCENDING_TRIANGLE",
      confidence: Math.min(100, 60 + peakDecrease * 1000),
      startIndex: recent[0].index,
      endIndex: recent[recent.length - 1].index,
      entryPrice: minValley,
      targetPrice: Math.round((minValley - (peakPrices[0] - minValley)) * 100) / 100,
      stopLoss: Math.round(peakPrices[0] * 1.02 * 100) / 100,
      description: `下降三角形：低点平齐，高点降低，跌破后目标价${(minValley - (peakPrices[0] - minValley)).toFixed(2)}`,
    };
  }

  // 对称三角形：高点递减，低点递增
  if (peakTrend && valleyTrend && peakDecrease > 0.02 && valleyIncrease > 0.02) {
    const apex = (peakPrices[peakPrices.length - 1] + valleyPrices[valleyPrices.length - 1]) / 2;
    return {
      type: "SYMMETRICAL_TRIANGLE",
      confidence: Math.min(100, 55 + (peakDecrease + valleyIncrease) * 500),
      startIndex: recent[0].index,
      endIndex: recent[recent.length - 1].index,
      description: `对称三角形：高点降低，低点抬高，等待突破方向`,
    };
  }

  return null;
}

// ─────────────────────────────────────────────
//  旗形检测
// ─────────────────────────────────────────────

function detectFlag(
  points: PricePoint[],
  prices: number[]
): PatternResult | null {
  if (points.length < 4 || prices.length < 20) return null;

  // 旗形：快速上涨/下跌后的平行整理
  const recent = points.slice(-4);
  if (recent.length < 4) return null;

  const p1 = recent[0];
  const p2 = recent[1];
  const p3 = recent[2];
  const p4 = recent[3];

  // 检查是否是平行通道
  const topSlope = Math.abs(p2.price - p4.price) / p2.price;
  const bottomSlope = Math.abs(p1.price - p3.price) / p1.price;
  const parallel = Math.abs(topSlope - bottomSlope) < 0.02;

  // 前面有一段快速趋势（旗杆）
  const beforePole = prices.slice(Math.max(0, p1.index - 10), p1.index);
  const poleChange = beforePole.length > 1
    ? (beforePole[beforePole.length - 1] - beforePole[0]) / beforePole[0]
    : 0;
  const hasPole = Math.abs(poleChange) > 0.05;

  if (parallel && hasPole && topSlope < 0.03) {
    const isBullFlag = poleChange > 0; // 上涨后的整理
    return {
      type: "FLAG",
      confidence: Math.min(100, 60 + Math.abs(poleChange) * 500),
      startIndex: p1.index,
      endIndex: p4.index,
      description: isBullFlag
        ? "看涨旗形：快速上涨后的平行整理，突破后继续上涨"
        : "看跌旗形：快速下跌后的平行整理，跌破后继续下跌",
    };
  }

  return null;
}

// ─────────────────────────────────────────────
//  楔形检测
// ─────────────────────────────────────────────

function detectWedge(
  points: PricePoint[],
  prices: number[]
): PatternResult | null {
  if (points.length < 4) return null;

  const recent = points.slice(-4);
  if (recent.length < 4) return null;

  // 上升楔形：高点和低点都递增，但收敛
  const p1 = recent[0];
  const p2 = recent[1];
  const p3 = recent[2];
  const p4 = recent[3];

  // 所有点都递增
  const allAscending = p1.price < p3.price && p2.price < p4.price;
  // 但收敛（高点增速慢于低点增速）
  const topIncrease = (p4.price - p2.price) / p2.price;
  const bottomIncrease = (p3.price - p1.price) / p1.price;
  const converging = topIncrease < bottomIncrease && topIncrease > 0;

  if (allAscending && converging) {
    return {
      type: "WEDGE",
      confidence: Math.min(100, 55 + (bottomIncrease - topIncrease) * 2000),
      startIndex: p1.index,
      endIndex: p4.index,
      description: "上升楔形：高点和低点收敛上升，通常是看跌信号",
    };
  }

  // 下降楔形：高点和低点都递减，但收敛
  const allDescending = p1.price > p3.price && p2.price > p4.price;
  const topDecrease = (p2.price - p4.price) / p2.price;
  const bottomDecrease = (p1.price - p3.price) / p1.price;
  const convergingDown = topDecrease < bottomDecrease && topDecrease > 0;

  if (allDescending && convergingDown) {
    return {
      type: "WEDGE",
      confidence: Math.min(100, 55 + (bottomDecrease - topDecrease) * 2000),
      startIndex: p1.index,
      endIndex: p4.index,
      description: "下降楔形：高点和低点收敛下降，通常是看涨信号",
    };
  }

  return null;
}

// ─────────────────────────────────────────────
//  通道检测
// ─────────────────────────────────────────────

function detectChannel(
  points: PricePoint[],
  prices: number[]
): PatternResult | null {
  if (points.length < 4) return null;

  // 取最近4个点检测平行通道
  const recent = points.slice(-4);
  if (recent.length < 4) return null;

  const peaks = recent.filter((p) => p.type === "peak");
  const valleys = recent.filter((p) => p.type === "valley");

  if (peaks.length < 2 || valleys.length < 2) return null;

  // 上升通道：高点和低点都递增
  const peakTrend = peaks[peaks.length - 1].price > peaks[0].price;
  const valleyTrend = valleys[valleys.length - 1].price > valleys[0].price;

  if (peakTrend && valleyTrend) {
    const topSlope = (peaks[peaks.length - 1].price - peaks[0].price) / peaks[0].price;
    const bottomSlope = (valleys[valleys.length - 1].price - valleys[0].price) / valleys[0].price;
    const parallel = Math.abs(topSlope - bottomSlope) < 0.03;

    if (parallel && topSlope > 0.02) {
      return {
        type: "CHANNEL_UP",
        confidence: Math.min(100, 55 + topSlope * 1000),
        startIndex: recent[0].index,
        endIndex: recent[recent.length - 1].index,
        description: `上升通道：高点和低点同步抬高，斜率${(topSlope * 100).toFixed(1)}%`,
      };
    }
  }

  // 下降通道
  const peakDown = peaks[peaks.length - 1].price < peaks[0].price;
  const valleyDown = valleys[valleys.length - 1].price < valleys[0].price;

  if (peakDown && valleyDown) {
    const topSlope = (peaks[0].price - peaks[peaks.length - 1].price) / peaks[0].price;
    const bottomSlope = (valleys[0].price - valleys[valleys.length - 1].price) / valleys[0].price;
    const parallel = Math.abs(topSlope - bottomSlope) < 0.03;

    if (parallel && topSlope > 0.02) {
      return {
        type: "CHANNEL_DOWN",
        confidence: Math.min(100, 55 + topSlope * 1000),
        startIndex: recent[0].index,
        endIndex: recent[recent.length - 1].index,
        description: `下降通道：高点和低点同步降低，斜率${(topSlope * 100).toFixed(1)}%`,
      };
    }
  }

  return null;
}

// ─────────────────────────────────────────────
//  成交量确认辅助函数
// ─────────────────────────────────────────────

function hasVolumeConfirmation(
  idx1: number,
  idx2: number,
  idx3: number,
  volumes: number[]
): boolean {
  if (volumes.length === 0) return false;

  // 突破时成交量放大
  const avgVol = volumes.slice(idx1, idx3 + 1).reduce((a, b) => a + b, 0) / (idx3 - idx1 + 1);
  const breakoutVol = volumes[idx3] || 0;
  return breakoutVol > avgVol * 1.3;
}

// ─────────────────────────────────────────────
//  获取形态中文名称
// ─────────────────────────────────────────────

export function getPatternName(type: PatternType): string {
  const names: Record<PatternType, string> = {
    W_BOTTOM: "W底",
    M_TOP: "M头",
    HEAD_SHOULDERS_TOP: "头肩顶",
    HEAD_SHOULDERS_BOTTOM: "头肩底",
    ASCENDING_TRIANGLE: "上升三角形",
    DESCENDING_TRIANGLE: "下降三角形",
    SYMMETRICAL_TRIANGLE: "对称三角形",
    FLAG: "旗形",
    WEDGE: "楔形",
    CHANNEL_UP: "上升通道",
    CHANNEL_DOWN: "下降通道",
  };
  return names[type] || type;
}

export function getPatternSignal(type: PatternType): "bullish" | "bearish" | "neutral" {
  const signals: Record<PatternType, "bullish" | "bearish" | "neutral"> = {
    W_BOTTOM: "bullish",
    M_TOP: "bearish",
    HEAD_SHOULDERS_TOP: "bearish",
    HEAD_SHOULDERS_BOTTOM: "bullish",
    ASCENDING_TRIANGLE: "bullish",
    DESCENDING_TRIANGLE: "bearish",
    SYMMETRICAL_TRIANGLE: "neutral",
    FLAG: "neutral",
    WEDGE: "neutral",
    CHANNEL_UP: "bullish",
    CHANNEL_DOWN: "bearish",
  };
  return signals[type] || "neutral";
}
