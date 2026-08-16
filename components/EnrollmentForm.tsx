"use client";

import Link from "next/link";
import { ChangeEvent, forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import BusyButton from "@/components/BusyButton";
import SignaturePad, { SignaturePadHandle } from "@/components/SignaturePad";
import DateField from "@/components/DateField";
import { Field, YesNo, inputClass } from "@/components/FormBits";
import { PdfWorkerMissingError, fileToRecordJpeg } from "@/lib/image";
import { formatPhoneInput } from "@/lib/phone";
import { useSettings } from "@/components/SettingsProvider";
import {
  DogDraft,
  EnrollmentDraft,
  REQUIRED_VACCINES,
  ageFromBirthdate,
  emptyDog,
  emptyEnrollment,
  notifyStaffOfEnrollment,
  sendAcknowledgement,
  submitForApproval,
  validateEnrollment,
} from "@/lib/enrollment";
import {
  DOG_SEXES,
  DogSex,
  MEET_GREET_HOURS,
  MEET_GREET_WINDOWS,
  VACCINES,
  isMeetGreetDay,
} from "@/types";

// Stage one of the enrollment: the public form on /enroll, the lobby form on
// /signup, and the copy embedded in the boarding request.
//
// It asks only what is needed to decide on a meet & greet and hold it
// safely — who the household is, the dog basics, vaccinations with the
// record, the agreements and the signature. The address, the vet, and the
// behaviour and health questions come later, through the details form linked
// from the email sent when the meet & greet passes. See lib/enrollment.ts.
//
// A vaccination record is usually a photo of a page or a PDF from the vet.
// Photos get resized like every other image in the app; PDFs are stored as
// they are, so this is the ceiling on what a submission can weigh.

export interface EnrollmentPrefill {
  owner_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  /** One dog card is seeded per name. */
  dogNames?: string[];
}

export interface EnrollmentFormHandle {
  /** Validates and sends. Resolves true only when it was filed. */
  submit: () => Promise<boolean>;
}

function EnrollmentFormInner({
  source,
  embed = false,
  prefill,
  lockContact = false,
  hideSubmit = false,
  onDogNamesChange,
  onSubmitted,
  detailsOnFile = false,
}: {
  // Where the submission came from, so staff reviewing the queue know
  // whether someone stood at the front desk or filled it in at home.
  source: "kiosk" | "web";
  // Drops the logo, heading and navigation, for embedding in an iframe on
  // the business's own website where that chrome is already on the page.
  embed?: boolean;
  // Details the person has already typed somewhere else — the booking form
  // asks for the same name, phone and dogs, and asking twice on one page is
  // how a form gets abandoned.
  prefill?: EnrollmentPrefill;
  // Hides the four contact fields the host form already collected, and keeps
  // them following whatever the host has. Only meaningful with `prefill`.
  lockContact?: boolean;
  // Hides this form's own submit. The host drives it through the ref
  // instead, so one button sends both forms.
  hideSubmit?: boolean;
  // Reports the dog names as they are typed, so a host form that also needs
  // them does not have to ask a second time.
  onDogNamesChange?: (names: string[]) => void;
  // Lets a host page react to a successful submission and keep its own
  // chrome, instead of this form taking over with its confirmation screen.
  onSubmitted?: () => void;
  // The household has already answered stage two — an existing client
  // adding another dog. Files the submission complete, so nothing later
  // asks them to finish an enrollment that is finished.
  detailsOnFile?: boolean;
}, ref: React.Ref<EnrollmentFormHandle>) {
  const { settings } = useSettings();
  // Whether there is a client sign-in to promise on the way out. Off until a
  // business turns it on, so the thank-you screen must not describe one.
  const portalOn = settings.portal.enabled;
  // The kiosk sends people back to the sign-in screen; the website sends
  // them back to the website.
  const homeHref = source === "kiosk" ? "/kiosk" : "/";
  const [draft, setDraft] = useState<EnrollmentDraft>(() => {
    const base = emptyEnrollment();
    if (!prefill) return base;
    const names = (prefill.dogNames ?? []).map((n) => n.trim()).filter(Boolean);
    return {
      ...base,
      owner: {
        ...base.owner,
        owner_name: prefill.owner_name ?? base.owner.owner_name,
        last_name: prefill.last_name ?? base.owner.last_name,
        phone: prefill.phone ?? base.owner.phone,
        email: prefill.email ?? base.owner.email,
      },
      // One card per dog already named, so the questionnaire is the only
      // thing left to fill in.
      dogs: names.length
        ? names.map((n) => ({ ...emptyDog(), dog_name: n }))
        : base.dogs,
    };
  });
  const lockedName = prefill?.owner_name ?? "";
  const lockedLast = prefill?.last_name ?? "";
  const lockedPhone = prefill?.phone ?? "";
  const lockedEmail = prefill?.email ?? "";
  useEffect(() => {
    if (!lockContact) return;
    setDraft((d) => ({
      ...d,
      owner: {
        ...d.owner,
        owner_name: lockedName,
        last_name: lockedLast,
        phone: lockedPhone,
        email: lockedEmail,
      },
    }));
  }, [lockContact, lockedName, lockedLast, lockedPhone, lockedEmail]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const sigRef = useRef<SignaturePadHandle>(null);

  useImperativeHandle(ref, () => ({ submit: handleSubmit }));

  // Mirror the dog names outward whenever they change.
  const dogNamesKey = draft.dogs.map((d) => d.dog_name).join("\u0000");
  useEffect(() => {
    onDogNamesChange?.(draft.dogs.map((d) => d.dog_name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dogNamesKey]);

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

  async function handleDoc(index: number, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    try {
      // Image or PDF, in or out, it lands as one budgeted JPEG. A PDF used to
      // be stored byte for byte, so a scanned certificate could be megabytes
      // in a database row; now its pages are rendered and stacked.
      const data = await fileToRecordJpeg(file);
      setDog(index, { doc: { name: file.name, mime: "image/jpeg", data } });
    } catch (err) {
      console.error("Reading vaccination record failed:", err);
      // A missing pdf.js worker is a fault at our end, and telling somebody
      // their certificate is unreadable when it is not sends them off to
      // re-scan a perfectly good document.
      setError(
        err instanceof PdfWorkerMissingError
          ? `${err.message} A photo of the certificate works in the meantime.`
          : "Could not read that file — try a photo or a PDF."
      );
    }
  }

  async function handleSubmit(): Promise<boolean> {
    const problem = validateEnrollment(draft);
    if (problem) {
      setError(problem);
      return false;
    }
    if (sigRef.current?.isEmpty()) {
      setError("Please sign at the bottom of the form.");
      return false;
    }
    setError("");
    setSubmitting(true);
    try {
      await submitForApproval(draft, sigRef.current?.toDataURL() ?? "", source, detailsOnFile);
      // Confirmation email. Awaited so a slow send doesn't race the
      // unmount, but never fatal — the form is already filed, and saying
      // otherwise because an email bounced would be wrong.
      await sendAcknowledgement(draft);
      await notifyStaffOfEnrollment(draft);
      setDone(true);
      onSubmitted?.();
      return true;
    } catch (e) {
      console.error("Enrollment submit failed:", e);
      setError("Couldn't send that — check your connection and try again.");
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  // Same fix as the booking form, and only when this form owns the page.
  useEffect(() => {
    if (done && !hideSubmit) window.scrollTo(0, 0);
  }, [done, hideSubmit]);

  if (done && !hideSubmit) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-20 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-accent-500 text-3xl text-accent-ink shadow-card">
          ✓
        </div>
        <p className="text-lg font-medium text-ink">
          Thanks — we&apos;ve got it.
        </p>
        <p className="text-sm text-ink-3">
          {settings.business.name} will review{" "}
          {draft.dogs.length > 1 ? "these profiles" : "the profile"} and be in
          touch to confirm your meet &amp; greet. You&apos;ll be able to check
          in by phone number once it&apos;s approved.
        </p>
        {/* Only said when there is an account to be had.

            This promised an emailed invitation and a place to see visits and
            what is owed. Client accounts are switched off until a business
            turns them on, so on most deployments that was a promise nobody
            was going to keep — and a client who has been told to expect an
            email waits for it, then rings the front desk about it.

            An existing client adding another dog is told none of it either:
            they already have an account and answered those questions the
            first time. */}
        {portalOn &&
          (detailsOnFile ? (
            <p className="text-sm text-ink-3">
              Nothing else to fill in — we already have your address, your vet and your emergency
              contact from last time. This will show up in your account once we have approved it.
            </p>
          ) : (
            <>
              <p className="text-sm text-ink-3">
                Once the meet &amp; greet has gone well we&apos;ll email you a link to set up your
                account.
              </p>
              <p className="text-xs text-ink-3">
                That account is also where you&apos;ll find{" "}
                {draft.dogs.length > 1 ? "their" : "your dog's"} vaccination dates, your visits and
                what you owe.
              </p>
            </>
          ))}
        {!embed && (
          <Link
            href="/"
            className="mt-2 rounded-xl bg-accent-500 px-6 py-2.5 text-sm font-medium text-accent-ink shadow-card transition hover:bg-accent-600">
            Back to the start
          </Link>
        )}
      </div>
    );
  }

  const multi = draft.dogs.length > 1;

  return (
    <div className={`mx-auto max-w-3xl ${embed ? "px-4 py-6" : "px-5 py-10 sm:px-8"}`}>
      {!embed && (
        <div className="mb-8 text-center">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            New client enrollment
          </h1>
          <p className="mt-1 text-sm text-ink-3">
            {settings.business.name} — one form per household, however many dogs
          </p>
        </div>
      )}

      {/* Said before the first question rather than after the last one: the
          reason this form is short is worth knowing while deciding whether to
          start it. */}
      <p className="mb-5 rounded-2xl border border-line-soft bg-surface-2 px-4 py-3 text-xs leading-relaxed text-ink-2">
        Just enough to book your meet &amp; greet — about five minutes. Once
        you&apos;ve been in and we&apos;ve met your dog, we&apos;ll email you a
        second short form for the rest: your address, your vet, and how they
        get on with other dogs.
      </p>

      {/* Contract */}
      <Section title="Contract" step={1}>
        <div className="max-h-52 overflow-y-auto rounded-xl border border-line bg-surface-2 p-4 text-xs leading-relaxed text-ink-2">
          <ContractText business={settings.business.name} />
        </div>
        <label className="mt-3 flex items-start gap-2">
          <input
            type="checkbox"
            checked={draft.contractAgreed}
            onChange={(e) => setDraft({ ...draft, contractAgreed: e.target.checked })}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-accent-500 focus:ring-accent-100"
          />
          <span className="text-sm text-ink-2">
            I have read and agree to every section of the contract above.
            <span className="ml-0.5 text-rose-500">*</span>
          </span>
        </label>
      </Section>

      {/* Owner */}
      <Section title="Owner information" step={2}>
        <div className="grid gap-3 sm:grid-cols-2">
          {/* When this form is embedded in another that already asked for
              them, these four are shown back rather than asked again. Typing
              a name and a phone number twice on one page is the fastest way
              to make someone abandon it — and to end up with two spellings of
              the same client. */}
          {lockContact ? (
            <div className="sm:col-span-2 rounded-xl border border-line-soft bg-surface-2 px-3.5 py-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
                Using the details you entered above
              </p>
              <p className="mt-1 text-sm text-ink-2">
                {[draft.owner.owner_name, draft.owner.last_name].filter(Boolean).join(" ") ||
                  "Your name"}
                <span className="text-ink-3">
                  {draft.owner.phone ? ` · ${draft.owner.phone}` : ""}
                  {draft.owner.email ? ` · ${draft.owner.email}` : ""}
                </span>
              </p>
              <p className="mt-1 text-[11px] text-ink-3">
                Change them at the top of the page and they update here.
              </p>
            </div>
          ) : (
            <>
          <Field label="First name" required>
            <input
              value={draft.owner.owner_name}
              onChange={(e) => setOwner("owner_name", e.target.value)}
              autoComplete="given-name"
              className={inputClass}
            />
          </Field>
          <Field label="Last name" required>
            <input
              value={draft.owner.last_name}
              onChange={(e) => setOwner("last_name", e.target.value)}
              autoComplete="family-name"
              className={inputClass}
            />
          </Field>
          <Field label="Phone number" required hint="This is what you'll use to check in.">
            <input
              value={draft.owner.phone}
              onChange={(e) => setOwner("phone", formatPhoneInput(e.target.value))}
              placeholder="(123) 456-7890"
              inputMode="tel"
              autoComplete="tel"
              className={inputClass}
            />
          </Field>
          <Field label="Email" required>
            <input
              type="email"
              value={draft.owner.email}
              onChange={(e) => setOwner("email", e.target.value)}
              placeholder="name@example.com"
              autoComplete="email"
              className={inputClass}
            />
          </Field>
            </>
          )}
        </div>
      </Section>

      {/* Dogs */}
      {draft.dogs.map((dog, i) => (
        <Section
          key={i}
          step={3 + i}
          title={multi ? `Dog ${i + 1}${dog.dog_name ? ` — ${dog.dog_name}` : ""}` : "Your dog"}
          action={
            multi ? (
              <button
                type="button"
                onClick={() =>
                  setDraft((d) => ({ ...d, dogs: d.dogs.filter((_, n) => n !== i) }))
                }
                className="text-xs font-medium text-rose-500 hover:text-rose-600"
              >
                Remove
              </button>
            ) : null
          }
        >
          <DogSection
            dog={dog}
            index={i}
            setDog={setDog}
            onDoc={handleDoc}
          />
        </Section>
      ))}

      <button
        type="button"
        onClick={() => setDraft((d) => ({ ...d, dogs: [...d.dogs, emptyDog()] }))}
        className="mb-5 w-full rounded-2xl border border-dashed border-line bg-surface px-4 py-3 text-sm font-medium text-ink-3 transition hover:border-accent-400 hover:text-accent-600"
      >
        + Add another dog
      </button>

      {/* Meet & greet + signature */}
      <Section title="Meet &amp; greet and signature" step={3 + draft.dogs.length}>
        <div className="rounded-xl border border-line bg-surface-2 p-4 text-xs leading-relaxed text-ink-2">
          Every new dog comes in for a meet &amp; greet before their first full day, so we can see
          how they settle in with the group. Bring your dog on a leash and plan to leave them with
          us for about two hours — owners do not stay, so come back for them at the end. If it
          goes well you are welcome to ask us to keep them for the rest of the day. Requested
          dates are confirmed by phone or email — nothing is booked until we reply.
        </div>
        <label className="mt-3 flex items-start gap-2">
          <input
            type="checkbox"
            checked={draft.policyAgreed}
            onChange={(e) => setDraft({ ...draft, policyAgreed: e.target.checked })}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-accent-500 focus:ring-accent-100"
          />
          <span className="text-sm text-ink-2">
            I understand the meet &amp; greet policy.<span className="ml-0.5 text-rose-500">*</span>
          </span>
        </label>

        <div className="mt-4">
          <p className="mb-1.5 text-[11px] font-medium text-ink-3">
            Signature<span className="ml-0.5 text-rose-500">*</span>
          </p>
          <p className="mb-2 text-xs text-ink-3">
            Signing covers the contract, the meet &amp; greet policy, and{" "}
            {multi ? "every dog listed above" : "the dog listed above"}.
          </p>
          <SignaturePad ref={sigRef} />
          <button
            type="button"
            onClick={() => sigRef.current?.clear()}
            className="mt-2 text-xs font-medium text-ink-3 hover:text-ink-2"
          >
            Clear signature
          </button>
        </div>
      </Section>

      {error && (
        <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
          {error}
        </p>
      )}

      {!hideSubmit && (
      <div className="flex flex-wrap items-center gap-3">
        {/* The enrollment carries a photo, a signature and a vaccination
            record, so this is the slowest submit in the app and the one most
            likely to be pressed twice. */}
        <BusyButton busy={submitting} busyLabel="Sending your enrollment…" onClick={handleSubmit}>
          Submit for review
        </BusyButton>
        <p className="text-xs text-ink-3">
          We&apos;ll review it and confirm by email — you can&apos;t check in until then.
        </p>
        {!embed && (
          <Link href={homeHref} className="ml-auto text-xs font-medium text-ink-3 hover:text-ink-2">
            Back
          </Link>
        )}
      </div>
      )}
    </div>
  );
}

function DogSection({
  dog,
  index,
  setDog,
  onDoc,
}: {
  dog: DogDraft;
  index: number;
  setDog: (i: number, patch: Partial<DogDraft>) => void;
  onDoc: (i: number, e: ChangeEvent<HTMLInputElement>) => void;
}) {
  const age = ageFromBirthdate(dog.birthdate);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Dog's name" required>
          <input
            value={dog.dog_name}
            onChange={(e) => setDog(index, { dog_name: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Breed" required>
          <input
            value={dog.breed}
            onChange={(e) => setDog(index, { breed: e.target.value })}
            placeholder="Mixed breed"
            className={inputClass}
          />
        </Field>
        <Field label="Colour" required>
          <input
            value={dog.color}
            onChange={(e) => setDog(index, { color: e.target.value })}
            className={inputClass}
          />
        </Field>
        {/* Age isn't stored — it's derived from the birthday, so it can't go
            stale the way a typed-in number does. */}
        <Field label="Birthday" required hint={age ? `About ${age} old` : undefined}>
          <DateField
            value={dog.birthdate}
            onChange={(v) => setDog(index, { birthdate: v })}
            className={inputClass}
            ariaLabel="Birthday"
          />
        </Field>
        <Field label="Weight (lb)" required>
          <input
            type="number"
            min="0"
            step="0.1"
            value={dog.weight_lb}
            onChange={(e) => setDog(index, { weight_lb: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Gender" required>
          <select
            value={dog.sex}
            onChange={(e) => setDog(index, { sex: e.target.value as DogSex | "" })}
            className={inputClass}
          >
            <option value="">Choose…</option>
            {DOG_SEXES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Spayed / neutered?" required>
          <YesNo value={dog.fixed} onChange={(v) => setDog(index, { fixed: v })} />
        </Field>
        {dog.fixed === false && (
          <Field label="If no, when is it scheduled?">
            <DateField
              value={dog.fixed_scheduled_on}
              onChange={(v) => setDog(index, { fixed_scheduled_on: v })}
              className={inputClass}
              ariaLabel="Spay or neuter appointment"
            />
          </Field>
        )}
      </div>

      {/* No date fields here any more.
          Owners were typing five expiry dates off a certificate they were
          uploading anyway, and staff checked every one against that document
          before approving — so the typing produced a number nobody trusted,
          and mistyped ones cost the front desk more time than they saved.
          The document is the record. Staff read the dates off it on the dog
          profile, where it is on screen beside the fields. */}
      <SubHeading>Vaccinations</SubHeading>
      <p className="text-xs text-ink-3">
        Upload a photo or PDF of your dog&apos;s vaccination records. We will read the dates off it
        — you do not need to type them in.
      </p>
      <Field label="Vaccination records" required>
        <div className="flex flex-wrap items-center gap-3">
          <label className="cursor-pointer rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink-2 transition hover:border-accent-400">
            {dog.doc ? "Replace file" : "Choose a photo or PDF"}
            <input
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => onDoc(index, e)}
            />
          </label>
          {dog.doc && (
            <span className="flex items-center gap-2 text-xs text-ink-2">
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">
                ✓ {dog.doc.name}
              </span>
              <button
                type="button"
                onClick={() => setDog(index, { doc: null })}
                className="text-rose-400 hover:text-rose-600"
              >
                remove
              </button>
            </span>
          )}
        </div>
      </Field>

      {/* The owner saying it in as many words. The document proves it and
          staff will read it, but a dog cannot be on site without these three
          and this is the line the household is answering for. */}
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3">
        <input
          type="checkbox"
          checked={dog.vaccinesConfirmed}
          onChange={(e) => setDog(index, { vaccinesConfirmed: e.target.checked })}
          className="mt-0.5 h-4 w-4 shrink-0 accent-accent-500"
        />
        <span className="text-xs leading-relaxed text-ink-2">
          I confirm {dog.dog_name.trim() || "my dog"} is up to date on{" "}
          <span className="font-medium text-ink">
            {REQUIRED_VACCINES.map((key) => VACCINES.find((v) => v.key === key)?.label ?? key).join(
              ", "
            )}
          </span>
          , and that the records above are current.
          <span className="ml-0.5 text-rose-500">*</span>
        </span>
      </label>

      <SubHeading>Your visit</SubHeading>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Preferred meet & greet date"
          hint={`${MEET_GREET_HOURS}. We'll confirm before it's booked.`}
        >
          <DateField
            value={dog.meet_greet_on}
            onChange={(v) => setDog(index, { meet_greet_on: v })}
            className={inputClass}
            ariaLabel="Meet and greet date"
          />
        </Field>
      </div>

      {/* Caught here as well as in validation, so a weekend date is
          obvious the moment it's typed rather than on submit. */}
      {dog.meet_greet_on && !isMeetGreetDay(dog.meet_greet_on) && (
        <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          We only do meet &amp; greets {MEET_GREET_HOURS.toLowerCase()} — please pick a weekday.
        </p>
      )}

      {dog.meet_greet_on && isMeetGreetDay(dog.meet_greet_on) && (
        <Field label="Which arrival window suits you?" required>
          <div className="flex flex-wrap gap-2">
            {MEET_GREET_WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setDog(index, { meet_greet_window: w })}
                className={`rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
                  dog.meet_greet_window === w
                    ? "border-accent-500 bg-accent-500 text-accent-ink shadow-card"
                    : "border-line bg-surface text-ink-2 hover:border-accent-300"
                }`}
              >
                {w}
              </button>
            ))}
          </div>
        </Field>
      )}
    </div>
  );
}

function Section({
  title,
  step,
  action,
  children,
}: {
  title: string;
  step: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 rounded-3xl bg-surface p-5 shadow-card sm:p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-500 text-[11px] font-semibold text-accent-ink">
          {step}
        </span>
        <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
        {action && <span className="ml-auto">{action}</span>}
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

// Kept in the component tree rather than a settings field: it's the same
// standard set of terms for any facility running this app, and the business
// name is the only part that changes per deployment.
function ContractText({ business }: { business: string }) {
  const clauses: [string, string][] = [
    [
      "Health and vaccinations",
      `My dog is in good health, has not been ill with a communicable condition in the last 30 days, and is currently vaccinated against rabies, distemper/parvo (DHPP) and bordetella. I will keep those records current with ${business} and understand my dog may be turned away if they lapse.`,
    ],
    [
      "Temperament",
      `My dog has not shown aggression toward people or other dogs beyond anything I have disclosed on this form. ${business} may refuse or end a stay if my dog is unsafe around others, and will contact me to collect them.`,
    ],
    [
      "Risk of injury",
      "I understand that dogs play off-leash in groups, and that scratches, nicks and scrapes can happen even with careful supervision. I accept that ordinary risk.",
    ],
    [
      "Veterinary care",
      `If my dog needs medical attention and I cannot be reached, I authorize ${business} to obtain veterinary care at my expense, preferring my own vet where practical.`,
    ],
    [
      "Payment and pick-up",
      "I will pay all charges when my dog is collected, and I will collect my dog by closing time. Late collection may incur a fee, and dogs left without contact for an extended period may be treated as abandoned.",
    ],
    [
      "Photos",
      `I agree that ${business} may photograph my dog for its records and social media, without payment.`,
    ],
  ];
  return (
    <div className="space-y-3">
      {clauses.map(([heading, body]) => (
        <div key={heading}>
          <p className="font-semibold text-ink-2">{heading}</p>
          <p>{body}</p>
        </div>
      ))}
    </div>
  );
}

const EnrollmentForm = forwardRef(EnrollmentFormInner);
export default EnrollmentForm;
