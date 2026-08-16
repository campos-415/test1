// Writing to and reading the audit log.
//
// Most of the log is not written from here. Edits to customer records and
// changes to permissions are recorded by triggers on the tables themselves,
// and exports are recorded inside the export functions - all in
// security-audit-migration.sql. That is deliberate: a log that depends on
// every future call site remembering to write to it is a log with holes in
// it, and the holes are invisible until somebody needs the entry that is
// missing.
//
// What is left for the application is the events the database cannot see by
// watching its own tables: somebody signing in, somebody signing out, and an
// attempt at something the database refused.
//
// Nothing here can put a password or a token in the log even by accident.
// The actor is stamped by the database from the session rather than sent
// from the browser, and a trigger scrubs anything shaped like a secret or a
// card number out of the detail on the way in.

import { getSupabase } from "@/lib/supabase";

export interface AuditEntry {
  id: string;
  at: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  entity: string;
  entityId: string;
  summary: string;
  detail: Record<string, unknown>;
}

export interface LogOptions {
  entity?: string;
  entityId?: string;
  summary?: string;
  detail?: Record<string, unknown>;
}

/**
 * Records one event.
 *
 * Never throws and never blocks what the caller was doing. A sign-in that
 * worked must not look like a failure because the log was unreachable, and a
 * refusal that has already happened is not made better by a second error on
 * top of it. Failures go to the console, where they are visible without
 * being in the way.
 */
export async function logEvent(action: string, options: LogOptions = {}): Promise<void> {
  try {
    const { error } = await getSupabase().rpc("audit_write", {
      p_action: action,
      p_entity: options.entity ?? null,
      p_entity_id: options.entityId ?? null,
      p_summary: options.summary ?? null,
      p_detail: options.detail ?? {},
    });
    if (error) console.error(`Could not record ${action} in the audit log:`, error.message);
  } catch (e) {
    console.error(`Could not record ${action} in the audit log:`, e);
  }
}

/** Somebody signed in. The account and role are added by the database. */
export async function logSignIn(): Promise<void> {
  await logEvent("auth.sign_in", {
    entity: "auth",
    summary: "Signed in",
    detail: { at: new Date().toISOString() },
  });
}

/**
 * Somebody signed out. Has to be called BEFORE the session is destroyed:
 * afterwards there is no session for the database to attribute it to, and
 * the write is refused.
 */
export async function logSignOut(): Promise<void> {
  await logEvent("auth.sign_out", { entity: "auth", summary: "Signed out" });
}

/** A second factor was accepted, raising the session to aal2. */
export async function logMfaVerified(): Promise<void> {
  await logEvent("auth.mfa_verified", {
    entity: "auth",
    summary: "Presented a two-factor code",
  });
}

/** An authenticator was set up, or removed. */
export async function logMfaEnrolled(): Promise<void> {
  await logEvent("auth.mfa_enrolled", {
    entity: "auth",
    summary: "Set up an authenticator app",
  });
}

export async function logMfaRemoved(): Promise<void> {
  await logEvent("auth.mfa_removed", {
    entity: "auth",
    summary: "Removed an authenticator app",
  });
}

/**
 * Something the database refused.
 *
 * Worth a line because a refused export is more interesting than a
 * successful one. It has to be written from here rather than inside the
 * export function: raising an exception rolls the transaction back, and an
 * audit row written inside the same transaction would roll back with it.
 *
 * Being written from the browser makes this the one entry an attacker could
 * decline to write. That is a limit worth stating rather than hiding: it
 * catches curiosity, which is what it is for, and Postgres logs the error
 * regardless.
 */
export async function logRefusal(what: string, reason: string): Promise<void> {
  await logEvent("access.refused", {
    entity: what,
    summary: `Refused: ${what}`,
    detail: { attempted: what, reason },
  });
}

// ---------------------------------------------------------------------
// Reading it. Managers and owners only, enforced by the read audit log
// policy.
// ---------------------------------------------------------------------

export interface AuditQuery {
  /** Only entries whose action starts with this, e.g. export or role. */
  prefix?: string;
  limit?: number;
}

export async function loadAuditLog(query: AuditQuery = {}): Promise<AuditEntry[]> {
  let request = getSupabase()
    .from("audit_log")
    .select("*")
    .order("at", { ascending: false })
    .limit(query.limit ?? 200);

  if (query.prefix) request = request.like("action", `${query.prefix}%`);

  const { data, error } = await request;
  if (error) throw error;

  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    at: String(r.at ?? ""),
    actorEmail: String(r.actor_email ?? ""),
    actorRole: String(r.actor_role ?? ""),
    action: String(r.action ?? ""),
    entity: String(r.entity ?? ""),
    entityId: String(r.entity_id ?? ""),
    summary: String(r.summary ?? ""),
    detail: (r.detail as Record<string, unknown>) ?? {},
  }));
}

/**
 * The groups the log viewer offers. Prefixes rather than a fixed list of
 * actions, so an action added later still lands in the right group instead
 * of disappearing from the filter.
 */
export const AUDIT_GROUPS: { key: string; label: string; prefix?: string }[] = [
  { key: "all", label: "Everything" },
  { key: "auth", label: "Sign-ins", prefix: "auth." },
  { key: "role", label: "Permission changes", prefix: "role." },
  { key: "export", label: "Exports", prefix: "export." },
  { key: "refused", label: "Refused", prefix: "access." },
];

/** A readable name for an action, without hiding what it actually was. */
export function describeAction(action: string): string {
  const named: Record<string, string> = {
    "auth.sign_in": "Signed in",
    "auth.sign_out": "Signed out",
    "auth.mfa_verified": "Two-factor code accepted",
    "auth.mfa_enrolled": "Authenticator set up",
    "auth.mfa_removed": "Authenticator removed",
    "auth.password_changed": "Password changed",
    "role.granted": "Role granted",
    "role.changed": "Role changed",
    "role.revoked": "Role revoked",
    "role.mfa_required": "MFA required",
    "role.mfa_relaxed": "MFA requirement lifted",
    "access.refused": "Refused",
    "audit.pruned": "Old log entries removed",
  };
  if (named[action]) return named[action];
  if (action.startsWith("export.")) return `Exported ${action.slice("export.".length)}`;

  // table.operation, which is most of them.
  const [table, operation] = action.split(".");
  if (!operation) return action;
  const verb =
    operation === "insert" ? "Added to" : operation === "update" ? "Edited" : operation === "delete" ? "Deleted from" : operation;
  return `${verb} ${table.replace(/_/g, " ")}`;
}
