import type { NewsItem, Symbol } from "../types";

type Props = {
  news: NewsItem[];
  symbol: Symbol;
};

const SENTIMENT_LABELS: Record<string, string> = {
  bullish: "Tích cực",
  bearish: "Tiêu cực",
  neutral: "Trung tính",
};

export default function NewsPanel({ news, symbol }: Props) {
  const coinName = symbol === "XAU/USDT" ? "XAU" : "BTC";

  return (
    <div className="news-panel">
      <div className="news-header">
        <div className="news-title">Tin tức &amp; Sentiment — {coinName}</div>
        <div className="news-badge">{news.length} tin</div>
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
                  {SENTIMENT_LABELS[item.sentimentLabel]} ({item.sentimentScore}%)
                </div>
                {item.hasTargetPrice && (
                  <button className="news-cta">Có Mục Tiêu Giá</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
