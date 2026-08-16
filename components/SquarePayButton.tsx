"use client";

import { useEffect, useState } from "react";
import { useSettings } from "@/components/SettingsProvider";
import {
  SquarePlatform,
  chargeUrl,
  detectPlatform,
  newState,
  simulatedReturnUrl,
  stashPending,
} from "@/lib/square";

// "Pay now" — hands off to the Square Point of Sale app with the amount
// filled in, and comes back to /pay/return with the result.
//
// Only renders when Square is configured and the device can actually do it.
// On a desktop browser there is no Square app to open, so it says so rather
// than opening a link that goes nowhere.
export default function SquarePayButton({
  amount,
  note,
  phone,
  dogNames,
  returnTo,
  label = "Pay now with Square",
  beforePay,
  onUnavailable,
}: {
  /** In dollars. Converted to cents here — Square works in minor units. */
  amount: number;
  /** Itemised breakdown; lands on the Square receipt. */
  note: string;
  phone: string;
  dogNames: string[];
  /** Where staff should end up once the payment is recorded. */
  returnTo: string;
  label?: string;
  /**
   * Run before handing off to Square. Returning false aborts.
   *
   * The kiosk uses this to sign the dog out first: launching Square
   * navigates the page away entirely, so an un-submitted sign-out would
   * simply be lost — the client would pay and the dog would still be
   * marked as here.
   */
  beforePay?: () => Promise<boolean>;
  onUnavailable?: (reason: string) => void;
}) {
  const { settings } = useSettings();
  const [platform, setPlatform] = useState<SquarePlatform>("unsupported");
  const [origin, setOrigin] = useState("");

  // Both need the browser, so neither can be read during the server render.
  useEffect(() => {
    setPlatform(detectPlatform());
    setOrigin(window.location.origin);
  }, []);

  const square = settings.square;
  if (!square?.enabled) return null;
  if (amount <= 0) return null;

  const testMode = !!square.testMode;
  // An Application ID is only needed to open the real Square app. Demanding
  // one in test mode would hide the button from the very person trying the
  // flow before Square is set up.
  //
  // Missing it with Square switched on used to render nothing at all, which
  // is indistinguishable at the counter from Square being off, the balance
  // being zero, or the app being broken. Say what is missing instead.
  const missingAppId = !testMode && !square.applicationId;
  // In test mode the device does not matter — nothing opens Square.
  const unsupported = platform === "unsupported" && !testMode;

  const [working, setWorking] = useState(false);

  async function pay() {
    if (beforePay) {
      setWorking(true);
      let go = false;
      try {
        go = await beforePay();
      } catch (e) {
        console.error("Could not complete the step before payment:", e);
      } finally {
        setWorking(false);
      }
      if (!go) return;
    }
    const state = newState();
    const callbackUrl = `${origin}/pay/return`;
    const input = {
      amountCents: Math.round(amount * 100),
      note,
      state,
      callbackUrl,
      applicationId: square.applicationId,
      locationId: square.locationId || undefined,
    };
    const url = testMode ? simulatedReturnUrl(input) : chargeUrl(input, platform);
    if (!url) {
      onUnavailable?.("This device cannot open the Square app.");
      return;
    }
    // Written BEFORE navigating: the page is about to be replaced by the
    // Square app, and this is the only record of what the payment was for.
    stashPending({
      state,
      phone,
      dogNames,
      amountCents: Math.round(amount * 100),
      note,
      returnTo,
      startedAt: Date.now(),
    });
    window.location.href = url;
  }

  if (missingAppId) {
    return (
      <p className="text-[11px] text-ink-3">
        💳 Card payment needs a Square <b>Application ID</b> — add it under Settings → Pricing →
        Square, or switch test mode on to try the flow without it.
      </p>
    );
  }

  if (unsupported) {
    return (
      <p className="text-[11px] text-ink-3">
        💳 Card payment needs the Square app — open this page on the tablet or phone that has it.
      </p>
    );
  }

  if (testMode) {
    return (
      <button
        onClick={pay}
        disabled={working}
        title="Test mode: Square is not opened and no card is charged"
        className="rounded-xl border border-dashed border-amber-400 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-900 transition hover:bg-amber-100"
      >
        🧪 {working ? "Working…" : `Simulate payment · $${amount.toFixed(2)}`}
      </button>
    );
  }

  return (
    <button
      onClick={pay}
      disabled={working}
      className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-card transition hover:bg-emerald-700"
    >
      💳 {working ? "Working…" : `${label} · $${amount.toFixed(2)}`}
    </button>
  );
}
