// The new-client enrollment questionnaire: its draft shape, its validation,
// and the writes it makes.
//
// Submitting does NOT create a client. The whole thing lands in
// `enrollments` as a pending row for staff to review on /requests —
// anyone on the internet can reach the public form, and a stranger's
// submission shouldn't be a bookable dog until someone has looked at it.
// Approving is what fans the answers out into `owners`, `clients`,
// `vaccinations` and `dog_docs`.
//
// The questionnaire is asked in two stages.
//
// Stage one is the public form. It asks only what is needed to decide
// whether to book a meet & greet and to hold it safely: who the household
// is, the dog basics, vaccinations with the record, the agreements and the
// signature. Stage two is a link emailed once the meet & greet has passed
// (see sendDetailsRequest) and collects the rest — the address, the vet,
// the behaviour and health questions.
//
// The draft shape is the same at both stages. A stage-one draft simply has
// the stage-two answers still empty, which is why every consumer needs the
// stage to tell "not answered" from "not yet asked".

import { getSupabase } from "@/lib/supabase";
import { prettyDateKey } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { renderTemplate, sendEmail } from "@/lib/email";
import { notifyStaff } from "@/lib/notify";
import { inviteToAccount } from "@/lib/customer";
import { activeDogs } from "@/lib/retire";
import {
  Dog,
  DogSex,
  MEET_GREET_HOURS,
  Enrollment,
  EnrollmentStage,
  EnrollmentStatus,
  FixedStatus,
  Owner,
  VACCINES,
  VaccineKey,
  isMeetGreetDay,
} from "@/types";

export type { EnrollmentStage };

// Vaccines a dog can't be enrolled without. The other entries in VACCINES
// are collected but optional — influenza and leptospirosis aren't given to
// every dog, and refusing the enrollment over them would just push clients
// into typing something false.
export const REQUIRED_VACCINES: VaccineKey[] = ["rabies", "dhpp", "bordetella"];

// Rows submitted before two-stage enrollment existed hold the whole
// questionnaire, so an absent stage means "complete", not "stage one".
//
// The column is read first and the copy inside `data` second: the copy is
// what keeps the review honest on a database where the migration has not
// been run yet, since the column does not exist there to be selected.
export function enrollmentStage(
  row: Pick<Enrollment, "stage" | "data"> | null | undefined
): EnrollmentStage {
  if (row?.stage === 1 || row?.stage === 2) return row.stage;
  const inData = (row?.data as { stage?: unknown } | null | undefined)?.stage;
  return inData === 1 ? 1 : 2;
}

/** An approved household that still owes its stage-two answers. */
export function detailsOutstanding(row: Enrollment): boolean {
  return row.status === "approved" && enrollmentStage(row) === 1 && !row.details_submitted_at;
}

// Where the details form lives. Built from the browser's own origin rather
// than a configured base URL: the app is reached on several hostnames (the
// kiosk, the staff laptop, the deployed domain) and the link has to work
// from wherever the person sending it is standing.
export function detailsLink(token: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/enroll/details/${token}`;
}

// True for the error PostgREST returns when a column does not exist —
// either in a select (42703) or in the body of a write (PGRST204).
//
// Worth handling rather than letting it throw: enrollment is the most
// important public flow in the app, and it must not start failing on an
// install where two-stage-enrollment-migration.sql has not been run yet.
export function isMissingColumn(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  return (
    err?.code === "PGRST204" ||
    err?.code === "42703" ||
    /does not exist|schema cache/i.test(err?.message ?? "")
  );
}

export interface VaccineDraft {
  given_on: string;
  expires_on: string;
}

export interface DogDraft {
  // ---- Stage one: who the dog is, and whether it can be on site --------
  dog_name: string;
  breed: string;
  birthdate: string;
  weight_lb: string;
  color: string;
  sex: DogSex | "";
  fixed: boolean | null;
  fixed_scheduled_on: string;

  // ---- Stage two: everything the meet & greet does not depend on -------
  flea_program: string;
  dog_source: string;

  growled: boolean | null;
  growled_note: string;
  bitten: boolean | null;
  bitten_note: string;
  climbed_fence: boolean | null;
  fence_height: string;
  dog_fight: boolean | null;
  dog_fight_note: string;

  health_problems: boolean | null;
  health_notes: string;
  activity_restrictions: string[];
  allergies: string[];
  sensitive_areas: boolean | null;
  sensitive_areas_note: string;

  behavior_traits: string[];
  play_style: string[];
  attendance_plan: string;
  big_dog_response: string;
  crate_trained: boolean | null;
  kennel_trained: boolean | null;

  package_interest: string;

  // ---- Stage one again -------------------------------------------------
  meet_greet_on: string;
  meet_greet_window: string;

  // Kept, and no longer asked for on the public form.
  //
  // Owners used to type five expiry dates off a certificate. They mistyped
  // them, and staff checked every one against the uploaded document anyway -
  // so it was work that produced a number nobody trusted. The form now asks
  // for the document and for the owner to confirm the three required shots
  // are current; staff read the dates off the paperwork, on the dog profile,
  // where the record is on screen beside the fields.
  //
  // The shape stays because staff still fill it in, and because enrollments
  // submitted before this change have dates in them.
  vaccines: Record<VaccineKey, VaccineDraft>;
  // The owner confirming the dog is current on rabies, DHPP and Bordetella.
  // An assertion, not a record - the uploaded document is the record, and
  // this is what makes the owner say so in as many words.
  vaccinesConfirmed: boolean;
  // The uploaded vaccination paperwork, already converted to a data URL.
  doc: { name: string; mime: string; data: string } | null;
}

export interface OwnerDraft {
  // ---- Stage one: who the household is ---------------------------------
  owner_name: string;
  last_name: string;
  phone: string;
  email: string;

  // ---- Stage two -------------------------------------------------------
  address: string;
  city: string;
  state: string;
  zip: string;
  emergency_name: string;
  emergency_phone: string;
  emergency_relation: string;
  authorized_pickup: string;
  vet_name: string;
  vet_phone: string;
  vet_address: string;
  heard_about: string;
}

export interface EnrollmentDraft {
  owner: OwnerDraft;
  dogs: DogDraft[];
  contractAgreed: boolean;
  policyAgreed: boolean;
}

function emptyVaccines(): Record<VaccineKey, VaccineDraft> {
  return Object.fromEntries(
    VACCINES.map((v) => [v.key, { given_on: "", expires_on: "" }])
  ) as Record<VaccineKey, VaccineDraft>;
}

export function emptyDog(): DogDraft {
  return {
    dog_name: "",
    breed: "",
    birthdate: "",
    weight_lb: "",
    color: "",
    sex: "",
    fixed: null,
    fixed_scheduled_on: "",
    flea_program: "",
    dog_source: "",
    growled: null,
    growled_note: "",
    bitten: null,
    bitten_note: "",
    climbed_fence: null,
    fence_height: "",
    dog_fight: null,
    dog_fight_note: "",
    health_problems: null,
    health_notes: "",
    activity_restrictions: [],
    allergies: [],
    sensitive_areas: null,
    sensitive_areas_note: "",
    behavior_traits: [],
    play_style: [],
    attendance_plan: "",
    big_dog_response: "",
    crate_trained: null,
    kennel_trained: null,
    package_interest: "",
    meet_greet_on: "",
    meet_greet_window: "",
    vaccines: emptyVaccines(),
    vaccinesConfirmed: false,
    doc: null,
  };
}

export function emptyOwner(): OwnerDraft {
  return {
    owner_name: "",
    last_name: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    emergency_name: "",
    emergency_phone: "",
    emergency_relation: "",
    authorized_pickup: "",
    vet_name: "",
    vet_phone: "",
    vet_address: "",
    heard_about: "",
  };
}

export function emptyEnrollment(): EnrollmentDraft {
  return { owner: emptyOwner(), dogs: [emptyDog()], contractAgreed: false, policyAgreed: false };
}

// The form asks gender and "spayed/neutered?" separately, which is how an
// owner thinks about it; the app stores one field. Without a sex on file
// there's no way to pick the right word, so a fixed dog of unknown sex is
// recorded as "unknown" rather than guessed at.
export function toFixedStatus(sex: DogSex | "", fixed: boolean | null): FixedStatus | null {
  if (fixed === false) return "intact";
  if (fixed !== true) return null;
  if (sex === "female") return "spayed";
  if (sex === "male") return "neutered";
  return "unknown";
}

export function ageFromBirthdate(birthdate?: string | null): string {
  if (!birthdate) return "";
  const born = new Date(`${birthdate}T12:00:00`);
  if (Number.isNaN(born.getTime())) return "";
  const now = new Date();
  let months = (now.getFullYear() - born.getFullYear()) * 12 + (now.getMonth() - born.getMonth());
  if (now.getDate() < born.getDate()) months -= 1;
  if (months < 0) return "";
  if (months < 24) return `${months} month${months === 1 ? "" : "s"}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${years} yr ${rem} mo` : `${years} years`;
}

/**
 * Stage one. Returns a human-readable problem, or "" when the draft is
 * submittable.
 *
 * Everything required here is either legally required, safety-critical, or
 * needed to identify the household. Nothing else: this form is filled in by
 * somebody who has not met the business yet, and every extra required field
 * is another reason to abandon it.
 */
export function validateEnrollment(draft: EnrollmentDraft): string {
  const o = draft.owner;
  if (!o.owner_name.trim()) return "Enter the owner's name.";
  if (!o.last_name.trim()) return "Enter the owner's last name.";
  if (o.phone.replace(/\D/g, "").length < 7) return "Enter a phone number.";
  if (!/^\S+@\S+\.\S+$/.test(o.email.trim())) return "Enter a valid email address.";

  for (const [i, d] of draft.dogs.entries()) {
    const who = draft.dogs.length > 1 ? `Dog ${i + 1}: ` : "";
    if (!d.dog_name.trim()) return `${who}enter the dog's name.`;
    if (!d.breed.trim()) return `${who}enter the breed.`;
    if (!d.birthdate) return `${who}enter the birthday.`;
    if (!d.weight_lb.trim()) return `${who}enter the weight.`;
    if (!d.color.trim()) return `${who}enter the colour.`;
    if (!d.sex) return `${who}choose a gender.`;
    if (d.fixed === null) return `${who}answer whether the dog is spayed or neutered.`;

    // Meet & greets are weekday mornings only, so a Saturday date would
    // be a booking nobody can honour.
    if (d.meet_greet_on && !isMeetGreetDay(d.meet_greet_on))
      return `${who}meet & greets are ${MEET_GREET_HOURS.toLowerCase()} — pick a weekday.`;
    if (d.meet_greet_on && !d.meet_greet_window)
      return `${who}choose an arrival window for the meet & greet.`;

    // The document and the owner saying the shots are current. The dates
    // themselves are read off that document by staff, on the dog profile.
    if (!d.doc) return `${who}upload a copy of the vaccination records.`;
    if (!d.vaccinesConfirmed) {
      const labels = REQUIRED_VACCINES.map(
        (key) => VACCINES.find((v) => v.key === key)?.label ?? key
      ).join(", ");
      return `${who}confirm the dog is up to date on ${labels}.`;
    }
  }

  if (!draft.contractAgreed) return "Read and accept the contract to continue.";
  if (!draft.policyAgreed) return "Read and accept the meet & greet policy to continue.";
  return "";
}

/**
 * Stage two, asked once the meet & greet has passed. Same rules the single
 * -stage form used to apply to these answers — by this point the household
 * has met the business, so asking properly is reasonable.
 */
export function validateEnrollmentDetails(draft: EnrollmentDraft): string {
  const o = draft.owner;
  if (!o.address.trim() || !o.city.trim() || !o.state.trim() || !o.zip.trim())
    return "Enter the full home address.";
  if (!o.emergency_name.trim() || !o.emergency_phone.trim())
    return "Enter an emergency contact name and phone number.";
  if (!o.authorized_pickup.trim())
    return "List who else may pick up — enter “nobody” if it's only you.";

  for (const [i, d] of draft.dogs.entries()) {
    const who = draft.dogs.length > 1 ? `${d.dog_name.trim() || `Dog ${i + 1}`}: ` : "";
    if (d.growled === null) return `${who}answer the growling question.`;
    if (d.bitten === null) return `${who}answer the biting question.`;
    if (d.climbed_fence === null) return `${who}answer the fence question.`;
    if (d.dog_fight === null) return `${who}answer the dog-fight question.`;
    if (d.health_problems === null) return `${who}answer the health question.`;
    if (d.sensitive_areas === null) return `${who}answer the sensitive-areas question.`;
    if (!d.behavior_traits.length) return `${who}pick at least one behaviour trait.`;
    if (!d.play_style.length) return `${who}pick at least one thing about play style.`;
    if (!d.attendance_plan.trim()) return `${who}choose how often you expect to visit.`;
    if (!d.big_dog_response.trim()) return `${who}answer how the dog is with big dogs.`;
    if (d.crate_trained === null) return `${who}answer the crate-training question.`;
    if (d.kennel_trained === null) return `${who}answer the kennel-training question.`;
  }
  return "";
}

const clean = (s: string) => s.trim() || null;

// Owner details, with blanks dropped. A household that already exists
// shouldn't have a field wiped just because this submission left it empty —
// only what was actually filled in gets written.
//
// That is also what makes this stage-safe without a stage argument: at
// stage one the address, the vet and the emergency contact have not been
// asked yet, so they are blank, so they are not written.
export function ownerPatch(o: OwnerDraft): Partial<Owner> {
  const patch: Record<string, string | null> = {
    owner_name: clean(`${o.owner_name.trim()}`),
    email: clean(o.email),
    address: clean(o.address),
    city: clean(o.city),
    state: clean(o.state),
    zip: clean(o.zip),
    emergency_name: clean(o.emergency_name),
    emergency_phone: clean(o.emergency_phone),
    emergency_relation: clean(o.emergency_relation),
    vet_name: clean(o.vet_name),
    vet_phone: clean(o.vet_phone),
    vet_address: clean(o.vet_address),
    heard_about: clean(o.heard_about),
  };
  for (const k of Object.keys(patch)) if (patch[k] === null) delete patch[k];
  return patch as Partial<Owner>;
}

// What stage one knows about the dog: who it is, and when the household
// would like to come in.
function stageOneDogPatch(d: DogDraft, o: OwnerDraft): Partial<Dog> {
  const weight = parseFloat(d.weight_lb);
  return {
    dog_name: d.dog_name.trim(),
    last_name: o.last_name.trim(),
    drop_off_by: o.owner_name.trim(),
    breed: clean(d.breed),
    birthdate: d.birthdate || null,
    weight_lb: Number.isFinite(weight) ? weight : null,
    color: clean(d.color),
    sex: d.sex || null,
    fixed_status: toFixedStatus(d.sex, d.fixed),
    // Only meaningful for a dog that isn't fixed yet; clearing it otherwise
    // stops a stale appointment hanging around after the surgery happens.
    fixed_scheduled_on: d.fixed === false ? d.fixed_scheduled_on || null : null,
    meet_greet_on: d.meet_greet_on || null,
    meet_greet_window: d.meet_greet_on ? clean(d.meet_greet_window) : null,
  };
}

// The rest, which the details form collects after the meet & greet.
//
// Kept separate so the stage-two merge writes only these: by then a dog has
// been on site, and staff may well have corrected its weight or its breed on
// the profile. Re-writing stage one from the owner's original answers would
// quietly undo that.
//
// It doubles as the whitelist the public details route writes through, which
// is the other reason it is a list rather than a spread — see the route.
export function stageTwoDogPatch(d: DogDraft, o: OwnerDraft): Partial<Dog> {
  return {
    flea_program: clean(d.flea_program),
    dog_source: clean(d.dog_source),
    authorized_pickup: clean(o.authorized_pickup),
    growled: d.growled,
    growled_note: d.growled ? clean(d.growled_note) : null,
    bitten: d.bitten,
    bitten_note: d.bitten ? clean(d.bitten_note) : null,
    climbed_fence: d.climbed_fence,
    fence_height: d.climbed_fence ? clean(d.fence_height) : null,
    dog_fight: d.dog_fight,
    dog_fight_note: d.dog_fight ? clean(d.dog_fight_note) : null,
    health_problems: d.health_problems,
    health_notes: d.health_problems ? clean(d.health_notes) : null,
    activity_restrictions: d.activity_restrictions,
    allergies: d.allergies,
    sensitive_areas: d.sensitive_areas,
    sensitive_areas_note: d.sensitive_areas ? clean(d.sensitive_areas_note) : null,
    behavior_traits: d.behavior_traits,
    play_style: d.play_style,
    attendance_plan: clean(d.attendance_plan),
    big_dog_response: clean(d.big_dog_response),
    crate_trained: d.crate_trained,
    kennel_trained: d.kennel_trained,
    package_interest: clean(d.package_interest),
  };
}

// The stage-two columns, taken from the patch itself so the two lists cannot
// drift apart as questions are added.
const STAGE_TWO_KEYS = Object.keys(stageTwoDogPatch(emptyDog(), emptyOwner())) as (keyof Dog)[];

const isBlankAnswer = (v: unknown) =>
  v == null || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * Drops the stage-two answers this submission does not actually have, so
 * approving one cannot blank what is already on the dog.
 *
 * The same rule ownerPatch has always followed, and for a sharper reason. A
 * household adding another dog from the portal files at stage two — their
 * address and vet are on file, so the enrollment is complete. But "complete"
 * there is a fact about the OWNER, and the form asks nothing about the dog
 * beyond stage one: no allergies, no bite history, no restrictions. Approving
 * it onto a dog of the same name therefore wrote `allergies: []` and
 * `activity_restrictions: []` over a live profile — erasing a peanut allergy
 * and a "no hard play" note in the course of adding a second dog.
 *
 * Only for updates. On an insert these blanks are simply the starting state,
 * and only in applyEnrollment: the details form asks these questions for real,
 * so an owner correcting an answer to "none" there must still be able to.
 */
export function withoutBlankAnswers(patch: Partial<Dog>): Partial<Dog> {
  const out = { ...patch };
  for (const key of STAGE_TWO_KEYS) {
    if (isBlankAnswer(out[key])) delete out[key];
  }
  return out;
}

// Everything the given stage has actually asked. At stage one the stage-two
// columns are left alone rather than written as nulls and empty arrays: on a
// dog profile, null means "never asked", and that is exactly what they are.
export function dogPatch(d: DogDraft, o: OwnerDraft, stage: EnrollmentStage = 2): Partial<Dog> {
  return stage === 1
    ? stageOneDogPatch(d, o)
    : { ...stageOneDogPatch(d, o), ...stageTwoDogPatch(d, o) };
}

// The owner columns the details form is allowed to fill in, and only those.
//
// Not ownerPatch: that one also carries the name and the email, which are
// stage one's and identify the household. The details form is a public page
// behind nothing but a link, and a link should not be able to change the
// address a confirmation goes to.
export function stageTwoOwnerPatch(o: OwnerDraft): Partial<Owner> {
  const patch: Record<string, string | null> = {
    address: clean(o.address),
    city: clean(o.city),
    state: clean(o.state),
    zip: clean(o.zip),
    emergency_name: clean(o.emergency_name),
    emergency_phone: clean(o.emergency_phone),
    emergency_relation: clean(o.emergency_relation),
    vet_name: clean(o.vet_name),
    vet_phone: clean(o.vet_phone),
    vet_address: clean(o.vet_address),
    heard_about: clean(o.heard_about),
  };
  for (const k of Object.keys(patch)) if (patch[k] === null) delete patch[k];
  return patch as Partial<Owner>;
}

// Files the form to the review queue. Nothing else in the app can see the
// household yet — the kiosk still won't find them by phone.
export async function submitForApproval(
  draft: EnrollmentDraft,
  signature: string,
  source: "kiosk" | "web",
  // True when the household already answered stage two — an existing client
  // adding another dog. Their address, vet and emergency contact are on
  // file; asking again would be asking a question we know the answer to, and
  // it would send them a "finish your enrollment" email for an enrollment
  // that is finished. The submission is filed complete instead.
  detailsOnFile = false
): Promise<void> {
  const supabase = getSupabase();
  const stage = detailsOnFile ? 2 : 1;
  const row = {
    phone: draft.owner.phone.trim(),
    owner_name: draft.owner.owner_name.trim(),
    last_name: draft.owner.last_name.trim(),
    dog_names: draft.dogs.map((d) => d.dog_name.trim()),
    status: "pending",
    source,
    // The draft is stored whole rather than spread across columns: the
    // review page wants to show exactly what was submitted, and questions
    // will be added to the form over time without a migration each round.
    //
    // The stage is written inside `data` as well as into its own column so
    // that a submission still says which half of the questionnaire it holds
    // on an install where the migration has not been run.
    data: { ...draft, signature, stage },
  };
  const { error } = await supabase.from("enrollments").insert({
    ...row,
    stage,
    // Stamped so nothing later reads this as still owing its second half:
    // detailsOutstanding checks exactly this, and it is what decides whether
    // the meet & greet pass emails a form.
    ...(detailsOnFile ? { details_submitted_at: new Date().toISOString() } : {}),
  });
  if (!error) return;
  // Without the migration there is no `stage` column. File the form anyway:
  // losing a client's enrollment over a column that only staff screens read
  // would be much the worse failure.
  if (!isMissingColumn(error)) throw error;
  console.warn("enrollments.stage is missing — run two-stage-enrollment-migration.sql");
  const { error: retryError } = await supabase.from("enrollments").insert(row);
  if (retryError) throw retryError;
}

// "Buki", "Buki and Mochi", "Buki, Mochi and Nala".
function joinNames(names: string[]): string {
  if (names.length > 1)
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return names[0] ?? "";
}

// The placeholders every enrollment email template can use.
export function templateVars(draft: EnrollmentDraft): Record<string, string> {
  const names = draft.dogs.map((d) => d.dog_name.trim()).filter(Boolean);
  return {
    owner: draft.owner.owner_name.trim() || "there",
    dogs: joinNames(names) || "your dog",
    business: getSettings().business.name,
    phone: draft.owner.phone.trim(),
    meetgreet: meetGreetWhen(draft),
  };
}

/**
 * When the household asked to come in — "Mon, Aug 24, 8:00–10:30 am".
 *
 * Falls back to a phrase rather than an empty string, because a requested
 * date is optional on the form and a sentence built around a blank reads as
 * a bug: "You asked for  — reply here if that no longer suits." Both values
 * are written to sit in the same sentence, so whoever edits the template
 * only has to make one version of it read well.
 *
 * Taken from the first dog that has one. A household books one visit and
 * brings its dogs to it; two different dates would be two enrollments.
 */
function meetGreetWhen(draft: EnrollmentDraft): string {
  const dog = draft.dogs.find((d) => d.meet_greet_on?.trim());
  if (!dog) return "a time we still need to arrange";
  const day = prettyDateKey(dog.meet_greet_on);
  const window = dog.meet_greet_window?.trim();
  return window ? `${day}, ${window}` : day;
}

// The same placeholders, from the queue row rather than the submitted draft.
// Used where the columns are all that has been loaded.
function rowTemplateVars(row: Enrollment): Record<string, string> {
  const names = (row.dog_names ?? []).map((n) => n.trim()).filter(Boolean);
  return {
    owner: row.owner_name?.trim() || "there",
    dogs: joinNames(names) || "your dog",
    business: getSettings().business.name,
    phone: row.phone?.trim() ?? "",
    // Present but empty on purpose. renderTemplate leaves an unknown
    // placeholder in the message as literal text, so a template using
    // {{meetgreet}} would email somebody "{{meetgreet}}" from this path —
    // which is only used after the meet & greet has already happened, when
    // there is nothing to announce anyway.
    meetgreet: "",
  };
}

// Fired straight after a submission. Deliberately never throws: the form
// has already been filed, and telling a client their enrollment failed
// because an email bounced would be a lie.
export async function sendAcknowledgement(draft: EnrollmentDraft): Promise<void> {
  const { email } = getSettings();
  if (!email.autoAcknowledge || !draft.owner.email.trim()) return;
  const vars = templateVars(draft);
  const result = await sendEmail({
    to: draft.owner.email.trim(),
    subject: renderTemplate(email.ackSubject, vars),
    body: renderTemplate(email.ackBody, vars),
    kind: "enrollment.received",
  });
  if (result.error) console.error("Acknowledgement email failed:", result.error);
}

// Tells staff a form arrived. Separate from the client acknowledgement:
// that one is optional courtesy, this one is how anybody finds out.
export async function notifyStaffOfEnrollment(draft: EnrollmentDraft): Promise<void> {
  const names = draft.dogs.map((d) => d.dog_name.trim()).filter(Boolean);
  try {
    await notifyStaff({
      kind: "enrollment",
      who: `${draft.owner.owner_name.trim()} ${draft.owner.last_name.trim()}`.trim(),
      dogs: names.join(", ") || "—",
      detail: `${names.length} dog${names.length === 1 ? "" : "s"}`,
      phone: draft.owner.phone.trim(),
      email: draft.owner.email.trim(),
    });
  } catch (e) {
    console.error("Staff notification failed:", e);
  }
}

export async function loadPendingCount(): Promise<number> {
  try {
    const supabase = getSupabase();
    const { count, error } = await supabase
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    if (error) throw error;
    return count ?? 0;
  } catch (e) {
    // A missing table (migration not run yet) shouldn't break the nav.
    console.error("Counting pending enrollments failed:", e);
    return 0;
  }
}

export interface EnrollmentResult {
  created: string[];
  updated: string[];
}

// Turns an approved submission into real records. The signature covers
// every dog on it, the same way the paper contract does.
//
// `stage` says how much of the questionnaire this submission actually holds:
// a stage-one form leaves the behaviour and health columns untouched rather
// than writing its own blanks over them.
export async function applyEnrollment(
  draft: EnrollmentDraft,
  signature: string,
  stage: EnrollmentStage = 2
): Promise<EnrollmentResult> {
  const supabase = getSupabase();
  const phone = draft.owner.phone.trim();
  const now = new Date().toISOString();

  const { error: ownerErr } = await supabase
    .from("owners")
    .upsert({ phone, ...ownerPatch(draft.owner) }, { onConflict: "phone" });
  if (ownerErr) throw ownerErr;

  // A household enrolling a second dog months later shouldn't end up with a
  // duplicate row for the dog they already have on file, so an existing
  // name on this number is updated in place instead.
  //
  // Retired dogs are deliberately not candidates. A household whose dog died
  // and who names the next one after it is the case this protects: matching
  // the name would update the dead dog in place, handing the new dog its
  // visits, its balance, its photo and its bite history. Skipping retired
  // rows means the new dog is inserted, and the old one keeps its own record.
  //
  // select("*") rather than a column list so this still works before
  // dog-retire-migration.sql has been run — there is no retired_at column to
  // ask for, and every dog reads as active. One household is a handful of
  // rows either way.
  const { data: existingRows, error: existingErr } = await supabase
    .from("dogs")
    .select("*")
    .eq("phone", phone);
  if (existingErr) throw existingErr;
  const existing = new Map(
    activeDogs((existingRows as Dog[]) ?? []).map((c) => [
      c.dog_name.trim().toLowerCase(),
      c.id as string,
    ])
  );

  const result: EnrollmentResult = { created: [], updated: [] };

  for (const dog of draft.dogs) {
    const patch = {
      ...dogPatch(dog, draft.owner, stage),
      phone,
      signature_data: signature,
      waiver_on_file: true,
      enrolled_at: now,
    };
    const priorId = existing.get(dog.dog_name.trim().toLowerCase());

    let dogId: string;
    if (priorId) {
      // Merged, not replaced — see withoutBlankAnswers.
      const { error } = await supabase
        .from("dogs")
        .update(withoutBlankAnswers(patch))
        .eq("id", priorId);
      if (error) throw error;
      dogId = priorId;
      result.updated.push(dog.dog_name.trim());
    } else {
      const { data, error } = await supabase
        .from("dogs")
        .insert(patch)
        .select("id")
        .single();
      if (error) throw error;
      dogId = (data as { id: string }).id;
      result.created.push(dog.dog_name.trim());
    }

    const vaccineRows = VACCINES.map((v) => ({
      dog_id: dogId,
      vaccine: v.key,
      given_on: dog.vaccines[v.key]?.given_on || null,
      expires_on: dog.vaccines[v.key]?.expires_on || null,
    })).filter((r) => r.given_on || r.expires_on);
    if (vaccineRows.length) {
      const { error } = await supabase
        .from("vaccinations")
        .upsert(vaccineRows, { onConflict: "dog_id,vaccine" });
      if (error) throw error;
    }

    if (dog.doc) {
      const { error } = await supabase.from("dog_docs").insert({
        dog_id: dogId,
        kind: "vaccination",
        file_name: dog.doc.name,
        mime_type: dog.doc.mime,
        data: dog.doc.data,
      });
      // A failed upload shouldn't throw away an otherwise complete
      // enrollment — the dates are on file and staff can chase the paperwork.
      if (error) console.error("Saving vaccination document failed:", error);
    }
  }

  return result;
}

// Approve: create the records first, then mark the row. In that order a
// failure part-way leaves the submission still pending — visibly unfinished
// and re-runnable — rather than marked done with nothing behind it. The
// re-run is safe because applyEnrollment updates a dog it already created
// instead of duplicating it.
export async function approveEnrollment(row: Enrollment): Promise<EnrollmentResult> {
  const draft = row.data as EnrollmentDraft & { signature?: string };
  const stage = enrollmentStage(row);
  const result = await applyEnrollment(draft, draft.signature ?? "", stage);
  const supabase = getSupabase();
  const done = { status: "approved", reviewed_at: new Date().toISOString(), review_note: null };
  // The details link is minted here rather than when it is sent, so the
  // token exists from the moment the household is real — staff can read it
  // down the phone to somebody whose email never arrived.
  const token = stage === 1 && !row.details_token ? newDetailsToken() : row.details_token;
  const { error } = await supabase
    .from("enrollments")
    .update(token ? { ...done, details_token: token } : done)
    .eq("id", row.id);
  if (error) {
    if (!isMissingColumn(error)) throw error;
    // No details_token column yet. Approving still has to work — it is the
    // step that makes a household bookable.
    console.warn("enrollments.details_token is missing — run two-stage-enrollment-migration.sql");
    const { error: retryError } = await supabase.from("enrollments").update(done).eq("id", row.id);
    if (retryError) throw retryError;
  }
  return result;
}

// crypto.randomUUID needs a secure context, which localhost and https both
// are — but an install reached over plain http on a LAN address is not, and
// the front desk should not lose the approve button over it.
function newDetailsToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${((Math.random() * 4) | 8).toString(16)}${hex(3)}-${hex(12)}`;
}

/**
 * Removes the submission itself.
 *
 * Only the request row goes. Anything approving it already created — the dog
 * profile, its vaccination records, the uploaded document — is real data with
 * a life of its own and stays put; deleting a form should not silently
 * un-enrol a dog that has been coming for months. Declining is the reversible
 * option, so this is for spam and duplicates.
 */
export async function deleteEnrollment(row: Enrollment): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("enrollments").delete().eq("id", row.id);
  if (error) throw error;
}

/**
 * The vaccination dates staff read off the uploaded record.
 *
 * The public form stopped asking for these — an owner uploads the document
 * and confirms the three required shots are current, and the dates are typed
 * here, on the review screen, with the certificate open beside them. They are
 * written back into the submission rather than held in the screen, so a
 * half-finished review survives a closed tab, and so the row that is finally
 * approved is the row that was read.
 */
export async function saveReviewedVaccines(
  row: Enrollment,
  dogIndex: number,
  key: VaccineKey,
  patch: Partial<VaccineDraft>
): Promise<Enrollment> {
  const draft = hydrateDraft(row);
  const dog = draft.dogs[dogIndex];
  if (!dog) throw new Error("That dog is not in this submission.");

  dog.vaccines = {
    ...dog.vaccines,
    [key]: { ...(dog.vaccines?.[key] ?? {}), ...patch },
  };

  const supabase = getSupabase();
  const { error } = await supabase
    .from("enrollments")
    .update({ data: draft })
    .eq("id", row.id);
  if (error) throw error;

  return { ...row, data: draft };
}

export async function rejectEnrollment(row: Enrollment, note: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("enrollments")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      review_note: note.trim() || null,
    })
    .eq("id", row.id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Stage two: the details form
// ---------------------------------------------------------------------------
//
// Everything below the client half of the details form talks to
// /api/enrollment-details rather than to the database.
//
// It has to. The anon key that ships in the public bundle may insert an
// enrollment and nothing else — see rls-lockdown.sql — so a browser holding
// only a token cannot read the submission back, let alone update the dog
// profiles it belongs to. Widening that policy is not an option either: a
// policy cannot tell "the row whose token you supplied" from "every row with
// a token", so any anon read of `enrollments` is a read of every applicant's
// name, phone and signature.
//
// The route runs server-side with the service key, matches the token itself,
// and writes a fixed whitelist of stage-two fields. The same shape as
// /api/email keeping the Resend key out of client JS.

/**
 * The draft as stored on a submission, filled out to the current shape.
 *
 * Everything read back out of `data` goes through here. It is a jsonb
 * document written by whichever version of the form was live at the time, so
 * a question added since is simply absent — and an absent `vaccines` or
 * `allergies` would crash a form that expects to render one. Missing keys
 * take their empty value instead.
 */
export function hydrateDraft(row: {
  data?: unknown;
  dog_names?: string[] | null;
}): EnrollmentDraft {
  const stored = (row.data ?? {}) as Partial<EnrollmentDraft>;
  const base = emptyEnrollment();
  const storedDogs = Array.isArray(stored.dogs) ? stored.dogs : [];
  // A submission with no dogs in its draft still names them on the row.
  const dogs = storedDogs.length
    ? storedDogs
    : (row.dog_names ?? []).filter((n) => n?.trim()).map((n) => ({ dog_name: n }) as DogDraft);
  return {
    ...base,
    ...stored,
    owner: { ...base.owner, ...(stored.owner ?? {}) },
    dogs: (dogs.length ? dogs : [emptyDog()]).map((d) => ({
      ...emptyDog(),
      ...d,
      vaccines: { ...emptyVaccines(), ...(d?.vaccines ?? {}) },
      // An enrollment saved before the confirmation existed has no answer to
      // give. False is the honest reading: nobody was asked.
      vaccinesConfirmed: d?.vaccinesConfirmed === true,
    })),
  };
}

/** What the public details page is given about the household. */
export interface DetailsForm {
  phone: string;
  owner_name: string;
  last_name: string;
  status: EnrollmentStatus;
  details_submitted_at: string | null;
  /**
   * Stage one's answers, to prefill and show back. Deliberately without the
   * signature and without the uploaded vaccination records: this form neither
   * shows nor changes them, and they are the heaviest and most personal part
   * of the submission.
   */
  draft: EnrollmentDraft;
}

export type DetailsFormError = "not-found" | "not-configured" | "unavailable";

/**
 * The submission a details link points at.
 *
 * Returns the reason rather than throwing, because every one of them is a
 * different thing to say to somebody standing on a public page with a link
 * their vet's waiting room gave them.
 */
export async function loadDetailsForm(
  token: string
): Promise<{ form?: DetailsForm; error?: DetailsFormError }> {
  try {
    const res = await fetch(`/api/enrollment-details?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    const body = (await res.json()) as { form?: DetailsForm; error?: DetailsFormError };
    if (res.ok && body.form) return { form: body.form };
    return { error: body.error ?? "unavailable" };
  } catch (e) {
    console.error("Loading the details form failed:", e);
    return { error: "unavailable" };
  }
}

/**
 * The approved submission for this household whose details are still
 * outstanding, or null.
 *
 * Answers the question a dog profile has to ask before it renders an empty
 * behaviour section: is this blank because nobody answered, or because
 * nobody has been asked? Never throws — a profile is still worth showing
 * without it, and on an install without the migration there is nothing to
 * find.
 */
export async function loadOutstandingDetails(phone: string): Promise<Enrollment | null> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("enrollments")
      // Deliberately not `data`: that is the whole submission including the
      // uploaded vaccination record, and this runs on every profile open.
      .select(
        "id, phone, owner_name, last_name, dog_names, status, stage, details_token, details_submitted_at, created_at"
      )
      .eq("phone", phone.trim())
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(5);
    if (error) throw error;
    return ((data as unknown as Enrollment[]) ?? []).find((r) => detailsOutstanding(r)) ?? null;
  } catch (e) {
    console.error("Checking for an outstanding details form failed:", e);
    return null;
  }
}

export interface DetailsSubmitResult {
  /** Dogs whose profile was updated. */
  updated: string[];
  /**
   * Names on the form with no profile behind them — renamed or removed by
   * staff since the enrollment was approved. The answers are still saved on
   * the submission for staff to read; only the profile write is skipped.
   */
  unmatched: string[];
}

/**
 * Sends a completed details form.
 *
 * Only the stage-two answers travel: the token is what says which household
 * this is, and the server decides what may be written from it. A public form
 * that could post its own vaccination expiry dates would be a way to walk an
 * out-of-date dog straight past the check that keeps it off site.
 */
export async function submitEnrollmentDetails(
  token: string,
  draft: EnrollmentDraft
): Promise<DetailsSubmitResult> {
  const res = await fetch("/api/enrollment-details", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, owner: draft.owner, dogs: draft.dogs }),
  });
  const body = (await res.json()) as Partial<DetailsSubmitResult> & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Saving failed (${res.status})`);
  return { updated: body.updated ?? [], unmatched: body.unmatched ?? [] };
}

export type DetailsRequestStatus =
  | "sent"
  | "no-enrollment"
  | "already-submitted"
  | "no-email"
  | "not-configured"
  | "failed";

export interface DetailsRequestResult {
  status: DetailsRequestStatus;
  /** Where it went, for the confirmation staff see. */
  to?: string;
  detail?: string;
}

/**
 * Emails a household the link to the second half of their enrollment.
 *
 * Called from one place — recording a meet & greet pass — so that when a
 * client says the form never arrived there is one place to look. Never
 * throws: the verdict on the meet & greet is the thing being saved, and it
 * must not be lost because an email bounced.
 */
export async function sendDetailsRequest(phone: string): Promise<DetailsRequestResult> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("enrollments")
      .select("*")
      .eq("phone", phone.trim())
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(5);
    if (error) throw error;

    const rows = (data as Enrollment[]) ?? [];
    // Approved but never asked for details is the state to act on. A
    // household that has already sent them back gets nothing — a second dog
    // added later rides on the answers already on file.
    const row = rows.find((r) => detailsOutstanding(r));
    if (!row) {
      return {
        status: rows.some((r) => r.details_submitted_at) ? "already-submitted" : "no-enrollment",
      };
    }

    let token = row.details_token;
    if (!token) {
      // Approved before this existed, or approved on a database without the
      // column. Mint one now so the link can be sent at all.
      token = newDetailsToken();
      const { error: tokenError } = await supabase
        .from("enrollments")
        .update({ details_token: token })
        .eq("id", row.id);
      if (tokenError) throw tokenError;
    }

    const draft = row.data as (EnrollmentDraft & { signature?: string }) | null;
    const to = draft?.owner?.email?.trim() ?? "";
    if (!to) return { status: "no-email" };

    // Where the link points is the whole of this change.
    //
    // It used to be /enroll/details/<token>: a public page holding the rest
    // of the household questionnaire, reachable by anyone the mail was
    // forwarded to. Now it is the invitation to their ACCOUNT. They choose a
    // password, sign in, and the portal puts the same form in front of them
    // and will not let them past it - so the answers arrive over a session
    // rather than over a link, and the household ends up with the portal it
    // was going to need anyway.
    //
    // Falling back to the old link is deliberate rather than lazy. A
    // household with no owner row yet, or one whose invitation cannot be
    // issued, must still be able to finish enrolling; the alternative is a
    // client stuck with no way to send their details and no way to tell.
    // Only invite them to an account that exists.
    //
    // This asked for an invitation unconditionally and fell back to the
    // details link only when issuing one FAILED. Client accounts are now
    // something a business switches on, and with them off the invitation
    // still succeeds — a token is written, a link comes back — but the page
    // it points at redirects to the home page. So a household that had just
    // passed its meet and greet got an email, clicked it, and landed on the
    // website with nothing to do and no way to finish enrolling.
    //
    // The details form is not behind the portal, so it works either way.
    const { portal, email } = getSettings();
    const account = portal.enabled ? await inviteToAccount(phone) : { link: null };
    const link = account.link ?? detailsLink(token);
    const vars = { ...rowTemplateVars(row), link };
    const result = await sendEmail({
      to,
      subject: renderTemplate(email.detailsRequestSubject, vars),
      body: renderTemplate(email.detailsRequestBody, vars),
      // The account invitation motif when that is what it is, so the message
      // looks like what it asks for.
      kind: account.link ? "account.invite" : "enrollment.details",
    });
    if (result.skipped) return { status: "not-configured", to };
    if (result.error) return { status: "failed", to, detail: result.error };
    return { status: "sent", to };
  } catch (e) {
    console.error("Sending the details form failed:", e);
    return {
      status: "failed",
      detail: isMissingColumn(e) ? "run two-stage-enrollment-migration.sql" : undefined,
    };
  }
}
