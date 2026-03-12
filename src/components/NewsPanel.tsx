import { useTranslation } from "react-i18next";
import type { NewsItem, Symbol } from "../types";

type Props = {
  news: NewsItem[];
  symbol: Symbol;
};

export default function NewsPanel({ news, symbol }: Props) {
  const { t } = useTranslation();
  const coinName = symbol.split("/")[0];
  const hasLiveFeed = news.some((item) => item.sourceMode === "live");
  const hasFallbackFeed = news.some((item) => item.sourceMode === "fallback");
  const feedLabel = hasLiveFeed && hasFallbackFeed
    ? t("news.mixedFeed")
    : hasLiveFeed
      ? t("news.liveFeed")
      : t("news.fallbackFeed");

  return (
    <div className="news-panel" role="region" aria-label={t("news.title")}>
      <div className="news-header">
        <div className="news-title">{t("news.title")} — {coinName}</div>
        <div className="news-badge">{feedLabel}</div>
        <div className="news-badge">{t("news.count", { count: news.length })}</div>
      </div>

      <div className="news-list">
        {news.map((item) => (
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

              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <div className={`news-sentiment ${item.sentimentLabel}`}>
                  {t(`news.${item.sentimentLabel}`)} ({item.sentimentScore}%)
                </div>
                {item.sourceMode !== "fallback" && item.hasTargetPrice && (
                  <button className="news-cta">{t("news.hasTarget")}</button>
                )}
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
