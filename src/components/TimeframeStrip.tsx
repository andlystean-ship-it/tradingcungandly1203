import { useTranslation } from "react-i18next";
import type { TimeframeSignal, TimeframeEntry } from "../types";

type Props = {
  signals: TimeframeSignal[];
  entriesByTF?: TimeframeEntry[];
};

function formatNum(n: number) {
  return n >= 10000 ? n.toFixed(0) : n.toFixed(2);
}

export default function TimeframeStrip({ signals, entriesByTF }: Props) {
  const { t } = useTranslation();

  const formatVolumeState = (entry: TimeframeEntry): string => {
    if (entry.volumeConfirmed) return t("timeframe.volumeConfirmed");
    if (entry.volumeState === "contracting") return t("timeframe.volumeLow");
    if (entry.volumeState === "expanding") return t("timeframe.volumeOppose");
    if (entry.volumeState === "neutral") return t("timeframe.volumeNeutral");
    return t("timeframe.volumeUnknown");
  };

  // Index entries by TF for quick lookup
  const entryMap = new Map<string, TimeframeEntry>();
  if (entriesByTF) {
    for (const e of entriesByTF) entryMap.set(e.tf, e);
  }

  return (
    <div className="tf-strip" role="region" aria-label={t("timeframe.confluence")}>
      <div className="tf-cards">
        {signals.map((s) => {
          const entry = entryMap.get(s.timeframe);
          const reasoning = (s.reasoningTags ?? []).slice(0, 3).join(", ");
          const sideClass = entry?.preferredSide === "long"
            ? "entry-long"
            : entry?.preferredSide === "short"
              ? "entry-short"
              : "";
          const tooltip = entry
            ? `Long: ${formatNum(entry.longEntry)} | Short: ${formatNum(entry.shortEntry)}\nTarget: ${formatNum(entry.target)} | Inv: ${formatNum(entry.invalidation)}\n${t("timeframe.volumeLabel")}: ${formatVolumeState(entry)}${entry.volumeScore != null ? ` (${entry.volumeScore})` : ""}\n${reasoning}`
            : reasoning || undefined;
          return (
            <div
              key={s.timeframe}
              className={`tf-card ${s.bias} ${sideClass}`.trim()}
              role="listitem"
              aria-label={`${s.timeframe}: ${s.bias}`}
              title={tooltip}
            >
              <div className="tf-top">{formatNum(s.bullishLevel)}</div>
              <div className="tf-label">{s.timeframe}</div>
              <div className="tf-bottom">{formatNum(s.bearishLevel)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
