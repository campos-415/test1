"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { StaffAccount, forgetCachedRole, loadMyAccount } from "@/lib/roles";

export interface RoleState {
  account: StaffAccount | null;
  loading: boolean;
  /**
   * Set when the role could not be read at all - almost always a database
   * that has not run security-roles-migration.sql yet. Screens use it to
   * fall back to their old behaviour rather than showing everybody an
   * application that thinks they have no permissions.
   */
  unavailable: boolean;
  refresh: () => Promise<void>;
}

/**
 * The signed-in account and its role.
 *
 * Used to decide what to OFFER. What is allowed is decided by the database,
 * every time, whatever this returns - see the note at the top of
 * lib/roles.ts.
 */
export default function useRole(): RoleState {
  const [account, setAccount] = useState<StaffAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const refresh = useCallback(async () => {
    try {
      forgetCachedRole();
      setAccount(await loadMyAccount());
      setUnavailable(false);
    } catch {
      setAccount(null);
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const next = await loadMyAccount();
        if (live) {
          setAccount(next);
          setUnavailable(false);
        }
      } catch {
        if (live) {
          setAccount(null);
          setUnavailable(true);
        }
      } finally {
        if (live) setLoading(false);
      }
    })();

    // Signing in or out in another tab changes the answer here, and so does
    // presenting a two-factor code, which is what makes a manager button
    // work that did not a moment ago.
    const { data: sub } = getSupabase().auth.onAuthStateChange(() => {
      forgetCachedRole();
      if (live) refresh();
    });
    return () => {
      live = false;
      sub.subscription.unsubscribe();
    };
  }, [refresh]);

  return { account, loading, unavailable, refresh };
}
