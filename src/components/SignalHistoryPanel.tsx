import { useTranslation } from "react-i18next";
import type { Symbol } from "../types";
import { getSignalHistory, type SignalSnapshot } from "../engine/signal-history";

type Props = {
  symbol: Symbol;
};

export default function SignalHistoryPanel({ symbol }: Props) {
  const { t } = useTranslation();
  const history = getSignalHistory(symbol);

  if (history.length === 0) {
    return (
      <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "8px 0" }}>
        {t("signalHistory.noHistory")}
      </div>
    );
  }

  return (
    <div className="signal-history">
      {history.slice(0, 20).map((sig: SignalSnapshot) => (
        <div key={sig.id} className="signal-history-item">
          <span className={`signal-history-side ${sig.primarySide}`}>
            {sig.primarySide === "long" ? "LONG" : sig.primarySide === "short" ? "SHORT" : "—"}
          </span>
          <span>{sig.confidence}%</span>
          <span>{sig.bullishPercent}/{100 - sig.bullishPercent}</span>
          <span style={{ fontSize: 9 }}>
            {formatHistoryTime(sig.timestamp)}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatHistoryTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "--:--";
  }
}
