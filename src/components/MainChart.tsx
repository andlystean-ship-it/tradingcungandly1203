import type { CandleData, MarketScenario } from "../types";

type Props = {
  candles: CandleData[];
  scenario: MarketScenario;
};

const CHART_HEIGHT = 260;
const PRICE_AXIS_WIDTH = 56;
const PADDING_TOP = 16;
const PADDING_BOTTOM = 24;

export default function MainChart({ candles, scenario }: Props) {
  // Use last 60 candles for display
  const visible = candles.slice(-60);

  const allPrices = visible.flatMap((c) => [c.high, c.low]);
  const { targetPrice, pendingLong, pendingShort, pivot } = scenario;
  allPrices.push(targetPrice, pendingLong, pendingShort, pivot);

  const priceMin = Math.min(...allPrices);
  const priceMax = Math.max(...allPrices);
  const priceRange = priceMax - priceMin || 1;

  const drawH = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  function py(price: number) {
    return PADDING_TOP + drawH - ((price - priceMin) / priceRange) * drawH;
  }

  // Width is dynamic — we'll use a viewBox and preserve ratio
  const totalW = 390;
  const chartW = totalW - PRICE_AXIS_WIDTH;
  const candleW = Math.max(3, (chartW / visible.length) * 0.8);
  const candleGap = chartW / visible.length;

  function cx(i: number) {
    return i * candleGap + candleGap / 2;
  }

  // Trendlines in chart coordinates
  const trendlines = scenario.trendlines.filter((t) => t.active).slice(0, 4);

  // Price axis labels
  const steps = 5;
  const priceStep = priceRange / steps;
  const priceLabels: number[] = [];
  for (let i = 0; i <= steps; i++) {
    priceLabels.push(priceMin + priceStep * i);
  }

  const fmt = (n: number) => (n >= 10000 ? n.toFixed(0) : n.toFixed(2));

  return (
    <div className="chart-section">
      <div className="chart-container">
        <svg
          viewBox={`0 0 ${totalW} ${CHART_HEIGHT}`}
          width="100%"
          height={CHART_HEIGHT}
          style={{ display: "block" }}
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Background */}
          <rect width={totalW} height={CHART_HEIGHT} fill="#000000" />

          {/* Grid lines */}
          {priceLabels.map((p, i) => {
            const y = py(p);
            return (
              <line
                key={i}
                x1={0}
                y1={y}
                x2={chartW}
                y2={y}
                stroke="rgba(0,255,231,0.06)"
                strokeWidth={1}
              />
            );
          })}

          {/* Trendlines */}
          {trendlines.map((t) => {
            const x1 = cx(t.x1 - (candles.length - visible.length));
            const x2 = cx(t.x2 - (candles.length - visible.length));
            const y1 = py(t.y1);
            const y2 = py(t.y2);
            const color = t.kind === "ascending" ? "#00ff8866" : "#ff336666";
            return (
              <line
                key={t.id}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray="4,3"
              />
            );
          })}

          {/* Horizontal price lines */}
          <HLine y={py(pivot)} color="#00ffe7" label="Pivot" fmt={fmt(pivot)} chartW={chartW} />
          <HLine y={py(targetPrice)} color="#ffe600" label="🎯 Target" fmt={fmt(targetPrice)} chartW={chartW} />
          <HLine y={py(pendingLong)} color="#00ff88" label="↑ Long" fmt={fmt(pendingLong)} chartW={chartW} />
          <HLine y={py(pendingShort)} color="#ff3366" label="↓ Short" fmt={fmt(pendingShort)} chartW={chartW} />

          {/* Candles */}
          {visible.map((c, i) => {
            const x = cx(i);
            const isUp = c.close >= c.open;
            const color = isUp ? "#00ff88" : "#ff3366";
            const bodyTop = py(Math.max(c.open, c.close));
            const bodyBot = py(Math.min(c.open, c.close));
            const bodyH = Math.max(1, bodyBot - bodyTop);

            return (
              <g key={c.time}>
                {/* Wick */}
                <line
                  x1={x}
                  y1={py(c.high)}
                  x2={x}
                  y2={py(c.low)}
                  stroke={color}
                  strokeWidth={1}
                  opacity={0.8}
                />
                {/* Body */}
                <rect
                  x={x - candleW / 2}
                  y={bodyTop}
                  width={candleW}
                  height={bodyH}
                  fill={isUp ? color : "transparent"}
                  stroke={color}
                  strokeWidth={isUp ? 0 : 0.8}
                  opacity={0.9}
                />
              </g>
            );
          })}

          {/* Price axis */}
          <rect x={chartW} width={PRICE_AXIS_WIDTH} height={CHART_HEIGHT} fill="#000000" />
          <line x1={chartW} y1={0} x2={chartW} y2={CHART_HEIGHT} stroke="#1a2a3a" strokeWidth={1} />
          {priceLabels.map((p, i) => (
            <text
              key={i}
              x={chartW + 4}
              y={py(p) + 3}
              fill="#5a7a9a"
              fontSize={8}
              fontFamily="monospace"
            >
              {fmt(p)}
            </text>
          ))}

          {/* Current price marker */}
          <CurrentPriceMarker
            price={scenario.currentPrice}
            y={py(scenario.currentPrice)}
            chartW={chartW}
            totalW={totalW}
            fmt={fmt}
          />

          {/* Time axis */}
          {[0, 15, 30, 45, 59].map((idx) => {
            const c = visible[idx];
            if (!c) return null;
            const d = new Date(c.time * 1000);
            const label = `${d.getHours().toString().padStart(2, "0")}:00`;
            return (
              <text
                key={idx}
                x={cx(idx)}
                y={CHART_HEIGHT - 4}
                fill="#3a5a7a"
                fontSize={7}
                fontFamily="monospace"
                textAnchor="middle"
              >
                {label}
              </text>
            );
          })}
        </svg>

        {/* Reasoning overlay */}
        <div className="chart-reasoning">
          {scenario.explanationLines.map((line, i) => (
            <div key={i} className="reasoning-line">
              {formatLine(line, i)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HLine({
  y,
  color,
  label,
  fmt,
  chartW,
}: {
  y: number;
  color: string;
  label: string;
  fmt: string;
  chartW: number;
}) {
  return (
    <g>
      <line
        x1={0}
        y1={y}
        x2={chartW}
        y2={y}
        stroke={color}
        strokeWidth={1}
        strokeDasharray={label.includes("Pivot") ? "4,3" : "none"}
        opacity={0.7}
      />
      <rect x={2} y={y - 7} width={label.length * 5 + 4} height={12} fill="#000000" rx={2} opacity={0.6} />
      <text x={4} y={y + 3} fill={color} fontSize={8} fontFamily="monospace">
        {label} {fmt}
      </text>
    </g>
  );
}

function CurrentPriceMarker({
  price,
  y,
  chartW,
  totalW,
  fmt,
}: {
  price: number;
  y: number;
  chartW: number;
  totalW: number;
  fmt: (n: number) => string;
}) {
  return (
    <g>
      <line
        x1={0}
        y1={y}
        x2={chartW}
        y2={y}
        stroke="#ffffff"
        strokeWidth={0.5}
        strokeDasharray="2,3"
        opacity={0.3}
      />
      <rect x={chartW} y={y - 7} width={totalW - chartW} height={14} fill="#0099ff" rx={2} />
      <text x={chartW + 3} y={y + 4} fill="#ffffff" fontSize={9} fontFamily="monospace" fontWeight="bold">
        {fmt(price)}
      </text>
    </g>
  );
}

function formatLine(line: string, index: number) {
  const parts = line.split(/(\d{4,}\.\d+|\d{5,})/g);
  return (
    <>
      {index === 0 && <span style={{ color: "var(--neon-cyan)" }}>• </span>}
      {index > 0 && (
        <span style={{ color: "var(--text-muted)" }}>{"  "}› </span>
      )}
      {parts.map((p, i) =>
        /^\d/.test(p) ? (
          <span key={i} className="hl">
            {p}
          </span>
        ) : (
          <span
            key={i}
            style={{
              color: p.toLowerCase().includes("long")
                ? "var(--text-green)"
                : p.toLowerCase().includes("short")
                ? "var(--text-red)"
                : undefined,
            }}
          >
            {p}
          </span>
        )
      )}
    </>
  );
}


