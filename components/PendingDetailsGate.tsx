"use client";

import { useCallback, useEffect, useState } from "react";
import EnrollmentDetailsForm from "@/components/EnrollmentDetailsForm";
import { Spinner } from "@/components/BusyButton";
import { useSettings } from "@/components/SettingsProvider";
import { PendingDetails, loadPendingDetails } from "@/lib/customer";
import { DetailsForm, loadDetailsForm } from "@/lib/enrollment";

// The rest of the enrollment, in the way of everything else.
//
// A household reaches this by passing a meet & greet: the email that used to
// carry a public link to the questionnaire now carries an invitation to
// their account, and the questionnaire is here instead. Same form, same
// questions, behind a login rather than behind a forwardable link.
//
// It is deliberately a wall rather than a banner. These are the answers that
// decide what happens on a bad day — the vet, who may collect the dog, what
// the dog cannot eat — and a dismissible reminder is how they stay unanswered
// until somebody needs them. Signing out is the only way past, and that is
// on purpose: there is nothing else in here a household with an unfinished
// profile needs to do.
//
// The form and its submission are the existing ones. What changed is who is
// allowed to open them, so there is one implementation of the stage-two
// whitelist rather than two.
export default function PendingDetailsGate({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingDetails | null>(null);
  const [form, setForm] = useState<DetailsForm | null>(null);
  const [checking, setChecking] = useState(true);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const outstanding = await loadPendingDetails();
      setPending(outstanding);
      if (outstanding) {
        // The same server route the emailed link used, reached with a token
        // that now only ever exists inside a signed-in session.
        const loaded = await loadDetailsForm(outstanding.token);
        if (loaded.form) {
          setForm(loaded.form);
        } else {
          // Already submitted, or the token no longer resolves, or the
          // server route has no secret key. Either way there is nothing to
          // ask for, so the portal opens rather than trapping somebody
          // behind a form that cannot load.
          setPending(null);
        }
      }
    } catch (e) {
      console.error("Could not load the outstanding enrollment:", e);
      // Fail open. A household locked out of its own account because a check
      // failed is worse than one that finishes the form a day later.
      setPending(null);
      setError("");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  if (checking) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-3">
        <Spinner className="h-4 w-4" />
        Checking your profile…
      </p>
    );
  }

  if (!pending || !form) return <>{children}</>;
  if (done) return <>{children}</>;

  return (
    <DetailsWall
      pending={pending}
      form={form}
      error={error}
      onSubmitted={() => setDone(true)}
    />
  );
}

function DetailsWall({
  pending,
  form,
  error,
  onSubmitted,
}: {
  pending: PendingDetails;
  form: DetailsForm;
  error: string;
  onSubmitted: () => void;
}) {
  const { settings } = useSettings();
  const dogs = pending.dogNames.filter(Boolean);

  return (
    <div>
      <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
        <h1 className="font-display text-xl font-semibold text-amber-900">
          {dogs.length
            ? `${dogs.join(" and ")} passed the meet & greet`
            : "Your meet & greet went well"}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-amber-900">
          Welcome to {settings.business.name}. There is one thing left: the rest of the profile.
          It asks about your vet, who is allowed to collect{" "}
          {dogs.length === 1 ? dogs[0] : "your dogs"}, and anything we need to know about health
          and behaviour.
        </p>
        <p className="mt-2 text-xs text-amber-800">
          We need these before the first day, so your account opens once it is done. It takes a
          few minutes and we have already filled in what you told us.
        </p>
      </div>

      {error && (
        <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
          {error}
        </p>
      )}

      <EnrollmentDetailsForm token={pending.token} form={form} onSubmitted={onSubmitted} />
    </div>
  );
}
