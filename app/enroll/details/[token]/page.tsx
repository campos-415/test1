"use client";

// The public half-two of the enrollment form, reached from the link emailed
// when a meet & greet passes.
//
// No sign-in: the token in the URL is the credential, and it is a random
// uuid that identifies exactly one household. No expiry either — an owner
// who fills this in three weeks later is completely normal, and an expired
// link would only turn into a phone call to the front desk.
//
// Reopening a completed link shows what was sent rather than a blank form.
// Somebody who clicks the same email twice should not be made to wonder
// whether the first attempt went through.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import EnrollmentDetailsForm from "@/components/EnrollmentDetailsForm";
import { useSettings } from "@/components/SettingsProvider";
import {
  DetailsForm,
  DetailsFormError,
  EnrollmentDraft,
  ageFromBirthdate,
  loadDetailsForm,
} from "@/lib/enrollment";

export default function EnrollmentDetailsPage({ params }: { params: { token: string } }) {
  const { settings } = useSettings();
  const [form, setForm] = useState<DetailsForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DetailsFormError | null>(null);
  // Set the moment the form saves, so the confirmation does not depend on
  // re-reading a row that has just been written.
  const [submitted, setSubmitted] = useState<EnrollmentDraft | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await loadDetailsForm(params.token);
    setForm(result.form ?? null);
    setError(result.error ?? null);
    setLoading(false);
  }, [params.token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (submitted) window.scrollTo(0, 0);
  }, [submitted]);

  const alreadyDone = !!form?.details_submitted_at;

  return (
    <div>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-5 sm:px-8">
          {settings.business.logoData && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={settings.business.logoData}
              alt={settings.business.name}
              className="h-10 w-auto object-contain"
            />
          )}
          <div>
            <p className="font-display text-lg font-semibold text-ink">{settings.business.name}</p>
            <p className="text-xs text-ink-3">Finishing your enrollment</p>
          </div>
        </div>
      </header>

      {loading ? (
        <p className="mx-auto max-w-3xl px-6 py-20 text-center text-sm text-ink-3">Loading…</p>
      ) : error === "not-found" ? (
        // Wrong token, or a submission that has since been deleted.
        // Deliberately vague about which: this page is open to the internet.
        <Message title="This link doesn't work">
          It may have been mistyped, or replaced by a newer one. Give {settings.business.name} a
          call and we&apos;ll send you a fresh link.
        </Message>
      ) : error || !form ? (
        <Message title="Something went wrong">
          Could not open your form just now — please try again in a minute, or give us a call.
          <button
            onClick={load}
            className="mt-4 block rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-medium text-accent-ink shadow-card hover:bg-accent-600"
          >
            Try again
          </button>
        </Message>
      ) : form.status === "rejected" ? (
        <Message title="Let's have a chat first">
          There&apos;s something outstanding on this enrollment. Please give{" "}
          {settings.business.name} a call before filling anything else in.
        </Message>
      ) : submitted || alreadyDone ? (
        <Submitted draft={submitted ?? form.draft} business={settings.business.name} />
      ) : (
        <EnrollmentDetailsForm token={params.token} form={form} onSubmitted={setSubmitted} />
      )}
    </div>
  );
}

// What was sent, read-only. Not a form: re-editing would need the same
// merge-into-existing-records care as the first submission, and an owner who
// wants to change an answer after the fact is better served by the phone
// call that would follow anyway.
function Submitted({ draft, business }: { draft: EnrollmentDraft; business: string }) {
  const o = draft.owner;
  return (
    <div className="mx-auto max-w-2xl px-6 py-14">
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-500 text-2xl text-accent-ink shadow-card">
          ✓
        </div>
        <p className="text-lg font-medium text-ink">That&apos;s everything — thank you.</p>
        <p className="text-sm text-ink-3">
          It&apos;s on {draft.dogs.length > 1 ? "their profiles" : "their profile"} at {business}.
          Anything you&apos;d like to change, just tell us at the front desk.
        </p>
      </div>

      <div className="rounded-3xl bg-surface p-5 shadow-card sm:p-6">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
          What you sent us
        </p>
        <Row label="Address" value={[o.address, o.city, o.state, o.zip].filter(Boolean).join(", ")} />
        <Row
          label="Emergency contact"
          value={[o.emergency_name, o.emergency_phone, o.emergency_relation]
            .filter(Boolean)
            .join(" · ")}
        />
        <Row label="Authorized pick-up" value={o.authorized_pickup} />
        <Row label="Vet" value={[o.vet_name, o.vet_phone, o.vet_address].filter(Boolean).join(" · ")} />
        <Row label="Heard about us" value={o.heard_about} />

        {draft.dogs.map((d, i) => (
          <div key={i} className="mt-4 border-t border-line-soft pt-3">
            <p className="mb-1.5 text-sm font-medium text-ink">
              🐕 {d.dog_name || "Your dog"}
              {ageFromBirthdate(d.birthdate) && (
                <span className="ml-1.5 text-xs font-normal text-ink-3">
                  {ageFromBirthdate(d.birthdate)}
                </span>
              )}
            </p>
            <Row label="Flea program" value={d.flea_program} />
            <Row label="Came from" value={d.dog_source} />
            <Row label="Health" value={d.health_problems ? d.health_notes || "Yes" : "None noted"} />
            <Row label="Allergies" value={d.allergies?.join(", ")} />
            <Row label="Restrictions" value={d.activity_restrictions?.join(", ")} />
            <Row
              label="History"
              value={
                [
                  d.growled ? "has growled" : "",
                  d.bitten ? "has bitten" : "",
                  d.dog_fight ? "dog fight" : "",
                  d.climbed_fence ? "climbs fences" : "",
                ]
                  .filter(Boolean)
                  .join(", ") || "Nothing reported"
              }
            />
            <Row label="Traits" value={d.behavior_traits?.join(", ")} />
            <Row label="At play" value={d.play_style?.join(", ")} />
            <Row label="Expected visits" value={d.attendance_plan} />
            <Row label="With big dogs" value={d.big_dog_response} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-20 text-center">
      <p className="text-lg font-medium text-ink">{title}</p>
      <div className="text-sm text-ink-3">{children}</div>
      <Link href="/" className="mt-2 text-xs font-medium text-accent-600 hover:underline">
        Back to the start
      </Link>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    // Stacked on a phone: a fixed label column plus an email address is
    // wider than the screen, and an address has no space to wrap at.
    <div className="flex flex-col gap-0.5 py-1 text-xs sm:flex-row sm:gap-3 sm:py-0.5">
      <span className="text-ink-3 sm:w-36 sm:shrink-0">{label}</span>
      <span className="min-w-0 flex-1 break-words text-ink-2">{value}</span>
    </div>
  );
}
