/**
 * useAlerts.ts
 * Price alert monitoring — checks current price against configured alerts.
 * Sends browser notifications when alerts trigger (if permission granted).
 */

import { useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Symbol } from "../types";
import type { PriceAlert } from "./useSettings";

type AlertActions = {
  triggerAlert: (id: string) => void;
};

export function useAlerts(
  symbol: Symbol,
  currentPrice: number | undefined,
  alerts: PriceAlert[],
  actions: AlertActions
) {
  const { t } = useTranslation();
  const notifiedRef = useRef(new Set<string>());

  // Request notification permission on first alert
  useEffect(() => {
    if (alerts.length > 0 && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, [alerts.length]);

  const notify = useCallback((alert: PriceAlert) => {
    if (notifiedRef.current.has(alert.id)) return;
    notifiedRef.current.add(alert.id);

    actions.triggerAlert(alert.id);

    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(t("alerts.notifyTitle", { symbol: alert.symbol }), {
        body: alert.direction === "above"
          ? t("alerts.notifyAbove", { price: alert.price.toFixed(2) })
          : t("alerts.notifyBelow", { price: alert.price.toFixed(2) }),
        icon: "/favicon.ico",
      });
    }
  }, [actions, t]);

  useEffect(() => {
    if (!currentPrice) return;

    for (const alert of alerts) {
      if (alert.triggered || alert.symbol !== symbol) continue;

      if (alert.direction === "above" && currentPrice >= alert.price) {
        notify(alert);
      } else if (alert.direction === "below" && currentPrice <= alert.price) {
        notify(alert);
      }
    }
  }, [currentPrice, alerts, symbol, notify]);
}
