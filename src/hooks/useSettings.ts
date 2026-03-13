/**
 * useSettings.ts
 * Centralized settings hook with localStorage persistence.
 * Manages: theme, language, last symbol, engine config, alerts.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import type { Symbol } from "../types";
import i18n from "../i18n";

export type Theme = "dark" | "light";

export type EngineConfig = {
  /** Minimum distance between swing points (candle indices) */
  minSwingDistance: number;
  /** Minimum price separation for SR dedup (percent) */
  minPriceSeparationPct: number;
  /** Auto-refresh interval in seconds */
  refreshIntervalSec: number;
};

export type PriceAlert = {
  id: string;
  symbol: Symbol;
  price: number;
  direction: "above" | "below";
  triggered: boolean;
  createdAt: string;
};

export type Settings = {
  theme: Theme;
  language: string;
  lastSymbol: Symbol;
  engineConfig: EngineConfig;
  alerts: PriceAlert[];
  geminiApiKey: string;
  groqApiKey: string;
};

const STORAGE_KEY = "trading-settings";

const MIN_REFRESH_SEC = 1;
const MAX_REFRESH_SEC = 600;

const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  minSwingDistance: 5,
  minPriceSeparationPct: 0.3,
  refreshIntervalSec: 3,
};

const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  language: "vi",
  lastSymbol: "XAU/USDT",
  engineConfig: DEFAULT_ENGINE_CONFIG,
  alerts: [],
  geminiApiKey: "",
  groqApiKey: "",
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const engineConfig = { ...DEFAULT_ENGINE_CONFIG, ...parsed.engineConfig };
    engineConfig.refreshIntervalSec = Math.max(
      MIN_REFRESH_SEC,
      Math.min(MAX_REFRESH_SEC, engineConfig.refreshIntervalSec),
    );

    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      engineConfig,
      alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
      geminiApiKey: typeof parsed.geminiApiKey === "string" ? parsed.geminiApiKey : "",
      groqApiKey: typeof parsed.groqApiKey === "string" ? parsed.groqApiKey : "",
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  // Persist on every change
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const setTheme = useCallback((theme: Theme) => {
    setSettings(s => ({ ...s, theme }));
    document.documentElement.setAttribute("data-theme", theme);
  }, []);

  const setLanguage = useCallback((language: string) => {
    setSettings(s => ({ ...s, language }));
    i18n.changeLanguage(language);
  }, []);

  const setLastSymbol = useCallback((sym: Symbol) => {
    setSettings(s => ({ ...s, lastSymbol: sym }));
  }, []);

  const setEngineConfig = useCallback((config: Partial<EngineConfig>) => {
    setSettings(s => ({
      ...s,
      engineConfig: {
        ...s.engineConfig,
        ...config,
        refreshIntervalSec: Math.max(
          MIN_REFRESH_SEC,
          Math.min(MAX_REFRESH_SEC, config.refreshIntervalSec ?? s.engineConfig.refreshIntervalSec),
        ),
      },
    }));
  }, []);

  const setGeminiApiKey = useCallback((geminiApiKey: string) => {
    setSettings(s => ({ ...s, geminiApiKey }));
  }, []);

  const setGroqApiKey = useCallback((groqApiKey: string) => {
    setSettings(s => ({ ...s, groqApiKey }));
  }, []);

  const addAlert = useCallback((alert: Omit<PriceAlert, "id" | "triggered" | "createdAt">) => {
    const newAlert: PriceAlert = {
      ...alert,
      id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      triggered: false,
      createdAt: new Date().toISOString(),
    };
    setSettings(s => ({ ...s, alerts: [...s.alerts, newAlert] }));
  }, []);

  const removeAlert = useCallback((id: string) => {
    setSettings(s => ({ ...s, alerts: s.alerts.filter(a => a.id !== id) }));
  }, []);

  const triggerAlert = useCallback((id: string) => {
    setSettings(s => ({
      ...s,
      alerts: s.alerts.map(a => a.id === id ? { ...a, triggered: true } : a),
    }));
  }, []);

  // Apply theme on mount
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", settings.theme);
    i18n.changeLanguage(settings.language);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(() => ({
    settings,
    setTheme,
    setLanguage,
    setLastSymbol,
    setEngineConfig,
    setGeminiApiKey,
    setGroqApiKey,
    addAlert,
    removeAlert,
    triggerAlert,
  }), [settings, setTheme, setLanguage, setLastSymbol, setEngineConfig, setGeminiApiKey, setGroqApiKey, addAlert, removeAlert, triggerAlert]);
}
