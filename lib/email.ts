// Client-side helpers for the email route. The templates and the From
// address live in settings so a business can reword everything without a
// deploy; the provider key stays server-side in app/api/email/route.ts.

import { getSettings } from "@/lib/settings";
import type { EmailKind } from "@/lib/emailTemplate";

export interface SendResult {
  sent: boolean;
  skipped?: boolean;
  error?: string;
}

// Placeholders staff can use in a template. Anything unknown is left alone
// rather than blanked, so a typo shows up in the preview instead of
// silently deleting a sentence.
export type TemplateVars = Record<string, string>;

export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key: string) =>
    key in vars ? vars[key] : whole
  );
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  body: string;
  // Which message this is. Decides the motif and heading the branded
  // template puts above the text — see lib/emailTemplate.ts. Omitted means
  // the plain treatment, which is what a test send should get.
  kind?: EmailKind;
  // Overrides the saved sender. Only the settings page uses this, so a
  // test send reflects the addresses being edited rather than the ones
  // last saved — otherwise "send a test" would quietly test the old value.
  from?: { fromName?: string; fromAddress?: string; replyTo?: string };
}): Promise<SendResult> {
  const { email, business } = getSettings();
  const { from, ...message } = input;
  try {
    const res = await fetch("/api/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...message,
        fromName: from?.fromName || email.fromName || business.name,
        fromAddress: from?.fromAddress || email.fromAddress,
        replyTo: from?.replyTo || email.replyTo || undefined,
        // Assembled here rather than in the route so there is one source of
        // branding, and it is the same settings object the whole app reads.
        brand: {
          name: business.name,
          // Already a public https URL: the settings screen uploads the
          // logo to the site-photos bucket. That matters more than it looks
          // — a base64 logo is stripped by Gmail and would arrive broken.
          logoUrl: business.logoData,
          accentColor: business.accentColor,
          phone: business.phone,
          address: [business.street, business.city, business.state].filter(Boolean).join(", "),
          website: business.domain,
        },
      }),
    });
    const data = (await res.json()) as { sent?: boolean; skipped?: boolean; error?: string };
    if (data.skipped) return { sent: false, skipped: true };
    if (!res.ok) return { sent: false, error: data.error ?? `Send failed (${res.status})` };
    return { sent: !!data.sent };
  } catch (e) {
    console.error("Email request failed:", e);
    return { sent: false, error: "Could not reach the email service." };
  }
}
