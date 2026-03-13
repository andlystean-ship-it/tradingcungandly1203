import { useEffect, useRef, useState, useCallback, useMemo } from "react";
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
import type { CandleMap, MarketScenario, Timeframe } from "../types";
import { buildTrendlines } from "../engine/trendlines";

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

function extrapolatePriceByTime(
  t1: number,
  p1: number,
  t2: number,
  p2: number,
  targetTime: number,
): number {
  if (t2 === t1) return p1;
  return p1 + ((p2 - p1) / (t2 - t1)) * (targetTime - t1);
}

export default function MainChart({ candleMap, scenario, theme = "dark" }: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const trendlineSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const lastSeriesStateRef = useRef<{ timeframe: Timeframe; length: number; lastTime: number | null } | null>(null);
  const annotationKeyRef = useRef<string>("");
  const [selectedTf, setSelectedTf] = useState<Timeframe>("1H");
  const [showTrendlines, setShowTrendlines] = useState(true);
  const [showExplanation, setShowExplanation] = useState(true);
  const [labelY, setLabelY] = useState<{ target: number | null; long: number | null; short: number | null }>({
    target: null,
    long: null,
    short: null,
  });
  const selectedCandles = useMemo(() => candleMap[selectedTf] ?? [], [candleMap, selectedTf]);
  const lastSelectedCandle = selectedCandles[selectedCandles.length - 1];
  const activeChartTrendlines = useMemo(
    () => buildTrendlines(selectedCandles, selectedTf).filter((trendline) => trendline.active).slice(0, 5),
    [selectedCandles, selectedTf],
  );

  const formatLastCandleTime = (time?: number) => {
    if (!time) return "n/a";
    try {
      return new Date(time * 1000).toLocaleString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        day: "2-digit",
        month: "2-digit",
      });
    } catch {
      return "n/a";
    }
  };

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
      lastSeriesStateRef.current = null;
      annotationKeyRef.current = "";
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
      (lastBar ? (lastBar.time as number) < previousState.lastTime : false);

    if (shouldResetSeries) {
      series.setData(data);
    } else if (lastBar) {
      const lastBarTime = lastBar.time as number;
      if (lastBarTime === previousState.lastTime || data.length === previousState.length + 1) {
        series.update(lastBar);
      } else {
        series.setData(data);
      }
    }

    lastSeriesStateRef.current = {
      timeframe: selectedTf,
      length: data.length,
      lastTime: candles[candles.length - 1]?.time ?? null,
    };

    const zoneKey = (scenario.srZones ?? [])
      .filter((item) => item.timeframe === selectedTf || item.timeframe === "multi")
      .slice(0, 4)
      .map((zone) => `${zone.kind}:${zone.center.toFixed(2)}:${zone.strengthScore}`)
      .join("|");
    const trendKey = activeChartTrendlines
      .map((trendline) => `${trendline.id}:${trendline.broken ? 1 : 0}:${trendline.x1}:${trendline.x2}`)
      .join("|");
    const annotationKey = [
      selectedTf,
      showTrendlines ? "1" : "0",
      scenario.pendingLong.toFixed(2),
      scenario.pendingShort.toFixed(2),
      scenario.targetPrice.toFixed(2),
      scenario.pivot.toFixed(2),
      scenario.invalidationLevel.toFixed(2),
      scenario.r1.toFixed(2),
      scenario.s1.toFixed(2),
      zoneKey,
      trendKey,
    ].join("#");

    if (annotationKeyRef.current === annotationKey) {
      setLabelY({
        target: series.priceToCoordinate(scenario.targetPrice),
        long: series.priceToCoordinate(scenario.pendingLong),
        short: series.priceToCoordinate(scenario.pendingShort),
      });
      return;
    }
    annotationKeyRef.current = annotationKey;

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
      for (const t of activeChartTrendlines) {
        const sourceTf = (t.sourceTimeframe as Timeframe | undefined) ?? selectedTf;
        const sourceCandles = candleMap[sourceTf] || [];
        if (!sourceCandles.length) continue;
        if (t.x1 < 0 || t.x2 < 0 || t.x1 >= sourceCandles.length || t.x2 >= sourceCandles.length) continue;

        const anchor1 = sourceCandles[t.x1];
        const anchor2 = sourceCandles[t.x2];
        if (!anchor1 || !anchor2 || anchor2.time <= anchor1.time) continue;

        const startTime = Math.max(anchor1.time, candles[0]?.time ?? anchor1.time);
        const endTime = candles[candles.length - 1]?.time ?? anchor2.time;
        if (endTime <= startTime) continue;

        const lineColor = t.kind === "ascending" ? "#26a69a" : "#ef5350";
        const lineData = candles
          .filter((c) => c.time >= startTime && c.time <= endTime)
          .map((c) => ({
            time: c.time as UTCTimestamp,
            value: +extrapolatePriceByTime(anchor1.time, t.y1, anchor2.time, t.y2, c.time).toFixed(4),
          }));

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

    setLabelY({
      target: series.priceToCoordinate(scenario.targetPrice),
      long: series.priceToCoordinate(scenario.pendingLong),
      short: series.priceToCoordinate(scenario.pendingShort),
    });
  }, [activeChartTrendlines, candleMap, selectedTf, scenario, showTrendlines]);

  useEffect(() => {
    updateChart();
  }, [updateChart]);

  useEffect(() => {
    chartRef.current?.timeScale().fitContent();
  }, [selectedTf, theme]);

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

      <div className="chart-status-strip">
        <span>TF: {selectedTf}</span>
        <span>Candles: {selectedCandles.length}</span>
        <span>Last candle: {formatLastCandleTime(lastSelectedCandle?.time)}</span>
        <span>Close: {lastSelectedCandle?.close?.toFixed(2) ?? "n/a"}</span>
      </div>

      {/* ── Interactive chart ───────────────────────────────────────── */}
      <div className="chart-canvas-wrap">
        <div ref={containerRef} className="lw-chart-container" />
        <div className="chart-labels" aria-hidden="true">
          <div className="price-label target" style={{ top: labelY.target ?? 120 }}>
            <span className="label-title">Giá Thị Trường Sẽ Hướng Tới</span>
            <span className="label-price">{scenario.targetPrice.toFixed(2)}</span>
          </div>
          <div className="price-label short" style={{ top: labelY.short ?? 170 }}>
            <span className="label-title">Đặt Lệnh Chờ Tự Động Short</span>
            <span className="label-price">{scenario.pendingShort.toFixed(2)}</span>
          </div>
          <div className="price-label long" style={{ top: labelY.long ?? 220 }}>
            <span className="label-title">Đặt Lệnh Chờ Tự Động Long</span>
            <span className="label-price">{scenario.pendingLong.toFixed(2)}</span>
          </div>
        </div>
      </div>

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
