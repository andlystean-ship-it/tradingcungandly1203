import { useTranslation } from "react-i18next";
import type { NewsItem, Symbol } from "../types";

type Props = {
  news: NewsItem[];
  symbol: Symbol;
};

export default function NewsPanel({ news, symbol }: Props) {
  const { t } = useTranslation();
  const coinName = symbol === "XAU/USDT" ? "XAU" : "BTC";

  return (
    <div className="news-panel" role="region" aria-label={t("news.title")}>
      <div className="news-header">
        <div className="news-title">{t("news.title")} — {coinName}</div>
        <div className="news-badge">{t("news.count", { count: news.length })}</div>
      </div>

      <div className="news-list">
        {news.map((item) => (
          <div key={item.id} className="news-card">
            <div className="news-meta">
              <span className="news-source">{item.source}</span>
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
                {item.hasTargetPrice && (
                  <button className="news-cta">{t("news.hasTarget")}</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
