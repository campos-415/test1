"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { Household, forgetCachedHousehold, loadMyHousehold } from "@/lib/customer";

export interface CustomerState {
  /** Null when nobody is signed in, or the account has no household. */
  household: Household | null;
  /** True while the first read is in flight. */
  loading: boolean;
  /** There is a session, whoever it belongs to. */
  signedIn: boolean;
  refresh: () => Promise<void>;
}

/**
 * The household the signed-in account has claimed.
 *
 * The mirror of useRole on the staff side, and used the same way: to decide
 * what to OFFER. What is allowed is decided by the database on every
 * request, whatever this returns.
 */
export default function useCustomer(): CustomerState {
  const [household, setHousehold] = useState<Household | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  const read = useCallback(async () => {
    const { data } = await getSupabase().auth.getSession();
    setSignedIn(!!data.session);
    setHousehold(data.session ? await loadMyHousehold() : null);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    forgetCachedHousehold();
    await read();
  }, [read]);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data } = await getSupabase().auth.getSession();
      const next = data.session ? await loadMyHousehold() : null;
      if (!live) return;
      setSignedIn(!!data.session);
      setHousehold(next);
      setLoading(false);
    })();

    // Signing in or out in another tab changes the answer here, and so does
    // claiming an invitation in one.
    const { data: sub } = getSupabase().auth.onAuthStateChange(() => {
      forgetCachedHousehold();
      if (live) read();
    });
    return () => {
      live = false;
      sub.subscription.unsubscribe();
    };
  }, [read]);

  return { household, loading, signedIn, refresh };
}
