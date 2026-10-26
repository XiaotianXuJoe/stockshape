import type { PatternResult } from "../api/lib/patternRecognition";

export * from "../api/lib/patternRecognition";

// K线数据类型
export interface HistoricalData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnoverRate: number;
  volumeRatio: number;
}

// 股票搜索结果类型
export interface StockSearchResult {
  code: string;
  name: string;
  pinyin: string;
  market: string;
}

// 相似股票结果类型（前端使用）
export interface SimilarStockResult {
  ticker: string;
  code: string;
  name: string;
  similarityScore: number;
  reasons: string[];
  detailedReasons: { dimension: string; description: string }[];
  detectedPattern: (PatternResult & { name: string; signal: string }) | null;
  volume: number;
  turnoverRate: number;
  volumeRatio: number;
  sector: string;
  industry: string;
  concept: string;
  change: number;
}

// 分析结果类型
export interface AnalysisResultItem {
  code: string;
  name: string;
  similarity: number;
  reasons: string;
  alignedPrices: number[];
  alignedTarget: number[];
  detectedPattern?: PatternResult & { name: string; signal: string };
  allPatterns?: PatternResult[];
}

export interface AnalysisResult {
  results: AnalysisResultItem[];
  targetSummary: {
    ticker: string;
    dateRange: string;
    klineCount: number;
  } | null;
  totalScanned: number;
  error: string | null;
}

// 形态检测返回类型
export interface PatternDetectionResult {
  patterns: Array<PatternResult & { name: string; signal: string }>;
  ticker: string;
  dateRange: string;
  klineCount: number;
  error: string | null;
}

// 可用形态选项
export const AVAILABLE_PATTERNS = [
  { value: "W_BOTTOM", label: "W底", signal: "bullish" },
  { value: "M_TOP", label: "M头", signal: "bearish" },
  { value: "HEAD_SHOULDERS_TOP", label: "头肩顶", signal: "bearish" },
  { value: "HEAD_SHOULDERS_BOTTOM", label: "头肩底", signal: "bullish" },
  { value: "ASCENDING_TRIANGLE", label: "上升三角形", signal: "bullish" },
  { value: "DESCENDING_TRIANGLE", label: "下降三角形", signal: "bearish" },
  { value: "SYMMETRICAL_TRIANGLE", label: "对称三角形", signal: "neutral" },
  { value: "FLAG", label: "旗形", signal: "neutral" },
  { value: "WEDGE", label: "楔形", signal: "neutral" },
  { value: "CHANNEL_UP", label: "上升通道", signal: "bullish" },
  { value: "CHANNEL_DOWN", label: "下降通道", signal: "bearish" },
] as const;
