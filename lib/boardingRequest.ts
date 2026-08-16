// The client-facing boarding request: its shape, validation, and the writes
// it makes.
//
// Same architecture as lib/enrollment.ts, and for the same reason —
// submitting does NOT book anything. The request lands in
// `boarding_requests` as pending, the calendar stays untouched, and nothing
// is held until staff confirm it. Approving is what creates the real
// `boardings` rows, one per dog.

import { getSupabase } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { renderTemplate, sendEmail } from "@/lib/email";
import { notifyStaff } from "@/lib/notify";
import { nightsBetweenKeys } from "@/lib/pricing";
import { prettyDateKey, todayKey } from "@/lib/dates";
import { Boarding, BoardingAddonKey, BoardingRequest, Dog } from "@/types";
import { activeDogs } from "@/lib/retire";

// The facility asks for two days' warning. It is a request, not a rule —
// staff can still take a last-minute stay — so a short-notice booking is
// flagged rather than refused.
export const NOTICE_DAYS = 2;

// More than this in a day stops being a walk schedule and starts being a
// data-entry mistake. Staff can always add more on the reservation.
export const MAX_WALKS_PER_DAY = 4;

/**
 * Where a request came from. Staff reading the queue want to know whether
 * somebody stood at the front desk, filled it in on the website, or sent it
 * from their own account — the last of those is the only one where the
 * household is already known rather than typed.
 */
export type BoardingRequestSource = "kiosk" | "web" | "portal";

export interface BoardingRequestDraft {
  owner_name: string;
  last_name: string;
  phone: string;
  email: string;
  // What the client believes. The review screen checks it against the
  // database rather than trusting it, but a "no" is still a useful signal.
  alreadyEnrolled: boolean | null;
  dogNames: string[];
  start_date: string;
  end_date: string;
  services: BoardingAddonKey[];
  // Only meaningful when services includes "walk". Priced per walk per
  // night, so it has to be asked rather than assumed.
  walksPerDay: number;
  otherServices: string;
  medicationInstructions: string;
  feedingInstructions: string;
  comments: string;
  policyAgreed: boolean;
}

export function emptyBoardingRequest(): BoardingRequestDraft {
  return {
    owner_name: "",
    last_name: "",
    phone: "",
    email: "",
    alreadyEnrolled: null,
    dogNames: [""],
    start_date: "",
    end_date: "",
    services: [],
    walksPerDay: 1,
    otherServices: "",
    medicationInstructions: "",
    feedingInstructions: "",
    comments: "",
    policyAgreed: false,
  };
}

export function cleanDogNames(draft: BoardingRequestDraft): string[] {
  return draft.dogNames.map((n) => n.trim()).filter(Boolean);
}

/** Whole days between today and drop-off. Negative means it is in the past. */
export function noticeDays(startDate: string): number {
  if (!startDate) return 0;
  const start = new Date(`${startDate}T12:00:00`).getTime();
  const today = new Date(`${todayKey()}T12:00:00`).getTime();
  return Math.round((start - today) / 86_400_000);
}

export function isShortNotice(startDate: string): boolean {
  return !!startDate && noticeDays(startDate) < NOTICE_DAYS;
}

/** Returns a human-readable problem, or "" when the draft is submittable. */
export function validateBoardingRequest(draft: BoardingRequestDraft): string {
  if (!draft.owner_name.trim()) return "Enter your first name.";
  if (!draft.last_name.trim()) return "Enter your last name.";
  if (draft.phone.replace(/\D/g, "").length < 7) return "Enter a phone number.";
  if (!/^\S+@\S+\.\S+$/.test(draft.email.trim())) return "Enter a valid email address.";
  if (draft.alreadyEnrolled === null)
    return "Let us know whether your dog is already enrolled with us.";
  // A dog that is not enrolled yet no longer blocks the request. The form
  // offers the enrollment alongside it, and both arrive together for staff to
  // approve in one go — turning a new client away at this point lost the
  // booking as well as the enrollment.
  //
  // The answer is still taken on trust rather than looked up: this form is
  // public, and probing it with phone numbers should not reveal who is a
  // client. Staff see the real check against the database when they review.

  const dogs = cleanDogNames(draft);
  if (!dogs.length) return "Enter your dog's name.";
  const seen = new Set(dogs.map((d) => d.toLowerCase()));
  if (seen.size !== dogs.length) return "Each dog needs a different name.";

  if (!draft.start_date) return "Choose a drop-off date.";
  if (!draft.end_date) return "Choose a pick-up date.";
  if (draft.end_date < draft.start_date) return "Pick-up has to be on or after drop-off.";
  if (draft.start_date < todayKey()) return "Drop-off can't be in the past.";

  if (draft.services.includes("walk") && !(draft.walksPerDay >= 1 && draft.walksPerDay <= MAX_WALKS_PER_DAY))
    return `Choose between 1 and ${MAX_WALKS_PER_DAY} walks a day.`;

  if (draft.services.includes("medication") && !draft.medicationInstructions.trim())
    return "Tell us what medication your dog needs and when.";

  // A dog staying overnight has to be fed, and "we will ask at drop-off" is
  // how that ends up being guessed at seven in the evening by whoever is on
  // shift. Asked here, while the person who knows the answer is the one
  // filling the form in.
  if (!draft.feedingInstructions.trim())
    return "Tell us how your dog is fed — how much, how often, and anything to avoid.";

  if (!draft.policyAgreed) return "Please confirm you've read the boarding policy.";
  return "";
}

export function nightsFor(draft: BoardingRequestDraft): number {
  if (!draft.start_date || !draft.end_date) return 0;
  return nightsBetweenKeys(draft.start_date, draft.end_date);
}

// Placeholders the boarding email templates can use.
export function boardingTemplateVars(draft: BoardingRequestDraft): Record<string, string> {
  const names = cleanDogNames(draft);
  const nights = nightsFor(draft);
  return {
    owner: draft.owner_name.trim() || "there",
    dogs:
      names.length > 1
        ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
        : (names[0] ?? "your dog"),
    business: getSettings().business.name,
    phone: draft.phone.trim(),
    dropoff: draft.start_date ? prettyDateKey(draft.start_date) : "",
    pickup: draft.end_date ? prettyDateKey(draft.end_date) : "",
    nights: String(nights),
  };
}

/**
 * Files the request as pending. Nothing is booked here, by design.
 *
 * No .select() on the insert, and that is load-bearing rather than a style
 * choice. Neither a signed-out visitor nor a signed-in client has a select
 * policy on this table, and Postgres treats a RETURNING clause as a read —
 * asking for the row back would turn a working submission into a refusal for
 * everybody except staff. See the note on "public submit" in
 * rls-lockdown.sql.
 *
 * From the portal, owner_id and the phone number are stamped by the
 * fill_owner_id trigger from the SESSION rather than taken from this
 * payload, so a request cannot arrive claiming to be from a household it is
 * not.
 */
export async function submitBoardingRequest(
  draft: BoardingRequestDraft,
  source: BoardingRequestSource
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("boarding_requests").insert({
    phone: draft.phone.trim(),
    owner_name: draft.owner_name.trim(),
    last_name: draft.last_name.trim(),
    email: draft.email.trim() || null,
    dog_names: cleanDogNames(draft),
    start_date: draft.start_date,
    end_date: draft.end_date,
    status: "pending",
    source,
    data: draft,
  });
  if (error) throw error;
}

// Never throws: the request is already filed, and telling a client their
// booking failed because an email bounced would be wrong.
export async function sendBoardingAcknowledgement(draft: BoardingRequestDraft): Promise<void> {
  const { email } = getSettings();
  if (!email.autoAcknowledge || !draft.email.trim()) return;
  const vars = boardingTemplateVars(draft);
  const result = await sendEmail({
    to: draft.email.trim(),
    subject: renderTemplate(email.boardingAckSubject, vars),
    body: renderTemplate(email.boardingAckBody, vars),
    kind: "boarding.requested",
  });
  if (result.error) console.error("Boarding acknowledgement email failed:", result.error);
}

export async function notifyStaffOfBoarding(draft: BoardingRequestDraft): Promise<void> {
  const nights = nightsFor(draft);
  const short = isShortNotice(draft.start_date) ? "  ** SHORT NOTICE **" : "";
  try {
    await notifyStaff({
      kind: "boarding",
      who: `${draft.owner_name.trim()} ${draft.last_name.trim()}`.trim(),
      dogs: cleanDogNames(draft).join(", ") || "—",
      detail: `${prettyDateKey(draft.start_date)} to ${prettyDateKey(draft.end_date)}, ${nights} night${nights === 1 ? "" : "s"}${short}`,
      phone: draft.phone.trim(),
      email: draft.email.trim(),
    });
  } catch (e) {
    console.error("Staff notification failed:", e);
  }
}

export async function loadPendingBoardingCount(): Promise<number> {
  try {
    const supabase = getSupabase();
    const { count, error } = await supabase
      .from("boarding_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    if (error) throw error;
    return count ?? 0;
  } catch (e) {
    // A missing table (migration not run yet) shouldn't break the nav.
    console.error("Counting boarding requests failed:", e);
    return 0;
  }
}

// Which dogs on this number the app already knows about. Used on review to
// check the client's own "already enrolled?" answer against reality, since
// a stay can't be honoured for a dog with no profile.
export async function matchDogs(
  phone: string,
  dogNames: string[]
): Promise<{ name: string; dog: Dog | null }[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("dogs").select("*").eq("phone", phone.trim());
  if (error) throw error;
  // A request naming "Buki" means the Buki they have now, not the one that
  // passed away and left its name on an old row.
  const dogs = activeDogs((data as Dog[]) ?? []);
  return dogNames.map((name) => ({
    name,
    dog:
      dogs.find((c) => c.dog_name.trim().toLowerCase() === name.trim().toLowerCase()) ?? null,
  }));
}

export interface BoardingApproval {
  created: string[];
  /** Names with no client profile — booked anyway, but worth flagging. */
  unmatched: string[];
}

// Creates one reservation per dog. Anything the client typed that the
// reservation has no field for is folded into `notes`, so it reaches the
// staff reading the stay sheet rather than being lost with the request.
export async function approveBoardingRequest(row: BoardingRequest): Promise<BoardingApproval> {
  const draft = row.data as BoardingRequestDraft;
  const supabase = getSupabase();
  const names = cleanDogNames(draft);
  const matches = await matchDogs(draft.phone, names);

  const extraNotes = [
    draft.comments.trim() ? `Client comments: ${draft.comments.trim()}` : "",
    draft.otherServices.trim() ? `Also asked for: ${draft.otherServices.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const rows: Omit<Boarding, "id" | "created_at">[] = matches.map((m) => ({
    dog_name: m.name,
    last_name: draft.last_name.trim(),
    phone: draft.phone.trim(),
    dog_id: m.dog?.id ?? null,
    start_date: draft.start_date,
    end_date: draft.end_date,
    feeding_instructions: draft.feedingInstructions.trim(),
    notes: extraNotes,
    addons: draft.services,
    walks_per_day: draft.services.includes("walk") ? Math.max(1, draft.walksPerDay || 1) : null,
    bath_size: null,
    medication_instructions: draft.services.includes("medication")
      ? draft.medicationInstructions.trim() || null
      : null,
  }));

  // Reservations first, then the status flip — a failure part-way leaves
  // the request visibly pending rather than marked done with no booking
  // behind it.
  const { error: insertErr } = await supabase.from("boardings").insert(rows);
  if (insertErr) throw insertErr;

  const { error: statusErr } = await supabase
    .from("boarding_requests")
    .update({ status: "approved", reviewed_at: new Date().toISOString(), review_note: null })
    .eq("id", row.id);
  if (statusErr) throw statusErr;

  return {
    created: names,
    unmatched: matches.filter((m) => !m.dog).map((m) => m.name),
  };
}

/**
 * Removes the request itself.
 *
 * Only the request row goes. A reservation that confirming it already created
 * is a real booking on the calendar and stays there — deleting the paperwork
 * must not quietly cancel a stay the client is expecting. Declining is the
 * reversible option, so this is for spam and duplicates.
 */
export async function deleteBoardingRequest(row: BoardingRequest): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("boarding_requests").delete().eq("id", row.id);
  if (error) throw error;
}

export async function rejectBoardingRequest(row: BoardingRequest, note: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("boarding_requests")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      review_note: note.trim() || null,
    })
    .eq("id", row.id);
  if (error) throw error;
}
