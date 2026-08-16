// What this account is allowed to do.
//
// The database is the boundary, not this file. Every rule here has a policy
// behind it in rls-lockdown.sql, and the policy is what actually refuses -
// see the note in lib/staffAuth.ts about the difference between a
// convenience and a security control. What this file is for is not offering
// somebody a button that would fail: an employee should not be shown an
// export button that the database will reject.
//
// If the two ever disagree, the database wins and the interface has a bug.

import { getSupabase } from "@/lib/supabase";

export type StaffRole = "owner_admin" | "manager" | "employee" | "kiosk";

export const ROLE_LABELS: Record<StaffRole, string> = {
  owner_admin: "Owner / Admin",
  manager: "Manager",
  employee: "Employee",
  kiosk: "Lobby kiosk",
};

export const ROLE_BLURBS: Record<StaffRole, string> = {
  owner_admin:
    "Everything, including staff permissions, prices and branding, and deleting a payment record.",
  manager:
    "Money, reservations, packages, deletions and the spreadsheet exports. Cannot change permissions or prices.",
  employee:
    "Day-to-day care: sign dogs in and out, keep records, look up a dog. No exports, no deletions.",
  kiosk:
    "The lobby iPad. Sign in and out, spend a package day, take a payment. Cannot read the owner table.",
};

/** The order roles are offered in, most powerful first. */
export const ASSIGNABLE_ROLES: StaffRole[] = ["owner_admin", "manager", "employee", "kiosk"];

export interface StaffAccount {
  userId: string;
  email: string;
  /** Null means an account nobody has assigned a role to, which can do nothing. */
  role: StaffRole | null;
  /** Once true, this account must satisfy MFA to use manager or owner powers. */
  requireMfa: boolean;
}

/** One row of the staff list on the Settings screen. */
export interface StaffListEntry {
  userId: string;
  email: string;
  role: StaffRole | null;
  requireMfa: boolean;
  hasTotp: boolean;
  lastSignInAt: string | null;
}

// ---------------------------------------------------------------------
// Capability questions. Asked by name so the reason is in the call site
// rather than in a role comparison somebody has to decode.
// ---------------------------------------------------------------------

export function isManagerOrAbove(role: StaffRole | null): boolean {
  return role === "owner_admin" || role === "manager";
}

export function isOwnerAdmin(role: StaffRole | null): boolean {
  return role === "owner_admin";
}

/** Staff who work with dogs, as opposed to the unattended lobby iPad. */
export function isStaff(role: StaffRole | null): boolean {
  return role === "owner_admin" || role === "manager" || role === "employee";
}

/**
 * The specific authorisation the requirements document asks for before
 * anybody downloads the client database. Mirrors can_export in the
 * database, which is what actually refuses.
 */
export function canExport(role: StaffRole | null): boolean {
  return isManagerOrAbove(role);
}

/** Aggregate money: receivables, ageing, what the business is carrying. */
export function canSeeBusinessMoney(role: StaffRole | null): boolean {
  return isManagerOrAbove(role);
}

export function canManageStaff(role: StaffRole | null): boolean {
  return isOwnerAdmin(role);
}

export function canReadAuditLog(role: StaffRole | null): boolean {
  return isManagerOrAbove(role);
}

/** Roles the requirements document says must carry a second factor. */
export function mfaRequiredFor(role: StaffRole | null): boolean {
  return isManagerOrAbove(role);
}

// ---------------------------------------------------------------------
// Reading the role.
//
// Cached per user id for the life of the page. A role changes when an owner
// changes it, which is rare, and the alternative is a request on every
// render of every gated button.
// ---------------------------------------------------------------------

let cache: { userId: string; account: StaffAccount } | null = null;

export function forgetCachedRole(): void {
  cache = null;
}

/**
 * The signed-in account and its role, or null when nobody is signed in.
 *
 * A signed-in account with no row comes back with role null rather than
 * throwing: that is a real state - an account somebody created and nobody
 * assigned - and the app has to be able to say so.
 */
export async function loadMyAccount(): Promise<StaffAccount | null> {
  const supabase = getSupabase();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    cache = null;
    return null;
  }
  if (cache?.userId === user.id) return cache.account;

  const { data, error } = await supabase
    .from("staff_roles")
    .select("role, require_mfa")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    // Before the migration runs there is no staff_roles table. Treating
    // that as "no role" would lock the whole app out of its own interface
    // on a database that has not been migrated yet, so it is reported and
    // left to the caller, which keeps the pre-migration app working.
    console.error("Could not read the staff role:", error);
    throw error;
  }

  const account: StaffAccount = {
    userId: user.id,
    email: user.email ?? "",
    role: (data?.role as StaffRole | undefined) ?? null,
    requireMfa: Boolean(data?.require_mfa),
  };
  cache = { userId: user.id, account };
  return account;
}

/**
 * Marks this account as one that must use its authenticator from now on.
 * Called after a successful enrolment: the grace period that let somebody
 * sign in and set MFA up closes the moment they have set it up.
 *
 * Allowed by the harden own account policy, and the staff_roles_guard
 * trigger makes sure this is the only change that door permits.
 */
export async function requireMfaOnMyAccount(): Promise<void> {
  const supabase = getSupabase();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return;
  const { error } = await supabase
    .from("staff_roles")
    .update({ require_mfa: true })
    .eq("user_id", user.id);
  if (error) {
    // Worth knowing about but not worth failing the enrolment over: the
    // factor is enrolled either way, and once a verified factor exists
    // mfa_ok in the database already demands it.
    console.error("Could not record the MFA requirement:", error);
  }
  cache = null;
}

/** The staff list, for the roles editor. Managers and owners only. */
export async function loadStaffList(): Promise<StaffListEntry[]> {
  const { data, error } = await getSupabase().rpc("list_staff");
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    userId: String(r.user_id),
    email: String(r.email ?? ""),
    role: (r.role as StaffRole | null) ?? null,
    requireMfa: Boolean(r.require_mfa),
    hasTotp: Boolean(r.has_totp),
    lastSignInAt: (r.last_sign_in_at as string | null) ?? null,
  }));
}

/**
 * Creates a staff account and gives it a role, in one go.
 *
 * Goes through /api/staff rather than doing it here, because creating an
 * auth account needs the secret key and the secret key must never reach a
 * browser. The session token is forwarded so the database can decide whether
 * the caller is allowed — see the note at the top of that route.
 *
 * Returns the generated password, which is shown once and then gone: this
 * app never stores it, and Supabase keeps only its hash.
 */
export async function addStaffAccount(
  email: string,
  role: StaffRole
): Promise<{ email: string; role: StaffRole; password: string }> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in again before adding someone.");

  const res = await fetch("/api/staff", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ email, role }),
  });
  const body = (await res.json().catch(() => null)) as
    | { email: string; role: StaffRole; password: string; error?: string }
    | null;
  if (!res.ok || !body?.password) {
    throw new Error(body?.error ?? "Could not add that account.");
  }
  return body;
}

/**
 * Grants or changes a role. Owner only, enforced by the manage roles
 * policy; the audit_role_changes trigger records it whatever route it
 * takes.
 */
export async function setStaffRole(userId: string, role: StaffRole): Promise<void> {
  const { error } = await getSupabase()
    .from("staff_roles")
    .upsert({ user_id: userId, role }, { onConflict: "user_id" });
  if (error) throw error;
  if (cache?.userId === userId) cache = null;
}

/**
 * Takes a role away, leaving the account signed-in-able and able to do
 * nothing. Deliberately not a deletion of the account: removing access and
 * removing a person from the system are different decisions, and the second
 * one belongs in the Supabase dashboard.
 */
export async function revokeStaffRole(userId: string): Promise<void> {
  const { error } = await getSupabase().from("staff_roles").delete().eq("user_id", userId);
  if (error) throw error;
  if (cache?.userId === userId) cache = null;
}

/** Turns the hard MFA requirement off for one account. Owner only. */
export async function setRequireMfa(userId: string, required: boolean): Promise<void> {
  const { error } = await getSupabase()
    .from("staff_roles")
    .update({ require_mfa: required })
    .eq("user_id", userId);
  if (error) throw error;
  if (cache?.userId === userId) cache = null;
}
