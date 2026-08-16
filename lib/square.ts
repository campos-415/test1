// Taking card payments through the Square Point of Sale app.
//
// The daycare uses a Square Reader paired to a phone or tablet. Readers
// cannot be driven remotely — Square's Terminal API only pushes a cart to
// Terminal or Register hardware — so this uses the Point of Sale API
// instead: the browser hands off to the Square app with the amount already
// filled in, the client taps their card there, and Square returns to a
// callback page in this app with the result.
//
// Consequences of that hand-off, all of which the UI has to allow for:
//   * it only works on the device with the Square app installed;
//   * the page is fully navigated away from, so anything needed on return
//     must be persisted first (see stashPending);
//   * Square takes a single amount, not a cart. The itemised breakdown goes
//     in the note so it lands on the seller receipt.

export type SquarePlatform = "ios" | "android" | "unsupported";

export function detectPlatform(): SquarePlatform {
  if (typeof navigator === "undefined") return "unsupported";
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "unsupported";
}

export interface SquareChargeInput {
  amountCents: number;
  /** Shown on the Square receipt — the itemised breakdown goes here. */
  note: string;
  /** Round-trip token; Square hands it back so we can find our context. */
  state: string;
  /** Must match a callback URL registered in the Square developer console. */
  callbackUrl: string;
  applicationId: string;
  locationId?: string;
}

// Square rejects a note over 500 characters, and a rejected charge at the
// counter is worse than a truncated receipt line.
const MAX_NOTE = 500;

function trimNote(note: string): string {
  return note.length > MAX_NOTE ? `${note.slice(0, MAX_NOTE - 1)}…` : note;
}

/** The iOS custom-scheme URL. */
export function iosUrl(input: SquareChargeInput): string {
  const data = {
    amount_money: { amount: Math.round(input.amountCents), currency_code: "USD" },
    callback_url: input.callbackUrl,
    client_id: input.applicationId,
    version: "1.3",
    notes: trimNote(input.note),
    state: input.state,
    ...(input.locationId ? { location_id: input.locationId } : {}),
    options: {
      supported_tender_types: ["CREDIT_CARD", "CASH", "OTHER"],
      // Returning by itself saves a tap at a busy counter; staff can still
      // hand the phone over for a receipt choice.
      auto_return: true,
    },
  };
  return `square-commerce-v1://payment/create?data=${encodeURIComponent(JSON.stringify(data))}`;
}

/** The Android intent URL. Same information, entirely different syntax. */
export function androidUrl(input: SquareChargeInput): string {
  const parts = [
    "intent:#Intent",
    "action=com.squareup.pos.action.CHARGE",
    "package=com.squareup",
    `S.browser_fallback_url=${encodeURIComponent(input.callbackUrl)}`,
    `S.com.squareup.pos.WEB_CALLBACK_URI=${encodeURIComponent(input.callbackUrl)}`,
    `S.com.squareup.pos.CLIENT_ID=${input.applicationId}`,
    "S.com.squareup.pos.API_VERSION=v2.0",
    `i.com.squareup.pos.TOTAL_AMOUNT=${Math.round(input.amountCents)}`,
    "S.com.squareup.pos.CURRENCY_CODE=USD",
    "S.com.squareup.pos.TENDER_TYPES=com.squareup.pos.TENDER_CARD,com.squareup.pos.TENDER_CASH",
    `S.com.squareup.pos.NOTE=${encodeURIComponent(trimNote(input.note))}`,
    `S.com.squareup.pos.REQUEST_METADATA=${encodeURIComponent(input.state)}`,
    ...(input.locationId ? [`S.com.squareup.pos.LOCATION_ID=${input.locationId}`] : []),
    "end",
  ];
  return parts.join(";");
}

/**
 * Whether Square's developer portal would accept this origin as a web
 * callback URL for the Point of Sale API.
 *
 * It requires a public HTTPS host. A plain-HTTP address, a localhost dev
 * server and a wifi IP are all rejected — and the rejection does not surface
 * as "bad callback URL". The Square app reports that the application is not
 * configured for making web calls, which reads like a portal setting is
 * missing rather than like the address being unregisterable in the first
 * place. Real card payments therefore only work from the deployed site.
 */
export function canRegisterWithSquare(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return false;
    if (url.hostname === "localhost" || url.hostname.endsWith(".local")) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname)) return false; // bare IPv4
    if (url.hostname.startsWith("[")) return false; // IPv6 literal
    return url.hostname.includes(".");
  } catch {
    return false;
  }
}

/** Marks a payment that never involved a card. Checked when clearing them. */
export const TEST_PREFIX = "TEST-";

/**
 * Where the button goes in test mode: straight to the return page with the
 * result Square would have sent. Everything downstream — matching the
 * stashed context, the duplicate check, writing the ledger row — runs for
 * real, which is the part worth testing.
 */
export function simulatedReturnUrl(input: SquareChargeInput, ok = true): string {
  const params = new URLSearchParams(
    ok
      ? { status: "ok", transaction_id: `${TEST_PREFIX}${Date.now().toString(36)}`, state: input.state }
      : { status: "error", error_code: "payment_canceled", state: input.state }
  );
  return `${input.callbackUrl}?${params.toString()}`;
}

export function chargeUrl(input: SquareChargeInput, platform = detectPlatform()): string | null {
  if (platform === "ios") return iosUrl(input);
  if (platform === "android") return androidUrl(input);
  return null;
}

export interface SquareResult {
  ok: boolean;
  state: string;
  transactionId?: string;
  clientTransactionId?: string;
  errorCode?: string;
  errorMessage?: string;
}

// Plain-language versions of the codes Square actually returns. The raw
// ones ("no_network_connection") would be shown to staff mid-transaction.
const ERRORS: Record<string, string> = {
  payment_canceled: "Payment was cancelled on the Square app.",
  TRANSACTION_CANCELED: "Payment was cancelled on the Square app.",
  not_logged_in: "Nobody is signed in to the Square app on this device.",
  NOT_LOGGED_IN: "Nobody is signed in to the Square app on this device.",
  unsupported_api_version: "The Square app needs updating on this device.",
  UNSUPPORTED_API_VERSION: "The Square app needs updating on this device.",
  invalid_request: "Square rejected the request — check the Application ID in Settings.",
  ILLEGAL_LOCATION_ID: "That Square location ID does not match the signed-in account.",
  no_network_connection: "The Square app could not reach Square. Check the connection.",
  NO_NETWORK: "The Square app could not reach Square. Check the connection.",
  amount_too_small: "That amount is below the minimum Square will charge.",
  AMOUNT_TOO_SMALL: "That amount is below the minimum Square will charge.",
};

/** Reads the result Square appended to the callback URL, either platform. */
export function parseSquareCallback(params: URLSearchParams): SquareResult | null {
  // iOS
  const status = params.get("status");
  if (status) {
    const errorCode = params.get("error_code") ?? undefined;
    return {
      ok: status === "ok",
      state: params.get("state") ?? "",
      transactionId: params.get("transaction_id") ?? undefined,
      clientTransactionId: params.get("client_transaction_id") ?? undefined,
      errorCode,
      errorMessage: errorCode ? (ERRORS[errorCode] ?? `Square reported: ${errorCode}`) : undefined,
    };
  }

  // Android — every value is namespaced.
  const androidError = params.get("com.squareup.pos.ERROR_CODE");
  const androidServer = params.get("com.squareup.pos.SERVER_TRANSACTION_ID");
  const androidClient = params.get("com.squareup.pos.CLIENT_TRANSACTION_ID");
  const androidState = params.get("com.squareup.pos.REQUEST_METADATA");
  if (androidError || androidServer || androidClient) {
    return {
      ok: !androidError,
      state: androidState ?? "",
      transactionId: androidServer ?? undefined,
      clientTransactionId: androidClient ?? undefined,
      errorCode: androidError ?? undefined,
      errorMessage: androidError
        ? (ERRORS[androidError] ??
           params.get("com.squareup.pos.ERROR_DESCRIPTION") ??
           `Square reported: ${androidError}`)
        : undefined,
    };
  }
  return null;
}

// ---------------------------------------------------------------------
// Surviving the hand-off.
//
// Launching Square navigates away from the page entirely, so React state is
// gone by the time it returns. What the payment is FOR is written to
// localStorage first, keyed by the token Square echoes back.
// ---------------------------------------------------------------------

export interface PendingPayment {
  state: string;
  phone: string;
  dogNames: string[];
  amountCents: number;
  note: string;
  /** Where to send staff once it is recorded. */
  returnTo: string;
  startedAt: number;
}

const PENDING_KEY = "square_pending";

export function newState(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function stashPending(p: PendingPayment): void {
  try {
    const all = readAllPending().filter((x) => x.state !== p.state);
    // A handful is plenty; anything old is abandoned and only clutters.
    const fresh = [...all, p].filter((x) => Date.now() - x.startedAt < 60 * 60_000).slice(-10);
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(fresh));
  } catch (e) {
    console.error("Could not record the pending payment:", e);
  }
}

function readAllPending(): PendingPayment[] {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingPayment[]) : [];
  } catch {
    return [];
  }
}

export function takePending(state: string): PendingPayment | null {
  const all = readAllPending();
  const found = all.find((p) => p.state === state) ?? null;
  if (found) {
    try {
      window.localStorage.setItem(
        PENDING_KEY,
        JSON.stringify(all.filter((p) => p.state !== state))
      );
    } catch {
      // Leaving it behind is harmless; it expires on its own.
    }
  }
  return found;
}
