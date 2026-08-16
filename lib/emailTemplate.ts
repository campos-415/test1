// The look of every email the business sends.
//
// Until now a message was one div of escaped text. It arrived looking like a
// system notification from 2003, which is a poor first impression when it is
// often the first thing a new client ever receives from the business.
//
// Rules this file obeys, because email is not the web:
//
//   Tables, not flexbox or grid. Outlook renders with Word, which knows
//   neither. Nested tables with fixed widths are the only layout that lands
//   the same way everywhere.
//
//   Inline styles, not classes. Gmail strips <style> blocks in some views,
//   and a layout that depends on one collapses rather than degrades.
//
//   No background images, no web fonts, no external CSS. All three are
//   blocked somewhere that matters.
//
//   The logo must be an https URL. A base64 data: URI - which is how this
//   app stores every other image - is stripped by Gmail and by Outlook, so a
//   logo stored that way would show as a broken image to most recipients.
//   The settings screen already uploads the logo to the public site-photos
//   bucket and keeps the URL, so the common case works; anything else falls
//   back to the business name set in the accent colour, which is a wordmark
//   rather than a hole.
//
//   Everything is centred in a 560px table. Wider than that and it wraps
//   badly on a phone; narrower and the desktop clients pad it oddly.

/** Which message this is. Decides the motif, the heading and the colour. */
export type EmailKind =
  | "enrollment.received"
  | "enrollment.approved"
  | "enrollment.declined"
  | "enrollment.details"
  | "boarding.requested"
  | "boarding.confirmed"
  | "boarding.declined"
  | "account.invite"
  | "generic";

export interface EmailBrand {
  name: string;
  /** Public https URL. A data: URI is ignored — see the note above. */
  logoUrl?: string | null;
  accentColor?: string | null;
  phone?: string | null;
  address?: string | null;
  website?: string | null;
}

interface Occasion {
  /** Shown large above the heading. Emoji survive everywhere; images do not. */
  motif: string;
  /** The one-line banner under the logo. */
  heading: string;
  /**
   * Overrides the business accent for this occasion. Only where the message
   * itself has a temperature: a confirmation should feel different from a
   * decline, and a decline should not arrive in celebration green.
   */
  tone?: string;
}

const OCCASIONS: Record<EmailKind, Occasion> = {
  "enrollment.received": { motif: "📋", heading: "We have your enrollment" },
  "enrollment.approved": { motif: "🎉", heading: "You are all set", tone: "#15803d" },
  // No motif that reads as celebration, and a neutral slate rather than the
  // brand colour: this message is a no, and dressing it up is worse than
  // sending it plain.
  "enrollment.declined": { motif: "", heading: "About your enrollment", tone: "#475569" },
  "enrollment.details": { motif: "📝", heading: "A few last details" },
  "boarding.requested": { motif: "📅", heading: "We have your dates" },
  "boarding.confirmed": { motif: "🐕", heading: "Your stay is confirmed", tone: "#15803d" },
  "boarding.declined": { motif: "", heading: "About your boarding request", tone: "#475569" },
  "account.invite": { motif: "🔑", heading: "Your account is ready to set up" },
  generic: { motif: "", heading: "" },
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Only an https URL is usable; anything else would render as a broken image. */
function usableLogo(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

/** A hex colour, or the default. Guards against a settings field with junk in it. */
function safeColor(value: string | null | undefined, fallback: string): string {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

/**
 * Staff type plain text with blank lines between paragraphs. That is the
 * right thing to type and the wrong thing to send, so it becomes real
 * paragraphs here rather than a run of <br> tags.
 *
 * A line that is only a URL becomes a button. This is what makes the
 * enrollment details link and the account invitation look like something to
 * press rather than a wall of query string — and it is deliberately narrow:
 * a URL with words around it stays inline, because a sentence is not a call
 * to action.
 */
function renderBody(body: string, accent: string): string {
  const paragraphs = body.trim().split(/\n\s*\n/);

  return paragraphs
    .map((para) => {
      const trimmed = para.trim();
      if (/^https?:\/\/\S+$/.test(trimmed)) {
        return `
          <tr><td style="padding:8px 0 20px">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-radius:10px;background:${accent}">
                <a href="${escapeHtml(trimmed)}"
                   style="display:inline-block;padding:12px 28px;font:600 15px/1 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#ffffff;text-decoration:none;border-radius:10px">
                  Open the link
                </a>
              </td></tr>
            </table>
            <p style="margin:10px 0 0;font:12px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#94a3b8">
              Or paste this into your browser:<br>
              <span style="color:#64748b;word-break:break-all">${escapeHtml(trimmed)}</span>
            </p>
          </td></tr>`;
      }
      return `
        <tr><td style="padding:0 0 14px;font:15px/1.65 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#334155">
          ${escapeHtml(trimmed).replace(/\n/g, "<br>")}
        </td></tr>`;
    })
    .join("");
}

/**
 * The whole message, ready to hand to the provider.
 *
 * `preheader` is the grey line a mail client shows next to the subject in the
 * inbox list. Left unset it shows whatever the first words of the HTML happen
 * to be, which is usually "View this email" or the alt text of the logo.
 */
export function renderEmailHtml(input: {
  kind: EmailKind;
  subject: string;
  body: string;
  brand: EmailBrand;
}): string {
  const { kind, subject, body, brand } = input;
  const occasion = OCCASIONS[kind] ?? OCCASIONS.generic;
  const brandAccent = safeColor(brand.accentColor, "#f59e0b");
  const accent = occasion.tone ?? brandAccent;
  const logo = usableLogo(brand.logoUrl);
  const name = escapeHtml(brand.name || "");

  const preheader = escapeHtml(subject).slice(0, 120);

  const contactLine = [brand.phone, brand.address]
    .filter((part): part is string => !!part && part.trim().length > 0)
    .map(escapeHtml)
    .join(" · ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9">
  <!-- The inbox preview line. Hidden in the message itself. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9">
    <tr><td align="center" style="padding:28px 12px">

      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"
             style="width:560px;max-width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">

        <!-- A band of the accent colour. The one piece of decoration that
             works in every client, because it is a table cell with a
             background colour and nothing else. -->
        <tr><td style="height:5px;background:${accent};font-size:0;line-height:0">&nbsp;</td></tr>

        <tr><td align="center" style="padding:28px 32px 0">
          ${
            logo
              ? `<img src="${escapeHtml(logo)}" alt="${name}" width="120"
                   style="display:block;width:120px;max-width:120px;height:auto;border:0">`
              : `<div style="font:700 20px/1.2 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${brandAccent}">${name}</div>`
          }
        </td></tr>

        ${
          occasion.motif
            ? `<tr><td align="center" style="padding:18px 32px 0;font-size:34px;line-height:1">${occasion.motif}</td></tr>`
            : ""
        }

        ${
          occasion.heading
            ? `<tr><td align="center" style="padding:12px 32px 0">
                 <h1 style="margin:0;font:600 21px/1.3 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
                   ${escapeHtml(occasion.heading)}
                 </h1>
               </td></tr>`
            : ""
        }

        <tr><td style="padding:22px 32px 6px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${renderBody(body, accent)}
          </table>
        </td></tr>

        <tr><td style="padding:6px 32px 26px">
          <div style="height:1px;background:#e2e8f0;font-size:0;line-height:0">&nbsp;</div>
        </td></tr>

        <tr><td align="center" style="padding:0 32px 28px">
          <p style="margin:0;font:600 13px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a">${name}</p>
          ${
            contactLine
              ? `<p style="margin:4px 0 0;font:12px/1.6 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#94a3b8">${contactLine}</p>`
              : ""
          }
          ${
            brand.website
              ? `<p style="margin:6px 0 0;font:12px/1.6 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
                   <a href="${escapeHtml(brand.website)}" style="color:${brandAccent};text-decoration:none">${escapeHtml(
                     brand.website.replace(/^https?:\/\//, "")
                   )}</a>
                 </p>`
              : ""
          }
        </td></tr>
      </table>

      <p style="margin:14px 0 0;font:11px/1.6 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#94a3b8">
        Sent to you because you are a client of ${name}.
      </p>

    </td></tr>
  </table>
</body>
</html>`;
}
