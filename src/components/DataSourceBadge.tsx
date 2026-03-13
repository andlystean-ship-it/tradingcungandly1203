/**
 * DataSourceBadge.tsx
 * Shows whether the engine is running on live Binance data,
 * plus a loading pulse and last-updated time.
 */

import type { SourceMode } from "../types";
import { useTranslation } from "react-i18next";

type Props = {
  source: "live" | "stale" | "error" | "partial";
  sourceMode: SourceMode;
  loading: boolean;
  lastUpdated: string;
  warning?: string;
  provider?: string;
  proxyWarning?: string;
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
  sourceMode,
  loading,
  lastUpdated,
  warning,
  provider,
  proxyWarning,
}: Props) {
  const { t } = useTranslation();
  const isLive = source === "live" || source === "partial";
  const isProxy = sourceMode === "proxy";
  const showOperationalWarning = source === "partial" || source === "stale" || source === "error";

  const sourceLabel = isProxy
    ? `${t("dataSource.proxy")} — ${provider ?? "Proxy"}`
    : isLive
      ? `${t("dataSource.live")} — ${provider ?? "Binance"}`
      : t("dataSource.offline");

  return (
    <div className="data-source-bar" role="status" aria-live="polite">
      <div className="data-source-left">
        <span
          className={`source-dot ${isLive ? "live" : "offline"} ${loading ? "pulse" : ""}`}
          aria-hidden="true"
        />
        <span className={`source-state ${isLive ? "live" : "offline"}`}>
          {isLive ? "LIVE" : "OFFLINE"}
        </span>
        <span className={`source-label ${isLive ? "live" : "offline"}`}>
          {sourceLabel}
        </span>
        {source === "partial" && (
          <span className="source-partial"> {t("dataSource.partial")}</span>
        )}
      </div>

      <div className="data-source-right">
        {loading && (
          <span className="source-fetching">{t("dataSource.refreshing")}</span>
        )}
        <span className="source-time">{formatTime(lastUpdated)}</span>
      </div>

      {proxyWarning && (
        <div className="source-warning source-proxy-warning">⚠ {proxyWarning}</div>
      )}
      {warning && showOperationalWarning && (
        <div className="source-warning">{warning}</div>
      )}
    </div>
  );
}
