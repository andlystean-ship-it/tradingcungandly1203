import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Symbol } from "../types";
import type { Theme, PriceAlert, EngineConfig } from "../hooks/useSettings";

type Props = {
  open: boolean;
  onClose: () => void;
  theme: Theme;
  language: string;
  symbol: Symbol;
  alerts: PriceAlert[];
  engineConfig: EngineConfig;
  onThemeChange: (t: Theme) => void;
  onLanguageChange: (l: string) => void;
  onAddAlert: (alert: { symbol: Symbol; price: number; direction: "above" | "below" }) => void;
  onRemoveAlert: (id: string) => void;
  onEngineConfigChange: (config: Partial<EngineConfig>) => void;
};

export default function SettingsPanel({
  open,
  onClose,
  theme,
  language,
  symbol,
  alerts,
  engineConfig,
  onThemeChange,
  onLanguageChange,
  onAddAlert,
  onRemoveAlert,
  onEngineConfigChange,
}: Props) {
  const { t } = useTranslation();
  const [alertPrice, setAlertPrice] = useState("");
  const [alertDir, setAlertDir] = useState<"above" | "below">("above");

  if (!open) return null;

  const symbolAlerts = alerts.filter(a => a.symbol === symbol);

  const handleAddAlert = () => {
    const price = parseFloat(alertPrice);
    if (isNaN(price) || price <= 0) return;
    onAddAlert({ symbol, price, direction: alertDir });
    setAlertPrice("");
  };

  return (
    <div className="settings-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={t("settings.title")}>
      <div className="settings-panel" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <div className="settings-title">{t("settings.title")}</div>
          <button className="settings-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="settings-group">
          <div className="settings-group-title">{t("settings.theme")}</div>
          <div className="settings-row">
            <span className="settings-label">{t("settings.theme")}</span>
            <select
              className="settings-select"
              value={theme}
              onChange={e => onThemeChange(e.target.value as Theme)}
              aria-label={t("settings.theme")}
            >
              <option value="dark">{t("settings.dark")}</option>
              <option value="light">{t("settings.light")}</option>
            </select>
          </div>
        </div>

        <div className="settings-group">
          <div className="settings-group-title">{t("settings.language")}</div>
          <div className="settings-row">
            <span className="settings-label">{t("settings.language")}</span>
            <select
              className="settings-select"
              value={language}
              onChange={e => onLanguageChange(e.target.value)}
              aria-label={t("settings.language")}
            >
              <option value="vi">Tiếng Việt</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>

        <div className="settings-group">
          <div className="settings-group-title">{t("engineConfig.title")}</div>
          <div className="settings-row">
            <span className="settings-label">{t("engineConfig.minSwingDistance")}</span>
            <input
              className="alert-input"
              type="number"
              min={2}
              max={20}
              value={engineConfig.minSwingDistance}
              onChange={e => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 2 && v <= 20) onEngineConfigChange({ minSwingDistance: v });
              }}
              aria-label={t("engineConfig.minSwingDistance")}
            />
          </div>
          <div className="settings-row">
            <span className="settings-label">{t("engineConfig.minPriceSeparation")}</span>
            <input
              className="alert-input"
              type="number"
              min={0.05}
              max={5}
              step={0.05}
              value={engineConfig.minPriceSeparationPct}
              onChange={e => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v) && v >= 0.05 && v <= 5) onEngineConfigChange({ minPriceSeparationPct: v });
              }}
              aria-label={t("engineConfig.minPriceSeparation")}
            />
          </div>
          <div className="settings-row">
            <span className="settings-label">{t("engineConfig.refreshInterval")}</span>
            <input
              className="alert-input"
              type="number"
              min={10}
              max={600}
              step={10}
              value={engineConfig.refreshIntervalSec}
              onChange={e => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 10 && v <= 600) onEngineConfigChange({ refreshIntervalSec: v });
              }}
              aria-label={t("engineConfig.refreshInterval")}
            />
          </div>
        </div>

        <div className="settings-group">
          <div className="settings-group-title">{t("alerts.title")} — {symbol}</div>

          {symbolAlerts.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "8px 0" }}>
              {t("alerts.noAlerts")}
            </div>
          )}

          <div className="alert-list">
            {symbolAlerts.map(alert => (
              <div key={alert.id} className={`alert-item ${alert.triggered ? "triggered" : ""}`}>
                <div className="alert-info">
                  <span className={`alert-direction ${alert.direction}`}>
                    {alert.direction === "above" ? t("alerts.above") : t("alerts.below")}
                  </span>
                  <span>{alert.price.toFixed(2)}</span>
                  {alert.triggered && (
                    <span style={{ fontSize: 9, color: "var(--neon-yellow)" }}>
                      {t("alerts.triggered")}
                    </span>
                  )}
                </div>
                <button
                  className="alert-remove"
                  onClick={() => onRemoveAlert(alert.id)}
                  aria-label="Remove alert"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="alert-add-row">
            <select
              className="settings-select"
              value={alertDir}
              onChange={e => setAlertDir(e.target.value as "above" | "below")}
              aria-label="Alert direction"
            >
              <option value="above">{t("alerts.above")}</option>
              <option value="below">{t("alerts.below")}</option>
            </select>
            <input
              className="alert-input"
              type="number"
              placeholder="Price"
              value={alertPrice}
              onChange={e => setAlertPrice(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAddAlert()}
              aria-label="Alert price"
            />
            <button className="alert-add-btn" onClick={handleAddAlert}>
              {t("alerts.addAlert")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
