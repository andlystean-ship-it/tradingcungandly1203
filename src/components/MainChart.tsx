import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  createChart,
  ColorType,
  LineStyle,
  CrosshairMode,
  type UTCTimestamp,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
} from "lightweight-charts";
import type { CandleMap, MarketScenario, Trendline, Timeframe } from "../types";

type Props = {
  candleMap: CandleMap;
  scenario: MarketScenario;
  theme?: "dark" | "light";
};

const TIMEFRAMES: Timeframe[] = ["15M", "1H", "2H", "4H", "6H", "8H", "12H", "1D", "1W"];

const UP_COLOR = "#26a69a";
const DN_COLOR = "#ef5350";

function getChartColors(theme: "dark" | "light") {
  if (theme === "light") {
    return {
      bg: "#f5f7fa",
      text: "#333",
      gridV: "rgba(200,200,200,0.4)",
      gridH: "rgba(200,200,200,0.6)",
      crosshair: "rgba(100,100,100,0.3)",
      crosshairLabel: "#e0e0e0",
      border: "#ccc",
      watermark: "rgba(150,150,150,0.08)",
    };
  }
  return {
    bg: "#0a130e",
    text: "#5a9a6a",
    gridV: "rgba(28,78,36,0.35)",
    gridH: "rgba(28,78,36,0.55)",
    crosshair: "rgba(0,229,255,0.3)",
    crosshairLabel: "#1e4025",
    border: "#1e4025",
    watermark: "rgba(35,110,45,0.08)",
  };
}

/** Extrapolate trendline to a target candle index */
function extrapolatePrice(t: Trendline, targetIdx: number): number {
  if (t.x2 === t.x1) return t.y1;
  return t.y1 + ((t.y2 - t.y1) / (t.x2 - t.x1)) * (targetIdx - t.x1);
}

export default function MainChart({ candleMap, scenario, theme = "dark" }: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const trendlineSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const lastSeriesStateRef = useRef<{ timeframe: Timeframe; length: number; lastTime: number | null } | null>(null);
  const [selectedTf, setSelectedTf] = useState<Timeframe>("1H");
  const [showTrendlines, setShowTrendlines] = useState(true);
  const [showExplanation, setShowExplanation] = useState(true);

  // ── Create chart once ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const c = getChartColors(theme);

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: c.bg },
        textColor: c.text,
        fontFamily: "'SF Mono', 'Fira Code', monospace",
      },
      grid: {
        vertLines: { color: c.gridV },
        horzLines: { color: c.gridH },
      },
      width: containerRef.current.clientWidth,
      height: 420,
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: c.crosshair, labelBackgroundColor: c.crosshairLabel },
        horzLine: { color: c.crosshair, labelBackgroundColor: c.crosshairLabel },
      },
      rightPriceScale: {
        borderColor: c.border,
        scaleMargins: { top: 0.05, bottom: 0.05 },
      },
      timeScale: {
        borderColor: c.border,
        timeVisible: true,
        secondsVisible: false,
      },
      watermark: {
        visible: true,
        text: "Crypto and Forex Trading",
        color: c.watermark,
        fontSize: 24,
      },
    });

    const series = chart.addCandlestickSeries({
      upColor: UP_COLOR,
      downColor: DN_COLOR,
      borderDownColor: DN_COLOR,
      borderUpColor: UP_COLOR,
      wickDownColor: DN_COLOR,
      wickUpColor: UP_COLOR,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLinesRef.current = [];
      trendlineSeriesRef.current = [];
    };
  }, [theme]);

  // ── Update candle data, price lines & trendlines ────────────────────────────
  const updateChart = useCallback(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!series || !chart) return;

    const candles = candleMap[selectedTf] || [];
    const data = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    const lastBar = data[data.length - 1];
    const previousState = lastSeriesStateRef.current;
    const shouldResetSeries =
      !previousState ||
      previousState.timeframe !== selectedTf ||
      previousState.length === 0 ||
      data.length === 0 ||
      previousState.length > data.length ||
      previousState.lastTime === null ||
      previousState.lastTime !== candles[candles.length - 1]?.time;

    if (shouldResetSeries) {
      series.setData(data);
      chart.timeScale().fitContent();
    } else if (lastBar) {
      series.update(lastBar);
    }

    lastSeriesStateRef.current = {
      timeframe: selectedTf,
      length: data.length,
      lastTime: candles[candles.length - 1]?.time ?? null,
    };

    // ── Remove old price lines ─────────────────────────────────────
    for (const pl of priceLinesRef.current) {
      series.removePriceLine(pl);
    }
    priceLinesRef.current = [];

    // ── Remove old trendline series ────────────────────────────────
    for (const ts of trendlineSeriesRef.current) {
      chart.removeSeries(ts);
    }
    trendlineSeriesRef.current = [];

    // ── Add level price lines ──────────────────────────────────────
    const levels: { price: number; color: string; title: string; style: LineStyle }[] = [
      { price: scenario.pendingLong, color: UP_COLOR, title: "Lệnh Chờ Long", style: LineStyle.Solid },
      { price: scenario.pendingShort, color: DN_COLOR, title: "Lệnh Chờ Short", style: LineStyle.Solid },
      { price: scenario.targetPrice, color: "#ffd600", title: "Target", style: LineStyle.Solid },
      { price: scenario.pivot, color: "#00e5ff", title: "Pivot", style: LineStyle.Dashed },
      { price: scenario.invalidationLevel, color: "#ff6d00", title: "Invalidation", style: LineStyle.Dotted },
      { price: scenario.r1, color: "rgba(239,83,80,0.5)", title: "R1", style: LineStyle.Dotted },
      { price: scenario.s1, color: "rgba(38,166,154,0.5)", title: "S1", style: LineStyle.Dotted },
    ];

    for (const lv of levels) {
      if (lv.price > 0) {
        const pl = series.createPriceLine({
          price: lv.price,
          color: lv.color,
          lineWidth: lv.title === "Pivot" || lv.title === "Target" ? 2 : 1,
          lineStyle: lv.style,
          axisLabelVisible: true,
          title: lv.title,
        });
        priceLinesRef.current.push(pl);
      }
    }

    for (const zone of (scenario.srZones ?? []).filter((item) => item.timeframe === selectedTf || item.timeframe === "multi").slice(0, 4)) {
      const pl = series.createPriceLine({
        price: zone.center,
        color: zone.kind === "support" ? "rgba(38,166,154,0.55)" : "rgba(239,83,80,0.55)",
        lineWidth: zone.strengthScore >= 70 ? 2 : 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${zone.kind === "support" ? "SZ" : "RZ"} ${selectedTf}`,
      });
      priceLinesRef.current.push(pl);
    }

    // ── Draw trendlines ────────────────────────────────────────────
    if (showTrendlines) {
      const activeTrendlines = scenario.trendlines.filter((t) => t.active);
      for (const t of activeTrendlines.slice(0, 5)) {
      // Extrapolate trendline from x1 to end of visible candles
      const startIdx = Math.max(0, t.x1);
      const endIdx = Math.min(candles.length - 1, t.x2 + Math.round((t.x2 - t.x1) * 0.5));

      if (startIdx >= candles.length || endIdx < 0) continue;

      const lineColor = t.kind === "ascending" ? "#26a69a" : "#ef5350";
      const lineData: { time: UTCTimestamp; value: number }[] = [];

      // Sample points along the trendline
      for (let idx = startIdx; idx <= endIdx && idx < candles.length; idx++) {
        const price = extrapolatePrice(t, idx);
        lineData.push({ time: candles[idx].time as UTCTimestamp, value: +price.toFixed(4) });
      }

      if (lineData.length >= 2) {
        const lineSeries = chart.addLineSeries({
          color: lineColor,
          lineWidth: 2,
          lineStyle: t.broken ? LineStyle.Dashed : LineStyle.Solid,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        lineSeries.setData(lineData);
        trendlineSeriesRef.current.push(lineSeries);
      }
    }
    } // end showTrendlines
  }, [candleMap, selectedTf, scenario, showTrendlines]);

  useEffect(() => {
    updateChart();
  }, [updateChart]);

  return (
    <div className="chart-section">
      {/* ── Timeframe selector + controls ────────────────────────────── */}
      <div className="chart-tf-selector">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            className={`chart-tf-btn ${selectedTf === tf ? "active" : ""}`}
            onClick={() => setSelectedTf(tf)}
          >
            {tf}
          </button>
        ))}
        <span className="chart-controls-divider" />
        <button
          className={`chart-toggle-btn ${showTrendlines ? "active" : ""}`}
          onClick={() => setShowTrendlines(!showTrendlines)}
          aria-pressed={showTrendlines}
          title={t("chart.showTrendlines")}
        >
          ↗
        </button>
        <button
          className={`chart-toggle-btn ${showExplanation ? "active" : ""}`}
          onClick={() => setShowExplanation(!showExplanation)}
          aria-pressed={showExplanation}
          title={t("chart.showExplanation")}
        >
          📝
        </button>
        <button
          className="chart-toggle-btn"
          onClick={() => chartRef.current?.timeScale().fitContent()}
          title={t("chart.resetZoom")}
        >
          ⟲
        </button>
      </div>

      {/* ── Interactive chart ───────────────────────────────────────── */}
      <div ref={containerRef} className="lw-chart-container" />

      {/* ── Reasoning overlay ───────────────────────────────────────── */}
      {showExplanation && (
        <div className="chart-reasoning">
          {scenario.explanationLines.map((line, i) => (
            <div key={i} className="reasoning-line">
              {formatLine(line, i)}
            </div>
          ))}
          {(scenario.candlePatterns ?? []).filter((pattern) => pattern.timeframe === selectedTf).slice(0, 3).map((pattern) => (
            <div key={`${pattern.timeframe}-${pattern.candleIndex}-${pattern.name}`} className="reasoning-line">
              <span style={{ color: pattern.direction === "bullish" ? "var(--text-green)" : pattern.direction === "bearish" ? "var(--text-red)" : "var(--text-muted)" }}>
                {pattern.label} ({pattern.reliability})
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Reasoning line formatter ───────────────────────────────────────────────────
function formatLine(line: string, index: number) {
  const parts = line.split(/(\d{4,}\.\d+|\d{5,})/g);
  return (
    <>
      {index === 0 && <span style={{ color: "var(--neon-cyan)" }}>• </span>}
      {index > 0 && <span style={{ color: "var(--text-muted)" }}>{"  "}› </span>}
      {parts.map((p, i) =>
        /^\d/.test(p) ? (
          <span key={i} className="hl">{p}</span>
        ) : (
          <span key={i} style={{
            color: p.toLowerCase().includes("long")
              ? "var(--text-green)"
              : p.toLowerCase().includes("short")
              ? "var(--text-red)"
              : undefined,
          }}>
            {p}
          </span>
        )
      )}
    </>
  );
}
