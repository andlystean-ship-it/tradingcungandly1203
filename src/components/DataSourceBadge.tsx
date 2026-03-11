/**
 * DataSourceBadge.tsx
 * Shows whether the engine is running on live Binance data or demo candles,
 * plus a loading pulse and last-updated time.
 */

type Props = {
  source: "live" | "demo" | "stale" | "error";
  loading: boolean;
  lastUpdated: string;
  warning?: string;
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "--:--:--";
  }
}

export default function DataSourceBadge({
  source,
  loading,
  lastUpdated,
  warning,
}: Props) {
  const isLive = source === "live";

  return (
    <div className="data-source-bar">
      <div className="data-source-left">
        <span
          className={`source-dot ${isLive ? "live" : "demo"} ${loading ? "pulse" : ""}`}
        />
        <span className={`source-label ${isLive ? "live" : "demo"}`}>
          {isLive ? "LIVE — Binance" : "DEMO — Generated"}
        </span>
      </div>

      <div className="data-source-right">
        {loading && (
          <span className="source-fetching">↻ đang làm mới…</span>
        )}
        <span className="source-time">Cập nhật: {formatTime(lastUpdated)}</span>
      </div>

      {warning && !isLive && (
        <div className="source-warning">{warning}</div>
      )}
    </div>
  );
}
