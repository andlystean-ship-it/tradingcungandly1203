import type { TimeframeSignal } from "../types";

type Props = {
  signals: TimeframeSignal[];
};

function formatNum(n: number) {
  return n >= 10000 ? n.toFixed(0) : n.toFixed(2);
}

export default function TimeframeStrip({ signals }: Props) {
  return (
    <div className="tf-strip">
      <div className="tf-strip-label">Multi-Timeframe Confluence</div>
      <div className="tf-cards">
        {signals.map((s) => (
          <div key={s.timeframe} className={`tf-card ${s.bias}`}>
            <div className="tf-label">{s.timeframe}</div>
            <div className="tf-bull">▲ {formatNum(s.bullishLevel)}</div>
            <div className="tf-bear">▼ {formatNum(s.bearishLevel)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
