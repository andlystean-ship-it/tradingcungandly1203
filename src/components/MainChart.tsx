import type { CandleData, MarketScenario } from "../types";

type Props = {
  candles: CandleData[];
  scenario: MarketScenario;
};

// ── Layout ────────────────────────────────────────────────────────────────────
const CHART_H = 320;
const PRICE_AXIS_W = 70;
const PAD_TOP = 14;
const PAD_BOTTOM = 26;
const TOTAL_W = 390;

// ── TradingView-style palette ─────────────────────────────────────────────────
const TV_BG        = "#0a130e";
const TV_BG_AXIS   = "#0d1a10";
const TV_GRID_H    = "rgba(28,78,36,0.55)";
const TV_GRID_V    = "rgba(28,78,36,0.35)";
const TV_BORDER    = "#1e4025";
const TV_AXIS_TXT  = "#5a9a6a";
const TV_TIME_TXT  = "#3a7a4a";
const TV_WATERMARK = "rgba(35,110,45,0.06)";

const UP_COLOR = "#26a69a";
const DN_COLOR = "#ef5350";

// ── Helper: nice round step for grid ─────────────────────────────────────────
function niceStep(raw: number): number {
  const exp = Math.floor(Math.log10(raw));
  const frac = raw / Math.pow(10, exp);
  const nice = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
  return nice * Math.pow(10, exp);
}

export default function MainChart({ candles, scenario }: Props) {
  const visible = candles.slice(-60);

  const { targetPrice, pendingLong, pendingShort, pivot, currentPrice } = scenario;

  // Price range with small margin so levels are never clipped
  const allP = visible.flatMap((c) => [c.high, c.low]);
  allP.push(targetPrice, pendingLong, pendingShort, pivot, currentPrice);
  const rawMin = Math.min(...allP);
  const rawMax = Math.max(...allP);
  const margin = (rawMax - rawMin) * 0.04;
  const priceMin = rawMin - margin;
  const priceMax = rawMax + margin;
  const priceRange = priceMax - priceMin || 1;

  const drawH  = CHART_H - PAD_TOP - PAD_BOTTOM;
  const chartW = TOTAL_W - PRICE_AXIS_W;

  const py = (price: number) =>
    PAD_TOP + drawH - ((price - priceMin) / priceRange) * drawH;

  const slotW    = chartW / (visible.length || 60);
  const bodyW    = Math.max(2, slotW * 0.65);
  const cx       = (i: number) => i * slotW + slotW / 2;
  const offset   = candles.length - visible.length;

  // Grid prices
  const step = niceStep(priceRange / 6);
  const gridStart = Math.ceil(priceMin / step) * step;
  const gridPrices: number[] = [];
  for (let p = gridStart; p <= priceMax + step * 0.1; p += step) {
    if (p >= priceMin && p <= priceMax) gridPrices.push(p);
  }

  const fmt = (n: number) => n.toFixed(2);

  // Active trendlines
  const trendlines = scenario.trendlines.filter((t) => t.active).slice(0, 5);

  // Time axis sample indices
  const N = visible.length;
  const timeIdxs = [0, Math.round(N * 0.25), Math.round(N * 0.5), Math.round(N * 0.75), N - 1]
    .filter((i) => i >= 0 && i < N);

  return (
    <div className="chart-section">
      <div className="chart-container">
        <svg
          viewBox={`0 0 ${TOTAL_W} ${CHART_H}`}
          width="100%"
          height={CHART_H}
          style={{ display: "block", pointerEvents: "none" }}
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* ── Background ─────────────────────────────────────────────── */}
          <rect width={TOTAL_W} height={CHART_H} fill={TV_BG} />

          {/* ── Horizontal grid ─────────────────────────────────────────── */}
          {gridPrices.map((p, i) => (
            <line key={`hg${i}`} x1={0} y1={py(p)} x2={chartW} y2={py(p)}
              stroke={TV_GRID_H} strokeWidth={1} />
          ))}

          {/* ── Vertical grid ───────────────────────────────────────────── */}
          {timeIdxs.map((idx) => (
            <line key={`vg${idx}`} x1={cx(idx)} y1={PAD_TOP} x2={cx(idx)} y2={CHART_H - PAD_BOTTOM}
              stroke={TV_GRID_V} strokeWidth={1} />
          ))}

          {/* ── Watermark ───────────────────────────────────────────────── */}
          <text x={chartW / 2} y={CHART_H / 2 + 12}
            fill={TV_WATERMARK} fontSize={26} fontFamily="sans-serif"
            fontWeight="bold" textAnchor="middle">
            Crypto and Forex Trading
          </text>

          {/* ── Trendlines — drawn BELOW candles ────────────────────────── */}
          {trendlines.map((t) => {
            const i1 = t.x1 - offset;
            const i2 = t.x2 - offset;
            const x1c = cx(i1), x2c = cx(i2);
            const y1c = py(t.y1), y2c = py(t.y2);
            // Extrapolate to full chart width
            const slope = (y2c - y1c) / (x2c - x1c || 1);
            const xL = 0,   yL = y1c + slope * (xL - x1c);
            const xR = chartW, yR = y1c + slope * (xR - x1c);
            // Gray like TradingView default trendline color
            const lineColor = "#9e9e9e";
            return (
              <g key={t.id}>
                {/* Glow */}
                <line x1={xL} y1={yL} x2={xR} y2={yR}
                  stroke={lineColor} strokeWidth={7} opacity={0.08} />
                {/* Main line */}
                <line x1={xL} y1={yL} x2={xR} y2={yR}
                  stroke={lineColor} strokeWidth={2} opacity={0.85} />
                {/* Anchor dot at newest point */}
                <circle cx={x2c} cy={y2c} r={3} fill={lineColor} opacity={0.7} />
              </g>
            );
          })}

          {/* ── Horizontal level lines ──────────────────────────────────── */}
          <HLine y={py(pendingShort)} color="#ef5350"
            label="Đặt Lệnh Chờ Tự Động Short" price={fmt(pendingShort)} chartW={chartW} axisW={PRICE_AXIS_W} />
          <HLine y={py(targetPrice)} color="#ffd600"
            label="Giá Thị Trường Sẽ Hướng Tới" price={fmt(targetPrice)} chartW={chartW} axisW={PRICE_AXIS_W} />
          <HLine y={py(pivot)} color="#00e5ff"
            label="Pivot" price={fmt(pivot)} chartW={chartW} axisW={PRICE_AXIS_W} dashed />
          <HLine y={py(pendingLong)} color="#26a69a"
            label="Đặt Lệnh Chờ Tự Động Long" price={fmt(pendingLong)} chartW={chartW} axisW={PRICE_AXIS_W} />

          {/* ── Candles ─────────────────────────────────────────────────── */}
          {visible.map((c, i) => {
            const x     = cx(i);
            const isUp  = c.close >= c.open;
            const color = isUp ? UP_COLOR : DN_COLOR;
            const bTop  = py(Math.max(c.open, c.close));
            const bBot  = py(Math.min(c.open, c.close));
            const bH    = Math.max(1, bBot - bTop);
            return (
              <g key={c.time}>
                <line x1={x} y1={py(c.high)} x2={x} y2={py(c.low)}
                  stroke={color} strokeWidth={1.2} />
                <rect x={x - bodyW / 2} y={bTop} width={bodyW} height={bH}
                  fill={color} />
              </g>
            );
          })}

          {/* ── Price axis background ────────────────────────────────────── */}
          <rect x={chartW} y={0} width={PRICE_AXIS_W} height={CHART_H} fill={TV_BG_AXIS} />
          <line x1={chartW} y1={0} x2={chartW} y2={CHART_H} stroke={TV_BORDER} strokeWidth={1} />

          {/* ── Price axis labels ────────────────────────────────────────── */}
          {gridPrices.map((p, i) => (
            <text key={`al${i}`} x={chartW + 5} y={py(p) + 4}
              fill={TV_AXIS_TXT} fontSize={9} fontFamily="monospace">
              {fmt(p)}
            </text>
          ))}

          {/* ── Current price marker ─────────────────────────────────────── */}
          <CurrentPriceMarker y={py(currentPrice)} chartW={chartW}
            totalW={TOTAL_W} label={fmt(currentPrice)} />

          {/* ── Time axis ────────────────────────────────────────────────── */}
          {timeIdxs.map((idx) => {
            const c = visible[idx];
            if (!c) return null;
            const d = new Date(c.time * 1000);
            const h = d.getUTCHours(), m = d.getUTCMinutes();
            const lbl = (h === 0 && m === 0)
              ? `${d.getUTCDate()}/${d.getUTCMonth() + 1}`
              : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
            return (
              <text key={`t${idx}`} x={cx(idx)} y={CHART_H - 6}
                fill={TV_TIME_TXT} fontSize={8} fontFamily="monospace" textAnchor="middle">
                {lbl}
              </text>
            );
          })}
        </svg>

        {/* ── Reasoning overlay ────────────────────────────────────────── */}
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

// ── Horizontal level line with TradingView-style badge ────────────────────────
function HLine({
  y, color, label, price, chartW, axisW, dashed,
}: {
  y: number; color: string; label: string; price: string;
  chartW: number; axisW: number; dashed?: boolean;
}) {
  // Left label tag
  const tagW = Math.min(label.length * 5.5 + 10, chartW - 4);
  // Right price badge in axis area
  const badgeX = chartW + 1;
  const badgeW = axisW - 2;
  return (
    <g>
      {/* Dashed/solid line across chart */}
      <line x1={0} y1={y} x2={chartW} y2={y}
        stroke={color} strokeWidth={1}
        strokeDasharray={dashed ? "5,4" : undefined}
        opacity={0.8} />
      {/* Left coloured tab */}
      <rect x={1} y={y - 9} width={tagW} height={14} fill={color} fillOpacity={0.15} rx={2} />
      <rect x={1} y={y - 9} width={3}    height={14} fill={color} rx={1} />
      <text x={8} y={y + 3.5} fill={color} fontSize={8} fontFamily="monospace" fontWeight="600">
        {label}
      </text>
      {/* Right price badge (on top of price axis) */}
      <rect x={badgeX} y={y - 8} width={badgeW} height={15} fill={color} rx={2} />
      <text x={badgeX + badgeW / 2} y={y + 4}
        fill="#000" fontSize={9} fontFamily="monospace" fontWeight="700" textAnchor="middle">
        {price}
      </text>
    </g>
  );
}

// ── Current price badge ────────────────────────────────────────────────────────
function CurrentPriceMarker({
  y, chartW, totalW, label,
}: {
  y: number; chartW: number; totalW: number; label: string;
}) {
  const axisW = totalW - chartW;
  return (
    <g>
      <line x1={0} y1={y} x2={chartW} y2={y}
        stroke="#ffffff" strokeWidth={0.5} strokeDasharray="2,4" opacity={0.2} />
      <rect x={chartW + 1} y={y - 8} width={axisW - 2} height={15}
        fill="#1565c0" rx={2} />
      <text x={chartW + axisW / 2} y={y + 4}
        fill="#fff" fontSize={9.5} fontFamily="monospace" fontWeight="bold" textAnchor="middle">
        {label}
      </text>
    </g>
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
