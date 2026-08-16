"use client";

import { ageFromBirthdate } from "@/lib/enrollment";
import { prettyDateKey } from "@/lib/dates";
import { Dog, Vaccination, VACCINES } from "@/types";

// What the kiosk shows for a dog arriving for its meet & greet.
//
// It replaces the add-ons picker, which is the wrong question at this
// moment: almost nobody books a bath for an assessment they have not passed
// yet, so the card was offering an upsell in the one slot where the person
// standing there needs to know what is about to happen — and staff need to
// know what they are about to take into a playgroup.
//
// So the same space carries the assessment instead. Two audiences, one card:
// the owner reads the top, the handler reads the bottom.
//
// Everything here is already on file from the enrollment. Nothing is asked
// for again, and nothing is editable — a kiosk in a lobby is not where a
// behaviour history gets rewritten.
export default function MeetGreetCard({
  dog,
  vaccinations,
}: {
  dog: Dog;
  /**
   * Optional because the kiosk does not load them. Adding a query per dog to
   * the sign-in path to warn about paperwork would slow down the screen the
   * whole business queues at, and the enrollment review already refuses a
   * dog whose records are out of date. Passed in where they are already to
   * hand.
   */
  vaccinations?: Vaccination[];
}) {
  const flags = behaviourFlags(dog);
  const care = careNotes(dog);
  const expired = expiredVaccines(vaccinations ?? []);
  const age = ageFromBirthdate(dog.birthdate);

  return (
    <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50/70 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700">
        👋 First visit — meet &amp; greet
      </p>

      {/* For the owner. They have usually never been here before and are
          holding a lead, so it is three short lines, not a policy. */}
      <p className="mt-1 text-xs leading-relaxed text-violet-900">
        {dog.dog_name} will spend about two hours with us while we see how they
        settle in with the group. Leave them with us and come back at the end —
        we will talk you through how it went. If it goes well, just ask and
        they can stay on for the rest of the day.
      </p>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-violet-800">
        {dog.breed && <span>{dog.breed}</span>}
        {age && <span>· {age}</span>}
        {dog.sex && <span>· {dog.sex === "female" ? "Female" : "Male"}</span>}
        {dog.weight_lb != null && <span>· {dog.weight_lb} lb</span>}
        {dog.meet_greet_on && (
          <span className="text-violet-600">· booked {prettyDateKey(dog.meet_greet_on)}</span>
        )}
      </div>

      {/* For whoever takes the dog through. Only the things that change how
          the next two hours are run — a card that lists everything gets read
          as decoration. */}
      {(flags.length > 0 || care.length > 0 || expired.length > 0) && (
        <div className="mt-2 border-t border-violet-200 pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700">
            Before they go in
          </p>

          {expired.length > 0 && (
            <p className="mt-1 rounded-lg bg-rose-100 px-2 py-1 text-[11px] font-medium text-rose-800">
              ⚠️ {expired.join(", ")} out of date — check the paperwork before the
              dog joins a group.
            </p>
          )}

          {flags.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {flags.map((f) => (
                <li key={f} className="text-[11px] font-medium text-amber-900">
                  ⚑ {f}
                </li>
              ))}
            </ul>
          )}

          {care.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {care.map((c) => (
                <li key={c} className="text-[11px] text-violet-800">
                  · {c}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {flags.length === 0 && care.length === 0 && expired.length === 0 && (
        <p className="mt-2 border-t border-violet-200 pt-2 text-[11px] text-violet-700">
          Nothing flagged on the enrollment.
        </p>
      )}
    </div>
  );
}

/**
 * The disclosures that change how a dog is handled, in the owner's own
 * words where they gave any.
 *
 * These are the answers the enrollment asks precisely so that nobody meets
 * them for the first time in a playgroup.
 */
function behaviourFlags(dog: Dog): string[] {
  const out: string[] = [];
  const add = (on: boolean | null | undefined, label: string, note?: string | null) => {
    if (!on) return;
    out.push(note?.trim() ? `${label} — ${note.trim()}` : label);
  };
  add(dog.bitten, "Has bitten", dog.bitten_note);
  add(dog.dog_fight, "Has been in a dog fight", dog.dog_fight_note);
  add(dog.growled, "Has growled at people or dogs", dog.growled_note);
  add(dog.climbed_fence, "Has climbed a fence", dog.fence_height);
  add(dog.sensitive_areas, "Sensitive to being touched", dog.sensitive_areas_note);
  return out;
}

/** Health and handling, which matter for two hours as much as for a day. */
function careNotes(dog: Dog): string[] {
  const out: string[] = [];
  if (dog.health_problems && dog.health_notes?.trim()) out.push(dog.health_notes.trim());
  if ((dog.allergies ?? []).length) out.push(`Allergic to ${(dog.allergies ?? []).join(", ")}`);
  if ((dog.activity_restrictions ?? []).length)
    out.push((dog.activity_restrictions ?? []).join(", "));
  if (dog.big_dog_response) out.push(`With big dogs: ${dog.big_dog_response}`);
  if ((dog.play_style ?? []).length) out.push(`Play style: ${(dog.play_style ?? []).join(", ")}`);
  return out;
}

function expiredVaccines(vaccinations: Vaccination[]): string[] {
  const today = new Date().toISOString().slice(0, 10);
  return vaccinations
    .filter((v) => v.expires_on && v.expires_on < today)
    .map((v) => VACCINES.find((x) => x.key === v.vaccine)?.label ?? String(v.vaccine));
}
