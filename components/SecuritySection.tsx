"use client";

import { useCallback, useEffect, useState } from "react";
import MfaSetup from "@/components/MfaSetup";
import useRole from "@/components/useRole";
import { MfaFactor, listFactors, removeFactor } from "@/lib/mfa";
import { logMfaRemoved, logEvent } from "@/lib/audit";
import { MIN_PASSWORD_LENGTH, changeMyPassword } from "@/lib/auth";
import {
  AUDIT_GROUPS,
  AuditEntry,
  describeAction,
  loadAuditLog,
} from "@/lib/audit";
import {
  ASSIGNABLE_ROLES,
  ROLE_BLURBS,
  ROLE_LABELS,
  addStaffAccount,
  StaffListEntry,
  StaffRole,
  canManageStaff,
  canReadAuditLog,
  loadStaffList,
  mfaRequiredFor,
  revokeStaffRole,
  setRequireMfa,
  setStaffRole,
} from "@/lib/roles";
import CardTable from "@/components/CardTable";

// Settings -> Security.
//
// Three panels, for the three things the security requirements asked for
// that somebody has to be able to see and change:
//
//   Your sign-in    the second factor for this account.
//   Who works here  the role on each account. Owner only, and the database
//                   agrees - the manage roles policy refuses anybody else,
//                   so this screen cannot grant what it should not.
//   Activity        the audit log. Managers and owners.
//
// Creating and deleting accounts is deliberately not here. That is done in
// the Supabase dashboard, where password resets and email changes live too,
// and splitting it across two places would mean neither was the whole story.
// This screen decides what an account that exists is allowed to do.

export default function SecuritySection() {
  const { account, loading, unavailable, refresh } = useRole();

  if (loading) return <p className="text-sm text-ink-3">Checking…</p>;

  if (unavailable) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <h3 className="text-sm font-semibold text-amber-900">Not set up on this database yet</h3>
        <p className="mt-1 text-xs leading-relaxed text-amber-900">
          Roles, two-factor sign-in and the audit log need their migrations run first, in this
          order: <code>security-roles-migration.sql</code>,{" "}
          <code>security-audit-migration.sql</code>, <code>security-exports-migration.sql</code>,
          then <code>rls-lockdown.sql</code>. See <code>docs/SECURITY-ROLES.md</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <MyAccountPanel account={account} onChanged={refresh} />
      {canManageStaff(account?.role ?? null) && <StaffPanel />}
      {canReadAuditLog(account?.role ?? null) && <ActivityPanel />}
      {!canReadAuditLog(account?.role ?? null) && (
        <p className="text-[11px] leading-relaxed text-ink-3">
          Who works here and the activity log need a manager or owner account.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------

/**
 * Your own sign-in: the second factor, and changing your own password.
 *
 * Exported because it must not live only inside Settings. Settings is
 * manager-and-above — so an employee handed a generated password could not
 * reach the one screen that would let them change it, which made the whole
 * feature useless to precisely the people it was for. /my-account renders
 * this for anybody with a staff role; this section keeps it too, because a
 * manager looking at Security reasonably expects their own account there.
 */
export function MyAccountPanel({
  account,
  onChanged,
}: {
  account: { role: StaffRole | null; email: string; requireMfa: boolean } | null;
  onChanged: () => Promise<void>;
}) {
  const [factors, setFactors] = useState<MfaFactor[] | null>(null);
  const [setting, setSetting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setFactors(await listFactors());
    } catch (e) {
      console.error("Could not list authenticators:", e);
      setFactors([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const verified = factors?.find((f) => f.verified) ?? null;
  const required = mfaRequiredFor(account?.role ?? null);

  async function remove() {
    if (!verified) return;
    setBusy(true);
    setError("");
    const result = await removeFactor(verified.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not remove it.");
      return;
    }
    await logMfaRemoved();
    await load();
    await onChanged();
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <h3 className="text-sm font-semibold text-ink">🔑 Your sign-in</h3>
      <p className="mt-0.5 text-xs text-ink-3">
        {account?.email || "This account"} —{" "}
        <span className="font-medium text-ink-2">
          {account?.role ? ROLE_LABELS[account.role] : "no role"}
        </span>
      </p>

      {factors === null ? (
        <p className="mt-3 text-sm text-ink-3">Checking…</p>
      ) : setting ? (
        <div className="mt-4">
          <MfaSetup
            onDone={async () => {
              setSetting(false);
              await load();
              await onChanged();
            }}
            onCancel={() => setSetting(false)}
          />
        </div>
      ) : verified ? (
        <div className="mt-3">
          <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            ✓ Two-factor sign-in is on. You are asked for a code from your authenticator app each
            time you sign in.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-xl border border-line px-3 py-1.5 text-xs font-medium text-ink-3 hover:border-rose-300 hover:text-rose-500 disabled:opacity-60"
            >
              {busy ? "Removing…" : "Remove this authenticator"}
            </button>
            <button
              onClick={() => setSetting(true)}
              className="rounded-xl border border-line px-3 py-1.5 text-xs font-medium text-ink-2 hover:border-accent-300"
            >
              Replace it (new phone)
            </button>
          </div>
          {required && (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
              Removing it does not switch the requirement off. Your role needs a second factor, so
              until you set one up again the manager side — exports, deletions, permissions — stays
              refused by the database.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <p
            className={`rounded-xl px-3 py-2 text-xs ${
              required ? "bg-amber-50 text-amber-900" : "bg-surface-2/60 text-ink-2"
            }`}
          >
            {required
              ? "Two-factor sign-in is not set up, and your role needs it. Until it is, the database refuses exports, deletions and permission changes from this account."
              : "Two-factor sign-in is not required for your role. You can still turn it on, and it is a good idea."}
          </p>
          <button
            onClick={() => setSetting(true)}
            className="mt-2 rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-accent-ink shadow-card hover:bg-accent-600"
          >
            Set up two-factor sign-in
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs font-medium text-rose-500">{error}</p>}

      <ChangePassword />
    </section>
  );
}

/**
 * Changing your own password, for the person whose password somebody else
 * chose. An owner creating an account generates one and reads it out; this
 * is where that stops being a shared secret.
 *
 * Collapsed until asked for, because on most visits to this screen it is not
 * what brought anybody here.
 */
function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit() {
    setError("");
    if (next !== again) {
      setError("The two do not match.");
      return;
    }
    setBusy(true);
    const result = await changeMyPassword(current, next);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Worth a line in the log: a password change is how an account stops
    // being shared, and it is the sort of thing somebody asks about later.
    // "auth." so it files under Sign-ins in the activity log — the groups
    // there match on the prefix, and a bare name lands in no group at all.
    await logEvent("auth.password_changed", {
      entity: "auth",
      summary: "Changed their own password",
    });
    setCurrent("");
    setNext("");
    setAgain("");
    setDone(true);
    setOpen(false);
  }

  if (!open) {
    return (
      <div className="mt-4 border-t border-line pt-3">
        {done && (
          <p className="mb-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            ✓ Password changed. It applies the next time you sign in.
          </p>
        )}
        <button
          onClick={() => {
            setOpen(true);
            setDone(false);
          }}
          className="text-xs font-medium text-accent-600 hover:underline"
        >
          Change your password
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-2 border-t border-line pt-3">
      <p className="text-xs font-semibold text-ink">Change your password</p>
      <p className="text-[11px] leading-relaxed text-ink-3">
        If somebody else set this account up, this is where you make it yours. Your current
        password is asked for so that a tablet left signed in cannot be used to take the account
        over. At least {MIN_PASSWORD_LENGTH} characters.
      </p>
      <input
        type="password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        placeholder="Current password"
        autoComplete="current-password"
        className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent-500"
      />
      <input
        type="password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        placeholder="New password"
        autoComplete="new-password"
        className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent-500"
      />
      <input
        type="password"
        value={again}
        onChange={(e) => setAgain(e.target.value)}
        placeholder="Type it again"
        autoComplete="new-password"
        className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent-500"
      />
      {error && <p className="text-xs font-medium text-rose-500">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={submit}
          disabled={busy || !current || !next || !again}
          className="rounded-xl bg-accent-500 px-4 py-2 text-xs font-medium text-accent-ink shadow-card hover:bg-accent-600 disabled:opacity-60"
        >
          {busy ? "Changing…" : "Change it"}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setCurrent("");
            setNext("");
            setAgain("");
            setError("");
          }}
          className="rounded-xl border border-line px-3 py-2 text-xs font-medium text-ink-3 hover:border-line"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------

/**
 * Hiring, without the Supabase dashboard.
 *
 * The password is shown once and cannot be retrieved afterwards, so the
 * screen says so before it is generated rather than after — somebody who
 * closes this panel without writing it down has to remove the account and
 * add it again.
 */
function AddStaff({ onAdded }: { onAdded: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("employee");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const result = await addStaffAccount(email.trim(), role);
      setCreated({ email: result.email, password: result.password });
      setEmail("");
      await onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add that account.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 rounded-xl border border-line bg-surface px-3.5 py-2 text-xs font-medium text-ink-2 hover:border-accent-300"
      >
        + Add someone
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-2xl border border-line bg-surface-2/50 p-4">
      {created ? (
        <>
          <p className="text-xs font-semibold text-ink">{created.email} can now sign in.</p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
            Give them this password. It is shown once and is not stored anywhere — if it is lost,
            remove the account and add it again.
          </p>
          <p className="mt-2 select-all rounded-xl border border-line bg-surface px-3 py-2 font-mono text-sm text-ink">
            {created.password}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => setCreated(null)}
              className="rounded-xl border border-line px-3 py-1.5 text-xs font-medium text-ink-2 hover:border-accent-300"
            >
              Add another
            </button>
            <button
              onClick={() => {
                setCreated(null);
                setOpen(false);
              }}
              className="rounded-xl bg-accent-500 px-3 py-1.5 text-xs font-medium text-accent-ink hover:bg-accent-600"
            >
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@staff.local"
              autoComplete="off"
              className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent-500"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as StaffRole)}
              className="rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent-500"
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
            {ROLE_BLURBS[role]}
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
            An address ending <code>@staff.local</code> is not a real mailbox and shows in the app
            as just the name. A password is generated and shown once.
          </p>
          {error && <p className="mt-2 text-xs font-medium text-rose-500">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={submit}
              disabled={busy || !email.trim()}
              className="rounded-xl bg-accent-500 px-3.5 py-2 text-xs font-medium text-accent-ink hover:bg-accent-600 disabled:opacity-60"
            >
              {busy ? "Adding…" : "Add"}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setError("");
              }}
              className="rounded-xl border border-line px-3.5 py-2 text-xs font-medium text-ink-3 hover:border-line"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function StaffPanel() {
  const [rows, setRows] = useState<StaffListEntry[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setRows(await loadStaffList());
    } catch (e) {
      console.error("Could not load the staff list:", e);
      setError("Could not load the staff list.");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function change(entry: StaffListEntry, role: StaffRole | "none") {
    setBusy(entry.userId);
    setError("");
    setNote("");
    try {
      if (role === "none") {
        await revokeStaffRole(entry.userId);
        setNote(`${entry.email} now has no access.`);
      } else {
        await setStaffRole(entry.userId, role);
        setNote(`${entry.email} is now ${ROLE_LABELS[role]}.`);
      }
      await load();
    } catch (e) {
      console.error("Could not change the role:", e);
      setError(
        e instanceof Error && /insufficient|policy|denied/i.test(e.message)
          ? "The database refused that. Only an owner with a two-factor code can change roles."
          : "Could not change the role."
      );
    } finally {
      setBusy("");
    }
  }

  async function liftMfa(entry: StaffListEntry) {
    setBusy(entry.userId);
    setError("");
    setNote("");
    try {
      await setRequireMfa(entry.userId, false);
      setNote(
        `${entry.email} can sign in without a code until they set an authenticator up again.`
      );
      await load();
    } catch (e) {
      console.error("Could not lift the MFA requirement:", e);
      setError("Could not change that.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">👥 Who works here</h3>
        <button
          onClick={load}
          className="ml-auto rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-ink-2 hover:border-accent-300"
        >
          Refresh
        </button>
      </div>
      <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
        The role decides what the database will accept from an account, not just what the app
        offers. Every change here is recorded in the activity log below. Client accounts are not
        listed here and cannot be given a staff role by mistake.
      </p>

      <AddStaff onAdded={load} />

      {rows === null ? (
        <p className="mt-3 text-sm text-ink-3">Loading…</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <CardTable className="w-full min-w-[38rem] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-line text-ink-3">
                <th className="py-1.5 pr-3 font-medium">Account</th>
                <th className="py-1.5 pr-3 font-medium">Role</th>
                <th className="py-1.5 pr-3 font-medium">Two-factor</th>
                <th className="py-1.5 pr-3 font-medium">Last signed in</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.userId} className="border-b border-line-soft text-ink-2">
                  <td className="py-2 pr-3">
                    <span className="font-medium text-ink">{entry.email}</span>
                  </td>
                  <td className="py-2 pr-3">
                    <select
                      value={entry.role ?? "none"}
                      disabled={busy === entry.userId}
                      onChange={(e) => change(entry, e.target.value as StaffRole | "none")}
                      className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent-500 disabled:opacity-60"
                    >
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                      <option value="none">No access</option>
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    {entry.hasTotp ? (
                      <span className="text-emerald-700">✓ set up</span>
                    ) : mfaRequiredFor(entry.role) ? (
                      <span className="text-amber-700">needed</span>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                    {entry.requireMfa && !entry.hasTotp && (
                      <button
                        onClick={() => liftMfa(entry)}
                        disabled={busy === entry.userId}
                        className="ml-2 rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-ink-3 hover:border-accent-300 disabled:opacity-60"
                        title="For somebody who has lost the phone their authenticator was on"
                      >
                        lift
                      </button>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3">
                    {entry.lastSignInAt ? new Date(entry.lastSignInAt).toLocaleDateString() : "never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </CardTable>
        </div>
      )}

      <div className="mt-3 space-y-1">
        {ASSIGNABLE_ROLES.map((r) => (
          <p key={r} className="text-[11px] leading-relaxed text-ink-3">
            <span className="font-medium text-ink-2">{ROLE_LABELS[r]}</span> — {ROLE_BLURBS[r]}
          </p>
        ))}
        <p className="text-[11px] leading-relaxed text-ink-3">
          <span className="font-medium text-ink-2">No access</span> — the account can still sign in
          and the database refuses it everything. Use it for somebody who has left, before deciding
          whether to delete the account.
        </p>
      </div>

      <p className="mt-3 rounded-xl bg-surface-2/60 px-3 py-2 text-[11px] leading-relaxed text-ink-3">
        New accounts, password resets and email changes are in the Supabase dashboard under
        Authentication. A new account arrives here with no access until it is given a role.
      </p>

      {error && <p className="mt-2 text-xs font-medium text-rose-500">{error}</p>}
      {note && <p className="mt-2 text-xs font-medium text-emerald-700">{note}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------

function ActivityPanel() {
  const [group, setGroup] = useState("all");
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const prefix = AUDIT_GROUPS.find((g) => g.key === group)?.prefix;
      setEntries(await loadAuditLog({ prefix, limit: 200 }));
    } catch (e) {
      console.error("Could not load the activity log:", e);
      setError("Could not load the activity log.");
      setEntries([]);
    }
  }, [group]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">📜 Activity</h3>
        <button
          onClick={load}
          className="ml-auto rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-ink-2 hover:border-accent-300"
        >
          Refresh
        </button>
      </div>
      <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
        Sign-ins, permission changes, edits to client records and every export. Written by the
        database itself, so nothing can leave an edit out — and nothing can be edited or deleted
        afterwards, including from the dashboard.
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {AUDIT_GROUPS.map((g) => (
          <button
            key={g.key}
            onClick={() => setGroup(g.key)}
            className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
              group === g.key
                ? "border-transparent bg-accent-500 text-accent-ink"
                : "border-line bg-surface text-ink-2 hover:border-accent-300"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      {entries === null ? (
        <p className="mt-3 text-sm text-ink-3">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="mt-3 text-sm text-ink-3">Nothing recorded there yet.</p>
      ) : (
        <div className="mt-3 max-h-[28rem] overflow-auto rounded-xl border border-line-soft">
          <CardTable className="w-full min-w-[40rem] border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-surface-2">
              <tr className="border-b border-line text-ink-3">
                <th className="py-1.5 pl-3 pr-3 font-medium">When</th>
                <th className="py-1.5 pr-3 font-medium">Who</th>
                <th className="py-1.5 pr-3 font-medium">What</th>
                <th className="py-1.5 pr-3 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-line-soft text-ink-2">
                  <td className="whitespace-nowrap py-1.5 pl-3 pr-3 text-ink-3">
                    {new Date(e.at).toLocaleString()}
                  </td>
                  <td className="py-1.5 pr-3">
                    {e.actorEmail || <span className="text-ink-3">dashboard</span>}
                    {e.actorRole && (
                      <span className="block text-[10px] text-ink-3">
                        {ROLE_LABELS[e.actorRole as StaffRole] ?? e.actorRole}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 font-medium text-ink">{describeAction(e.action)}</td>
                  <td className="py-1.5 pr-3 text-ink-3">
                    {e.summary}
                    {Array.isArray(e.detail?.changed) && (e.detail.changed as string[]).length > 0 && (
                      <span className="block text-[10px]">
                        changed: {(e.detail.changed as string[]).join(", ")}
                      </span>
                    )}
                    {typeof e.detail?.rows === "number" && (
                      <span className="block text-[10px]">
                        {(e.detail.rows as number).toLocaleString()} rows
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </CardTable>
        </div>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        Values are not recorded, only which fields changed — the log says who touched a record and
        when, and is not a second copy of the client database. Passwords, tokens and anything shaped
        like a card number are stripped by the database before a line is stored.
      </p>

      {error && <p className="mt-2 text-xs font-medium text-rose-500">{error}</p>}
    </section>
  );
}
