"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import BusyButton from "@/components/BusyButton";
import DateField from "@/components/DateField";
import { Field, YesNo, inputClass } from "@/components/FormBits";
import { formatPhoneInput } from "@/lib/phone";
import { useSettings } from "@/components/SettingsProvider";
import EnrollmentForm, { EnrollmentFormHandle } from "@/components/EnrollmentForm";
import { prettyDateKey } from "@/lib/dates";
import {
  BATH_PRICES,
  BOARDING_ADDON_PRICES,
  PRICING,
  estimateBoardingTotal,
} from "@/lib/pricing";
import {
  BoardingRequestDraft,
  BoardingRequestSource,
  MAX_WALKS_PER_DAY,
  NOTICE_DAYS,
  cleanDogNames,
  emptyBoardingRequest,
  isShortNotice,
  nightsFor,
  notifyStaffOfBoarding,
  noticeDays,
  sendBoardingAcknowledgement,
  submitBoardingRequest,
  validateBoardingRequest,
} from "@/lib/boardingRequest";
import { BOARDING_SERVICES, BoardingAddonKey } from "@/types";

/** Details the account already holds, so the form does not ask for them. */
export interface BoardingPrefill {
  owner_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
}

export default function BoardingRequestForm({
  source,
  embed = false,
  prefill,
  lockContact = false,
  knownDogs,
}: {
  source: BoardingRequestSource;
  // Drops the heading and back link, for embedding in an iframe on the
  // business's own website.
  embed?: boolean;
  // What the signed-in account already knows. The portal passes this; the
  // public form does not have it to pass.
  prefill?: BoardingPrefill;
  // Shows the contact details back rather than asking for them. Only
  // meaningful with `prefill`, and only honest when the details came from an
  // account rather than from something the person typed a moment ago.
  lockContact?: boolean;
  // The dogs on the account. Given these, the form offers them to tick
  // instead of asking somebody to type the name of a dog we already know —
  // which is also how a stay ends up filed under a spelling that matches no
  // profile. Passing this also settles the enrollment question: a dog with a
  // record here is enrolled by definition.
  knownDogs?: string[];
}) {
  const { settings } = useSettings();
  // The kiosk sends people back to the sign-in screen, the portal back to
  // the account, and the website back to the website.
  const homeHref = source === "kiosk" ? "/kiosk" : source === "portal" ? "/account" : "/";
  const [draft, setDraft] = useState<BoardingRequestDraft>(() => {
    const base = emptyBoardingRequest();
    if (!prefill) return base;
    return {
      ...base,
      owner_name: prefill.owner_name ?? base.owner_name,
      last_name: prefill.last_name ?? base.last_name,
      phone: prefill.phone ?? base.phone,
      email: prefill.email ?? base.email,
      // A household with dogs on file has answered this already.
      alreadyEnrolled: knownDogs?.length ? true : base.alreadyEnrolled,
      // One dog: ticked already, since there is nothing to choose between.
      // Several: none ticked, so nobody books the wrong dog by not looking.
      dogNames: knownDogs?.length ? (knownDogs.length === 1 ? [knownDogs[0]] : []) : base.dogNames,
    };
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  function set<K extends keyof BoardingRequestDraft>(key: K, value: BoardingRequestDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function setDogName(i: number, value: string) {
    setDraft((d) => ({ ...d, dogNames: d.dogNames.map((n, x) => (x === i ? value : n)) }));
  }

  function toggleService(key: BoardingAddonKey, on: boolean) {
    setDraft((d) => ({
      ...d,
      services: on ? [...d.services, key] : d.services.filter((s) => s !== key),
    }));
  }

  async function handleSubmit() {
    // The shared validator says "Enter your dog's name", which is the wrong
    // instruction next to a list of tick boxes.
    if (knownDogs?.length && !cleanDogNames(draft).length) {
      setError("Tick which of your dogs is coming.");
      return;
    }
    const problem = validateBoardingRequest(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      // One button, two submissions. The enrollment goes first: if it fails
      // validation there is no point filing a stay for a dog with no profile,
      // and the enrollment form shows its own reason inline.
      if (enrollingHere) {
        const ok = await enrollmentRef.current?.submit();
        if (!ok) {
          setError("Please finish the enrollment form above, then send again.");
          return;
        }
      }
      await submitBoardingRequest(draft, source);
      await sendBoardingAcknowledgement(draft);
      await notifyStaffOfBoarding(draft);
      setDone(true);
    } catch (e) {
      console.error("Boarding request failed:", e);
      setError("Couldn't send that — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const nights = nightsFor(draft);
  const dogs = cleanDogNames(draft);
  const notEnrolled = draft.alreadyEnrolled === false;
  const [showEnrollment, setShowEnrollment] = useState(false);
  const [enrollmentSent, setEnrollmentSent] = useState(false);
  const enrollmentRef = useRef<EnrollmentFormHandle>(null);
  // True while the embedded enrollment is on screen and unsent — that is when
  // it owns the dog names and the single submit covers both forms.
  const enrollingHere = notEnrolled && showEnrollment && !enrollmentSent;
  // The embedded enrollment reuses these four rather than asking again, so
  // they have to exist before it can open.
  const contactReady =
    !!draft.owner_name.trim() &&
    !!draft.last_name.trim() &&
    draft.phone.replace(/\D/g, "").length >= 7 &&
    /^\S+@\S+\.\S+$/.test(draft.email.trim());

  // Scrolled after the confirmation has rendered, and instantly.
  //
  // It used to smooth-scroll from inside the submit handler, while the tall
  // form was still on screen. The document then collapsed to a short
  // confirmation mid-animation, leaving the viewport parked far below the
  // new end of the page — a blank white screen until something (a click)
  // made the browser clamp the scroll back.
  useEffect(() => {
    if (done) window.scrollTo(0, 0);
  }, [done]);

  if (done) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-20 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-accent-500 text-3xl text-accent-ink shadow-card">
          ✓
        </div>
        <p className="text-lg font-medium text-ink">Request sent.</p>
        <p className="text-sm text-ink-3">
          We&apos;ll check availability for {dogs.join(" and ") || "your dog"} and email you to
          confirm. <strong className="font-medium text-ink-2">This isn&apos;t booked yet</strong> —
          please wait for our confirmation before dropping off.
        </p>
        {!embed && (
          <Link
            href={homeHref}
            className="mt-2 rounded-xl bg-accent-500 px-6 py-2.5 text-sm font-medium text-accent-ink shadow-card transition hover:bg-accent-600"
          >
            Back to the start
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className={`mx-auto max-w-2xl ${embed ? "px-4 py-6" : "px-5 py-10 sm:px-8"}`}>
      {!embed && (
        <div className="mb-8 text-center">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Boarding request
          </h1>
          <p className="mt-1 text-sm text-ink-3">
            {settings.business.name} — tell us your dates and we&apos;ll confirm by email
          </p>
        </div>
      )}

      {/* Policy up front: it sets expectations before anyone fills in dates,
          and two of these are the reasons a request gets turned down. */}
      <Section title="Before you book" step={1}>
        <ul className="space-y-2 text-sm text-ink-2">
          <li className="flex gap-2">
            <span>📅</span>
            <span>
              Please request a stay at least <strong>{NOTICE_DAYS} days</strong> ahead.
            </span>
          </li>
          <li className="flex gap-2">
            <span>📝</span>
            <span>
              Every boarding dog must have completed{" "}
              <Link href="/enroll" className="text-accent-600 underline">
                enrollment
              </Link>{" "}
              and a meet &amp; greet first, with vaccination records up to date.
            </span>
          </li>
          <li className="flex gap-2">
            <span>🐕</span>
            <span>One daycare day before a first stay is strongly recommended.</span>
          </li>
          <li className="flex gap-2">
            <span>✉️</span>
            <span>
              <strong>Wait for our confirmation before dropping off.</strong> Sending this form
              doesn&apos;t hold the dates.
            </span>
          </li>
        </ul>
        <label className="mt-3 flex items-start gap-2">
          <input
            type="checkbox"
            checked={draft.policyAgreed}
            onChange={(e) => set("policyAgreed", e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-accent-500 focus:ring-accent-100"
          />
          <span className="text-sm text-ink-2">
            I&apos;ve read the above.<span className="ml-0.5 text-rose-500">*</span>
          </span>
        </label>
      </Section>

      {/* Owner */}
      <Section title="Your details" step={2}>
        {/* Signed in, so these came from the account rather than from
            somebody typing them again. Shown back rather than asked: this is
            also how a household ends up in the book twice, under two
            spellings of the same name. */}
        {lockContact ? (
          <div className="rounded-xl border border-line-soft bg-surface-2 px-3.5 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
              Sending as
            </p>
            <p className="mt-1 text-sm text-ink-2">
              {[draft.owner_name, draft.last_name].filter(Boolean).join(" ") || "Your account"}
              <span className="text-ink-3">
                {draft.phone ? ` · ${draft.phone}` : ""}
                {draft.email ? ` · ${draft.email}` : ""}
              </span>
            </p>
            <p className="mt-1 text-[11px] text-ink-3">
              Change these under{" "}
              <Link href="/account/details" className="text-accent-600 underline">
                Your details
              </Link>
              .
            </p>
          </div>
        ) : (
        <>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name" required>
            <input
              value={draft.owner_name}
              onChange={(e) => set("owner_name", e.target.value)}
              autoComplete="given-name"
              className={inputClass}
            />
          </Field>
          <Field label="Last name" required>
            <input
              value={draft.last_name}
              onChange={(e) => set("last_name", e.target.value)}
              autoComplete="family-name"
              className={inputClass}
            />
          </Field>
          <Field label="Phone number" required>
            <input
              value={draft.phone}
              onChange={(e) => set("phone", formatPhoneInput(e.target.value))}
              placeholder="(123) 456-7890"
              inputMode="tel"
              autoComplete="tel"
              className={inputClass}
            />
          </Field>
          <Field label="Email" required hint="This is where the confirmation goes.">
            <input
              type="email"
              value={draft.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="name@example.com"
              autoComplete="email"
              className={inputClass}
            />
          </Field>
        </div>
        </>
        )}

        <div className="mt-3">
          {/* Not asked when the dogs are already on the account: a household
              with records here is enrolled, and asking anyway invites a "no"
              that opens an enrollment form for a dog we have had for years. */}
          {!knownDogs?.length && (
          <Field label={`Is your dog already enrolled with ${settings.business.name}?`} required>
            <YesNo
              value={draft.alreadyEnrolled}
              onChange={(v) => set("alreadyEnrolled", v)}
            />
          </Field>
          )}
          {/* Not a dead end any more.
              Sending someone away to another form lost everything they had
              already typed and lost the booking with it. The enrollment form
              opens here instead, carrying their details across, and the dates
              below stay open — both can be sent in one sitting and staff
              approve the enrollment and the stay together. */}
          {draft.alreadyEnrolled === false && (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
              <p className="text-sm font-medium text-amber-900">
                {enrollmentSent
                  ? "✓ Enrollment sent — now finish your dates below."
                  : "Let's get them enrolled at the same time."}
              </p>
              <p className="mt-1 text-xs text-amber-800">
                {enrollmentSent
                  ? "We'll review the profile and your requested dates together."
                  : "Every boarding dog needs an enrollment form and a meet & greet on file. " +
                    "Fill it in here — we've carried over what you have already typed — and " +
                    "request your dates below. You can send both now; we'll confirm the stay " +
                    "once the enrollment is approved."}
              </p>
              {!enrollmentSent &&
                (contactReady ? (
                  <button
                    type="button"
                    onClick={() => setShowEnrollment((v) => !v)}
                    className="mt-3 inline-block rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-amber-700"
                  >
                    {showEnrollment ? "Hide the enrollment form" : "Open the enrollment form"}
                  </button>
                ) : (
                  // The enrollment reuses the details above rather than
                  // asking twice, so it cannot open until they are there —
                  // otherwise it would fail validation on fields the person
                  // can no longer see.
                  <p className="mt-3 text-xs font-medium text-amber-900">
                    Fill in your name, phone and email above, then the enrollment form opens here.
                  </p>
                ))}
            </div>
          )}

          {draft.alreadyEnrolled === false && showEnrollment && !enrollmentSent && (
            <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface">
              <EnrollmentForm
                ref={enrollmentRef}
                source="web"
                embed
                lockContact
                hideSubmit
                onDogNamesChange={(names) =>
                  setDraft((d) => ({ ...d, dogNames: names.length ? names : [""] }))
                }
                prefill={{
                  owner_name: draft.owner_name,
                  last_name: draft.last_name,
                  phone: draft.phone,
                  email: draft.email,
                  dogNames: draft.dogNames,
                }}
                onSubmitted={() => {
                  setEnrollmentSent(true);
                  setShowEnrollment(false);
                }}
              />
            </div>
          )}
        </div>
      </Section>

      {/* The rest of the form stays open whether or not the dog is enrolled.
          A request from a new client is worth having: staff can see the dates
          they want while they review the enrollment, rather than losing the
          booking to a redirect. */}
      <>
      {/* Dogs and dates */}
      <Section title="Dogs and dates" step={3}>
        {knownDogs?.length ? (
          // Ticked, not typed. The approval matches each name against the
          // dogs on the number, so a stay requested for "Bailey" when the
          // profile says "Baley" arrives unmatched and has to be sorted out
          // by hand — and the account already knows the spelling.
          <Field label="Who is coming?" required>
            <div className="space-y-1.5">
              {knownDogs.map((name) => (
                <label key={name} className="flex items-center gap-2 text-sm text-ink-2">
                  <input
                    type="checkbox"
                    checked={draft.dogNames.includes(name)}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        dogNames: e.target.checked
                          ? [...d.dogNames.filter((n) => n !== name), name]
                          : d.dogNames.filter((n) => n !== name),
                      }))
                    }
                    className="h-4 w-4 shrink-0 rounded border-line text-accent-500 focus:ring-accent-100"
                  />
                  <span>{name}</span>
                </label>
              ))}
            </div>
          </Field>
        ) : enrollingHere ? (
          // The enrollment above already named them, and naming them twice is
          // how the two submissions end up disagreeing about who is coming.
          <div className="rounded-xl border border-line-soft bg-surface-2 px-3.5 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
              Dogs from your enrollment
            </p>
            <p className="mt-1 text-sm text-ink-2">
              {cleanDogNames(draft).join(" · ") || "Add your dog in the enrollment form above"}
            </p>
            <p className="mt-1 text-[11px] text-ink-3">
              Add another dog up there and it appears here too.
            </p>
          </div>
        ) : (
          <>
        <div className="space-y-2">
          {draft.dogNames.map((name, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1">
                <Field label={i === 0 ? "Dog's name" : `Additional dog`} required={i === 0}>
                  <input
                    value={name}
                    onChange={(e) => setDogName(i, e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>
              {draft.dogNames.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setDraft((d) => ({ ...d, dogNames: d.dogNames.filter((_, x) => x !== i) }))
                  }
                  className="mb-0.5 rounded-xl border border-line px-3 py-2.5 text-xs text-ink-3 hover:border-rose-300 hover:text-rose-500"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setDraft((d) => ({ ...d, dogNames: [...d.dogNames, ""] }))}
          className="mt-2 w-full rounded-xl border border-dashed border-line px-3 py-2 text-xs font-medium text-ink-3 transition hover:border-accent-400 hover:text-accent-600"
        >
          + Add another dog
        </button>
          </>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Drop-off date" required>
            <DateField
              value={draft.start_date}
              onChange={(v) => set("start_date", v)}
              className={inputClass}
              ariaLabel="Drop-off date"
            />
          </Field>
          <Field label="Pick-up date" required>
            <DateField
              value={draft.end_date}
              onChange={(v) => set("end_date", v)}
              className={inputClass}
              ariaLabel="Pick-up date"
            />
          </Field>
        </div>

        {nights > 0 && (
          <p className="mt-2 text-xs font-medium text-ink-2">
            {prettyDateKey(draft.start_date)} → {prettyDateKey(draft.end_date)} ·{" "}
            {nights} night{nights === 1 ? "" : "s"}
          </p>
        )}
        {/* Warned, not blocked — staff can still take a short-notice stay. */}
        {isShortNotice(draft.start_date) && noticeDays(draft.start_date) >= 0 && (
          <p className="mt-2 rounded-xl bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
            That&apos;s less than {NOTICE_DAYS} days away. Send it through and we&apos;ll do our
            best, but we may not be able to fit it in.
          </p>
        )}
      </Section>

      {/* Extras */}
      <Section title="Anything else?" step={4}>
        <Field label="Additional services" hint="Leave all unticked if none are needed.">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {BOARDING_SERVICES.map((s) => (
              <label key={s.key} className="flex items-center gap-2 text-sm text-ink-2">
                <input
                  type="checkbox"
                  checked={draft.services.includes(s.key)}
                  onChange={(e) => toggleService(s.key, e.target.checked)}
                  className="h-4 w-4 shrink-0 rounded border-line text-accent-500 focus:ring-accent-100"
                />
                <span>{s.label}</span>
              </label>
            ))}
          </div>
        </Field>

        {draft.services.includes("walk") && (
          <div className="mt-3">
            <Field label="How many walks a day?" required>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: MAX_WALKS_PER_DAY }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => set("walksPerDay", n)}
                    className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
                      draft.walksPerDay === n
                        ? "border-accent-500 bg-accent-500 text-accent-ink shadow-card"
                        : "border-line bg-surface text-ink-2 hover:border-accent-300"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        )}

        {draft.services.includes("medication") && (
          <div className="mt-3">
            <Field label="Medication details" required hint="What, how much, and when.">
              <textarea
                value={draft.medicationInstructions}
                onChange={(e) => set("medicationInstructions", e.target.value)}
                rows={2}
                className={inputClass}
              />
            </Field>
          </div>
        )}

        <PriceDisclaimer draft={draft} />

        <div className="mt-3 grid gap-3">
          <Field label="Feeding instructions" required>
            <textarea
              value={draft.feedingInstructions}
              onChange={(e) => set("feedingInstructions", e.target.value)}
              rows={2}
              placeholder="How much, how often, anything to avoid"
              className={inputClass}
            />
          </Field>
          <Field label="Any other service you'd like?">
            <input
              value={draft.otherServices}
              onChange={(e) => set("otherServices", e.target.value)}
              placeholder="Something not listed above"
              className={inputClass}
            />
          </Field>
          <Field label="Comments or questions">
            <textarea
              value={draft.comments}
              onChange={(e) => set("comments", e.target.value)}
              rows={3}
              className={inputClass}
            />
          </Field>
        </div>
      </Section>

      {error && (
        <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <BusyButton
          busy={submitting}
          busyLabel="Sending your request…"
          onClick={handleSubmit}
        >
          {enrollingHere ? "Send enrollment & request dates" : "Request these dates"}
        </BusyButton>
        <p className="text-xs text-ink-3">
          We&apos;ll email you to confirm — nothing is held until then.
        </p>
        {!embed && (
          <Link href={homeHref} className="ml-auto text-xs font-medium text-ink-3 hover:text-ink-2">
            Back
          </Link>
        )}
      </div>
      </>
    </div>
  );
}

// A running estimate of what the stay will cost, built from the same
// pricing functions the front desk bills with — so the number a client is
// quoted here and the one they pay come from one place.
//
// The bath is quoted as a range rather than a figure: it is priced by size,
// and this form deliberately does not ask an owner to size their own dog.
function PriceDisclaimer({ draft }: { draft: BoardingRequestDraft }) {
  const nights = nightsFor(draft);
  if (!draft.start_date || !draft.end_date) return null;

  const estimate = estimateBoardingTotal(draft.start_date, draft.end_date, {
    // Bath is left out of the total on purpose — see above. It is listed
    // underneath as a range instead.
    addons: draft.services.filter((s) => s !== "bath"),
    walksPerDay: draft.walksPerDay,
    bathSize: null,
  });

  const bath = draft.services.includes("bath");
  const bathPrices = BATH_PRICES;

  return (
    <div className="mt-4 rounded-xl border border-line-soft bg-surface-2 p-3.5">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
        Estimated cost
      </p>
      <ul className="space-y-1 text-sm">
        {estimate.breakdown.map((b) => (
          <li key={b.label} className="flex items-baseline justify-between gap-3">
            <span className="text-ink-2">{b.label}</span>
            <span className="whitespace-nowrap font-medium text-ink-2">
              ${b.amount.toFixed(2)}
            </span>
          </li>
        ))}
        {bath && (
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-ink-2">Bath (by size)</span>
            <span className="whitespace-nowrap font-medium text-ink-2">
              ${bathPrices.S.toFixed(2)}–${bathPrices.L.toFixed(2)}
            </span>
          </li>
        )}
      </ul>
      <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-line-soft pt-2">
        <span className="text-sm font-semibold text-ink">
          {bath ? "Estimated total (before bath)" : "Estimated total"}
        </span>
        <span className="text-base font-semibold text-ink">${estimate.amount.toFixed(2)}</span>
      </div>
      <p className="mt-2 text-[11px] text-ink-3">
        An estimate, not a bill. {nights} night{nights === 1 ? "" : "s"} at $
        {PRICING.boardingPerNight.toFixed(2)}
        {draft.services.includes("walk") &&
          `, walks at $${BOARDING_ADDON_PRICES.walkPerWalk.toFixed(2)} each`}
        {bath && ", bath priced once we see your dog"}. The final total is worked out at pick-up
        and may change if dates or services do.
      </p>
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
