import { Dog } from "@/types";

/**
 * Retiring a dog, and the one rule the rest of the app follows about it.
 *
 * A retired dog disappears from anything that **books, charges or checks a dog
 * in** — the kiosk lookup, the reservation picker, the package purchase
 * screen, the calendar. It stays visible anywhere that **looks at history** —
 * its own profile, the household, the stay report, search. Nothing is deleted:
 * the visits, payments, vaccinations and uploaded records all stay attached to
 * the same row, which is the entire point.
 *
 * Every check is done on data already in hand rather than in the query, so it
 * works the same on an install that has not run dog-retire-migration.sql yet:
 * there the column is absent, `retired_at` is undefined, and every dog reads
 * as active — exactly how the app behaved before any of this existed.
 */

/** Why a dog stopped coming. Free text in the database; these are the offer. */
export const RETIRE_REASONS: { key: string; label: string }[] = [
  { key: "passed_away", label: "Passed away" },
  { key: "moved_away", label: "Moved away" },
  { key: "stopped_coming", label: "No longer coming" },
];

export function retireReasonLabel(key: string | null | undefined): string {
  if (!key) return "Retired";
  return RETIRE_REASONS.find((r) => r.key === key)?.label ?? key;
}

export function isRetired(dog: Pick<Dog, "retired_at"> | null | undefined): boolean {
  return !!dog?.retired_at;
}

/** The dogs a household can actually book, charge or check in today. */
export function activeDogs<T extends Pick<Dog, "retired_at">>(dogs: T[]): T[] {
  return dogs.filter((d) => !d.retired_at);
}

export function retiredDogs<T extends Pick<Dog, "retired_at">>(dogs: T[]): T[] {
  return dogs.filter((d) => !!d.retired_at);
}
