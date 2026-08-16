import { NextRequest, NextResponse } from "next/server";

// -----------------------------------------------------------------------
// Driving a Square Terminal from the front desk.
//
// The other Square integration (lib/square.ts) hands off to the Square app
// on the same device and needs no secret at all. This one is the opposite
// shape: the server tells a Terminal to take a payment, and the client never
// leaves this app. That is only possible with an access token, and an access
// token can move money — so everything here runs server-side and the token
// never reaches a browser.
//
// SECRET KEY. SQUARE_ACCESS_TOKEN is the third secret in this application,
// after SUPABASE_SECRET_KEY and RESEND_API_KEY, and the most dangerous of
// the three: the other two read and write records, this one takes money from
// somebody's card. It is read here and nowhere else.
//
// WHO IS ALLOWED. The caller's own Supabase session, checked against
// at_least_employee(). Anyone who can sign a dog out can take a payment for
// it; nobody who cannot sign in at all can reach a card reader.
//
// DOUBLE CHARGES. Square deduplicates on idempotency_key, so the same key
// resent is the same payment rather than a second one. The key is the visit
// being paid for plus the amount, which means a double tap, a retried
// request and a refreshed page all collapse into one charge. This is the
// whole reason the key is built here rather than generated per request.
//
// WHAT THIS DOES NOT DO. It does not refund, void, or read past payments.
// A route that holds this token should do the smallest possible number of
// things, and taking one payment is the thing the front desk needs.
// -----------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;

// Square's own API version header. Pinned rather than floating: a silent
// upgrade to a version with different field names would break payments, and
// payments are not the place to find that out.
const SQUARE_VERSION = "2025-01-23";
const TIMEOUT_MS = 20_000;

function squareBase(sandbox: boolean): string {
  return sandbox ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";
}

/** The signed-in staff account behind this request, or null. */
async function callerIsStaff(token: string): Promise<boolean> {
  if (!SUPABASE_URL || !ANON_KEY) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/at_least_employee`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return false;
    return (await res.json()) === true;
  } catch (e) {
    console.error("Could not check the caller's role:", e);
    return false;
  }
}

async function square(
  path: string,
  init: { method: string; body?: unknown; sandbox: boolean }
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${squareBase(init.sandbox)}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

/** Square returns errors as a list; take the first thing a person can act on. */
function squareError(data: Record<string, unknown>): string {
  const errors = data.errors as { detail?: string; code?: string }[] | undefined;
  const first = errors?.[0];
  return first?.detail || first?.code || "Square refused that.";
}

export async function POST(req: NextRequest) {
  if (!ACCESS_TOKEN) {
    return NextResponse.json(
      {
        error:
          "Card terminal is not configured on this server — SQUARE_ACCESS_TOKEN is not set. Add it and restart.",
      },
      { status: 501 }
    );
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !(await callerIsStaff(token))) {
    return NextResponse.json({ error: "Sign in as staff to take a payment." }, { status: 403 });
  }

  let body: {
    action?: string;
    amountCents?: number;
    deviceId?: string;
    locationId?: string;
    reference?: string;
    note?: string;
    checkoutId?: string;
    sandbox?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const sandbox = body.sandbox !== false;

  // ---- Pair a Terminal ------------------------------------------------
  //
  // Square hands back a short code which somebody types into the device.
  // Without this there is no way to learn a device id, so the rest of the
  // route would be unusable however correct it was.
  if (body.action === "pair") {
    const res = await square("/v2/devices/codes", {
      method: "POST",
      sandbox,
      body: {
        idempotency_key: `pair-${Date.now()}`,
        device_code: {
          name: "Front desk",
          product_type: "TERMINAL_API",
          location_id: body.locationId || undefined,
        },
      },
    });
    if (!res.ok) {
      return NextResponse.json({ error: squareError(res.data) }, { status: res.status });
    }
    const code = res.data.device_code as { code?: string; id?: string } | undefined;
    return NextResponse.json({ pairingCode: code?.code ?? null, deviceCodeId: code?.id ?? null });
  }

  // ---- Ask the Terminal for a payment ---------------------------------
  if (body.action === "charge") {
    const amount = Math.round(Number(body.amountCents));
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Nothing to charge." }, { status: 400 });
    }
    if (!body.deviceId) {
      return NextResponse.json(
        { error: "No card terminal is paired — pair one under Settings → Card payments." },
        { status: 400 }
      );
    }
    // The visit and the amount, not a fresh uuid. Square treats a repeat of
    // the same key as the same payment, so a double tap cannot take the
    // money twice — see the note at the top.
    const idempotencyKey = `${body.reference ?? "visit"}-${amount}`.slice(0, 64);

    const res = await square("/v2/terminals/checkouts", {
      method: "POST",
      sandbox,
      body: {
        idempotency_key: idempotencyKey,
        checkout: {
          amount_money: { amount, currency: "USD" },
          device_options: { device_id: body.deviceId },
          note: (body.note ?? "").slice(0, 500) || undefined,
          reference_id: (body.reference ?? "").slice(0, 40) || undefined,
        },
      },
    });
    if (!res.ok) {
      return NextResponse.json({ error: squareError(res.data) }, { status: res.status });
    }
    const checkout = res.data.checkout as { id?: string; status?: string } | undefined;
    return NextResponse.json({ checkoutId: checkout?.id ?? null, status: checkout?.status ?? null });
  }

  // ---- How did it go? -------------------------------------------------
  //
  // Polled rather than pushed. A webhook would need a public URL and a
  // signature check, and the front desk is standing at the screen waiting
  // for an answer — there is nothing to gain by making it asynchronous.
  if (body.action === "status") {
    if (!body.checkoutId) {
      return NextResponse.json({ error: "No checkout to look up." }, { status: 400 });
    }
    const res = await square(`/v2/terminals/checkouts/${encodeURIComponent(body.checkoutId)}`, {
      method: "GET",
      sandbox,
    });
    if (!res.ok) {
      return NextResponse.json({ error: squareError(res.data) }, { status: res.status });
    }
    const checkout = res.data.checkout as
      | { status?: string; payment_ids?: string[]; cancel_reason?: string }
      | undefined;
    return NextResponse.json({
      status: checkout?.status ?? null,
      paymentId: checkout?.payment_ids?.[0] ?? null,
      cancelReason: checkout?.cancel_reason ?? null,
    });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
