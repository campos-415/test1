"use client";

// Stage two of the enrollment: everything the meet & greet did not depend on.
//
// Reached from a link emailed when the meet & greet passes, with no sign-in —
// the token in the URL is what identifies the household. So the form asks
// nothing it already knows: the name, the phone, the dogs and their
// vaccination dates are shown back as a recap, and every question below is
// one that has never been put to this owner before. The same rule the
// boarding form follows when it embeds the enrollment.
//
// Submitting merges into the dog records that already exist. It creates
// nothing — see applyEnrollmentDetails in lib/enrollment.ts.

import { useState } from "react";
import { CheckGrid, ChoiceWithOther, Field, YesNo, YesNoDetail, inputClass } from "@/components/FormBits";
import { formatPhoneInput } from "@/lib/phone";
import { useSettings } from "@/components/SettingsProvider";
import {
  DetailsForm,
  DogDraft,
  EnrollmentDraft,
  ageFromBirthdate,
  submitEnrollmentDetails,
  validateEnrollmentDetails,
} from "@/lib/enrollment";
import {
  ACTIVITY_RESTRICTIONS,
  ALLERGENS,
  ATTENDANCE_PLANS,
  BEHAVIOR_TRAITS,
  BIG_DOG_RESPONSES,
  FLEA_PROGRAMS,
  HEARD_ABOUT,
  PACKAGE_INTEREST,
  PLAY_STYLES,
} from "@/types";

export default function EnrollmentDetailsForm({
  token,
  form,
  onSubmitted,
}: {
  token: string;
  form: DetailsForm;
  /** Lets the page show the completed view without another round trip. */
  onSubmitted?: (draft: EnrollmentDraft) => void;
}) {
  const { settings } = useSettings();
  const [draft, setDraft] = useState<EnrollmentDraft>(() => form.draft);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function setOwner<K extends keyof EnrollmentDraft["owner"]>(
    key: K,
    value: EnrollmentDraft["owner"][K]
  ) {
    setDraft((d) => ({ ...d, owner: { ...d.owner, [key]: value } }));
  }

  function setDog(index: number, patch: Partial<DogDraft>) {
    setDraft((d) => ({
      ...d,
      dogs: d.dogs.map((dog, i) => (i === index ? { ...dog, ...patch } : dog)),
    }));
  }

  async function handleSubmit() {
    const problem = validateEnrollmentDetails(draft);
    if (problem) {
      setError(problem);
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const result = await submitEnrollmentDetails(token, draft);
      if (result.unmatched.length) {
        // Saved either way — the answers are on the submission, and staff can
        // see them on /requests. Only the profile write was skipped, because
        // there is no profile under that name to write to.
        console.warn("No dog profile matched:", result.unmatched.join(", "));
      }
      onSubmitted?.(draft);
    } catch (e) {
      console.error("Saving enrollment details failed:", e);
      setError("Couldn't save that — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const multi = draft.dogs.length > 1;

  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
      <div className="mb-6 text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          A few last details
        </h1>
        <p className="mt-1 text-sm text-ink-3">
          {settings.business.name} — the second half of {draft.owner.owner_name.trim() || "your"}
          &apos;s enrollment
        </p>
      </div>

      {/* What stage one already collected, shown rather than asked. */}
      <div className="mb-5 rounded-2xl border border-line-soft bg-surface-2 px-4 py-3.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
          Already on file
        </p>
        <p className="mt-1 text-sm text-ink-2">
          {[form.owner_name, form.last_name].filter(Boolean).join(" ")}
          <span className="text-ink-3">
            {form.phone ? ` · ${form.phone}` : ""}
            {draft.owner.email ? ` · ${draft.owner.email}` : ""}
          </span>
        </p>
        <ul className="mt-1.5 space-y-0.5 text-xs text-ink-3">
          {draft.dogs.map((d, i) => (
            <li key={i}>
              🐕 {d.dog_name || "Your dog"}
              {[d.breed, ageFromBirthdate(d.birthdate)].filter(Boolean).length > 0 &&
                ` — ${[d.breed, ageFromBirthdate(d.birthdate)].filter(Boolean).join(", ")}`}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-ink-3">
          Anything wrong here? Give us a call and we&apos;ll fix it — this form only adds to it.
        </p>
      </div>

      <Section title="Home and emergency contact" step={1}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Street address" required>
              <input
                value={draft.owner.address}
                onChange={(e) => setOwner("address", e.target.value)}
                autoComplete="street-address"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="City" required>
            <input
              value={draft.owner.city}
              onChange={(e) => setOwner("city", e.target.value)}
              autoComplete="address-level2"
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="State" required>
              <input
                value={draft.owner.state}
                onChange={(e) => setOwner("state", e.target.value.toUpperCase())}
                maxLength={2}
                autoComplete="address-level1"
                className={inputClass}
              />
            </Field>
            <Field label="ZIP" required>
              <input
                value={draft.owner.zip}
                onChange={(e) => setOwner("zip", e.target.value)}
                inputMode="numeric"
                autoComplete="postal-code"
                className={inputClass}
              />
            </Field>
          </div>
          <Field
            label="Emergency contact name"
            required
            hint="Who we call if we can't reach you."
          >
            <input
              value={draft.owner.emergency_name}
              onChange={(e) => setOwner("emergency_name", e.target.value)}
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Emergency phone" required>
              <input
                value={draft.owner.emergency_phone}
                onChange={(e) => setOwner("emergency_phone", formatPhoneInput(e.target.value))}
                inputMode="tel"
                className={inputClass}
              />
            </Field>
            <Field label="Relationship">
              <input
                value={draft.owner.emergency_relation}
                onChange={(e) => setOwner("emergency_relation", e.target.value)}
                placeholder="Sister, neighbour…"
                className={inputClass}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field
              label={`Others authorized to pick up ${multi ? "your dogs" : "your dog"}`}
              required
              hint="Nobody else will be allowed to collect them. Enter “nobody” if it's only you."
            >
              <input
                value={draft.owner.authorized_pickup}
                onChange={(e) => setOwner("authorized_pickup", e.target.value)}
                placeholder="Names of anyone else allowed"
                className={inputClass}
              />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Veterinarian" step={2}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Hospital name">
            <input
              value={draft.owner.vet_name}
              onChange={(e) => setOwner("vet_name", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Phone number">
            <input
              value={draft.owner.vet_phone}
              onChange={(e) => setOwner("vet_phone", formatPhoneInput(e.target.value))}
              inputMode="tel"
              className={inputClass}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address">
              <input
                value={draft.owner.vet_address}
                onChange={(e) => setOwner("vet_address", e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
        </div>
      </Section>

      {draft.dogs.map((dog, i) => (
        <Section
          key={i}
          step={3 + i}
          title={multi ? `About ${dog.dog_name || `dog ${i + 1}`}` : "About your dog"}
        >
          <DogDetails dog={dog} index={i} setDog={setDog} />
        </Section>
      ))}

      <Section title="One last thing" step={3 + draft.dogs.length}>
        <Field label="How did you hear about us?">
          <ChoiceWithOther
            options={HEARD_ABOUT}
            value={draft.owner.heard_about}
            onChange={(v) => setOwner("heard_about", v)}
            ariaLabel="How did you hear about us"
          />
        </Field>
      </Section>

      {error && (
        <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="rounded-xl bg-accent-500 px-6 py-3 text-sm font-medium text-accent-ink shadow-card transition hover:bg-accent-600 disabled:opacity-60"
        >
          {submitting ? "Saving…" : "Send these details"}
        </button>
        <p className="text-xs text-ink-3">
          Goes straight onto {multi ? "their profiles" : "their profile"} — nothing else to do.
        </p>
      </div>
    </div>
  );
}

function DogDetails({
  dog,
  index,
  setDog,
}: {
  dog: DogDraft;
  index: number;
  setDog: (i: number, patch: Partial<DogDraft>) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Flea program">
          <ChoiceWithOther
            options={FLEA_PROGRAMS}
            value={dog.flea_program}
            onChange={(v) => setDog(index, { flea_program: v })}
            ariaLabel="Flea program"
          />
        </Field>
        <Field label="Where did you get your dog?">
          <input
            value={dog.dog_source}
            onChange={(e) => setDog(index, { dog_source: e.target.value })}
            placeholder="Breeder, shelter, rescue…"
            className={inputClass}
          />
        </Field>
      </div>

      <SubHeading>History</SubHeading>
      {/* Asked plainly, and answered honestly far more often when the person
          answering has already met the staff — which is the whole reason
          these questions moved to this side of the meet & greet. */}
      <p className="text-xs text-ink-3">
        Please answer these straight. A dog that has growled or nipped is not turned away for
        it — it just tells us how to look after them.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <YesNoDetail
          required
          label="Has your dog ever growled at a person or another dog?"
          value={dog.growled}
          onChange={(v) => setDog(index, { growled: v })}
          detail={dog.growled_note}
          onDetailChange={(v) => setDog(index, { growled_note: v })}
          detailLabel="What happened?"
        />
        <YesNoDetail
          required
          label="Has your dog ever bitten a person or another dog?"
          value={dog.bitten}
          onChange={(v) => setDog(index, { bitten: v })}
          detail={dog.bitten_note}
          onDetailChange={(v) => setDog(index, { bitten_note: v })}
          detailLabel="What happened?"
        />
        <YesNoDetail
          required
          label="Has your dog ever climbed or jumped a fence?"
          value={dog.climbed_fence}
          onChange={(v) => setDog(index, { climbed_fence: v })}
          detail={dog.fence_height}
          onDetailChange={(v) => setDog(index, { fence_height: v })}
          detailLabel="How high was it?"
          detailPlaceholder="e.g. 5 ft"
        />
        <YesNoDetail
          required
          label="Has your dog ever been in a fight with another dog?"
          value={dog.dog_fight}
          onChange={(v) => setDog(index, { dog_fight: v })}
          detail={dog.dog_fight_note}
          onDetailChange={(v) => setDog(index, { dog_fight_note: v })}
          detailLabel="What happened?"
        />
      </div>

      <SubHeading>Health &amp; grooming</SubHeading>
      <div className="space-y-3">
        <YesNoDetail
          required
          label="Does your dog have any health problems?"
          value={dog.health_problems}
          onChange={(v) => setDog(index, { health_problems: v })}
          detail={dog.health_notes}
          onDetailChange={(v) => setDog(index, { health_notes: v })}
          detailLabel="Please describe — including any medication"
        />
        <Field label="Any activity restrictions?">
          <CheckGrid
            options={ACTIVITY_RESTRICTIONS}
            value={dog.activity_restrictions}
            onChange={(v) => setDog(index, { activity_restrictions: v })}
            otherPlaceholder="Other restrictions, comma separated"
          />
        </Field>
        <Field label="Any allergies?" hint="Leave blank if none.">
          <CheckGrid
            options={ALLERGENS}
            value={dog.allergies}
            onChange={(v) => setDog(index, { allergies: v })}
            otherPlaceholder="Other allergies, comma separated"
          />
        </Field>
        <YesNoDetail
          required
          label="Is your dog sensitive about being touched anywhere?"
          value={dog.sensitive_areas}
          onChange={(v) => setDog(index, { sensitive_areas: v })}
          detail={dog.sensitive_areas_note}
          onDetailChange={(v) => setDog(index, { sensitive_areas_note: v })}
          detailLabel="Where?"
          detailPlaceholder="Paws, ears, tail…"
        />
      </div>

      <SubHeading>Behaviour</SubHeading>
      <div className="space-y-3">
        <Field label="Which of these describe your dog?" required>
          <CheckGrid
            options={BEHAVIOR_TRAITS}
            value={dog.behavior_traits}
            onChange={(v) => setDog(index, { behavior_traits: v })}
            otherPlaceholder="Anything else, comma separated"
          />
        </Field>
        <Field label="What is your dog like at play?" required>
          <CheckGrid
            options={PLAY_STYLES}
            value={dog.play_style}
            onChange={(v) => setDog(index, { play_style: v })}
            otherPlaceholder="Anything else, comma separated"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="How often do you expect to visit?" required>
            <ChoiceWithOther
              options={ATTENDANCE_PLANS}
              value={dog.attendance_plan}
              onChange={(v) => setDog(index, { attendance_plan: v })}
              ariaLabel="Expected visit frequency"
            />
          </Field>
          <Field label="How is your dog around big dogs?" required>
            <ChoiceWithOther
              options={BIG_DOG_RESPONSES}
              value={dog.big_dog_response}
              onChange={(v) => setDog(index, { big_dog_response: v })}
              ariaLabel="Around big dogs"
            />
          </Field>
          <Field label="Crate trained?" required>
            <YesNo value={dog.crate_trained} onChange={(v) => setDog(index, { crate_trained: v })} />
          </Field>
          <Field label="Kennel trained?" required>
            <YesNo
              value={dog.kennel_trained}
              onChange={(v) => setDog(index, { kennel_trained: v })}
            />
          </Field>
          <Field label="Interested in a daycare package?">
            <ChoiceWithOther
              options={PACKAGE_INTEREST}
              value={dog.package_interest}
              onChange={(v) => setDog(index, { package_interest: v })}
              ariaLabel="Interested in a package"
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  step,
  children,
}: {
  title: string;
  step: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 rounded-3xl bg-surface p-5 shadow-card sm:p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-500 text-[11px] font-semibold text-accent-ink">
          {step}
        </span>
        <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="border-t border-line-soft pt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
      {children}
    </h3>
  );
}
