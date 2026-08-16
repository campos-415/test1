// Real sign-in, replacing the shared passcode.
//
// The passcode it replaces was checked in the browser against a
// NEXT_PUBLIC_ env var, which meant it shipped inside the JavaScript — you
// could read it in dev tools. Worse, it guarded nothing but the UI: the
// database was reachable directly with the anon key.
//
// Now every staff and kiosk request carries a Supabase session token, and
// Row Level Security is what actually decides who can read what (see
// rls-lockdown.sql). No query in the app changed — supabase-js attaches the
// token itself.

import { getSupabase } from "@/lib/supabase";
import { logSignIn, logSignOut } from "@/lib/audit";
import { forgetCachedRole } from "@/lib/roles";
import type { Session, User } from "@supabase/supabase-js";

// Supabase identifies users by email. Staff would rather type "frontdesk"
// than "frontdesk@…", so a value with no @ is expanded to this domain. It
// never receives mail — it only has to be a syntactically valid address.
export const STAFF_EMAIL_DOMAIN = "staff.local";

export function toEmail(usernameOrEmail: string): string {
  const v = usernameOrEmail.trim().toLowerCase();
  return v.includes("@") ? v : `${v}@${STAFF_EMAIL_DOMAIN}`;
}

export interface SignInResult {
  ok: boolean;
  error?: string;
}

export async function signIn(usernameOrEmail: string, password: string): Promise<SignInResult> {
  if (!usernameOrEmail.trim() || !password) {
    return { ok: false, error: "Enter a username and password." };
  }
  try {
    const supabase = getSupabase();
    const { error } = await supabase.auth.signInWithPassword({
      email: toEmail(usernameOrEmail),
      password,
    });
    if (error) {
      // Deliberately vague: saying which half was wrong tells an attacker
      // which usernames exist.
      return { ok: false, error: "That username and password don't match." };
    }

    // A different account may have been signed in a moment ago, and the
    // cached role belongs to that one.
    forgetCachedRole();

    // Requirement 9 asks for a record of admin sign-ins. Written after the
    // session exists, because the database attributes the entry to the
    // session rather than believing what the browser says about who it is.
    //
    // Only successful sign-ins are recorded here, and a failed one cannot
    // be: there is no session to attribute it to, and letting a signed-out
    // caller write to the log would hand anybody on the internet a way to
    // fill it with noise. Supabase Auth keeps its own record of every
    // attempt including the failures, in auth.audit_log_entries.
    await logSignIn();

    return { ok: true };
  } catch (e) {
    console.error("Sign-in failed:", e);
    return { ok: false, error: "Could not reach the server. Check the connection." };
  }
}

/**
 * Where signing out of the staff side lands.
 *
 * The dashboard, not the home page. /dashboard is behind <StaffGate>, so a
 * signed-out visit renders the staff sign-in form — which is what somebody who
 * just signed out is nearly always about to need, because signing out at a
 * front desk usually means handing the screen to the next person on shift.
 * Landing on the public marketing site instead left them with no way back in
 * but the URL bar.
 *
 * Customers are not sent here. Signing out of the portal goes to the home
 * page, which is theirs — see CustomerGate and PortalChrome.
 */
export const STAFF_SIGNED_OUT_HREF = "/dashboard";

export async function signOut(): Promise<void> {
  try {
    // Before, not after: once the session is gone there is nobody for the
    // database to attribute the entry to and the write is refused.
    await logSignOut();
    forgetCachedRole();
    await getSupabase().auth.signOut();
  } catch (e) {
    console.error("Sign-out failed:", e);
  }
}

export async function getSession(): Promise<Session | null> {
  try {
    const { data } = await getSupabase().auth.getSession();
    return data.session;
  } catch {
    return null;
  }
}

/** The name to show in the UI — the username half, not the synthetic email. */
export function displayName(user: User | null | undefined): string {
  const email = user?.email ?? "";
  if (!email) return "Signed in";
  return email.endsWith(`@${STAFF_EMAIL_DOMAIN}`) ? email.split("@")[0] : email;
}

/** The shortest password this app will set. Supabase's own floor is lower. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Changes the signed-in account's own password.
 *
 * This is the other half of the owner being able to create an account. An
 * owner generates a password, reads it out, and until now that was the
 * password forever — meaning the person who runs the daycare knew the
 * sign-in of every member of staff. The audit log records who did what, and
 * that record is only worth something if an account belongs to one person.
 *
 * It changes the CALLER's own password and nothing else: the request carries
 * their session and Supabase applies it to that user, so this cannot be
 * pointed at somebody else's account. No service key, no role check needed.
 *
 * A staff.local address has no mailbox, so the emailed reset link that works
 * for clients cannot work here. Changing it from inside the app, while
 * signed in, is the only route — which is why it lives on the settings page
 * rather than on the sign-in screen.
 */
export async function changeMyPassword(
  current: string,
  next: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = next.trim();
  if (!current) return { ok: false, error: "Enter your current password." };
  if (trimmed.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  }

  // Through the server, not supabase.auth.updateUser.
  //
  // updateUser changes the password of whoever holds the session and asks
  // for nothing else — so on a front desk signed in all day, anybody passing
  // an unattended tablet could take the account over, and every audit entry
  // afterwards would name somebody who was not there. /api/password proves
  // the old password first, and does it without replacing the live session.
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: "Sign in again and retry." };

  try {
    const res = await fetch("/api/password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword: current, newPassword: trimmed }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      return { ok: false, error: body.error || "Could not change the password." };
    }
    return { ok: true };
  } catch (e) {
    console.error("Changing the password failed:", e);
    return { ok: false, error: "Could not reach the server. Try again." };
  }
}
