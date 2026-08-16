"use client";

import { useCallback, useEffect, useState } from "react";
import BusyButton from "@/components/BusyButton";
import Panel from "@/components/Panel";
import useRole from "@/components/useRole";
import { useSettings } from "@/components/SettingsProvider";
import { isOwnerAdmin } from "@/lib/roles";
import { getSupabase } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { renderTemplate, sendEmail } from "@/lib/email";
import { prettyDateKey } from "@/lib/dates";

// The client account, from the staff side of the desk.
//
// Claiming is staff-initiated by design. A client cannot create an account
// by typing a phone number — guessing one is trivial, and that is exactly
// the isolation failure the requirements are about — so somebody here has to
// send the invitation, and it goes to the address already on file. That is
// what makes holding the link proof of controlling the address.
//
// Everything this panel does is refused by the database as well as hidden
// here: issue_owner_invite needs an employee, revoke_owner_claim needs an
// owner. The gating below is about not offering a button that would fail.

interface AccountState {
  invitedAt: string | null;
  claimedAt: string | null;
  hasInvite: boolean;
  accountEmail: string | null;
}

export default function CustomerAccountPanel({
  ownerId,
  ownerName,
  email,
  dogNames,
}: {
  /** Null before the owner row exists — it is created on first save. */
  ownerId: string | null;
  ownerName: string;
  email: string;
  dogNames: string[];
}) {
  // Nothing to offer while the portal is switched off: an invitation would
  // send a client to a page that redirects them straight back out.
  const portalOn = useSettings().settings.portal.enabled;

  const { account } = useRole();
  const [state, setState] = useState<AccountState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [manualLink, setManualLink] = useState("");

  const load = useCallback(async () => {
    if (!ownerId) return;
    const { data, error: rpcError } = await getSupabase().rpc("owner_account", {
      p_owner_id: ownerId,
    });
    if (rpcError) {
      // A database that has not run customer-accounts-migration.sql yet has
      // no such function. The rest of the profile still works, so this
      // section stays quiet rather than shouting about a migration.
      console.error("Could not read the client account state:", rpcError);
      return;
    }
    const row = (data as Record<string, unknown>[] | null)?.[0];
    setState({
      invitedAt: (row?.invited_at as string | null) ?? null,
      claimedAt: (row?.claimed_at as string | null) ?? null,
      hasInvite: Boolean(row?.has_invite),
      accountEmail: (row?.account_email as string | null) ?? null,
    });
  }, [ownerId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!portalOn) return null;
  if (!ownerId || !state) return null;

  const summary = state.claimedAt
    ? `Account in use — ${state.accountEmail ?? "signed up"}`
    : state.hasInvite
      ? `Invited ${state.invitedAt ? prettyDateKey(state.invitedAt.slice(0, 10)) : ""}, not set up yet`
      : "No account";

  async function invite() {
    if (!ownerId) return;
    setBusy(true);
    setError("");
    setNote("");
    setManualLink("");
    try {
      const { data, error: rpcError } = await getSupabase().rpc("issue_owner_invite", {
        p_owner_id: ownerId,
      });
      if (rpcError) throw rpcError;

      const link = `${window.location.origin}/account/claim/${data as string}`;
      const settings = getSettings();
      const vars = {
        owner: ownerName.trim().split(/\s+/)[0] || "there",
        dogs:
          dogNames.length > 1
            ? `${dogNames.slice(0, -1).join(", ")} and ${dogNames[dogNames.length - 1]}`
            : (dogNames[0] ?? "your dog"),
        business: settings.business.name,
        link,
        days: "14",
      };
      const result = await sendEmail({
        to: email,
        subject: renderTemplate(settings.email.portalInviteSubject, vars),
        body: renderTemplate(settings.email.portalInviteBody, vars),
        kind: "account.invite",
      });

      if (result.sent) {
        setNote(`Invitation sent to ${email}.`);
      } else {
        // The token exists whether or not the email went. Handing it over
        // rather than swallowing it is the difference between a client who
        // gets their account and one who rings up about a message that never
        // arrived — email is not configured on every install.
        setManualLink(link);
        setNote(
          result.skipped
            ? "Email is not set up on this install, so nothing was sent. Send them this link yourself:"
            : `The email did not go (${result.error ?? "unknown reason"}). Send them this link yourself:`
        );
      }
      await load();
    } catch (e) {
      console.error("Inviting the client failed:", e);
      setError(
        e instanceof Error && e.message
          ? e.message
          : "Could not create the invitation. Check there is an email address on file."
      );
    } finally {
      setBusy(false);
    }
  }

  async function unbind() {
    if (!ownerId) return;
    if (
      !window.confirm(
        "Unbind this household from its account? They will be signed out and will need a fresh invitation to get back in."
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setNote("");
    try {
      const { error: rpcError } = await getSupabase().rpc("revoke_owner_claim", {
        p_owner_id: ownerId,
      });
      if (rpcError) throw rpcError;
      setNote("Unbound. They can be invited again whenever you like.");
      await load();
    } catch (e) {
      console.error("Unbinding the client account failed:", e);
      setError("Could not unbind that account.");
    } finally {
      setBusy(false);
    }
  }

  const canUnbind = isOwnerAdmin(account?.role ?? null);
  const hasEmail = !!email.trim();

  return (
    <Panel
      id="owner-account"
      title="Client account"
      summary={summary}
      blurb="Lets this household sign in to see their own dogs, vaccination dates, packages, stays and balance — and ask for boarding dates. They cannot book, and they cannot see anything belonging to anybody else."
    >
      {state.claimedAt ? (
        <div className="space-y-2 text-sm">
          <p className="text-ink-2">
            Set up {prettyDateKey(state.claimedAt.slice(0, 10))}
            {state.accountEmail ? ` as ${state.accountEmail}` : ""}.
          </p>
          {/* Hidden rather than disabled for anybody below owner, the same
              as every other owner-only action in the app. */}
          {canUnbind && (
            <BusyButton
              busy={busy}
              busyLabel="Unbinding…"
              onClick={unbind}
              variant="secondary"
              className="px-3.5 py-2 text-xs hover:border-rose-300 hover:text-rose-500"
            >
              Unbind this account
            </BusyButton>
          )}
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          {state.hasInvite && (
            <p className="rounded-xl bg-surface-2 px-3.5 py-2.5 text-xs text-ink-2">
              An invitation was sent
              {state.invitedAt ? ` on ${prettyDateKey(state.invitedAt.slice(0, 10))}` : ""} and has
              not been used yet. Sending another replaces it — the older link stops working.
            </p>
          )}

          {hasEmail ? (
            <BusyButton
              busy={busy}
              busyLabel="Sending the invitation…"
              onClick={invite}
              className="px-4 py-2.5"
            >
              {state.hasInvite ? "Send a new invitation" : `Invite ${email}`}
            </BusyButton>
          ) : (
            <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
              There is no email address on file for this household, and the invitation has nowhere
              to go. Add one above and save first.
            </p>
          )}
        </div>
      )}

      {note && <p className="mt-3 text-xs font-medium text-emerald-700">{note}</p>}
      {manualLink && (
        <p className="mt-1 break-all rounded-xl bg-surface-2 px-3.5 py-2.5 font-mono text-[11px] text-ink-2">
          {manualLink}
        </p>
      )}
      {error && <p className="mt-3 text-xs font-medium text-rose-500">{error}</p>}
    </Panel>
  );
}
