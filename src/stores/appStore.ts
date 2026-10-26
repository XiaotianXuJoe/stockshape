import { create } from "zustand";
import type { StockSearchResult, SimilarStockResult } from "@contracts/types";

interface AppState {
  targetStock: StockSearchResult | null;
  dateRange: { start: string; end: string };
  results: SimilarStockResult[];
  selectedCandidate: string | null;
  loading: boolean;
  error: string | null;
  sortBy: "similarity" | "volume" | "turnoverRate" | "volumeRatio" | "sector" | "marketCap";
  sortOrder: "asc" | "desc";
  filterSector: string;
  /** 市值范围筛选（亿元，null表示不限） */
  filterMarketCap: { min: number | null; max: number | null };

  /** 形态识别模式 */
  patternMode: boolean;
  /** 形态过滤 */
  patternFilter: string[];
  /** 目标股票检测到的形态 */
  targetPatterns: Array<{ type: string; name: string; confidence: number; signal: string; description: string }>;
  /** 是否正在检测形态 */
  isDetectingPattern: boolean;

  setTargetStock: (stock: StockSearchResult | null) => void;
  setDateRange: (range: { start: string; end: string }) => void;
  setResults: (results: SimilarStockResult[]) => void;
  setSelectedCandidate: (code: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSortBy: (sortBy: AppState["sortBy"]) => void;
  setSortOrder: (order: "asc" | "desc") => void;
  setFilterSector: (sector: string) => void;
  setFilterMarketCap: (range: { min: number | null; max: number | null }) => void;
  setPatternMode: (v: boolean) => void;
  setPatternFilter: (patterns: string[]) => void;
  setTargetPatterns: (patterns: AppState["targetPatterns"]) => void;
  setIsDetectingPattern: (v: boolean) => void;

  getMatchDays: () => number;
  getSortedResults: () => SimilarStockResult[];
}

function getDefaultDateRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 180);
  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  targetStock: null,
  dateRange: getDefaultDateRange(),
  results: [],
  selectedCandidate: null,
  loading: false,
  error: null,
  sortBy: "similarity",
  sortOrder: "desc",
  filterSector: "all",
  filterMarketCap: { min: null, max: null },

  patternMode: false,
  patternFilter: [],
  targetPatterns: [],
  isDetectingPattern: false,

  setTargetStock: (stock) => set({ targetStock: stock, selectedCandidate: null }),
  setDateRange: (range) => set({ dateRange: range }),
  setResults: (results) => set({ results }),
  setSelectedCandidate: (code) => set({ selectedCandidate: code }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setSortBy: (sortBy) => set({ sortBy }),
  setSortOrder: (sortOrder) => set({ sortOrder }),
  setFilterSector: (filterSector) => set({ filterSector }),
  setFilterMarketCap: (filterMarketCap) => set({ filterMarketCap }),
  setPatternMode: (patternMode) => set({ patternMode }),
  setPatternFilter: (patternFilter) => set({ patternFilter }),
  setTargetPatterns: (targetPatterns) => set({ targetPatterns }),
  setIsDetectingPattern: (isDetectingPattern) => set({ isDetectingPattern }),

  getMatchDays: () => {
    const { start, end } = get().dateRange;
    const s = new Date(start);
    const e = new Date(end);
    const diffMs = e.getTime() - s.getTime();
    return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  },

  getSortedResults: () => {
    const { results, sortBy, sortOrder, filterSector, filterMarketCap } = get();

    // 大类行业 → 细分行业的映射（东方财富申万二级行业）
    const SECTOR_MAP: Record<string, string[]> = {
      "电子": ["半导体", "消费电子", "光学光电子", "其他电子Ⅱ", "电子化学品Ⅱ", "军工电子Ⅱ"],
      "计算机": ["软件开发", "IT服务Ⅱ"],
      "通信": ["通信设备"],
      "医药": ["化学制药", "生物制品", "医疗器械", "医疗服务"],
      "汽车": ["汽车零部件", "摩托车及其他"],
      "机械设备": ["专用设备", "通用设备", "自动化设备"],
      "电力设备": ["电池", "电网设备", "光伏设备", "风电设备", "其他电源设备Ⅱ"],
      "化工": ["化学制品", "化学纤维", "塑料", "电子化学品Ⅱ"],
      "有色金属": ["小金属", "金属新材料"],
      "家电": ["小家电", "黑色家电"],
      "军工": ["航空装备Ⅱ", "航天装备Ⅱ", "军工电子Ⅱ"],
      "环保": ["环保设备Ⅱ", "环境治理"],
      "汽车及零部件": ["汽车零部件", "摩托车及其他"],
    };

    let filtered = [...results];

    // ── 市值范围筛选 ──
    if (filterMarketCap.min !== null || filterMarketCap.max !== null) {
      filtered = filtered.filter((r) => {
        const cap = r.marketCap;
        if (cap === undefined || cap === null) return true;
        if (filterMarketCap.min !== null && cap < filterMarketCap.min) return false;
        if (filterMarketCap.max !== null && cap > filterMarketCap.max) return false;
        return true;
      });
    }

    if (filterSector !== "all") {
      const matchedSectors = new Set([filterSector, ...(SECTOR_MAP[filterSector] || [])]);
      filtered = results.filter((r) => {
        // 精确匹配 sector / industry
        if (matchedSectors.has(r.sector) || matchedSectors.has(r.industry)) return true;
        // 模糊匹配 concept（概念中常包含行业关键词）
        if (r.concept) {
          for (const s of matchedSectors) {
            if (r.concept.includes(s)) return true;
          }
        }
        return false;
      });
    }

    filtered.sort((a, b) => {
      let valA: number | string;
      let valB: number | string;

      switch (sortBy) {
        case "similarity":
          valA = a.similarityScore;
          valB = b.similarityScore;
          break;
        case "volume":
          valA = a.volume;
          valB = b.volume;
          break;
        case "turnoverRate":
          valA = a.turnoverRate;
          valB = b.turnoverRate;
          break;
        case "volumeRatio":
          valA = a.volumeRatio;
          valB = b.volumeRatio;
          break;
        case "sector":
          valA = a.sector;
          valB = b.sector;
          break;
        case "marketCap":
          valA = a.marketCap ?? 0;
          valB = b.marketCap ?? 0;
          break;
        default:
          valA = a.similarityScore;
          valB = b.similarityScore;
      }

      if (typeof valA === "string" && typeof valB === "string") {
        return sortOrder === "asc"
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      }

      return sortOrder === "asc"
        ? (valA as number) - (valB as number)
        : (valB as number) - (valA as number);
    });

    return filtered;
  },
}));
