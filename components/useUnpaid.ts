"use client";

import { useCallback, useEffect, useState } from "react";
import { UnpaidIndex, loadUnpaidIndex } from "@/lib/unpaid";
import { PayState } from "@/components/Money";

// Every screen that shows a price needs the same answer, so it is loaded the
// same way in one place.
//
// A failure here must never take a page down: not knowing whether something
// is paid is a missing colour, not a broken screen. On error the index is
// empty, which reads as "nothing outstanding" — the same as before any of
// this existed.
export function useUnpaid(): {
  unpaid: UnpaidIndex;
  stateFor: (key: string | null | undefined) => PayState;
  reload: () => void;
} {
  const [unpaid, setUnpaid] = useState<UnpaidIndex>(new Map());

  const reload = useCallback(() => {
    loadUnpaidIndex()
      .then(setUnpaid)
      .catch((e) => console.error("Loading what is unpaid failed:", e));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // No key means nothing has been charged yet — an estimate, not a debt.
  const stateFor = useCallback(
    (key: string | null | undefined): PayState =>
      !key ? "estimate" : unpaid.has(key) ? "unpaid" : "paid",
    [unpaid]
  );

  return { unpaid, stateFor, reload };
}
