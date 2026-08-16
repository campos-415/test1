"use client";

import StaffGate from "@/components/StaffGate";
import StaffNav from "@/components/StaffNav";
import useRole from "@/components/useRole";
import { ROLE_LABELS } from "@/lib/roles";
import { MyAccountPanel } from "@/components/SecuritySection";

// Your own sign-in, reachable by anybody who works here.
//
// Changing your own password and setting up your own authenticator used to
// sit inside Settings, which is manager-and-above. So an employee given a
// password by the owner had no way to change it — the owner knew every staff
// sign-in permanently, and the audit log's record of who did what was worth
// that much less.
//
// Nothing on this page is an administrative action: it only ever affects the
// account making the request. Supabase applies both to the caller's own user,
// so there is nothing here an employee could point at somebody else.

export default function MyAccountPage() {
  return (
    <StaffGate title="Your account">
      <Inner />
    </StaffGate>
  );
}

function Inner() {
  const { account, refresh } = useRole();

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <StaffNav current="/my-account" />

      <h1 className="font-display text-2xl font-semibold text-ink">Your account</h1>
      <p className="mt-1 text-sm leading-relaxed text-ink-3">
        {account?.email ? (
          <>
            Signed in as <span className="font-medium text-ink-2">{account.email}</span>
            {account.role && <> — {ROLE_LABELS[account.role]}</>}.
          </>
        ) : (
          "Your sign-in."
        )}{" "}
        Changes here affect only this account.
      </p>

      <div className="mt-5">
        <MyAccountPanel account={account} onChanged={refresh} />
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-ink-3">
        If somebody else set this account up, change the password to one only you know. Who did
        what is recorded against the account that did it, so a sign-in shared between two people
        is a record that cannot answer the question it exists to answer.
      </p>
    </div>
  );
}
