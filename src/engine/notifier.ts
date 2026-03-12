/**
 * notifier.ts — Notification service abstraction
 *
 * Architecture for pluggable notification channels.
 * Currently supports: browser Notification API.
 * Prepared for: Telegram bot integration.
 *
 * To add Telegram bot:
 *   1. Set BOT_TOKEN and CHAT_ID in environment or config
 *   2. Implement TelegramNotifier.send() with fetch to Telegram Bot API
 *   3. Register it via registerNotifier()
 *
 * The notifier system is decoupled from the alert engine — useAlerts
 * or any other consumer can call notifyAll() to broadcast across channels.
 */

export type NotificationPayload = {
  title: string;
  body: string;
  symbol: string;
  price: number;
  direction: "above" | "below";
  timestamp: string;
};

export interface Notifier {
  readonly name: string;
  send(payload: NotificationPayload): Promise<void>;
}

// ── Browser Notification Channel ──────────────────────────────────────────────

export class BrowserNotifier implements Notifier {
  readonly name = "browser";

  async send(payload: NotificationPayload): Promise<void> {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    new Notification(payload.title, {
      body: payload.body,
      icon: "/favicon.ico",
    });
  }
}

// ── Telegram Bot Channel (skeleton — ready for implementation) ─────────────────

export class TelegramNotifier implements Notifier {
  readonly name = "telegram";
  private botToken: string;
  private chatId: string;

  constructor(botToken: string, chatId: string) {
    this.botToken = botToken;
    this.chatId = chatId;
  }

  async send(payload: NotificationPayload): Promise<void> {
    if (!this.botToken || !this.chatId) return;

    const text = [
      `🔔 *${payload.title}*`,
      payload.body,
      `Symbol: ${payload.symbol}`,
      `Price: ${payload.price.toFixed(2)}`,
      `Time: ${payload.timestamp}`,
    ].join("\n");

    // Telegram Bot API endpoint
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        parse_mode: "Markdown",
      }),
    });
  }
}

// ── Notifier Registry ─────────────────────────────────────────────────────────

const notifiers: Notifier[] = [new BrowserNotifier()];

export function registerNotifier(notifier: Notifier): void {
  // Prevent duplicate registrations
  if (notifiers.some(n => n.name === notifier.name)) return;
  notifiers.push(notifier);
}

export function getNotifiers(): readonly Notifier[] {
  return notifiers;
}

/**
 * Broadcast a notification across all registered channels.
 * Errors in individual channels are silently caught to avoid
 * one failing channel blocking others.
 */
export async function notifyAll(payload: NotificationPayload): Promise<void> {
  await Promise.allSettled(
    notifiers.map(n => n.send(payload))
  );
}
