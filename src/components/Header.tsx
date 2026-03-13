import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { Symbol, Direction } from "../types";
import { KNOWN_SYMBOLS, fetchExtraSymbols } from "../engine/symbols";

type Props = {
  direction: Direction;
  symbol: Symbol;
  onDirectionChange: (d: Direction) => void;
  onSymbolChange: (s: Symbol) => void;
  onSettingsOpen?: () => void;
};

export default function Header({
  direction,
  symbol,
  onDirectionChange,
  onSymbolChange,
  onSettingsOpen,
}: Props) {
  const { t } = useTranslation();
  const [extraSymbols, setExtraSymbols] = useState<string[]>([]);

  useEffect(() => {
    fetchExtraSymbols().then(setExtraSymbols);
  }, []);

  return (
    <div className="header">
      <div className="header-logo">SC</div>
      <div className="header-brand">
        <div className="header-title">{t("header.title")}</div>
        <div className="header-subtitle">{symbol} | LIVE TERMINAL</div>
      </div>
      <div className="header-controls">
        <select
          className="select-pill"
          value={direction}
          onChange={(e) => onDirectionChange(e.target.value as Direction)}
          aria-label={t("header.longOrder")}
        >
          <option value="long">{t("header.longOrder")}</option>
          <option value="short">{t("header.shortOrder")}</option>
        </select>
        <select
          className="select-pill"
          value={symbol}
          onChange={(e) => onSymbolChange(e.target.value as Symbol)}
          aria-label="Symbol"
        >
          {KNOWN_SYMBOLS.map(s => (
            <option key={s} value={s}>{t(`symbols.${s}`)}</option>
          ))}
          {extraSymbols.length > 0 && (
            <optgroup label="──────────">
              {extraSymbols.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </optgroup>
          )}
        </select>
        {onSettingsOpen && (
          <button className="settings-btn" onClick={onSettingsOpen} aria-label={t("settings.title")}>
            ⚙
          </button>
        )}
      </div>
    </div>
  );
}
