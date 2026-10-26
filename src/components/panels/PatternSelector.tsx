import { useAppStore } from "@/stores/appStore";
import { AVAILABLE_PATTERNS } from "@contracts/types";
import { ScanEye } from "lucide-react";

export default function PatternSelector() {
  const patternMode = useAppStore((s) => s.patternMode);
  const setPatternMode = useAppStore((s) => s.setPatternMode);
  const patternFilter = useAppStore((s) => s.patternFilter);
  const setPatternFilter = useAppStore((s) => s.setPatternFilter);
  const targetPatterns = useAppStore((s) => s.targetPatterns);

  const togglePattern = (value: string) => {
    if (patternFilter.includes(value)) {
      setPatternFilter(patternFilter.filter((p) => p !== value));
    } else {
      setPatternFilter([...patternFilter, value]);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-background/40 p-4">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScanEye className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">形态识别</h3>
        </div>
        {/* 优雅开关 */}
        <button
          role="switch"
          aria-checked={patternMode}
          onClick={() => {
            setPatternMode(!patternMode);
            if (patternMode) setPatternFilter([]);
          }}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 focus:outline-none focus:ring-1 focus:ring-primary ${
            patternMode ? "bg-primary" : "bg-secondary"
          }`}
          title="启用形态模式"
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all duration-200 ${
              patternMode ? "left-[18px]" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {patternMode && (
        <div className="mt-3">
          <p className="mb-2.5 text-[11px] leading-relaxed text-muted-foreground">
            选择要检测的形态类型，相似度分析将优先返回包含这些形态的股票
          </p>

          <div className="grid grid-cols-2 gap-1.5">
            {AVAILABLE_PATTERNS.map((pattern) => {
              const active = patternFilter.includes(pattern.value);
              return (
                <button
                  key={pattern.value}
                  onClick={() => togglePattern(pattern.value)}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] transition-all ${
                    active
                      ? pattern.signal === "bullish"
                        ? "border-red-500/50 bg-red-500/10 text-red-400"
                        : pattern.signal === "bearish"
                          ? "border-green-500/50 bg-green-500/10 text-green-400"
                          : "border-primary/50 bg-primary/10 text-primary"
                      : "border-transparent bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      pattern.signal === "bullish"
                        ? "bg-red-400"
                        : pattern.signal === "bearish"
                          ? "bg-green-400"
                          : "bg-muted-foreground"
                    }`}
                  />
                  {pattern.label}
                </button>
              );
            })}
          </div>

          {targetPatterns.length > 0 && (
            <div className="mt-3 border-t border-border/60 pt-3">
              <p className="mb-2 text-[11px] font-medium text-muted-foreground">
                目标股票检测到的形态：
              </p>
              <div className="flex flex-wrap gap-1.5">
                {targetPatterns.map((p) => (
                  <span
                    key={p.type}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium ${
                      p.signal === "bullish"
                        ? "border-red-500/40 bg-red-500/10 text-red-400"
                        : p.signal === "bearish"
                          ? "border-green-500/40 bg-green-500/10 text-green-400"
                          : "border-border bg-secondary/50 text-muted-foreground"
                    }`}
                  >
                    {p.name}
                    <span className="opacity-60">({p.confidence}%)</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
