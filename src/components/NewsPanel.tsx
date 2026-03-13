import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { NewsItem, Symbol } from "../types";

type Props = {
  news: NewsItem[];
  symbol: Symbol;
};

export default function NewsPanel({ news, symbol }: Props) {
  const { t } = useTranslation();
  const [activeFilter, setActiveFilter] = useState<"all" | "live" | "fallback" | "bullish" | "bearish">("all");
  const coinName = symbol.split("/")[0];
  const hasLiveFeed = news.some((item) => item.sourceMode === "live");
  const hasFallbackFeed = news.some((item) => item.sourceMode === "fallback");
  const feedLabel = hasLiveFeed && hasFallbackFeed
    ? t("news.mixedFeed")
    : hasLiveFeed
      ? t("news.liveFeed")
      : t("news.fallbackFeed");

  const visibleNews = useMemo(() => {
    if (activeFilter === "all") return news;
    if (activeFilter === "live") return news.filter((item) => item.sourceMode === "live");
    if (activeFilter === "fallback") return news.filter((item) => item.sourceMode === "fallback");
    return news.filter((item) => item.sentimentLabel === activeFilter);
  }, [activeFilter, news]);

  return (
    <div className="news-panel" role="region" aria-label={t("news.title")}>
      <div className="news-header">
        <div className="news-title-wrap">
          <div className="news-title">{t("news.title")} | {coinName}</div>
          <div className="news-subtitle">{feedLabel}</div>
        </div>
        <div className="news-badge">{t("news.count", { count: visibleNews.length })}</div>
      </div>

      <div className="news-filters" role="tablist" aria-label={t("news.title")}>
        <button
          className={`news-filter ${activeFilter === "all" ? "active" : ""}`}
          onClick={() => setActiveFilter("all")}
          type="button"
        >
          {t("news.filterAll")}
        </button>
        <button
          className={`news-filter ${activeFilter === "live" ? "active" : ""}`}
          onClick={() => setActiveFilter("live")}
          type="button"
        >
          {t("news.filterLive")}
        </button>
        <button
          className={`news-filter ${activeFilter === "bullish" ? "active" : ""}`}
          onClick={() => setActiveFilter("bullish")}
          type="button"
        >
          {t("news.filterBullish")}
        </button>
        <button
          className={`news-filter ${activeFilter === "bearish" ? "active" : ""}`}
          onClick={() => setActiveFilter("bearish")}
          type="button"
        >
          {t("news.filterBearish")}
        </button>
      </div>

      <div className="news-list">
        {visibleNews.length === 0 && (
          <div style={{ color: "var(--text-muted)", fontSize: 12, padding: "16px 0", textAlign: "center" }}>
            {t("news.noNews")}
          </div>
        )}
        {visibleNews.map((item) => (
          <div key={item.id} className="news-card">
            <div className="news-meta">
              <span className="news-source">{item.source}</span>
              {item.sourceMode === "live" && item.sourceAttribution && <span className="news-time">· {item.sourceAttribution}</span>}
              {item.sourceMode === "fallback" && <span className="news-time">· {t("news.systemFallback")}</span>}
              <span className="news-time">· {item.publishedAt}</span>
            </div>

            <div className="news-title-text">{item.title}</div>
            <div className="news-summary">{item.summary}</div>

            <div className="news-footer">
              <div className="news-tags">
                {item.relatedCoins.map((coin) => (
                  <span key={coin} className="news-tag">
                    #{coin}
                  </span>
                ))}
              </div>

              <div className="news-actions">
                <div className={`news-sentiment ${item.sentimentLabel}`}>
                  {t(`news.${item.sentimentLabel}`)} ({item.sentimentScore}%)
                </div>
                {item.sourceMode !== "fallback" && item.hasTargetPrice && (
                  <button className="news-cta">{t("news.hasTarget")}</button>
                )}
                <button className="news-cta ghost" type="button">{t("news.details")}</button>
              </div>
            </div>
            {item.sourceMode === "fallback" && (
              <div className="news-summary" style={{ marginTop: 8, opacity: 0.8 }}>
                {t("news.secondaryOnly")}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
