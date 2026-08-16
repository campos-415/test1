// Telling STAFF that a request came in.
//
// Two channels, because they cover different situations:
//
//   Email    — reaches someone who isn't looking at the app. This is the
//              one that matters for a form submitted at 9pm.
//   In-app   — a live badge, a toast, and a desktop notification for
//              whoever has the app open at the front desk.
//
// Both are best-effort. A request is already saved by the time either runs,
// so a failure here is logged and swallowed rather than surfaced to the
// client, who did nothing wrong.

import { getSettings } from "@/lib/settings";
import { sendEmail } from "@/lib/email";

export interface RequestNotice {
  kind: "enrollment" | "boarding";
  who: string;
  dogs: string;
  /** One line of specifics — dates for a boarding, dog count otherwise. */
  detail: string;
  phone: string;
  email: string;
}

export async function notifyStaff(notice: RequestNotice): Promise<void> {
  const { email, business } = getSettings();
  if (!email.notifyOnNewRequest) return;

  const recipients = email.notifyAddresses
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  if (!recipients.length) return;

  const label = notice.kind === "enrollment" ? "enrollment" : "boarding request";
  const subject = `New ${label}: ${notice.dogs} (${notice.who})`;
  const body = `A new ${label} just came in.

Who:    ${notice.who}
Dogs:   ${notice.dogs}
${notice.detail ? `Detail: ${notice.detail}\n` : ""}Phone:  ${notice.phone}
Email:  ${notice.email}

Review it here:
${typeof window !== "undefined" ? window.location.origin : ""}/requests?tab=${
    notice.kind === "enrollment" ? "enrollments" : "boarding"
  }

— ${business.name}`;

  // Sent one at a time so a single bad address doesn't lose the rest.
  await Promise.all(
    recipients.map(async (to) => {
      const result = await sendEmail({ to, subject, body });
      if (result.error) console.error(`Staff notification to ${to} failed:`, result.error);
    })
  );
}

// ---- Desktop notifications -------------------------------------------

const STORE_KEY = "staff_desktop_alerts";

export function desktopAlertsOn(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORE_KEY) === "on" && Notification?.permission === "granted";
}

export function setDesktopAlerts(on: boolean) {
  localStorage.setItem(STORE_KEY, on ? "on" : "off");
}

/** Asks the browser for permission. Returns whether alerts are now usable. */
export async function enableDesktopAlerts(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  const permission =
    Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  const ok = permission === "granted";
  setDesktopAlerts(ok);
  return ok;
}

export function showDesktopAlert(title: string, body: string) {
  if (!desktopAlertsOn()) return;
  try {
    const n = new Notification(title, { body, icon: "/icon-192.png", tag: "ldk-request" });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch (e) {
    // Some browsers throw on constructing a Notification outside a service
    // worker; the in-app toast still fires, so this is not worth surfacing.
    console.error("Desktop notification failed:", e);
  }
}
