import { NextRequest, NextResponse } from "next/server";
import { EmailBrand, EmailKind, renderEmailHtml } from "@/lib/emailTemplate";

// -----------------------------------------------------------------------
// Sends client-facing email — the enrollment acknowledgement, and whatever
// staff write when they approve or decline a request.
//
// Runs server-side so the provider key never ships in client JS. It talks
// to Resend's REST API over plain fetch rather than pulling in their SDK,
// which keeps the dependency list where it is.
//
// SETUP (once per deployment):
//   1. Create a free account at resend.com and verify your sending domain.
//   2. Put the API key in .env.local as RESEND_API_KEY=re_...
//   3. Set the From address on /settings — it must be on the verified
//      domain, or Resend rejects the send.
//
// Until RESEND_API_KEY is set this route no-ops and returns
// { skipped: true }. Nothing else in the app depends on the result, so an
// unconfigured install still enrolls and approves clients exactly as
// before — it just doesn't email anyone.
// -----------------------------------------------------------------------

interface EmailPayload {
  to: string;
  subject: string;
  // Plain text, as typed by staff. Turned into HTML here so line breaks
  // survive; the text version goes along for clients that prefer it.
  body: string;
  fromName?: string;
  fromAddress?: string;
  replyTo?: string;
  // Which message this is, so it can carry the right motif and heading.
  // Absent means "generic", which is the old plain look and is what a test
  // send from the settings screen gets.
  kind?: EmailKind;
  // The logo, colour and contact details, passed from the client because
  // that is where the settings cache lives. The route holds no state of its
  // own beyond the provider key.
  brand?: EmailBrand;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// How long to wait on the provider before giving up. Without this a hung
// connection leaves staff watching a spinner with no way to tell whether
// the message went.
const TIMEOUT_MS = 15_000;

// Anything outside printable ASCII cannot go in an HTTP header — fetch
// throws rather than sending. A key pasted with a trailing newline, a
// smart quote, or wrapping quotes is the usual culprit, and the raw throw
// ("Invalid header value") points nowhere useful.
function keyProblem(key: string): string | null {
  if (/^["']|["']$/.test(key)) {
    return "The RESEND_API_KEY in .env.local is wrapped in quotes. Remove them and restart the server.";
  }
  if (/[^\x20-\x7e]/.test(key)) {
    return "The RESEND_API_KEY in .env.local contains a line break or an invalid character. Re-copy it and restart the server.";
  }
  if (!key.startsWith("re_")) {
    return "The RESEND_API_KEY in .env.local doesn't look like a Resend key — they begin with `re_`.";
  }
  return null;
}

// Turns a thrown fetch error into something a staff member can act on.
// Node reports the real reason on `cause.code`.
function describeFetchFailure(e: unknown): string {
  const cause = (e as { cause?: { code?: string } } | undefined)?.cause;
  const name = (e as { name?: string } | undefined)?.name;
  switch (cause?.code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "Could not look up api.resend.com — this machine has no DNS or no internet connection.";
    case "ECONNREFUSED":
    case "ECONNRESET":
    case "EPIPE":
      return "The connection to Resend was refused or dropped. A firewall or proxy may be blocking it.";
    case "UND_ERR_CONNECT_TIMEOUT":
    case "ETIMEDOUT":
      return "Timed out connecting to Resend. Check the connection and try again.";
    case "CERT_HAS_EXPIRED":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
      return "The TLS certificate could not be verified — usually a corporate proxy intercepting HTTPS.";
    case "ERR_INVALID_CHAR":
      return "The API key contains a character that cannot be sent in a request header. Re-copy RESEND_API_KEY and restart the server.";
  }
  if (name === "TimeoutError" || name === "AbortError") {
    return `Resend did not respond within ${TIMEOUT_MS / 1000} seconds. The message may or may not have been sent — check your Resend dashboard before resending.`;
  }
  // Unknown: name the failure rather than guessing at a cause.
  return `Could not reach the email provider (${name ?? "unknown error"}). The server log has the details.`;
}

export async function POST(req: NextRequest) {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    return NextResponse.json({ skipped: true, reason: "RESEND_API_KEY is not set" });
  }

  // Checked before the request rather than after it fails, so a malformed
  // key reports itself instead of surfacing as a network error. This is the
  // exact case that made a stale env var look like an outage.
  const problem = keyProblem(key);
  if (problem) {
    console.error("Resend key rejected before sending:", problem);
    return NextResponse.json({ error: problem }, { status: 500 });
  }

  let payload: EmailPayload;
  try {
    payload = (await req.json()) as EmailPayload;
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }

  const to = (payload.to ?? "").trim();
  const subject = (payload.subject ?? "").trim();
  const body = payload.body ?? "";
  if (!to || !subject || !body.trim()) {
    return NextResponse.json({ error: "Need a recipient, a subject and a message." }, { status: 400 });
  }

  const address = (payload.fromAddress ?? process.env.EMAIL_FROM ?? "").trim();
  if (!address) {
    return NextResponse.json(
      { error: "No From address configured — set one under Settings → Email." },
      { status: 400 }
    );
  }
  const from = payload.fromName ? `${payload.fromName} <${address}>` : address;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        // Both parts, always. The text version is what a watch, a screen
        // reader and a plain-text client show, and it is the one staff
        // actually wrote — the HTML is a presentation of it, not a
        // replacement for it.
        text: body,
        html: renderEmailHtml({
          kind: payload.kind ?? "generic",
          subject,
          body,
          brand: payload.brand ?? { name: payload.fromName ?? "" },
        }),
        ...(payload.replyTo ? { reply_to: payload.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      // Resend puts the useful part in a JSON `message`. Unwrap it so staff
      // see "The gmail.com domain is not verified" rather than a wall of
      // JSON, and fall back to the raw body if the shape ever changes.
      const raw = await res.text();
      let detail = raw;
      try {
        const parsed = JSON.parse(raw) as { message?: string };
        if (parsed.message) detail = parsed.message;
      } catch {
        // not JSON — keep the raw text
      }
      console.error("Resend rejected the send:", res.status, raw);
      return NextResponse.json({ error: detail || `Send failed (${res.status})` }, { status: 502 });
    }

    return NextResponse.json({ sent: true });
  } catch (e) {
    // Log the real thing — the message returned to the browser is
    // deliberately plain-language, and the stack is what actually diagnoses
    // a proxy or a DNS failure.
    console.error("Sending email failed:", e);
    return NextResponse.json({ error: describeFetchFailure(e) }, { status: 502 });
  }
}
