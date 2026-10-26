import { useState } from "react";
import { Loader2, SlidersHorizontal, FlaskConical, Play } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { AVAILABLE_PATTERNS } from "@contracts/types";
import { normalizeResults, callAnalysisAPI } from "./ControlPanel";

/**
 * 策略组合筛选面板（①均线多头 ②平台突破 ⑨新高/回撤 + ⑬形态条件 任意叠加，AND 交集）
 * 另含 ⑭ 回测：以过去某日为信号日重跑筛选，计算 T+N 收益与胜率
 */

interface ParamDef { key: string; label: string; def: number }
interface FactorDef { type: string; label: string; desc: string; params: ParamDef[] }

const FACTORS: FactorDef[] = [
  {
    type: "ma_alignment",
    label: "均线多头排列",
    desc: "MA5>MA10>MA20>MA60 且向上",
    params: [{ key: "consecutiveDays", label: "持续≥日", def: 3 }],
  },
  {
    type: "platform_breakout",
    label: "平台突破",
    desc: "窄幅震荡后放量突破平台上沿",
    params: [
      { key: "platformDays", label: "平台天数", def: 30 },
      { key: "maxRangePct", label: "振幅≤%", def: 15 },
      { key: "volumeSurge", label: "放量≥倍", def: 1.5 },
    ],
  },
  {
    type: "n_day_high",
    label: "N日新高",
    desc: "收盘价创近N日新高",
    params: [{ key: "days", label: "N日", def: 250 }],
  },
  {
    type: "pullback_from_high",
    label: "高位回撤",
    desc: "距N日高点回撤X%~Y%（抄底候选）",
    params: [
      { key: "days", label: "N日", def: 250 },
      { key: "minPullbackPct", label: "回撤≥%", def: 20 },
      { key: "maxPullbackPct", label: "回撤≤%", def: 60 },
    ],
  },
];

interface BtSummary {
  asOfDate: string; horizonDays: number; totalScanned: number;
  sampleCount: number; completeCount: number;
  winRate: number; avgReturn: number; medianReturn: number;
  maxReturn: number; minReturn: number;
}

export default function StrategyPanel() {
  const setResults = useAppStore((s) => s.setResults);
  const setSelectedCandidate = useAppStore((s) => s.setSelectedCandidate);

  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    ma_alignment: true,
  });
  const [params, setParams] = useState<Record<string, Record<string, number>>>(() => {
    const init: Record<string, Record<string, number>> = {};
    for (const f of FACTORS) {
      init[f.type] = {};
      for (const p of f.params) init[f.type][p.key] = p.def;
    }
    return init;
  });
  const [patterns, setPatterns] = useState<string[]>([]);
  const [asOfDate, setAsOfDate] = useState("");
  const [btDate, setBtDate] = useState("");
  const [horizon, setHorizon] = useState(20);
  const [loading, setLoading] = useState(false);
  const [btLoading, setBtLoading] = useState(false);
  const [meta, setMeta] = useState<string | null>(null);
  const [summary, setSummary] = useState<BtSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buildConditions = () => {
    const conds: Array<Record<string, unknown>> = [];
    for (const f of FACTORS) {
      if (enabled[f.type]) conds.push({ type: f.type, params: params[f.type] });
    }
    if (patterns.length > 0) conds.push({ type: "pattern", patterns });
    return conds;
  };

  const runScreen = async () => {
    const conditions = buildConditions();
    if (conditions.length === 0) {
      setError("请至少勾选一个筛选条件");
      return;
    }
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const data = await callAnalysisAPI("analysis.screenByStrategy", {
        conditions,
        asOfDate: asOfDate || undefined,
      });
      if (data.error) {
        setError(data.error);
        setResults([]);
      } else {
        const converted = normalizeResults(data.results || []);
        setResults(converted);
        if (converted.length > 0) setSelectedCandidate(converted[0].ticker);
        setMeta(
          `信号日 ${data.asOfDate}：扫描 ${data.totalScanned} 只，命中 ${converted.length} 只（真实数据 ${data.realDataCount}）`
        );
      }
    } catch (e: any) {
      setError(e.message || "筛选请求失败");
    } finally {
      setLoading(false);
    }
  };

  const runBacktest = async () => {
    const conditions = buildConditions();
    if (conditions.length === 0) {
      setError("请至少勾选一个筛选条件");
      return;
    }
    if (!btDate) {
      setError("回测需要选择过去的信号日");
      return;
    }
    setBtLoading(true);
    setError(null);
    setSummary(null);
    try {
      const data = await callAnalysisAPI("analysis.backtestStrategy", {
        conditions,
        asOfDate: btDate,
        horizonDays: horizon,
      });
      if (data.error) {
        setError(data.error);
      } else {
        const converted = normalizeResults(data.results || []);
        setResults(converted);
        if (converted.length > 0) setSelectedCandidate(converted[0].ticker);
        setSummary(data.summary || null);
        setMeta(
          `回测 ${data.summary?.asOfDate} 信号 → T+${data.summary?.horizonDays}：样本 ${data.summary?.sampleCount} 只`
        );
      }
    } catch (e: any) {
      setError(e.message || "回测请求失败");
    } finally {
      setBtLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-background/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <SlidersHorizontal className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">策略筛选</h3>
        <span className="ml-auto text-[10px] text-muted-foreground">多条件取交集（AND）</span>
      </div>

      {/* 因子条件 */}
      <div className="space-y-1.5">
        {FACTORS.map((f) => (
          <div
            key={f.type}
            className={`rounded-md border p-2.5 transition-colors ${
              enabled[f.type] ? "border-primary/30 bg-primary/5" : "border-border/60 hover:border-border"
            }`}
          >
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={!!enabled[f.type]}
                onChange={(e) => setEnabled({ ...enabled, [f.type]: e.target.checked })}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-border accent-[#2DD4BF]"
              />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-foreground">{f.label}</span>
                <span className="block text-[10px] leading-snug text-muted-foreground">{f.desc}</span>
              </span>
            </label>
            {enabled[f.type] && f.params.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 pl-[22px]">
                {f.params.map((p) => (
                  <label key={p.key} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    {p.label}
                    <input
                      type="number"
                      value={params[f.type]?.[p.key] ?? p.def}
                      onChange={(e) =>
                        setParams({
                          ...params,
                          [f.type]: { ...params[f.type], [p.key]: Number(e.target.value) },
                        })
                      }
                      className="tnum h-6 w-14 rounded border border-border bg-background px-1 text-center text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ⑬ 要求形态（可选） */}
      <div className="mt-3 border-t border-border/60 pt-3">
        <p className="mb-2 text-[11px] text-muted-foreground">要求形态（可选，与上方条件叠加）</p>
        <div className="flex flex-wrap gap-1.5">
          {AVAILABLE_PATTERNS.map((p) => (
            <button
              key={p.value}
              onClick={() =>
                setPatterns(
                  patterns.includes(p.value)
                    ? patterns.filter((x) => x !== p.value)
                    : [...patterns, p.value]
                )
              }
              className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${
                patterns.includes(p.value)
                  ? "border-[#2DD4BF]/50 bg-[#2DD4BF]/15 text-[#2DD4BF]"
                  : "border-transparent bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* 筛选执行 */}
      <div className="mt-3 flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          信号日
          <input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className="h-7 rounded-md border border-border bg-background px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <span className="text-[10px] text-muted-foreground/60">留空 = 最新交易日</span>
      </div>
      <button
        onClick={runScreen}
        disabled={loading}
        className="mt-2.5 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-xs font-semibold text-primary-foreground transition-all hover:brightness-110 disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        {loading ? "正在全市场扫描..." : "开始策略筛选"}
      </button>

      {/* ⑭ 回测 */}
      <div className="mt-4 border-t border-border/60 pt-3">
        <div className="mb-2.5 flex items-center gap-2">
          <FlaskConical className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold text-foreground">策略回测</span>
          <span className="ml-auto text-[10px] text-muted-foreground/60">T+N 胜率验证</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            信号日
            <input
              type="date"
              value={btDate}
              onChange={(e) => setBtDate(e.target.value)}
              className="h-7 rounded-md border border-border bg-background px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            持有
            <select
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
              className="h-7 rounded-md border border-border bg-background px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {[5, 10, 20, 60].map((d) => (
                <option key={d} value={d}>{d}日</option>
              ))}
            </select>
          </label>
        </div>
        <button
          onClick={runBacktest}
          disabled={btLoading}
          className="mt-2.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-primary/40 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
        >
          {btLoading && <Loader2 className="h-3 w-3 animate-spin" />}
          {btLoading ? "回测中（需1-3分钟）..." : "运行回测"}
        </button>

        {summary && (
          <div className="mt-2.5 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border/60 bg-border/40 text-center">
            {[
              ["胜率", `${summary.winRate}%`],
              ["平均收益", `${summary.avgReturn}%`],
              ["中位收益", `${summary.medianReturn}%`],
              ["样本", `${summary.sampleCount}只`],
              ["满期", `${summary.completeCount}只`],
              ["最大/最小", `${summary.maxReturn}/${summary.minReturn}%`],
            ].map(([k, v]) => (
              <div key={k} className="bg-card px-1 py-2">
                <div className="text-[9px] text-muted-foreground">{k}</div>
                <div className={`tnum mt-0.5 text-[11px] font-semibold ${String(v).startsWith("-") ? "text-green-400" : "text-foreground"}`}>{v}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {meta && (
        <p className="mt-2.5 rounded-md bg-primary/5 px-2.5 py-1.5 text-[10px] leading-relaxed text-primary/90">{meta}</p>
      )}
      {error && (
        <p className="mt-2.5 rounded-md bg-red-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-red-400">{error}</p>
      )}
    </div>
  );
}
