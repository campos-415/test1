// The client side of the client portal.
//
// The same relationship to the database that lib/roles.ts has: the database
// is the boundary, and nothing here is a security control. What this file is
// for is not offering somebody a screen the database will refuse, and not
// asking for a column it will not hand over.
//
// One rule runs through all of it, and it is worth stating once rather than
// per function: a client never reads a base table. Every read below goes to
// a my_* view and every write to a named function, because a policy can say
// which ROWS but not which COLUMNS, and half these tables carry a note staff
// wrote for each other - the handover note on a visit, the note on a dog, the
// note on a household. See section 9 of customer-accounts-migration.sql and
// the V and F cells in rls-lockdown.sql.
//
// If this file ever selects from `dogs` rather than `my_dogs`, the request
// will simply come back empty. That is the design working, not a bug.

import { getSupabase } from "@/lib/supabase";
import { Balance, computeBalance } from "@/lib/billing";
import { Boarding, Dog, Package, Payment, SignInRecord, Vaccination } from "@/types";
import { activeDogs } from "@/lib/retire";

/** The household this account has claimed. */
export interface Household {
  id: string;
  phone: string;
  owner_name: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  emergency_name: string | null;
  emergency_phone: string | null;
  emergency_relation: string | null;
  vet_name: string | null;
  vet_phone: string | null;
  vet_address: string | null;
  claimed_at: string | null;
}

/** A document the household has on file. Their own upload, in practice. */
export interface CustomerDoc {
  id: string;
  dog_id: string | null;
  kind: string;
  file_name: string | null;
  mime_type: string | null;
  data: string;
  created_at: string;
}

/** The stage-two questionnaire this household still owes, if any. */
export interface PendingDetails {
  token: string;
  dogNames: string[];
}

export interface CustomerRequest {
  id: string;
  dog_names: string[];
  start_date: string;
  end_date: string;
  status: string;
  created_at: string;
  reviewed_at: string | null;
}

/** Everything one screen of the portal needs, fetched together. */
export interface HouseholdData {
  household: Household;
  dogs: Dog[];
  vaccinations: Vaccination[];
  packages: Package[];
  stays: Boarding[];
  visits: SignInRecord[];
  payments: Payment[];
  documents: CustomerDoc[];
  requests: CustomerRequest[];
}

// ---------------------------------------------------------------------
// Is this account a client, and whose?
// ---------------------------------------------------------------------

let cache: { userId: string; household: Household | null } | null = null;

export function forgetCachedHousehold(): void {
  cache = null;
}

/**
 * The household for the signed-in account, or null.
 *
 * Null covers three different situations that the portal has to tell apart
 * and this function deliberately does not: nobody is signed in, a staff
 * account is signed in, and an account exists that has never been invited.
 * The gate asks the questions it needs; this only answers the common one.
 */
export async function loadMyHousehold(): Promise<Household | null> {
  const supabase = getSupabase();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    cache = null;
    return null;
  }
  if (cache?.userId === user.id) return cache.household;

  const { data, error } = await supabase.from("my_household").select("*").maybeSingle();
  // Not thrown: an account with no household is an ordinary state, and so is
  // a database where the migration has not run. Both mean "not a client
  // here", and the gate says so in words rather than as a stack trace.
  if (error) {
    console.error("Could not read the household:", error);
    cache = { userId: user.id, household: null };
    return null;
  }

  const household = (data as Household | null) ?? null;
  cache = { userId: user.id, household };
  return household;
}

/**
 * Binds this account to the household an invitation names.
 *
 * The token is the whole of the proof: staff emailed it to the address
 * already on file, so holding it demonstrates control of that address. There
 * is deliberately no route in that takes a phone number - guessing one is
 * trivial, and a portal that hands over a household for a correct guess is
 * the exact failure the requirements are about.
 */
export async function claimInvite(token: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await getSupabase().rpc("claim_owner_invite", { p_token: token });
  if (error) {
    return { ok: false, error: error.message || "That invitation could not be used." };
  }
  forgetCachedHousehold();
  return { ok: true };
}

/** Where a claim link lives. Same reasoning as detailsLink: built from the
 *  browser's own origin, because the app is reached on several hostnames and
 *  the link has to work from wherever the person sending it is standing. */
export function claimLink(token: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/account/claim/${token}`;
}

export function portalLink(): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/account`;
}

/**
 * Gets a household the link it needs to reach its own account.
 *
 * Called when a meet and greet passes, which is the moment a household stops
 * being an applicant and starts being a client — and so the moment an
 * account is worth having.
 *
 * Three answers, and the caller only has to know whether it got a link:
 *
 *   unclaimed household  a fresh one-time invitation
 *   already claimed      the portal itself, because they can just sign in
 *   anything else        null, and the caller falls back to the old public
 *                        details link so nobody is left unable to finish
 *
 * Never throws. The meet and greet verdict is the thing being saved, and it
 * must not be lost because an invitation could not be issued.
 */
export async function inviteToAccount(
  phone: string
): Promise<{ link: string | null; reason?: string }> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("owners")
      .select("id, email, claimed_at")
      .eq("phone", phone.trim())
      .maybeSingle();
    if (error) throw error;

    const owner = data as { id: string; email: string | null; claimed_at: string | null } | null;
    if (!owner?.id) return { link: null, reason: "no owner record for that number yet" };
    if (owner.claimed_at) return { link: portalLink(), reason: "already has an account" };
    if (!owner.email?.trim()) return { link: null, reason: "no email on file" };

    const { data: token, error: rpcError } = await supabase.rpc("issue_owner_invite", {
      p_owner_id: owner.id,
    });
    if (rpcError) throw rpcError;
    return { link: claimLink(token as string) };
  } catch (e) {
    console.error("Could not issue an account invitation:", e);
    return { link: null, reason: "the invitation could not be issued" };
  }
}

// ---------------------------------------------------------------------
// Reading.
// ---------------------------------------------------------------------

async function readAll<T>(view: string, order?: { column: string; ascending: boolean }): Promise<T[]> {
  let request = getSupabase().from(view).select("*");
  if (order) request = request.order(order.column, { ascending: order.ascending });
  const { data, error } = await request;
  if (error) throw error;
  return (data as T[]) ?? [];
}

/**
 * The whole household in one round trip per table.
 *
 * Fetched together rather than per screen because the balance cannot be
 * worked out from part of it: payments settle oldest charge first, so
 * whether a given visit is paid depends on every charge older than it. The
 * same reason lib/unpaid.ts loads the whole book for staff.
 */
export async function loadHouseholdData(): Promise<HouseholdData | null> {
  const household = await loadMyHousehold();
  if (!household) return null;

  const [dogs, vaccinations, packages, stays, visits, payments, documents, requests] =
    await Promise.all([
      readAll<Dog>("my_dogs", { column: "dog_name", ascending: true }),
      readAll<Vaccination>("my_vaccinations"),
      readAll<Package>("my_packages", { column: "created_at", ascending: false }),
      readAll<Boarding>("my_stays", { column: "start_date", ascending: false }),
      readAll<SignInRecord>("my_visits", { column: "created_at", ascending: false }),
      readAll<Payment>("my_payments", { column: "paid_on", ascending: false }),
      readAll<CustomerDoc>("my_documents", { column: "created_at", ascending: false }),
      readAll<CustomerRequest>("my_boarding_requests", { column: "created_at", ascending: false }),
    ]);

  return {
    household,
    // Retired dogs are not offered back to the household. A client should
    // not be shown a picker containing the dog they lost, least of all one
    // that would let them request boarding for it. Their stays, visits and
    // payments below are untouched — the history stays theirs.
    dogs: activeDogs(dogs),
    vaccinations,
    packages,
    stays,
    visits,
    payments,
    documents,
    requests,
  };
}

/**
 * The rest of the enrollment, when the household has not sent it back yet.
 *
 * Returns the details token for the caller's own household and nothing else,
 * which is what lets the portal reuse /api/enrollment-details rather than
 * growing a second implementation of the stage-two whitelist. The token now
 * never leaves an authenticated session: it is not emailed any more.
 *
 * Null both when nothing is outstanding and when the database has not run
 * customer-details-handover-migration.sql. Both mean "no form to show", and
 * a portal that refuses to load because a function is missing would be worse
 * than one that simply does not nag.
 */
export async function loadPendingDetails(): Promise<PendingDetails | null> {
  try {
    const { data, error } = await getSupabase().rpc("my_pending_enrollment");
    if (error) throw error;
    const row = ((data ?? []) as Record<string, unknown>[])[0];
    if (!row?.details_token) return null;
    return {
      token: String(row.details_token),
      dogNames: (row.dog_names as string[] | null) ?? [],
    };
  } catch (e) {
    console.error("Could not check for an outstanding enrollment:", e);
    return null;
  }
}

/**
 * What the household owes, using the same arithmetic the front desk bills
 * with. One function, so the figure a client is shown here and the one they
 * are asked for at pick-up cannot disagree.
 */
export function householdBalance(data: HouseholdData): Balance {
  return computeBalance(data.visits, data.packages, data.payments);
}

/** Days left on a package. Negative is impossible; over-use shows as zero. */
export function daysRemaining(pkg: Package): number {
  return Math.max(0, (pkg.total_days ?? 0) - (pkg.days_used ?? 0));
}

/** The next stay that has not finished yet, or null. */
export function nextStay(stays: Boarding[], today: string): Boarding | null {
  const upcoming = stays
    .filter((s) => s.end_date >= today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  return upcoming[0] ?? null;
}

// ---------------------------------------------------------------------
// Writing. Three things, and no more - the portal asks, it does not book.
// ---------------------------------------------------------------------

export interface HouseholdDetails {
  owner_name: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  emergency_name: string;
  emergency_phone: string;
  emergency_relation: string;
  vet_name: string;
  vet_phone: string;
  vet_address: string;
}

/**
 * Saves the contact details.
 *
 * Through a function rather than an update, and the reason is worth keeping
 * near the call site: an UPDATE with a WHERE clause makes Postgres apply the
 * SELECT policies, a client has none on owners, and so the obvious
 * `.update().eq("id")` matched no rows, reported success, and changed
 * nothing. The phone number is absent because it is the key every record in
 * the household hangs off; changing it is a phone call to the front desk.
 */
export async function saveHouseholdDetails(details: HouseholdDetails): Promise<void> {
  const { error } = await getSupabase().rpc("update_my_household", {
    p_owner_name: details.owner_name,
    p_email: details.email,
    p_address: details.address,
    p_city: details.city,
    p_state: details.state,
    p_zip: details.zip,
    p_emergency_name: details.emergency_name,
    p_emergency_phone: details.emergency_phone,
    p_emergency_relation: details.emergency_relation,
    p_vet_name: details.vet_name,
    p_vet_phone: details.vet_phone,
    p_vet_address: details.vet_address,
  });
  if (error) throw error;
  forgetCachedHousehold();
}

/**
 * Files a replacement vaccination record against one of their own dogs.
 *
 * Inserted, never updated: what was on file and when is worth more than a
 * tidy list, and staff read the dates off the record to update the
 * vaccination rows themselves.
 *
 * No .select() on the insert. A client has no select policy on dog_docs, and
 * Postgres treats a RETURNING clause as a read - chaining select here would
 * turn a working upload into a refusal. Same trap the public forms have.
 *
 * owner_id is not sent at all. The fill_owner_id trigger derives it from the
 * dog, which is what makes uploading against somebody else's dog impossible
 * rather than merely unlikely.
 */
export async function uploadVaccinationRecord(
  dogId: string,
  fileName: string,
  dataUrl: string
): Promise<void> {
  const { error } = await getSupabase().from("dog_docs").insert({
    dog_id: dogId,
    kind: "vaccination",
    file_name: fileName,
    // fileToRecordJpeg is what produced this, so it is always a JPEG however
    // it arrived - a photo, a scan, or a PDF from the vet.
    mime_type: "image/jpeg",
    data: dataUrl,
  });
  if (error) throw error;
}
