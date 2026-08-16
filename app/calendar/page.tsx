"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { formatPhoneInput } from "@/lib/phone";
import { dateKey, parseDateKey, prettyDateKey, todayKey } from "@/lib/dates";
import { estimateBoardingTotal } from "@/lib/pricing";
import { nightsBetweenKeys } from "@/lib/pricing";
import {
  BathSize,
  Boarding,
  BOARDING_ADDONS,
  BoardingAddonKey,
  Dog,
  Package,
  SignInRecord,
} from "@/types";
import { dogHref, findDog } from "@/lib/dogs";
import MonthGrid, { MonthEntry } from "@/components/MonthGrid";
import DogLink from "@/components/DogLink";
import Money, { PayState } from "@/components/Money";
import { signinChargeKey } from "@/lib/billing";
import { useUnpaid } from "@/components/useUnpaid";
import { fileToBudgetedJpeg } from "@/lib/image";
import StaffNav from "@/components/StaffNav";
import StaffGate from "@/components/StaffGate";
import DateField from "@/components/DateField";
import { activeDogs } from "@/lib/retire";

// What's shared by every dog on one booking — the family drops off and
// picks up together, so the phone and dates are entered once.
interface FormState {
  phone: string;
  start_date: string;
  end_date: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  phone: "",
  start_date: todayKey(),
  end_date: todayKey(),
  notes: "",
};

// A dog picked from the phone lookup. `key` is the client id, or the
// MANUAL_KEY sentinel when editing an older reservation whose client
// profile is gone (or was created before reservations stored dog_id).
interface SelectedDog {
  key: string;
  dog_name: string;
  last_name: string;
  dog_id: string | null;
  profile_photo: string | null; // the dog's profile photo from clients, for recognition
}

const MANUAL_KEY = "__manual__";

// Everything that varies dog to dog. Two dogs on the same booking often
// want different add-ons, food, and walk counts, so none of this can be
// shared across the booking the way the dates are.
interface DogConfig {
  addons: BoardingAddonKey[];
  walks_per_day: number;
  bath_size: BathSize | "";
  medication_instructions: string;
  feeding_instructions: string;
  photo_data: string; // base64 data URL, empty string if no photo
}

const EMPTY_DOG_CONFIG: DogConfig = {
  addons: [],
  walks_per_day: 1,
  bath_size: "",
  medication_instructions: "",
  feeding_instructions: "",
  photo_data: "",
};

// Muted, print-friendly-ish palette cycled per reservation on the
// calendar so overlapping stays stay visually distinct.
// A dog with an approved meet & greet booked. Not a reservation row — the
// date lives on the dog itself, set by the enrollment form.
interface MeetGreet {
  id: string;
  photo_data?: string | null;
  dog_name: string;
  last_name: string;
  phone: string;
  meet_greet_on: string;
  meet_greet_window: string | null;
  retired_at?: string | null;
}

// The meet & greet list, and the same list without the column
// dog-retire-migration.sql adds — see the fallback where it is queried.
const MEET_COLUMNS =
  "id, dog_name, last_name, phone, photo_data, meet_greet_on, meet_greet_window, retired_at";
const LEGACY_MEET_COLUMNS =
  "id, dog_name, last_name, phone, photo_data, meet_greet_on, meet_greet_window";

type CalView = "all" | "boardings" | "meets";

const CAL_VIEWS: { key: CalView; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "boardings", label: "🛏️ Boardings" },
  { key: "meets", label: "✨ Meet & greets" },
];

// A colour per reservation, cycled, so the same stay is recognisable as the
// same stay wherever it appears.
//
// Both classes are written out in full on purpose. The bar colour used to be
// the only one stored, and the ring under the dog's photo was derived from it
// at runtime with a string replace — which produced class names that appear
// nowhere in the source, so Tailwind stripped them and every ring in the list
// below came out colourless. Anything Tailwind must generate has to be
// literal somewhere it can read.
const RESERVATION_COLORS: { bar: string; ring: string }[] = [
  // accent-200/300/800 are not on the ramp in tailwind.config.ts, so they
  // generate nothing. Only the six stops that exist are used here.
  { bar: "bg-accent-100 text-accent-700", ring: "ring-accent-400" },
  { bar: "bg-emerald-100 text-emerald-800", ring: "ring-emerald-300" },
  { bar: "bg-amber-100 text-amber-800", ring: "ring-amber-300" },
  { bar: "bg-rose-100 text-rose-800", ring: "ring-rose-300" },
  { bar: "bg-violet-100 text-violet-800", ring: "ring-violet-300" },
  { bar: "bg-sky-100 text-sky-800", ring: "ring-sky-300" },
];

// How many bars a day shows before the rest collapse into a "+n". Four fits
// a busy week without the month becoming a scroll; a quiet daycare can turn
// it up and see everything at once.
const DENSITIES: { rows: number; label: string }[] = [
  { rows: 3, label: "Compact" },
  { rows: 5, label: "Roomy" },
  { rows: 99, label: "Everything" },
];


export default function BoardingsPage() {
  return (
    <StaffGate title="Calendar">
      <BoardingsInner />
    </StaffGate>
  );
}

function BoardingsInner() {
  // Access is decided by <StaffGate> above; inside here it is granted.
  const unlocked = true;
  const [error, setError] = useState("");
  const [boardings, setBoardings] = useState<Boarding[]>([]);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // What was typed into the lookup box: a phone number, or a name.
  //
  // Kept apart from form.phone, which is the household this reservation is
  // actually for. Searching by name means the number is not known until a dog
  // is picked, and the row written to `boardings` needs the real one.
  const [query, setQuery] = useState("");

  // Dogs on file matching the lookup — staff pick which ones are boarding
  // instead of retyping names by hand. Mirrors the kiosk's lookup +
  // multi-dog picker (see components/KioskForm.tsx).
  const [dogMatches, setDogMatches] = useState<Dog[]>([]);
  const [dogsLoading, setDogsLoading] = useState(false);
  const [dogsChecked, setDogsChecked] = useState(false);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedDogs, setSelectedDogs] = useState<SelectedDog[]>([]);
  const [configByDog, setConfigByDog] = useState<Record<string, DogConfig>>({});

  // Calendar month currently shown — defaults to this month.
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  // Approved meet & greets, which live as a date on the dog rather than as
  // a reservation row. Shown on the same calendar so staff have one place
  // to see what the day holds.
  const [meets, setMeets] = useState<MeetGreet[]>([]);
  // Needed to price a stay whose walks a package covers.
  const [packages, setPackages] = useState<Package[]>([]);
  // Every dog, so a name anywhere on this page can open its profile card.
  const [allDogs, setAllDogs] = useState<Dog[]>([]);
  // Priced pick-ups and payments, so an amount on this page can say whether
  // it has been paid. Without them every figure here was the same green
  // whether it was settled or three weeks overdue.
  const [signins, setSignins] = useState<SignInRecord[]>([]);
  const { stateFor } = useUnpaid();
  const [calView, setCalView] = useState<CalView>("all");
  // Roomy by default: five bars covers all but the busiest days outright,
  // and the whole point of the redesign was to stop hiding bookings.
  const [rowsPerDay, setRowsPerDay] = useState(5);

  useEffect(() => {
    if (unlocked) load();
  }, [unlocked]);

  // The stay report sends staff back here to edit. Read straight from the
  // URL rather than useSearchParams so the page needs no Suspense boundary.
  const openedFromUrl = useRef(false);
  useEffect(() => {
    if (openedFromUrl.current || !boardings.length) return;
    const wanted = new URLSearchParams(window.location.search).get("edit");
    if (!wanted) return;
    const b = boardings.find((x) => x.id === wanted);
    if (!b) return;
    openedFromUrl.current = true;
    startEdit(b);
    window.scrollTo({ top: 0, behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardings]);

  useEffect(() => {
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    // Whatever was picked belonged to the previous number. Editing is
    // pinned to one existing reservation, so its selection stays put —
    // the lookup still runs to resolve that dog's profile photo.
    if (!editingId) {
      setSelectedDogs([]);
      setConfigByDog({});
    }
    const raw = query.trim();
    const digits = raw.replace(/\D/g, "");
    // A name if there is a letter in it. Everything else — digits, dashes,
    // brackets, the spaces formatPhoneInput puts in — is a phone number.
    const byName = /[a-z]/i.test(raw);
    if (byName ? raw.length < 2 : digits.length < 7) {
      setDogMatches([]);
      setDogsChecked(false);
      return;
    }
    lookupTimer.current = setTimeout(async () => {
      setDogsLoading(true);
      try {
        const supabase = getSupabase();
        // The characters PostgREST reads as filter syntax. A comma would end
        // the `or` clause early and a bracket would close it, so a client
        // called O'Brien (Smith, Jr.) searches as plain text instead of
        // returning an error nobody can act on.
        const safe = raw.replace(/[,()%*\\]/g, " ").trim();
        const lookup = supabase.from("dogs").select("*");
        const { data, error: err } = byName
          ? await lookup
              .or(`dog_name.ilike.%${safe}%,last_name.ilike.%${safe}%`)
              .order("dog_name", { ascending: true })
              .limit(25)
          : await lookup.eq("phone", raw).order("created_at", { ascending: true });
        if (err) throw err;
        // Nothing retired can be booked, so nothing retired is offered.
        const found = activeDogs((data as Dog[]) ?? []);
        setDogMatches(found);
        // A number typed in full is the household, whether or not a dog gets
        // picked out of it. A name is not — that phone arrives with the dog.
        if (!byName && !editingId) setForm((f) => ({ ...f, phone: raw }));
        if (editingId) {
          // Backfill the pinned dog's photo now that its profile is loaded.
          setSelectedDogs((prev) =>
            prev.map((d) => {
              const match = found.find(
                (c) => c.dog_name.trim().toLowerCase() === d.dog_name.trim().toLowerCase()
              );
              return match ? { ...d, profile_photo: match.photo_data ?? null } : d;
            })
          );
        } else if (found.length === 1) {
          // A single dog on file selects itself — with several, staff pick
          // which ones are boarding together.
          toggleDog(found[0]);
        }
      } catch (e) {
        console.error("Dog lookup failed:", e);
      } finally {
        setDogsLoading(false);
        setDogsChecked(true);
      }
    }, 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function load() {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data, error: err } = await supabase
        .from("boardings")
        .select("*")
        .order("start_date", { ascending: true });
      if (err) throw err;
      setBoardings((data as Boarding[]) ?? []);

      const { data: pkgData, error: pkgErr } = await supabase.from("packages").select("*");
      if (pkgErr) throw pkgErr;
      setPackages((pkgData as Package[]) ?? []);

      // Priced pick-ups only, to match a stay to the charge it became.
      // Whether that charge is paid is the shared hook's job.
      const { data: signinData, error: signinErr } = await supabase
        .from("signins")
        .select("id, dog_name, dog_id, phone, action, service_type, price, created_at")
        .eq("action", "pick_up")
        .not("price", "is", null);
      if (signinErr) throw signinErr;
      setSignins((signinData as SignInRecord[]) ?? []);

      // Enough of each dog for the hover card. Deliberately not select("*") —
      // this page shows every dog on the books and the enrollment answers
      // would be dead weight.
      const { data: dogData, error: dogListErr } = await supabase
        .from("dogs")
        .select("id, dog_name, last_name, phone, photo_data");
      if (dogListErr) throw dogListErr;
      setAllDogs((dogData as Dog[]) ?? []);

      // Non-fatal: reservations are the point of this page, and an install
      // that has not run the meet-and-greet migration yet should still get
      // its calendar rather than an error.
      //
      // Only the columns the calendar needs — `clients` rows carry photo
      // and document data that would be pointless to pull here.
      try {
        const fetchMeets = (columns: string) =>
          supabase
            .from("dogs")
            .select(columns)
            .not("meet_greet_on", "is", null)
            .order("meet_greet_on", { ascending: true });

        let { data: meetData, error: meetErr } = await fetchMeets(MEET_COLUMNS);
        if (meetErr) {
          // No retired_at column: dog-retire-migration.sql has not been run
          // here. Asking for a column that does not exist fails the whole
          // query, and the calendar predates retiring — it works without it.
          console.warn("Falling back to the pre-retire columns:", meetErr.message);
          ({ data: meetData, error: meetErr } = await fetchMeets(LEGACY_MEET_COLUMNS));
        }
        if (meetErr) throw meetErr;
        // A retired dog has no meet & greet coming up. Filtered here rather
        // than in the query so the fallback above still returns its rows.
        setMeets(activeDogs((meetData as unknown as MeetGreet[]) ?? []));
      } catch (e) {
        console.error("Loading meet & greets failed:", e);
      }
    } catch (e) {
      console.error("Loading boardings failed:", e);
      setError("Could not load boarding reservations.");
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setQuery("");
    setEditingId(null);
    setDogMatches([]);
    setDogsChecked(false);
    setSelectedDogs([]);
    setConfigByDog({});
  }

  function configFor(key: string): DogConfig {
    return configByDog[key] ?? EMPTY_DOG_CONFIG;
  }

  function updateConfig(key: string, patch: Partial<DogConfig>) {
    setConfigByDog((prev) => ({ ...prev, [key]: { ...(prev[key] ?? EMPTY_DOG_CONFIG), ...patch } }));
  }

  // Adds/removes a dog from this booking. Each dog keeps its own add-on
  // config, seeded blank the first time it's picked.
  function toggleDog(c: Dog) {
    const key = c.id ?? c.dog_name;
    const dogPhone = (c.phone ?? "").trim();
    // A name search can return two households at once — three dogs called
    // Buki belonging to three different families. One reservation covers one
    // family, so picking a dog from a different number starts that family's
    // booking rather than adding a stranger's dog to this one.
    const switching =
      !!dogPhone &&
      !!form.phone &&
      dogPhone.replace(/\D/g, "") !== form.phone.replace(/\D/g, "");

    setSelectedDogs((prev) => {
      if (!switching && prev.some((d) => d.key === key)) {
        return prev.filter((d) => d.key !== key);
      }
      const picked = {
        key,
        dog_name: c.dog_name,
        last_name: c.last_name,
        dog_id: c.id ?? null,
        profile_photo: c.photo_data ?? null,
      };
      return switching ? [picked] : [...prev, picked];
    });
    setConfigByDog((prev) =>
      switching ? { [key]: EMPTY_DOG_CONFIG } : prev[key] ? prev : { ...prev, [key]: EMPTY_DOG_CONFIG }
    );
    // The number the reservation is written against. Typing a phone sets this
    // already; picking a dog by name is the only way it gets set otherwise.
    if (dogPhone) setForm((f) => ({ ...f, phone: dogPhone }));
  }

  function toggleDogAddon(key: string, addon: BoardingAddonKey) {
    const current = configFor(key).addons;
    updateConfig(key, {
      addons: current.includes(addon) ? current.filter((a) => a !== addon) : [...current, addon],
    });
  }

  // Editing works on one existing reservation at a time — it maps to a
  // single boardings row, so the picker collapses to just that dog.
  function startEdit(b: Boarding) {
    setEditingId(b.id ?? null);
    const key = b.dog_id ?? MANUAL_KEY;
    // Drives the lookup, which is what backfills the dog's photo below.
    setQuery(b.phone);
    setForm({
      phone: b.phone,
      start_date: b.start_date,
      end_date: b.end_date,
      notes: b.notes ?? "",
    });
    setSelectedDogs([
      {
        key,
        dog_name: b.dog_name,
        last_name: b.last_name,
        dog_id: b.dog_id ?? null,
        // Filled in by the lookup effect below once the client is found.
        profile_photo: null,
      },
    ]);
    setConfigByDog({
      [key]: {
        addons: b.addons ?? [],
        walks_per_day: b.walks_per_day ?? 1,
        bath_size: b.bath_size ?? "",
        medication_instructions: b.medication_instructions ?? "",
        feeding_instructions: b.feeding_instructions ?? "",
        photo_data: b.photo_data ?? "",
      },
    });
  }

  async function handlePhotoChange(key: string, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    try {
      const dataUrl = await fileToBudgetedJpeg(file, 640, 120 * 1024);
      updateConfig(key, { photo_data: dataUrl });
    } catch (err) {
      console.error("Reading photo failed:", err);
      setError("Could not read that photo — try a different file.");
    }
  }

  // Builds the boardings row for one dog — its own add-ons, food, and
  // photo, plus the phone/dates shared across the booking.
  function payloadFor(dog: SelectedDog) {
    const cfg = configFor(dog.key);
    return {
      dog_name: dog.dog_name.trim(),
      last_name: dog.last_name.trim(),
      phone: form.phone.trim(),
      dog_id: dog.dog_id,
      start_date: form.start_date,
      end_date: form.end_date,
      feeding_instructions: cfg.feeding_instructions.trim() || null,
      notes: form.notes.trim() || null,
      addons: cfg.addons,
      walks_per_day: cfg.addons.includes("walk") ? Math.max(1, cfg.walks_per_day) : null,
      bath_size: cfg.addons.includes("bath") && cfg.bath_size ? cfg.bath_size : null,
      medication_instructions: cfg.addons.includes("medication")
        ? cfg.medication_instructions.trim() || null
        : null,
      photo_data: cfg.photo_data || null,
    };
  }

  async function saveBoarding() {
    if (selectedDogs.length === 0) {
      setError("Find the client, then pick which dog (or dogs) this reservation is for.");
      return;
    }
    // Only reachable from a dog with no number on its profile: a name search
    // takes the phone off the dog that was picked, and a phone search has one
    // by definition. Saving anyway would write a reservation the stay report
    // and the sign-in screen both look up by phone and never find.
    if (!form.phone.trim()) {
      setError(
        `No phone number on ${selectedDogs[0].dog_name}'s profile — add one there first, or search by number.`
      );
      return;
    }
    if (!form.start_date || !form.end_date) {
      setError("Enter both dates.");
      return;
    }
    if (form.end_date < form.start_date) {
      setError("End date can't be before the start date.");
      return;
    }
    if (conflicts.length) {
      setError(
        `${conflicts.map((d) => d.dog_name).join(", ")} already ${
          conflicts.length > 1 ? "have reservations" : "has a reservation"
        } overlapping these dates — edit the existing one instead of booking a duplicate.`
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      const supabase = getSupabase();
      if (editingId) {
        const { error: err } = await supabase.from("boardings").update(payloadFor(selectedDogs[0])).eq("id", editingId);
        if (err) throw err;
      } else {
        // One row per dog — each dog's stay is tracked, printed, and
        // priced separately even though they were booked together.
        const { error: err } = await supabase.from("boardings").insert(selectedDogs.map(payloadFor));
        if (err) throw err;
      }
      resetForm();
      load();
    } catch (e) {
      console.error("Saving boarding failed:", e);
      setError("Could not save the reservation.");
    } finally {
      setSaving(false);
    }
  }


  // An existing reservation for this dog whose dates overlap the ones
  // being entered — two stays for the same dog can't run at once, so this
  // blocks the booking rather than quietly creating a duplicate. Matches
  // on dog_id when the reservation has one, falling back to
  // dog name + phone for rows created before dog_id was stored.
  function conflictingBoardingFor(dog: SelectedDog): Boarding | null {
    if (!form.start_date || !form.end_date) return null;
    return (
      boardings.find((b) => {
        if (b.id && b.id === editingId) return false; // the row being edited
        const sameDog = b.dog_id && dog.dog_id
          ? b.dog_id === dog.dog_id
          : b.dog_name.trim().toLowerCase() === dog.dog_name.trim().toLowerCase() &&
            b.phone.replace(/\D/g, "") === form.phone.replace(/\D/g, "");
        if (!sameDog) return false;
        return b.start_date <= form.end_date && b.end_date >= form.start_date;
      }) ?? null
    );
  }

  const conflicts = useMemo(
    () => selectedDogs.filter((d) => conflictingBoardingFor(d) !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedDogs, boardings, form.start_date, form.end_date, form.phone, editingId]
  );

  // Combined estimate across every dog on this booking — null while the
  // dates are incomplete or backwards, since there's nothing to price.
  const bookingTotal = useMemo(() => {
    if (!form.start_date || !form.end_date || form.end_date < form.start_date) return null;
    return selectedDogs.reduce((sum, dog) => {
      const cfg = configByDog[dog.key] ?? EMPTY_DOG_CONFIG;
      return (
        sum +
        estimateBoardingTotal(form.start_date, form.end_date, {
          addons: cfg.addons,
          walksPerDay: cfg.walks_per_day,
          bathSize: cfg.bath_size || null,
        }).amount
      );
    }, 0);
  }, [form.start_date, form.end_date, selectedDogs, configByDog]);

  // The month on the grid is what the lists below describe.
  //
  // They used to be "everything from today onwards" and "everything before",
  // so paging the calendar to September changed the grid and left the lists
  // still talking about today — one screen giving two answers to the same
  // question. Scoping them to the shown month also means the month arrows are
  // how you reach history, which is what they looked like they did anyway.
  const monthRange = useMemo(() => {
    const from = dateKey(new Date(calMonth.getFullYear(), calMonth.getMonth(), 1));
    const to = dateKey(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0));
    return { from, to };
  }, [calMonth]);

  // A stay counts as being in the month if any night of it falls inside —
  // an August list that hid a stay running 30 July to 3 August would be
  // hiding a dog who is here for most of the first week.
  const monthBoardings = useMemo(
    () =>
      boardings
        .filter((b) => b.start_date <= monthRange.to && b.end_date >= monthRange.from)
        .sort((a, b) => a.start_date.localeCompare(b.start_date)),
    [boardings, monthRange]
  );

  // A reservation is only a charge once the dog has been signed out — that is
  // the pick-up row that carries the price. Until then the figure on screen
  // is an estimate of a stay that has not happened, and nothing is owed.
  function stayPayState(b: Boarding): PayState {
    const match = signins.find(
      (r) =>
        r.phone?.replace(/\D/g, "") === b.phone.replace(/\D/g, "") &&
        (b.dog_id && r.dog_id
          ? r.dog_id === b.dog_id
          : r.dog_name?.trim().toLowerCase() === b.dog_name.trim().toLowerCase()) &&
        !!r.created_at &&
        dateKey(new Date(r.created_at)) === b.end_date
    );
    if (!match?.id) return "estimate";
    return stateFor(signinChargeKey(match.id));
  }

  // Stable colour per reservation id so the same stay keeps its colour
  // across the month grid and the list below.
  const colorFor = useMemo(() => {
    const map = new Map<string, (typeof RESERVATION_COLORS)[number]>();
    boardings.forEach((b, i) => {
      if (b.id) map.set(b.id, RESERVATION_COLORS[i % RESERVATION_COLORS.length]);
    });
    return map;
  }, [boardings]);

  // 6x7 calendar grid for calMonth, padded with the trailing days of
  // the previous/next month so every week row is full.
  const calendarDays = useMemo(() => {
    const firstOfMonth = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1);
    const startPad = firstOfMonth.getDay(); // 0 = Sunday
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(gridStart.getDate() - startPad);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
  }, [calMonth]);

  // The grid is drawn a week at a time, because a bar can only span days that
  // sit on the same row.
  const weeks = useMemo(() => {
    const out: Date[][] = [];
    for (let i = 0; i < calendarDays.length; i += 7) out.push(calendarDays.slice(i, i + 7));
    return out;
  }, [calendarDays]);

  // Flattened into what the grid draws: a name, a colour and a span. Doing
  // the mapping here keeps the grid ignorant of what a boarding is.
  const calEntries = useMemo<MonthEntry[]>(() => {
    const out: MonthEntry[] = [];
    if (calView !== "meets") {
      boardings.forEach((b) => {
        if (!b.id) return;
        out.push({
          id: `b${b.id}`,
          kind: "stay",
          start: b.start_date,
          end: b.end_date,
          name: b.dog_name,
          detail: `${b.dog_name} (${b.last_name}) · ${prettyDateKey(
            b.start_date
          )} → ${prettyDateKey(b.end_date)}`,
          dog: dogForBoarding(b),
          color: colorFor.get(b.id)?.bar ?? "",
        });
      });
    }
    if (calView !== "boardings") {
      meets.forEach((m) =>
        out.push({
          id: `m${m.id}`,
          kind: "meet",
          start: m.meet_greet_on,
          end: m.meet_greet_on,
          name: m.dog_name,
          detail: `Meet & greet · ${m.dog_name} (${m.last_name})${
            m.meet_greet_window ? ` · ${m.meet_greet_window}` : ""
          }`,
          dog: meetAsDog(m),
          color: "bg-violet-100 text-violet-800",
          icon: "✨",
        })
      );
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardings, meets, calView, colorFor, allDogs]);

  // The headline numbers for the month on screen. Reading a total off a grid
  // by counting bars is exactly the thing a grid is bad at, and the busiest
  // day is the number that decides whether another booking fits.
  const monthStats = useMemo(() => {
    const from = dateKey(new Date(calMonth.getFullYear(), calMonth.getMonth(), 1));
    const to = dateKey(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0));
    const stays = boardings.filter((b) => b.start_date <= to && b.end_date >= from);
    const monthMeets = meets.filter((m) => m.meet_greet_on >= from && m.meet_greet_on <= to);

    let peak = 0;
    for (const d of calendarDays) {
      const key = dateKey(d);
      if (key < from || key > to) continue;
      peak = Math.max(peak, stays.filter((b) => b.start_date <= key && b.end_date >= key).length);
    }
    return { stays: stays.length, meets: monthMeets.length, peak };
  }, [boardings, meets, calMonth, calendarDays]);

  function boardingsOn(day: string): Boarding[] {
    if (calView === "meets") return [];
    return boardings.filter((b) => b.start_date <= day && b.end_date >= day);
  }

  // Older reservations predate dog_id, so fall back to phone + name.
  function dogForBoarding(b: Boarding): Dog | null {
    return findDog(allDogs, { dogId: b.dog_id, dogName: b.dog_name, phone: b.phone });
  }

  function meetsOn(day: string): MeetGreet[] {
    if (calView === "boardings") return [];
    return meets.filter((m) => m.meet_greet_on === day);
  }

  const monthMeets = useMemo(
    () =>
      meets
        .filter((m) => m.meet_greet_on >= monthRange.from && m.meet_greet_on <= monthRange.to)
        .sort((a, b) => a.meet_greet_on.localeCompare(b.meet_greet_on)),
    [meets, monthRange]
  );

  const monthLabel = calMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const today = todayKey();
  const selectedDayBoardings = selectedDay ? boardingsOn(selectedDay) : [];
  const selectedDayMeets = selectedDay ? meetsOn(selectedDay) : [];
  // Which kind of lookup is on screen. A name can match dogs from several
  // households, so the results have to say more than a phone lookup's do.
  const searchingByName = /[a-z]/i.test(query.trim());

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <StaffNav current="/calendar" />
      <h1 className="font-display mb-6 text-xl font-semibold text-ink">Calendar</h1>

      <div className="mb-8 rounded-2xl border border-line bg-surface p-5 shadow-card">
        <p className="mb-4 text-sm font-medium text-ink-2">
          {editingId ? "Edit reservation" : "Add a new reservation"}
        </p>
        {/* Dog lookup — staff find the client, then pick the dog from what's
            already on file instead of retyping names. Either the number or a
            name gets there: the phone is exact and unambiguous, but it is not
            what a client says at the desk, and it is not what staff remember
            about the dog in front of them. */}
        <div className="mb-3">
          <label className="mb-1 block text-[11px] text-ink-3" htmlFor="client-lookup">
            Client
          </label>
          <input
            id="client-lookup"
            value={query}
            onChange={(e) => {
              const typed = e.target.value;
              // Formatted as a phone only while it could still be one. Doing
              // it unconditionally would strip the letters out of a name.
              setQuery(/[a-z]/i.test(typed) ? typed : formatPhoneInput(typed));
            }}
            placeholder="Name or phone number"
            className="w-full max-w-xs rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
          />

          {dogsLoading && <p className="mt-2 text-xs text-ink-3">Looking up…</p>}

          {!dogsLoading && dogsChecked && dogMatches.length === 0 && (
            <p className="mt-2 text-xs text-amber-700">
              {searchingByName
                ? `Nothing on file matching “${query.trim()}” — try the last name, or the phone number.`
                : "No dog on file for that number — the client needs an approved enrollment first."}
            </p>
          )}

          {editingId && selectedDogs.length > 0 && (
            <p className="mt-2 text-xs text-ink-3">
              Editing {selectedDogs[0].dog_name}&apos;s reservation · {selectedDogs[0].last_name}
            </p>
          )}

          {!editingId && dogMatches.length > 0 && (
            <div className="mt-2">
              <p className="mb-1 text-[11px] text-ink-3">
                {dogMatches.length === 1
                  ? "Dog on file"
                  : searchingByName
                    ? // Two families can both have a dog called Buki, and one
                      // reservation belongs to one of them. Picking across
                      // households starts that household's booking instead of
                      // adding to this one — hence the warning rather than the
                      // "tap all of them" wording below.
                      "Matching dogs. Tap the right one — check the number if there are two of a name."
                    : "Which dog (or dogs)? Tap all that are boarding together."}
              </p>
              <div className="flex flex-wrap gap-2">
                {dogMatches.map((c) => {
                  const key = c.id ?? c.dog_name;
                  const selected = selectedDogs.some((d) => d.key === key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleDog(c)}
                      className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3.5 text-xs font-medium transition ${
                        selected
                          ? "border-accent-500 bg-accent-500 text-accent-ink"
                          : "border-accent-200 bg-surface text-accent-700 hover:border-accent-400"
                      }`}
                    >
                      {c.photo_data ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.photo_data}
                          alt={`${c.dog_name}'s photo`}
                          className="h-7 w-7 rounded-full object-cover ring-1 ring-white/60"
                        />
                      ) : (
                        <span
                          className={`flex h-7 w-7 items-center justify-center rounded-full text-sm ${
                            selected ? "bg-white/20" : "bg-accent-50"
                          }`}
                        >
                          🐕
                        </span>
                      )}
                      <span className="text-left">
                        {selected ? "✓ " : ""}
                        {c.dog_name} · {c.last_name}
                        {/* The number is what tells two dogs of the same name
                            apart, so a name search shows it. A phone search
                            already knows it — every result has the same one. */}
                        {searchingByName && c.phone && (
                          <span
                            className={`block text-[10px] font-normal ${
                              selected ? "text-accent-ink/70" : "text-ink-3"
                            }`}
                          >
                            {c.phone}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-[11px] text-ink-3">Drop-off date</label>
            <DateField
              value={form.start_date}
              onChange={(v) => setForm({ ...form, start_date: v })}
              className="w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
              ariaLabel="Drop-off date"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-ink-3">Pick-up date</label>
            <DateField
              value={form.end_date}
              onChange={(v) => setForm({ ...form, end_date: v })}
              className="w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
              ariaLabel="Pick-up date"
            />
          </div>
          <input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Notes (optional)"
            className="rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
          />
        </div>

        {/* Per-dog add-ons, food, and photo — one card per selected dog,
            since two dogs on the same booking rarely want the same thing. */}
        {selectedDogs.length > 0 && (
          <div className="mt-4 space-y-3 border-t border-line-soft pt-4">
            {selectedDogs.map((dog) => {
              const cfg = configFor(dog.key);
              const datesValid = form.start_date && form.end_date && form.end_date >= form.start_date;
              const dogTotal = datesValid
                ? estimateBoardingTotal(form.start_date, form.end_date, {
                    addons: cfg.addons,
                    walksPerDay: cfg.walks_per_day,
                    bathSize: cfg.bath_size || null,
                  }).amount
                : 0;
              const conflict = conflictingBoardingFor(dog);
              return (
                <div
                  key={dog.key}
                  className={`rounded-2xl border p-4 ${
                    conflict ? "border-rose-200 bg-rose-50/60" : "border-line bg-surface-2/60"
                  }`}
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      {dog.profile_photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={dog.profile_photo}
                          alt={`${dog.dog_name}'s photo`}
                          className="h-10 w-10 rounded-full object-cover ring-2 ring-white"
                        />
                      ) : (
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-lg ring-2 ring-white">
                          🐕
                        </span>
                      )}
                      <p className="text-sm font-medium text-ink">
                        {dog.dog_name} <span className="font-normal text-ink-3">· {dog.last_name}</span>
                      </p>
                    </div>
                    {datesValid && (
                      <span className="text-xs font-medium text-emerald-700">${dogTotal.toFixed(2)}</span>
                    )}
                  </div>

                  {conflict && (
                    <p className="mb-2 rounded-lg bg-rose-100 px-2.5 py-1.5 text-xs font-medium text-rose-700">
                      🛏️ {dog.dog_name} already has a reservation for {conflict.start_date} →{" "}
                      {conflict.end_date}, which overlaps these dates. Edit that one instead of booking a
                      duplicate.
                    </p>
                  )}

                  <label className="mb-1.5 block text-[11px] text-ink-3">Add-ons for {dog.dog_name}</label>
                  <div className="flex flex-wrap gap-2">
                    {BOARDING_ADDONS.map((a) => (
                      <button
                        key={a.key}
                        type="button"
                        onClick={() => toggleDogAddon(dog.key, a.key)}
                        className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                          cfg.addons.includes(a.key)
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                            : "border-line bg-surface text-ink-3 hover:border-line"
                        }`}
                      >
                        {a.icon} {a.label}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {cfg.addons.includes("walk") && (
                      <div>
                        <label className="mb-1 block text-[11px] text-ink-3">Walks per day</label>
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={cfg.walks_per_day}
                          onChange={(e) =>
                            updateConfig(dog.key, { walks_per_day: Math.max(1, Number(e.target.value) || 1) })
                          }
                          className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
                        />
                      </div>
                    )}
                    {cfg.addons.includes("bath") && (
                      <div>
                        <label className="mb-1 block text-[11px] text-ink-3">Bath size</label>
                        <select
                          value={cfg.bath_size}
                          onChange={(e) => updateConfig(dog.key, { bath_size: e.target.value as BathSize | "" })}
                          className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
                        >
                          <option value="">Select size…</option>
                          <option value="S">Small</option>
                          <option value="M">Medium</option>
                          <option value="L">Large</option>
                        </select>
                      </div>
                    )}
                    {cfg.addons.includes("medication") && (
                      <div className="sm:col-span-3">
                        <label className="mb-1 block text-[11px] text-ink-3">
                          Medication instructions (dosage, timing — shown on the printed report)
                        </label>
                        <textarea
                          value={cfg.medication_instructions}
                          onChange={(e) => updateConfig(dog.key, { medication_instructions: e.target.value })}
                          rows={2}
                          className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
                        />
                      </div>
                    )}
                    <textarea
                      value={cfg.feeding_instructions}
                      onChange={(e) => updateConfig(dog.key, { feeding_instructions: e.target.value })}
                      placeholder={`Feeding instructions for ${dog.dog_name} (shown on the printed report)`}
                      rows={2}
                      className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100 sm:col-span-3"
                    />
                  </div>

                </div>
              );
            })}

            {selectedDogs.length > 1 && bookingTotal !== null && (
              <p className="text-xs font-medium text-ink-3">
                Estimated total for {selectedDogs.length} dogs:{" "}
                <span className="text-emerald-700">${bookingTotal.toFixed(2)}</span>
              </p>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={saveBoarding}
            disabled={saving || conflicts.length > 0}
            className="rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-medium text-accent-ink shadow-card hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving
              ? "Saving…"
              : conflicts.length > 0
                ? "Already booked"
                : editingId
                  ? "Save changes"
                  : selectedDogs.length > 1
                    ? `Add ${selectedDogs.length} reservations`
                    : "Add reservation"}
          </button>
          {editingId && (
            <button
              onClick={resetForm}
              className="rounded-xl border border-line px-5 py-2.5 text-sm text-ink-3 hover:border-line"
            >
              Cancel
            </button>
          )}
        </div>
        {error && <p className="mt-3 text-xs font-medium text-rose-500">{error}</p>}
      </div>

      {/* Calendar */}
      <div className="mb-8 rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {CAL_VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => setCalView(v.key)}
              className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                calView === v.key
                  ? "bg-accent-500 text-accent-ink shadow-card"
                  : "border border-line bg-surface text-ink-2 hover:border-accent-300"
              }`}
            >
              {v.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1">
            <span className="mr-1 text-[11px] text-ink-3">Rows per day</span>
            {DENSITIES.map((d) => (
              <button
                key={d.rows}
                onClick={() => setRowsPerDay(d.rows)}
                title={
                  d.rows === 99
                    ? "Show every booking, however tall the month gets"
                    : `Show ${d.rows} per day, then a count`
                }
                className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                  rowsPerDay === d.rows
                    ? "bg-accent-500 text-accent-ink"
                    : "border border-line bg-surface text-ink-2 hover:border-accent-300"
                }`}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-3 flex items-center justify-between">
          <button
            onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))}
            className="rounded-lg border border-line px-2.5 py-1 text-sm text-ink-3 hover:border-line"
          >
            ←
          </button>
          <div className="text-center">
            <p className="text-sm font-medium text-ink-2">{monthLabel}</p>
            {/* The totals a month grid cannot show: you cannot count bars
                that run across rows, and the busiest day is the number that
                decides whether one more booking fits. */}
            <p className="text-[11px] text-ink-3">
              {monthStats.stays === 0 && monthStats.meets === 0
                ? "Nothing booked"
                : [
                    monthStats.stays > 0 &&
                      `${monthStats.stays} stay${monthStats.stays === 1 ? "" : "s"}`,
                    monthStats.meets > 0 &&
                      `${monthStats.meets} meet & greet${monthStats.meets === 1 ? "" : "s"}`,
                    monthStats.peak > 0 && `busiest day ${monthStats.peak}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </p>
          </div>
          <button
            onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))}
            className="rounded-lg border border-line px-2.5 py-1 text-sm text-ink-3 hover:border-line"
          >
            →
          </button>
        </div>
        <MonthGrid
          month={calMonth}
          weeks={weeks}
          entries={calEntries}
          rowsPerDay={rowsPerDay}
          today={today}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
        />

        {selectedDay && (
          <div className="mt-4 rounded-xl border border-line-soft bg-surface-2 px-4 py-3">
            <p className="mb-2 text-xs font-medium text-ink-2">{prettyDateKey(selectedDay)}</p>
            {selectedDayBoardings.length === 0 && selectedDayMeets.length === 0 ? (
              <p className="text-xs text-ink-3">Nothing booked that day.</p>
            ) : (
              <ul className="space-y-1 text-xs text-ink-2">
                {selectedDayMeets.map((m) => (
                  <li key={m.id}>
                    ✨{" "}
                    <DogLink dog={meetAsDog(m)} name={m.dog_name} />{" "}
                    ({m.last_name}) · {m.phone} · meet &amp; greet
                    {m.meet_greet_window ? ` · ${m.meet_greet_window}` : ""}
                  </li>
                ))}
                {selectedDayBoardings.map((b) => (
                  <li key={b.id}>
                    🐕 <DogLink dog={dogForBoarding(b)} name={b.dog_name} /> ({b.last_name}) ·{" "}
                    {b.phone} · {b.start_date} → {b.end_date}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* List. Both sections describe the month shown on the grid above, so
          paging the calendar moves them with it. */}
      {loading ? (
        <p className="text-sm text-ink-3">Loading…</p>
      ) : (
        <>
          {/* The view pills above choose which of these is on screen, so the
              filter that decides what the grid shows decides what the list
              shows too — picking Boardings and still being handed a page of
              meet and greets was the grid and the list disagreeing again. */}
          {calView !== "meets" && (
          <details open className="group mb-8">
            <summary className="mb-3 flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-ink-2">
                <span className="mr-1 inline-block text-[10px] text-ink-3 transition group-open:rotate-90">
                  ▶
                </span>
                Reservations in {monthLabel}
              </span>
              {monthBoardings.length > 0 && (
                <span className="text-[11px] text-ink-3">
                  {monthBoardings.length} stay{monthBoardings.length === 1 ? "" : "s"}
                </span>
              )}
            </summary>
          <div className="space-y-2">
            {monthBoardings.map((b) => (
              <BoardingRow
                key={b.id}
                b={b}
                dog={dogForBoarding(b)}
                packages={packages}
                color={b.id ? colorFor.get(b.id) : undefined}
                payState={stayPayState(b)}
              />
            ))}
            {monthBoardings.length === 0 && (
              <p className="rounded-2xl border border-line bg-surface px-4 py-6 text-center text-sm text-ink-3">
                No reservations in {monthLabel}.
              </p>
            )}
          </div>
          </details>
          )}

          {/* Meet & greets, listed like the reservations above. They are a
              date on the dog rather than a reservation row, so the row links
              to the profile — where the date and window are edited — instead
              of an edit form here. */}
          {calView !== "boardings" && (
          <details open className="group mb-8">
            <summary className="mb-3 flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-ink-2">
                <span className="mr-1 inline-block text-[10px] text-ink-3 transition group-open:rotate-90">
                  ▶
                </span>
                Meet &amp; greets in {monthLabel}
              </span>
              {monthMeets.length > 0 && (
                <span className="text-[11px] text-ink-3">{monthMeets.length} booked</span>
              )}
            </summary>
          <div className="space-y-2">
            {monthMeets.map((m) => (
              <MeetGreetRow key={m.id} m={m} />
            ))}
            {monthMeets.length === 0 && (
              <p className="rounded-2xl border border-line bg-surface px-4 py-6 text-center text-sm text-ink-3">
                No meet &amp; greets in {monthLabel}.
              </p>
            )}
          </div>
          </details>
          )}
        </>
      )}
    </div>
  );
}

/** The meets query selects exactly the fields the hover card reads. */
function meetAsDog(m: MeetGreet): Dog {
  return {
    id: m.id,
    dog_name: m.dog_name,
    last_name: m.last_name,
    phone: m.phone,
    photo_data: m.photo_data ?? null,
    drop_off_by: "",
    signature_data: "",
  };
}


// The shape every schedule row uses, so boardings and meet & greets line up
// column for column instead of each inventing its own layout.
function ScheduleRow({
  dog,
  name,
  owner,
  phone,
  accent,
  when,
  detail,
  amount,
  extras,
  actions,
}: {
  dog: Dog | null;
  name: string;
  owner: string;
  phone: string;
  /** Tailwind classes for the leading avatar ring — ties a stay to its calendar colour. */
  accent: string;
  when: string;
  detail?: string | null;
  amount?: React.ReactNode;
  extras?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-card">
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full ring-2 ${accent}`}
      >
        {dog?.photo_data ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dog.photo_data} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-base">🐕</span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">
          <DogLink dog={dog} name={name} />
          <span className="ml-1.5 font-normal text-ink-3">· {owner}</span>
        </p>
        <p className="truncate text-xs text-ink-3">{phone}</p>
        {extras}
      </div>

      <div className="shrink-0 text-right">
        <p className="whitespace-nowrap text-sm font-medium text-ink-2">{when}</p>
        {detail && <p className="whitespace-nowrap text-xs text-ink-3">{detail}</p>}
        {amount && <p className="whitespace-nowrap text-xs font-medium">{amount}</p>}
      </div>

      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

// A meet & greet in the list. Read-only here on purpose: the date lives on
// the dog, so the link goes where it can be changed.
function MeetGreetRow({ m }: { m: MeetGreet }) {
  return (
    <ScheduleRow
      dog={meetAsDog(m)}
      name={m.dog_name}
      owner={m.last_name}
      phone={m.phone}
      accent="ring-violet-300"
      when={prettyDateKey(m.meet_greet_on)}
      detail={m.meet_greet_window ?? "Meet & greet"}
      extras={
        <p className="mt-0.5 text-xs text-violet-700">✨ Meet &amp; greet</p>
      }
      actions={
        <Link
          href={dogHref(m.id)}
          className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-accent-300"
        >
          Profile →
        </Link>
      }
    />
  );
}

function BoardingRow({
  b,
  dog,
  color,
  packages,
  payState,
}: {
  b: Boarding;
  dog: Dog | null;
  color?: { bar: string; ring: string };
  packages: Package[];
  payState: PayState;
}) {
  const total = estimateBoardingTotal(b.start_date, b.end_date, {
    addons: b.addons ?? [],
    walksPerDay: b.walks_per_day,
    bathSize: b.bath_size ?? null,
  }).amount;
  const addonLabels = (b.addons ?? [])
    .map((a) => BOARDING_ADDONS.find((x) => x.key === a)?.label)
    .filter(Boolean)
    .join(", ");

  return (
    <ScheduleRow
      dog={dog}
      name={b.dog_name}
      owner={b.last_name}
      phone={b.phone}
      accent={color?.ring ?? "ring-line"}
      when={`${prettyDateKey(b.start_date)} → ${prettyDateKey(b.end_date)}`}
      detail={`${nightsBetweenKeys(b.start_date, b.end_date)} night${
        nightsBetweenKeys(b.start_date, b.end_date) === 1 ? "" : "s"
      }`}
      amount={<Money amount={total} state={payState} />}
      extras={
        <>
          {addonLabels && <p className="mt-0.5 truncate text-xs text-ink-3">➕ {addonLabels}</p>}
          {b.feeding_instructions && (
            <p className="mt-0.5 truncate text-xs text-ink-3">🍽️ {b.feeding_instructions}</p>
          )}
        </>
      }
      actions={
        <Link
          href={`/stay-report?boardingId=${b.id}`}
          className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-accent-300"
        >
          Details →
        </Link>
      }
    />
  );
}
