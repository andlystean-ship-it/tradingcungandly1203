/**
 * i18n.ts
 * Internationalization setup using i18next + react-i18next.
 * Supports Vietnamese (default) and English.
 * Persists language choice to localStorage.
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import vi from "./vi.json";
import en from "./en.json";

const STORAGE_KEY = "trading-lang";

function getSavedLanguage(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || "vi";
  } catch {
    return "vi";
  }
}

i18n.use(initReactI18next).init({
  resources: {
    vi: { translation: vi },
    en: { translation: en },
  },
  lng: getSavedLanguage(),
  fallbackLng: "vi",
  interpolation: { escapeValue: false },
});

// Persist language changes
i18n.on("languageChanged", (lng) => {
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // localStorage unavailable
  }
});

export default i18n;
