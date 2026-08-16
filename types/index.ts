export type SignAction = "drop_off" | "pick_up";

export type DogSex = "male" | "female";

// "intact" is the app's word for what an import might call "Not Fixed".
export type FixedStatus = "spayed" | "neutered" | "intact" | "unknown";

export const DOG_SEXES: { key: DogSex; label: string }[] = [
  { key: "female", label: "Female" },
  { key: "male", label: "Male" },
];

export const FIXED_STATUSES: { key: FixedStatus; label: string }[] = [
  { key: "spayed", label: "Spayed" },
  { key: "neutered", label: "Neutered" },
  { key: "intact", label: "Not fixed" },
  { key: "unknown", label: "Unknown" },
];
export type ServiceType = "daycare" | "boarding" | "meet_greet";
export type AddonKey = "bath" | "walk" | "nail_trim";

// Each sign-in (drop off OR pick up) is its own row, tagged by `action`.
// The /records page merges a dog's drop-off and pick-up row for the same
// day into a single displayed line — see mergeRecords() in app/records/page.tsx.
export type BathSize = "S" | "M" | "L";

export type MealKey = "breakfast" | "lunch" | "dinner";

// Short labels on purpose: these render as three letters inside a table cell
// that already carries a name, a status pill and a price.
export const MEALS: { key: MealKey; label: string; short: string; icon: string }[] = [
  { key: "breakfast", label: "Breakfast", short: "B", icon: "🌅" },
  { key: "lunch", label: "Lunch", short: "L", icon: "☀️" },
  { key: "dinner", label: "Dinner", short: "D", icon: "🌙" },
];

export interface SignInRecord {
  id?: string;
  dog_name: string;
  phone: string;
  drop_off_by: string;
  pick_up_by?: string;
  last_name: string;
  action: SignAction;
  service_type: ServiceType;
  addons: string[];
  bath_size?: BathSize | null; // set later on /records, not at drop-off — see lib/pricing.ts
  package_id?: string | null;
  dog_id?: string | null;
  price?: number | null; // charge for this visit when no package covers it — set at pick-up, staff-editable after (e.g. to add bath charges)
  signature_data: string; // base64 PNG, may be empty if the client's waiver is on file from signup
  // Daycare walk log — filled in on /records for a drop-off with the
  // "walk" add-on, free-text rather than a strict time so staff can jot
  // down whatever's fastest ("2:15pm", "~2pm", etc).
  walk_out?: string | null;
  walk_in?: string | null;
  walk_staff_initials?: string | null;
  pickup_window?: string | null; // chosen at drop-off when a bath is booked — see PICKUP_WINDOWS
  // Meals due today and which have been given. Per visit, not per dog:
  // a dog that skips lunch today still eats lunch tomorrow.
  // See signin-meals-migration.sql.
  meals?: MealKey[] | null;
  meals_given?: MealKey[] | null;
  // A handover note for this visit — special requests, what the owner said
  // at drop-off. Internal: never printed on the day sheets clients get.
  staff_note?: string | null;
  // Staff have said this visit must not spend a package day, overriding the
  // automatic past-four-hours rule. Null means nobody has decided, which is
  // not the same as false. See signin-notes-migration.sql.
  package_opt_out?: boolean | null;
  by_staff?: boolean | null; // recorded by staff on the client's behalf, not at the lobby kiosk
  // How a meet & greet went. Recorded against the assessment itself rather
  // than the dog, so a dog brought back for a second try keeps both verdicts.
  meet_greet_result?: MeetGreetResult | null;
  meet_greet_note?: string | null;
  created_at?: string;
}

/** A meet & greet either clears the dog for daycare or it does not. */
export type MeetGreetResult = "pass" | "fail";

// Pick-up time windows offered at the kiosk when a bath is added, so
// grooming knows when the dog is expected back at the front.
export const PICKUP_WINDOWS: string[] = ["11am–1pm", "1–3pm", "3–5pm", "5–7pm"];

// What a package buys. Daycare packages cover a full-day base rate; walk
// packages cover the walk add-on on a visit. Same mechanics either way —
// a block of prepaid uses that a visit draws one from.
export type PackageKind = "daycare" | "walk";

export const PACKAGE_KINDS: { key: PackageKind; label: string; unit: string; icon: string }[] = [
  { key: "daycare", label: "Daycare days", unit: "days", icon: "🐕" },
  { key: "walk", label: "Walks", unit: "walks", icon: "🚶" },
];

export interface Package {
  id?: string;
  kind?: PackageKind; // defaults to daycare for rows written before walks existed
  client_name: string;
  dog_name?: string;
  phone: string;
  total_days: number;
  days_used: number;
  // What the client paid for the package. This is the revenue event — it's
  // counted on the day the package was sold, and the visits it later covers
  // are $0, since the money already changed hands here.
  price?: number | null;
  created_at?: string;
}

// The enrollment questionnaire's fixed answer lists. Free text is allowed
// everywhere alongside these — a value that isn't in the list is stored
// verbatim and rendered as "Other", so the lists can be extended later
// without stranding existing rows. See lib/enrollment.ts.
export const FLEA_PROGRAMS = ["Simparica", "Frontline", "Trifexis"];

export const ACTIVITY_RESTRICTIONS = ["No jumping", "No running", "No hard play"];

export const ALLERGENS = ["Peanut butter", "Treats", "Chicken", "Shampoo"];

export const BEHAVIOR_TRAITS = [
  "Quiet",
  "Digger",
  "Fence climber",
  "Food possessive",
  "Leash aggression",
  "Shy",
  "Jumper",
  "People aggressive",
  "Eats foreign objects",
  "Friendly",
  "Escapist",
  "Noisy",
  "Submissive",
  "Toy possessive",
  "Excessive barker",
  "Energetic",
  "Destructive",
  "Poop eater",
  "Whiner",
];

export const PLAY_STYLES = [
  "Rough player",
  "Gentle player",
  "Vocal player",
  "Submissive",
  "Fearful",
  "Not interested",
  "Likes any dog",
  "Prefers big dogs",
  "Small dogs",
  "Prefers opposite sex",
  "Dislikes other dogs",
  "Dog aggressive",
  "Toy possessive",
  "Food possessive",
  "Humps",
  "Fetch",
];

export const ATTENDANCE_PLANS = [
  "Daycare often",
  "Boarding often",
  "Both often",
  "Daycare occasionally",
  "Boarding occasionally",
  "Just visiting",
];

export const BIG_DOG_RESPONSES = ["Does well", "Doesn't do well", "Doesn't care"];

export const HEARD_ABOUT = ["Google", "Yelp", "Friend", "Walk-by"];

export const PACKAGE_INTEREST = ["Yes", "No", "Maybe"];

// Meet & greets run weekday mornings only, split into two arrival windows.
// A client picks a date and a window; staff confirm the exact time when
// they approve the enrollment.
export const MEET_GREET_WINDOWS = ["8:00–10:30 am", "10:30 am–1:00 pm"];

export const MEET_GREET_HOURS = "Monday to Friday, 8am–1pm";

/** True for Mon–Fri. Meet & greets are not offered at weekends. */
export function isMeetGreetDay(dateKey: string): boolean {
  if (!dateKey) return false;
  // Parsed at local noon so a timezone offset can't shift the weekday.
  const day = new Date(`${dateKey}T12:00:00`).getDay();
  return day >= 1 && day <= 5;
}

// A one-time signup profile. Waiver is signed once here; daily kiosk
// check-in just looks this up by phone instead of re-collecting it.
export interface Dog {
  id?: string;
  phone: string;
  dog_name: string;
  last_name: string;
  drop_off_by: string;
  signature_data: string; // base64 PNG, the signed waiver
  photo_data?: string | null; // base64 JPEG data URL, resized client-side — shown at kiosk sign-in/out
  // The dog itself. Mostly populated by importing an existing system's
  // export; all optional, since the kiosk signup only asks for the basics.
  breed?: string | null;
  sex?: DogSex | null;
  fixed_status?: FixedStatus | null;
  birthdate?: string | null; // "YYYY-MM-DD"
  weight_lb?: number | null;
  vet?: string | null;
  // ---- Enrollment questionnaire ----------------------------------------
  // Everything below comes from the full enrollment form (/enroll). All
  // optional: dogs added by staff from an owner profile, or imported from a
  // previous system, never answered any of it.
  color?: string | null;
  flea_program?: string | null; // a FLEA_PROGRAMS entry, or free text
  fixed_scheduled_on?: string | null; // "YYYY-MM-DD" — when a not-fixed dog is booked in
  dog_source?: string | null; // where the dog came from (breeder, rescue…)
  // Incident history. null means "never asked", which is different from a
  // recorded "no" — the profile shows the two differently.
  growled?: boolean | null;
  growled_note?: string | null;
  bitten?: boolean | null;
  bitten_note?: string | null;
  climbed_fence?: boolean | null;
  fence_height?: string | null;
  dog_fight?: boolean | null;
  dog_fight_note?: string | null;
  health_problems?: boolean | null;
  health_notes?: string | null;
  activity_restrictions?: string[] | null;
  allergies?: string[] | null;
  sensitive_areas?: boolean | null;
  sensitive_areas_note?: string | null;
  behavior_traits?: string[] | null;
  play_style?: string[] | null;
  attendance_plan?: string | null;
  big_dog_response?: string | null;
  crate_trained?: boolean | null;
  kennel_trained?: boolean | null;
  package_interest?: string | null;
  meet_greet_on?: string | null; // "YYYY-MM-DD" — requested meet & greet (weekdays only)
  meet_greet_window?: string | null; // a MEET_GREET_WINDOWS entry
  enrolled_at?: string | null; // set when the enrollment form was submitted
  // Who else may collect this dog, beyond the usual drop_off_by person.
  authorized_pickup?: string | null;
  notes?: string | null;
  // Ids and the photo filename carried over from a previous system, kept so
  // an import can be reconciled or re-run against the source export.
  external_id?: string | null;
  photo_filename?: string | null;
  // The package new visits should draw from, per kind, when staff have
  // pinned one. Without these the default rule picks (own before shared,
  // remaining before exhausted) — see findPackageFor in lib/clients.ts.
  default_package_id?: string | null;
  default_walk_package_id?: string | null;
  // Set by staff when a waiver was signed outside the kiosk (on paper, or
  // at another location) so a dog added from the owner profile isn't
  // flagged as unsigned forever. A real signature in signature_data counts
  // on its own — see hasWaiver() in lib/clients.ts.
  waiver_on_file?: boolean | null;
  // Set when the dog stops coming — it passed away, moved away, or the
  // household simply stopped. The row and everything hanging off it stays;
  // the dog just leaves every screen that books, charges or checks one in.
  // Reversible, and undefined on an install that has not run
  // dog-retire-migration.sql yet — see lib/retire.ts.
  retired_at?: string | null;
  retired_reason?: string | null;
  retired_note?: string | null;
  created_at?: string;
}

export const SERVICE_TYPES: { key: ServiceType; label: string; icon: string }[] = [
  { key: "daycare", label: "Daycare", icon: "🐕" },
  { key: "boarding", label: "Boarding", icon: "🛏️" },
  { key: "meet_greet", label: "Meet & greet", icon: "✨" },
];

export const ADDONS: { key: AddonKey; label: string; icon: string }[] = [
  { key: "bath", label: "Bath", icon: "🛁" },
  { key: "walk", label: "Walk", icon: "🚶" },
  { key: "nail_trim", label: "Nail trim", icon: "💅" },
];

// Add-ons selectable on a boarding reservation (separate list from the
// daycare walk-in ADDONS above — boarding also offers medications, and
// "walk" needs a per-day count rather than being a flat one-time thing).
export type BoardingAddonKey = "walk" | "bath" | "nail_trim" | "medication";

export const BOARDING_ADDONS: { key: BoardingAddonKey; label: string; icon: string }[] = [
  { key: "walk", label: "Walks", icon: "🚶" },
  { key: "bath", label: "Bath", icon: "🛁" },
  { key: "nail_trim", label: "Nail trim", icon: "💅" },
  { key: "medication", label: "Medication", icon: "💊" },
];

// A staff-created advance boarding reservation. The kiosk checks this
// before allowing a boarding drop-off — see components/KioskForm.tsx.
export interface Boarding {
  id?: string;
  dog_name: string;
  last_name: string;
  phone: string;
  dog_id?: string | null;
  start_date: string; // "YYYY-MM-DD"
  end_date: string; // "YYYY-MM-DD"
  feeding_instructions?: string;
  notes?: string;
  addons?: BoardingAddonKey[];
  walks_per_day?: number | null; // only meaningful when addons includes "walk"
  bath_size?: BathSize | null; // only meaningful when addons includes "bath"
  medication_instructions?: string | null; // only meaningful when addons includes "medication"
  /**
   * @deprecated Unused. A boarding stay no longer draws from a walk package:
   * walk packages cover the daycare walk add-on only, and a stay's walks bill
   * per walk on the reservation. The column is kept so existing rows are not
   * silently rewritten, but nothing reads or writes it.
   */
  walk_package_id?: string | null;
  photo_data?: string | null; // base64 JPEG data URL, resized client-side — printed on /report
  created_at?: string;
}

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

// One meal-log entry for a given boarding reservation/day, logged by
// staff on the /report page and included on the printed PDF.
export interface MealLog {
  id?: string;
  boarding_id: string;
  date: string; // "YYYY-MM-DD"
  meal_type: MealType;
  fed: boolean;
  fed_by?: string | null; // staff name who fed the dog
  notes?: string;
  created_at?: string;
}

export const MEAL_TYPES: { key: MealType; label: string }[] = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
  { key: "snack", label: "Snack" },
];

// One walk entry for a boarding stay, per day and per walk slot. A
// daycare walk is stored on the sign-in row itself (see the walk_* fields
// on SignInRecord) — a boarding stay can't be, since one reservation
// spans many days and can have several walks a day.
export interface WalkLog {
  id?: string;
  boarding_id: string;
  date: string; // "YYYY-MM-DD"
  walk_index: number; // 0-based slot within that day, for walks_per_day > 1
  walk_out?: string | null;
  walk_in?: string | null;
  staff_initials?: string | null;
  // Whose walk this was. A row used to identify itself only by the stay it
  // belonged to, so the table could not answer the one question asked of it
  // without a join. dog_name rides along so a row reads on its own, the same
  // way PackageUse carries one.
  dog_id?: string | null;
  dog_name?: string | null;
  created_at?: string;
}

export type PaymentMethod = "cash" | "card" | "check" | "other";

export const PAYMENT_METHODS: { key: PaymentMethod; label: string; icon: string }[] = [
  { key: "card", label: "Card", icon: "💳" },
  { key: "cash", label: "Cash", icon: "💵" },
  { key: "check", label: "Check", icon: "🧾" },
  { key: "other", label: "Other", icon: "•" },
];

// Money taken from a client. Recorded against the phone number, since
// that's the household that pays — a payment can settle charges across
// several of their dogs at once.
export interface Payment {
  id?: string;
  phone: string;
  dog_id?: string | null; // set when the payment was clearly for one dog
  amount: number;
  method?: PaymentMethod | null;
  note?: string | null;
  paid_on: string; // "YYYY-MM-DD"
  created_at?: string;
}

// The person behind a phone number. `clients` is one row per DOG, so this
// is where owner-level details live — keyed by phone, the same key every
// lookup in the app already uses. Created lazily the first time staff save
// something on an owner profile.
export interface Owner {
  id?: string;
  phone: string;
  owner_name?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  external_id?: string | null; // the previous system's owner id
  emergency_name?: string | null;
  emergency_phone?: string | null;
  emergency_relation?: string | null;
  // The household's vet, asked once on the enrollment form. A dog with its
  // own vet overrides this on its profile — see `vet` on Client.
  vet_name?: string | null;
  vet_phone?: string | null;
  vet_address?: string | null;
  heard_about?: string | null; // a HEARD_ABOUT entry, or free text
  notes?: string | null;
  created_at?: string;
}

// A file a client uploaded with their enrollment — in practice vaccination
// paperwork. Kept in its own table rather than a column on `clients`,
// because a multi-megabyte base64 PDF on a row that every list page selects
// would be dragged into memory on screens that never display it.
export interface DogDoc {
  id?: string;
  dog_id: string;
  kind: string; // "vaccination" today; room for others later
  file_name: string;
  mime_type: string;
  data: string; // data URL
  created_at?: string;
}

// Extras a client can ask for when requesting a stay. Deliberately plainer
// than BOARDING_ADDONS: an owner picks "walk", staff decide how many a day
// and what a bath costs by size when they confirm the reservation.
export const BOARDING_SERVICES: { key: BoardingAddonKey; label: string }[] = [
  { key: "bath", label: "Bath before pick-up" },
  { key: "walk", label: "Walks" },
  { key: "medication", label: "Medication" },
  { key: "nail_trim", label: "Nail trim" },
];

export type EnrollmentStatus = "pending" | "approved" | "rejected";

// A submitted enrollment form, awaiting staff review. The public form is
// reachable by anyone with the link, so a submission is a request — nothing
// becomes a client, and nothing is bookable, until it's approved.
//
// `data` holds the whole submitted draft (see EnrollmentDraft in
// lib/enrollment.ts) plus the signature, rather than being spread across
// columns: the review screen shows exactly what was sent, and adding a
// question to the form doesn't need a migration.
export interface Enrollment {
  id?: string;
  phone: string;
  owner_name: string;
  last_name: string;
  dog_names: string[];
  status: EnrollmentStatus;
  source?: "kiosk" | "web" | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  review_note?: string | null;
  reviewed_at?: string | null;
  // Two-stage enrollment. Stage one is the public form; stage two is the
  // link emailed once the meet & greet has passed. See enrollmentStage() in
  // lib/enrollment.ts, and two-stage-enrollment-migration.sql — a row
  // written before that migration has none of these three, which reads as a
  // complete, single-stage submission.
  stage?: EnrollmentStage | null;
  details_token?: string | null;
  details_submitted_at?: string | null;
  created_at?: string;
}

/** 1 while the details form is outstanding, 2 once it has been returned. */
export type EnrollmentStage = 1 | 2;

// A client asking for a stay. Same shape of idea as Enrollment: the public
// form is open to anyone, so a submission is a request for dates, not a
// booking. Approving is what writes real `boardings` rows — until then the
// dates are not held and nothing shows on the calendar.
export interface BoardingRequest {
  id?: string;
  phone: string;
  owner_name: string;
  last_name: string;
  email?: string | null;
  dog_names: string[];
  // Promoted out of `data` so the review list can sort and filter by date
  // without loading every submission body.
  start_date: string; // "YYYY-MM-DD"
  end_date: string;
  status: EnrollmentStatus;
  source?: "kiosk" | "web" | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  review_note?: string | null;
  reviewed_at?: string | null;
  created_at?: string;
}

export type VaccineKey = "rabies" | "dhpp" | "bordetella" | "influenza" | "leptospirosis";

// One row per (dog, vaccine). The vaccine list is fixed — staff only fill
// in dates, so records stay comparable across dogs.
export interface Vaccination {
  id?: string;
  dog_id: string;
  vaccine: VaccineKey;
  given_on?: string | null; // "YYYY-MM-DD"
  expires_on?: string | null; // "YYYY-MM-DD"
  created_at?: string;
}

export const VACCINES: { key: VaccineKey; label: string }[] = [
  { key: "rabies", label: "Rabies" },
  { key: "dhpp", label: "DHPP" },
  { key: "bordetella", label: "Bordetella" },
  { key: "influenza", label: "Canine influenza" },
  { key: "leptospirosis", label: "Leptospirosis" },
];

// A single package day being consumed. `packages.days_used` is just a
// counter — this is the ledger that gives that counter dates, so staff can
// see which visits burned which days.
export interface PackageUse {
  id?: string;
  package_id: string;
  dog_id?: string | null;
  signin_id?: string | null;
  dog_name?: string | null;
  used_on: string; // "YYYY-MM-DD"
  created_at?: string;
}
