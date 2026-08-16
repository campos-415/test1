"use client";

import { ChangeEvent, Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { prettyDateKey } from "@/lib/dates";
import { getSupabase } from "@/lib/supabase";
import { fileToBudgetedJpeg, unreadableImageMessage } from "@/lib/image";
import {
  BATH_PRICES,
  estimateBoardingTotal,
  estimatePrice,
  isFullDayVisit,
  nightsBetweenKeys,
  PriceEstimate,
} from "@/lib/pricing";
import {
  BOARDING_ADDONS,
  AddonKey,
  ADDONS,
  BathSize,
  Boarding,
  Dog,
  Package,
  ServiceType,
  SERVICE_TYPES,
  PackageKind,
  MeetGreetResult,
  MealKey,
  MEALS,
  PackageUse,
  SignInRecord,
  WalkLog,
} from "@/types";
import {
  daysLeft,
  findDog,
  findPackageFor,
  eligiblePackagesFor,
  packageBillingPickUp,
  packageLabel,
  packageKind,
  packagesBoughtOn,
} from "@/lib/dogs";
import { sendDetailsRequest } from "@/lib/enrollment";
import StaffNav from "@/components/StaffNav";
import Money from "@/components/Money";
import { useUnpaid } from "@/components/useUnpaid";
import { signinChargeKey } from "@/lib/billing";
import { StaffSelect, TimeSelect, WalkSelect } from "@/components/WalkFields";
import StaffGate from "@/components/StaffGate";
import DateField from "@/components/DateField";
import { useSettings } from "@/components/SettingsProvider";
import DogLink from "@/components/DogLink";
import StaffCheckIn from "@/components/StaffCheckIn";
import CardTable from "@/components/CardTable";

const BATH_SIZES: BathSize[] = ["S", "M", "L"];

type SortKey =
  | "dog_name"
  | "status"
  | "last_name"
  | "phone"
  | "service"
  | "drop_off_by"
  | "pick_up_time"
  | "drop_off_time"
  | "pick_up_by"
  | "price";

// A dog is still here if it was dropped off and no pick-up has been logged
// after it. A row with only a pick-up (a manual correction) counts as gone.
function isStillIn(r: MergedRow): boolean {
  return !!r.drop_off_time && !r.pick_up_time;
}

const SORT_LABELS: Record<SortKey, string> = {
  dog_name: "dog",
  status: "status",
  last_name: "last name",
  phone: "phone",
  service: "service",
  drop_off_by: "drop-off by",
  drop_off_time: "drop-off time",
  pick_up_by: "picked-up by",
  pick_up_time: "pick-up time",
  price: "price",
};

function timeValue(iso?: string): number | null {
  return iso ? new Date(iso).getTime() : null;
}

// Blank cells always sort last, in both directions — a dog still here has no
// pick-up time, and reversing the column shouldn't float it to the top as if
// it were the earliest. Direction is applied only to real comparisons.
function compareBy(
  a: string | number | null,
  b: string | number | null,
  dir: 1 | -1
): number {
  const aBlank = a == null || a === "";
  const bBlank = b == null || b === "";
  if (aBlank && bBlank) return 0;
  if (aBlank) return 1;
  if (bBlank) return -1;
  const cmp =
    typeof a === "string" && typeof b === "string" ? a.localeCompare(b) : Number(a) - Number(b);
  return cmp * dir;
}

type WalkField = "walk_out" | "walk_in" | "walk_staff_initials";

// One line on the printable walk log. Daycare and boarding walks come from
// different tables and save differently, so each row carries its own save
// function and the table just renders them.
// How long a walk took, from the two logged times. Null unless both are set
// and parse — the stored format is display text ("9:30am"), not a timestamp,
// and older rows hold whatever staff typed before these became dropdowns.
function walkMinutes(out: string, back: string): number | null {
  const parse = (t: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(t.trim());
    if (!m) return null;
    let hour = Number(m[1]) % 12;
    if (m[3].toLowerCase() === "pm") hour += 12;
    return hour * 60 + Number(m[2]);
  };
  const a = parse(out);
  const b = parse(back);
  if (a == null || b == null) return null;
  const diff = b - a;
  // A walk that comes back before it left is a typo, not a negative walk.
  return diff > 0 ? diff : null;
}

interface WalkRow {
  // Set on boarding rows: the reservation this walk belongs to, so the walk
  // package picker can point the whole stay at a block.
  boarding?: Boarding;
  key: string;
  service: "daycare" | "boarding";
  // Present on daycare rows: the merged visit behind this walk, so its walk
  // package can be resolved and changed from the log.
  row?: MergedRow;
  dogName: string;
  phone: string;
  dogId?: string;
  handler: string;
  lastName: string;
  slot: string;
  /** 1-based position and total, so the row can render "Walk 2 of 3". */
  slotNo: number;
  slotOf: number;
  out: string;
  back: string;
  initials: string;
  save: (field: WalkField, value: string) => void;
}

interface MergedRow {
  key: string;
  dateKey: string;
  dog_name: string;
  last_name: string;
  drop_off_by: string;
  pick_up_by: string;
  phone: string;
  drop_off_id?: string; // most recent drop-off row — used for display/edit
  pick_up_id?: string; // most recent pick-up row — used for display/edit
  allIds: string[]; // every row (including duplicates) for this dog/day — used for delete
  drop_off_time?: string;
  pick_up_time?: string;
  service_type?: ServiceType;
  addons?: string[];
  bath_size?: BathSize | null;
  price?: number | null;
  walk_out?: string | null;
  walk_in?: string | null;
  walk_staff_initials?: string | null;
  pickup_window?: string | null;
  meet_greet_result?: MeetGreetResult | null;
  staff_note?: string | null;
  package_opt_out?: boolean | null;
  meals?: MealKey[];
  meals_given?: MealKey[];
  // Set when the pick-up landed on a different day from the drop-off, so a
  // multi-day boarding stay still appears on the day the dog went home.
  pickUpDateKey?: string;
}

interface EditState {
  last_name: string;
  drop_off_by: string;
  pick_up_by: string;
  service_type: ServiceType;
  addons: AddonKey[];
  drop_off_time: string; // "HH:MM" 24h, input[type=time] format
  pick_up_time: string;
  price: string; // input value; parsed to number/null on save
  bath_size: BathSize | null;
  package_id: string; // "" means this visit spent no package day
}

// Just the first name on the sign-in list.
//
// The column holds whoever handed the dog over, and a full name pushes the
// times out of line on a tablet — "Christina Villanueva-Reyes" against a
// column sized for a time. Staff are matching a face at the door, and the
// first name is what does that. The whole name is still on the row editor
// and on the printed sheet, where there is room for it.
function firstNameOnly(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

function localDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// One row per VISIT, not per dog-day. Rows are paired sequentially: a
// drop-off opens a visit and the next pick-up for that dog closes it.
//
// Keying on dog+phone+date instead would collapse a dog that comes back a
// second time the same day into a single row — the second drop-off
// overwrites the first, the last pick-up's price wins, and one of the two
// visits is invisible along with whatever it was charged.
function mergeRecords(records: SignInRecord[]): MergedRow[] {
  const sorted = [...records].sort(
    (a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime()
  );

  const byDog = new Map<string, SignInRecord[]>();
  for (const r of sorted) {
    if (!r.created_at) continue;
    const k = `${r.dog_name.trim().toLowerCase()}|${r.phone}`;
    const list = byDog.get(k) ?? [];
    list.push(r);
    byDog.set(k, list);
  }

  const rows: MergedRow[] = [];

  function blank(r: SignInRecord): MergedRow {
    return {
      key: `${r.dog_name}|${r.phone}|${r.id ?? r.created_at}`,
      dateKey: localDateKey(r.created_at as string),
      dog_name: r.dog_name,
      last_name: r.last_name,
      drop_off_by: "",
      pick_up_by: "",
      phone: r.phone,
      allIds: [],
    };
  }

  byDog.forEach((visits) => {
    let open: MergedRow | null = null;
    for (const r of visits) {
      if (r.action === "drop_off") {
        // A drop-off with no pick-up before it means the previous visit was
        // never closed out — keep it rather than losing it to the overwrite.
        if (open) rows.push(open);
        open = blank(r);
        if (r.id) open.allIds.push(r.id);
        open.drop_off_id = r.id;
        open.drop_off_time = r.created_at;
        open.drop_off_by = r.drop_off_by || "";
        open.service_type = r.service_type;
        open.addons = r.addons;
        open.bath_size = r.bath_size ?? null;
        open.walk_out = r.walk_out ?? null;
        open.walk_in = r.walk_in ?? null;
        open.meet_greet_result = r.meet_greet_result ?? null;
        open.walk_staff_initials = r.walk_staff_initials ?? null;
        open.pickup_window = r.pickup_window ?? null;
        open.staff_note = r.staff_note ?? null;
        open.meals = r.meals ?? [];
        open.meals_given = r.meals_given ?? [];
        open.package_opt_out = r.package_opt_out ?? null;
      } else {
        // A pick-up with no open drop-off is a manual correction; it still
        // gets a row so its price is visible.
        const row = open ?? blank(r);
        if (r.id) row.allIds.push(r.id);
        row.pick_up_id = r.id;
        row.pick_up_time = r.created_at;
        row.pick_up_by = r.pick_up_by || row.pick_up_by;
        row.price = r.price ?? row.price;
        row.pickUpDateKey = localDateKey(r.created_at as string);
        if (!row.service_type) row.service_type = r.service_type;
        rows.push(row);
        open = null;
      }
    }
    if (open) rows.push(open);
  });

  return rows.sort(
    (a, b) =>
      new Date(b.drop_off_time ?? b.pick_up_time ?? 0).getTime() -
      new Date(a.drop_off_time ?? a.pick_up_time ?? 0).getTime()
  );
}

// A column header that sorts: first click ascending, second descending,
// third back to the default service grouping. Renders as plain text when
// printed, since a print-out has no sort affordance.
function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
  width,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" } | null;
  onSort: (key: SortKey) => void;
  /** Reserved width, for columns whose editor is wider than their text. */
  width?: string;
  /** Money reads right-aligned, so the figures stack by decimal point. */
  align?: "left" | "right";
}) {
  const active = sort?.key === sortKey;
  return (
    <th
      className={`px-3 py-3 print:border print:border-paper-rule print:px-2 print:py-1.5 ${
        align === "right" ? "text-right" : ""
      } ${width ?? ""}`}
    >
      <button
        onClick={() => onSort(sortKey)}
        title={`Sort by ${label.replace(/^\W+\s*/, "")}`}
        className={`inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-ink-2 print:pointer-events-none ${
          active ? "font-semibold text-accent-600" : ""
        }`}
      >
        {label}
        <span className={`text-[9px] print:hidden ${active ? "" : "text-ink-3"}`}>
          {active ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

function timeOnly(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// "2026-08-06" + "15:04" -> ISO string for created_at, keeping the same
// calendar day the record is filed under.
function combineDateTime(dateKey: string, time: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  return new Date(y, m - 1, d, h, min).toISOString();
}

function isoToTimeInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function RecordsPage() {
  return (
    <StaffGate title="In house">
      <RecordsInner />
    </StaffGate>
  );
}

function RecordsInner() {
  const { settings } = useSettings();
  const business = settings.business;

  // Access is decided by <StaffGate> above; inside here it is granted.
  const unlocked = true;
  const [error, setError] = useState("");
  const [records, setRecords] = useState<SignInRecord[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  // The package-use ledger, so a visit's row knows which package it spent
  // and staff can move that use to a different one.
  const [uses, setUses] = useState<PackageUse[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [breakdownOpenKey, setBreakdownOpenKey] = useState<string | null>(null);
  const [view, setView] = useState<"signins" | "boarding" | "walklog">("signins");
  // Whether each visit has actually been paid for. Loaded across the whole
  // book, because payments settle oldest first — see lib/unpaid.ts.
  const { stateFor } = useUnpaid();
  // Which row has its note open, and what is being typed into it.
  const [noteKey, setNoteKey] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  // Null means the default grouped-by-service view; a key takes over from it.
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  // Staff front-desk panel, collapsed until needed.
  const [deskOpen, setDeskOpen] = useState(false);
  // Set when the dashboard links here for one service — e.g. tapping a bar
  // on its revenue chart.
  const [serviceFilter, setServiceFilter] = useState<ServiceType | null>(null);

  // The dashboard deep-links into this page with ?date=, ?service=, and
  // ?desk=1, so those links land on exactly the view staff expected.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const date = params.get("date");
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) setSelectedDate(date);
    const service = params.get("service");
    if (service === "daycare" || service === "boarding" || service === "meet_greet") {
      setServiceFilter(service);
    }
    if (params.get("desk")) setDeskOpen(true);
  }, []);
  const [dogs, setDogs] = useState<Dog[]>([]);
  const [boardings, setBoardings] = useState<Boarding[]>([]);
  const [walkLogs, setWalkLogs] = useState<WalkLog[]>([]);

  // Reloads when the date changes too, now that the query is scoped to it.
  // Without this, changing the date would filter an old window rather than
  // fetching the new one — which is how the list would come back empty for
  // a day that has visits.
  useEffect(() => {
    if (unlocked) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, selectedDate]);

  async function loadAll() {
    setLoading(true);
    try {
      const supabase = getSupabase();
      // Sign-ins for the day being looked at, not "the most recent 500".
      //
      // The cap was every row when this table held a few dozen. At ten
      // thousand it covers about a fortnight, and the failure is silent in
      // both directions: pick any older date and the list is empty although
      // the visits exist, and a day on the edge of the window arrives HALF
      // there — a pick-up whose drop-off fell outside it merges into a row
      // with no drop_off_id, which is the row whose note and meal editors
      // then quietly do nothing.
      //
      // A window rather than a single day because a visit can cross
      // midnight: the pairing in mergeRecords needs the drop-off that opened
      // a stay still in the set. Two days either side is generous and still
      // a couple of dozen rows.
      const from = new Date(`${selectedDate}T00:00:00`);
      from.setDate(from.getDate() - 2);
      const to = new Date(`${selectedDate}T00:00:00`);
      to.setDate(to.getDate() + 3);

      const [signinsRes, usesRes, packagesRes, clientsRes, boardingsRes] = await Promise.all([
        supabase
          .from("signins")
          .select("*")
          .gte("created_at", from.toISOString())
          .lt("created_at", to.toISOString())
          .order("created_at", { ascending: false }),
        supabase.from("package_uses").select("*").limit(2000),
        supabase.from("packages").select("*"),
        // Clients back the hover cards and profile links on dog names.
        supabase.from("dogs").select("*"),
        supabase.from("boardings").select("*"),
      ]);
      if (signinsRes.error) throw signinsRes.error;
      if (usesRes.error) throw usesRes.error;
      if (packagesRes.error) throw packagesRes.error;
      setUses((usesRes.data as PackageUse[]) ?? []);
      if (clientsRes.error) throw clientsRes.error;
      if (boardingsRes.error) throw boardingsRes.error;
      setRecords((signinsRes.data as SignInRecord[]) ?? []);
      setPackages((packagesRes.data as Package[]) ?? []);
      setDogs((clientsRes.data as Dog[]) ?? []);
      setBoardings((boardingsRes.data as Boarding[]) ?? []);
    } catch (e) {
      console.error("Loading records failed:", e);
      setError("Could not load records.");
    } finally {
      setLoading(false);
    }
  }

  // Walk entries for the boarding stays covering the selected date. Kept
  // separate from `records` because a stay's walks aren't sign-ins — one
  // reservation spans many days with several walks a day.
  const loadWalkLogs = useCallback(async () => {
    const stayIds = boardings
      .filter((b) => b.start_date <= selectedDate && b.end_date >= selectedDate)
      .map((b) => b.id)
      .filter(Boolean) as string[];
    if (!stayIds.length) {
      setWalkLogs([]);
      return;
    }
    try {
      const supabase = getSupabase();
      const { data, error: err } = await supabase
        .from("walk_logs")
        .select("*")
        .in("boarding_id", stayIds)
        .eq("date", selectedDate);
      if (err) throw err;
      setWalkLogs((data as WalkLog[]) ?? []);
    } catch (e) {
      console.error("Loading walk logs failed:", e);
    }
  }, [boardings, selectedDate]);

  useEffect(() => {
    if (unlocked) loadWalkLogs();
  }, [unlocked, loadWalkLogs]);

  // Packages looked up live per row — prefers a package tied to that
  // specific dog (dog_name set), falling back to a phone-only package
  // shared across every dog on that number (dog_name left blank).
  const packagesByPhone = useMemo(() => {
    const map = new Map<string, Package[]>();
    for (const p of packages) {
      if (!p.phone) continue;
      const list = map.get(p.phone) ?? [];
      list.push(p);
      map.set(p.phone, list);
    }
    return map;
  }, [packages]);

  // The block a visit draws from, for one KIND of package.
  //
  // This used to ignore kind and hand back whichever block was newest, so a
  // household holding a walk block saw it in the Package column instead of
  // their daycare block — and, worse, pricing treated it as covering the
  // daycare full-day rate, showing the day as free.
  function findPackage(
    phone: string,
    dogName: string,
    kind: PackageKind = "daycare"
  ): Package | null {
    return findPackageFor(packages, phone, dogName, kind);
  }

  // A price estimate for the visit — live (using the current time as a
  // stand-in pick-up) if the dog hasn't been picked up yet, or
  // reconstructed from the actual recorded times once it has. A package
  // only ever covers a FULL daycare day, decided against whichever
  // pick-up time is used here.
  // The ledger row this visit spent, for a given package kind.
  //
  // Filtering by kind matters: a visit can spend a daycare day AND a walk on
  // the same pick-up, and the records picker only offers daycare packages —
  // without it a walk use gets handed to a daycare dropdown that has no such
  // option.
  //
  // `signin_id` pins a use to one exact visit. Rows written before that
  // column existed only have dog + date, which is ambiguous once a dog
  // visits twice in a day; rather than guess wrong, those resolve to null and
  // the picker shows "No package used" until staff set it explicitly.
  function useForRow(r: MergedRow, kind: PackageKind = "daycare"): PackageUse | null {
    const ofKind = (u: PackageUse) => {
      const pkg = packages.find((p) => p.id === u.package_id);
      return !!pkg && packageKind(pkg) === kind;
    };

    if (r.pick_up_id) {
      const exact = uses.find((u) => u.signin_id === r.pick_up_id && ofKind(u));
      if (exact) return exact;
    }

    const dog = findDog(dogs, { dogName: r.dog_name, phone: r.phone });
    const legacy = uses.filter(
      (u) =>
        !u.signin_id &&
        u.used_on === r.dateKey &&
        ofKind(u) &&
        (dog?.id
          ? u.dog_id === dog.id
          : (u.dog_name ?? "").trim().toLowerCase() === r.dog_name.trim().toLowerCase())
    );
    // Exactly one candidate is unambiguous; more than one isn't attributable.
    return legacy.length === 1 ? legacy[0] : null;
  }


  async function reassignPackage(
    r: MergedRow,
    nextPackageId: string,
    kind: PackageKind = "daycare"
  ) {
    const existing = useForRow(r, kind);
    const currentId = existing?.package_id ?? "";
    if (currentId === nextPackageId) return;
    const supabase = getSupabase();

    const older = packages.find((p) => p.id === currentId);
    if (older?.id) {
      await supabase
        .from("packages")
        .update({ days_used: Math.max(0, older.days_used - 1) })
        .eq("id", older.id);
    }
    const next = packages.find((p) => p.id === nextPackageId);
    if (next?.id) {
      await supabase
        .from("packages")
        .update({ days_used: Math.min(next.total_days, next.days_used + 1) })
        .eq("id", next.id);
    }

    if (existing?.id && nextPackageId) {
      await supabase.from("package_uses").update({ package_id: nextPackageId }).eq("id", existing.id);
    } else if (existing?.id && !nextPackageId) {
      await supabase.from("package_uses").delete().eq("id", existing.id);
    } else if (nextPackageId) {
      await supabase.from("package_uses").insert({
        package_id: nextPackageId,
        dog_id: findDog(dogs, { dogName: r.dog_name, phone: r.phone })?.id ?? null,
        signin_id: r.pick_up_id ?? null,
        dog_name: r.dog_name,
        used_on: r.dateKey,
      });
    }
    if (r.pick_up_id) {
      await supabase
        .from("signins")
        .update({ package_id: nextPackageId || null })
        .eq("id", r.pick_up_id);
    }
  }

  function computeEstimate(r: MergedRow, pkg: Package | null): PriceEstimate | null {
    if (!r.drop_off_time || !r.service_type) return null;
    const dropOff = new Date(r.drop_off_time);
    // No pick-up row yet means the dog is still here, so "now" is only a
    // stand-in — a boarding stay mid-run hasn't earned the last-day
    // late-pickup fee just because it's past noon today.
    const pickedUp = !!r.pick_up_time;
    const pickUp = pickedUp ? new Date(r.pick_up_time as string) : new Date();
    const usingPackage = !!pkg && r.service_type === "daycare" && isFullDayVisit(dropOff, pickUp);
    // A package bought on this same day is part of what the client pays for
    // this visit; one bought earlier isn't — those days are already paid for.
    // Only sales not already charged to an earlier pick-up that day — a dog
    // that came back for a second visit shouldn't be billed the package twice.
    // A sale belongs to exactly one visit — the first pick-up after it. Show
    // it on that visit's estimate, and on a not-yet-picked-up visit when no
    // pick-up has claimed it yet.
    const pricedPickUpsThatDay = records.filter(
      (s2) =>
        s2.phone === r.phone &&
        s2.action === "pick_up" &&
        s2.price != null &&
        !!s2.created_at &&
        localDateKey(s2.created_at) === r.dateKey
    );
    const sold = packagesBoughtOn(packages, r.phone, r.dog_name, r.dateKey).filter((p) => {
      const owner = packageBillingPickUp(p, pricedPickUpsThatDay);
      return owner ? owner.id === r.pick_up_id : !r.pick_up_id;
    });
    // A walk package covers the walk add-on the same way a daycare package
    // covers the base rate — on DAYCARE only. A boarding stay's walks bill per
    // walk on the reservation, so a block must not absorb them here either.
    const walkPkg = findPackageFor(packages, r.phone, r.dog_name, "walk");
    const walkCovered =
      r.service_type === "daycare" &&
      !!walkPkg &&
      (r.addons ?? []).includes("walk") &&
      daysLeft(walkPkg) > 0;
    return estimatePrice(
      r.service_type,
      dropOff,
      pickUp,
      r.addons ?? [],
      usingPackage,
      r.bath_size ?? null,
      pickedUp,
      sold.map((p) => ({
        days: p.total_days,
        price: p.price ?? 0,
        unit: packageKind(p) === "walk" ? "walks" : "days",
      })),
      walkCovered
    );
  }

  const merged = useMemo(() => mergeRecords(records), [records]);
  // Meet & greets first. There are one or two a day against twenty daycare
  // dogs, they are the rows that need something done to them — a verdict, a
  // photo, a first-day report — and at the bottom of the list they were the
  // rows most likely to be scrolled past. Everything else keeps its order.
  const SERVICE_ORDER: Record<string, number> = { meet_greet: 0, daycare: 1, boarding: 2 };
  const filtered = useMemo(() => {
    const rows = merged
      .filter((r) => r.dateKey === selectedDate || r.pickUpDateKey === selectedDate)
      // Boarding has its own tab, where a stay gets the columns it needs.
      // Leaving it here too meant one list claiming to be two things, and a
      // boarding row that could only ever show a fragment of its stay.
      .filter((r) => r.service_type !== "boarding")
      .filter((r) => !serviceFilter || r.service_type === serviceFilter);

    // Service always wins, sort or no sort. Daycare, boarding and meet &
    // greet are different kinds of work with different questions attached, so
    // interleaving them to satisfy a column sort loses more than the sort
    // gains. A sort orders rows WITHIN each band instead.
    const dir: 1 | -1 = sort?.dir === "asc" ? 1 : -1;
    return rows.sort((a, b) => {
      const orderA = SERVICE_ORDER[a.service_type ?? ""] ?? 99;
      const orderB = SERVICE_ORDER[b.service_type ?? ""] ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      // No column picked: a stable sort keeps merged's recency order.
      if (!sort) return 0;
      return compareBy(sortValue(a, sort.key), sortValue(b, sort.key), dir);
    });
  }, [merged, selectedDate, serviceFilter, sort]);

  function sortValue(r: MergedRow, key: SortKey): string | number | null {
    switch (key) {
      case "dog_name":
        return r.dog_name;
      // In-house first when ascending — that's the list staff actually act on.
      case "status":
        return isStillIn(r) ? 0 : 1;
      case "last_name":
        return r.last_name;
      case "phone":
        return r.phone;
      case "service":
        return SERVICE_ORDER[r.service_type ?? ""] ?? 99;
      case "drop_off_by":
        return r.drop_off_by;
      case "pick_up_by":
        return r.pick_up_by;
      case "drop_off_time":
        return timeValue(r.drop_off_time);
      case "pick_up_time":
        return timeValue(r.pick_up_time);
      case "price":
        return priceValue(r);
      default:
        return null;
    }
  }

  // Whichever price the row displays — the final one once set, otherwise the
  // running estimate, so sorting matches what staff can see.
  function priceValue(r: MergedRow): number | null {
    if (r.price != null) return r.price;
    const estimate = computeEstimate(r, findPackage(r.phone, r.dog_name));
    return estimate?.amount ?? null;
  }

  function toggleSort(key: SortKey) {
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null; // third click returns to the grouped default
    });
  }

  // Every walk owed on the selected date, from both sources: daycare dogs
  // who added a walk at drop-off (stored on their sign-in row) and boarding
  // dogs whose stay covers today (stored per day/slot in walk_logs, since
  // one stay spans many days and can have several walks a day).
  const stillInCount = useMemo(() => filtered.filter(isStillIn).length, [filtered]);

  const walkRows: WalkRow[] = useMemo(() => {
    const daycare: WalkRow[] = filtered
      .filter((r) => r.service_type === "daycare" && r.addons?.includes("walk"))
      .map((r) => ({
        key: `daycare-${r.key}`,
        service: "daycare",
        row: r,
        dogName: r.dog_name,
        phone: r.phone,
        dogId: undefined,
        handler: r.drop_off_by,
        lastName: r.last_name,
        slot: "Walk",
        slotNo: 1,
        slotOf: 1,
        out: r.walk_out ?? "",
        back: r.walk_in ?? "",
        initials: r.walk_staff_initials ?? "",
        save: (field, value) => saveWalkField(r, field, value),
      }));

    const boarding: WalkRow[] = [];
    for (const b of boardings) {
      if (b.start_date > selectedDate || b.end_date < selectedDate) continue;
      if (!(b.addons ?? []).includes("walk")) continue;
      const perDay = Math.max(1, b.walks_per_day ?? 1);
      for (let i = 0; i < perDay; i++) {
        const entry = walkLogs.find((w) => w.boarding_id === b.id && w.walk_index === i);
        boarding.push({
          key: `boarding-${b.id}-${i}`,
          service: "boarding",
          dogName: b.dog_name,
          phone: b.phone,
          dogId: b.dog_id ?? undefined,
          handler: b.last_name,
          lastName: b.last_name,
          slot: perDay > 1 ? `Walk ${i + 1} of ${perDay}` : "Walk",
          slotNo: i + 1,
          slotOf: perDay,
          out: entry?.walk_out ?? "",
          back: entry?.walk_in ?? "",
          initials: entry?.staff_initials ?? "",
          boarding: b,
          save: (field, value) => saveBoardingWalkField(b, i, field, value),
        });
      }
    }

    return [...daycare, ...boarding];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, boardings, walkLogs, selectedDate]);

  // Every stay covering the selected date, with the things a list of stays
  // is actually asked: how far through it is, when the dog goes home, and
  // whether it has arrived yet.
  const boardingRows = useMemo(() => {
    return boardings
      .filter((b) => b.start_date <= selectedDate && b.end_date >= selectedDate)
      .map((b) => {
        const nights = nightsBetweenKeys(b.start_date, b.end_date);
        const elapsed = Math.min(nights, nightsBetweenKeys(b.start_date, selectedDate));
        const isArrival = b.start_date === selectedDate;
        const isDeparture = b.end_date === selectedDate;
        // Has the dog actually been signed in for this stay? A booked stay
        // with no drop-off is the one staff need to chase, so it cannot be
        // inferred from the dates alone.
        const visit = merged.find(
          (r) =>
            r.service_type === "boarding" &&
            r.phone === b.phone &&
            r.dog_name.trim().toLowerCase() === b.dog_name.trim().toLowerCase() &&
            r.dateKey >= b.start_date &&
            r.dateKey <= b.end_date
        );
        const onSite = !!visit && isStillIn(visit);
        const estimate = estimateBoardingTotal(b.start_date, b.end_date, {
          addons: b.addons ?? [],
          walksPerDay: b.walks_per_day,
          bathSize: b.bath_size ?? null,
        });
        return {
          b,
          nights,
          elapsed,
          isArrival,
          isDeparture,
          onSite,
          departed: !!visit && !isStillIn(visit),
          notArrived: !visit,
          estimate,
          dog: findDog(dogs, { dogId: b.dog_id, dogName: b.dog_name, phone: b.phone }),
        };
      })
      .sort(
        (x, y) =>
          x.b.end_date.localeCompare(y.b.end_date) || x.b.dog_name.localeCompare(y.b.dog_name)
      );
  }, [boardings, selectedDate, merged, dogs]);

  const boardingOnSite = useMemo(
    () => boardingRows.filter((r) => r.onSite).length,
    [boardingRows]
  );
  const boardingToArrive = useMemo(
    () => boardingRows.filter((r) => r.notArrived).length,
    [boardingRows]
  );
  const boardingGone = useMemo(
    () => boardingRows.filter((r) => r.departed).length,
    [boardingRows]
  );

  // "in 3 days" reads faster than a date when the question is when the dog
  // goes home.
  function untilLabel(day: string): string {
    const diff = Math.round(
      (new Date(`${day}T12:00:00`).getTime() - new Date(`${selectedDate}T12:00:00`).getTime()) /
        86_400_000
    );
    if (diff === 0) return "today";
    if (diff === 1) return "tomorrow";
    if (diff < 0) return `${Math.abs(diff)}d ago`;
    return `in ${diff} days`;
  }

  const prettyDate = useMemo(() => {
    const [y, m, d] = selectedDate.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }, [selectedDate]);

  const printedAt = useMemo(
    () => new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
    [filtered] // eslint-disable-line react-hooks/exhaustive-deps
  );

  function startEdit(row: MergedRow) {
    setEditingKey(row.key);
    setEditState({
      last_name: row.last_name,
      drop_off_by: row.drop_off_by,
      pick_up_by: row.pick_up_by,
      service_type: row.service_type ?? "daycare",
      addons: (row.addons as AddonKey[]) ?? [],
      drop_off_time: isoToTimeInput(row.drop_off_time),
      pick_up_time: isoToTimeInput(row.pick_up_time),
      price: row.price != null ? String(row.price) : "",
      bath_size: row.bath_size ?? null,
      package_id: useForRow(row, "daycare")?.package_id ?? "",
    });
  }

  function cancelEdit() {
    setEditingKey(null);
    setEditState(null);
  }

  function toggleEditAddon(key: AddonKey) {
    setEditState((prev) =>
      prev
        ? { ...prev, addons: prev.addons.includes(key) ? prev.addons.filter((a) => a !== key) : [...prev.addons, key] }
        : prev
    );
  }

  // Clicking a bath size sets/toggles it and adjusts the price field by
  // swapping out any previously-applied bath amount for the new one —
  // clicking the same size again removes the bath charge entirely. The
  // price field stays freely editable afterward for further adjustments.
  function selectBathSize(size: BathSize) {
    setEditState((prev) => {
      if (!prev) return prev;
      const oldAmount = prev.bath_size ? BATH_PRICES[prev.bath_size] : 0;
      const turningOff = prev.bath_size === size;
      const newAmount = turningOff ? 0 : BATH_PRICES[size];
      const currentPrice = parseFloat(prev.price) || 0;
      const updatedPrice = Math.max(0, currentPrice - oldAmount + newAmount);
      return { ...prev, bath_size: turningOff ? null : size, price: updatedPrice.toFixed(2) };
    });
  }

  async function saveEdit(row: MergedRow) {
    if (!editState) return;
    setSavingEdit(true);
    setError("");
    try {
      const supabase = getSupabase();

      if (row.drop_off_id) {
        const { error: err } = await supabase
          .from("signins")
          .update({
            last_name: editState.last_name.trim(),
            drop_off_by: editState.drop_off_by.trim(),
            service_type: editState.service_type,
            addons: editState.addons,
            bath_size: editState.addons.includes("bath") ? editState.bath_size : null,
            created_at: editState.drop_off_time
              ? combineDateTime(row.dateKey, editState.drop_off_time)
              : row.drop_off_time,
          })
          .eq("id", row.drop_off_id);
        if (err) throw err;
      }
      if (row.pick_up_id) {
        const parsedPrice = editState.price.trim() === "" ? null : parseFloat(editState.price);
        const { error: err } = await supabase
          .from("signins")
          .update({
            last_name: editState.last_name.trim(),
            pick_up_by: editState.pick_up_by.trim(),
            service_type: editState.service_type,
            price: parsedPrice !== null && !Number.isNaN(parsedPrice) ? parsedPrice : null,
            created_at: editState.pick_up_time
              // The pick-up keeps its own day — a boarding stay's pick-up is
              // often not the drop-off date, and reusing that would drag it
              // back across the calendar.
              ? combineDateTime(row.pickUpDateKey ?? row.dateKey, editState.pick_up_time)
              : row.pick_up_time,
          })
          .eq("id", row.pick_up_id);
        if (err) throw err;
      }

      // Moving the day between packages touches three tables, so it runs as
      // its own step rather than being folded into the row updates above.
      await reassignPackage(row, editState.package_id);

      cancelEdit();
      loadAll();
    } catch (e) {
      console.error("Saving edit failed:", e);
      setError("Could not save changes.");
    } finally {
      setSavingEdit(false);
    }
  }

  // Saves one walk-log field straight to the drop-off row as staff type it
  // in — no separate edit/save step, since this is meant for quick entry
  // while walking dogs throughout the day.
  async function saveWalkField(row: MergedRow, field: "walk_out" | "walk_in" | "walk_staff_initials", value: string) {
    if (!row.drop_off_id) return;
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase
        .from("signins")
        .update({ [field]: value.trim() || null })
        .eq("id", row.drop_off_id);
      if (err) throw err;
      setRecords((prev) => prev.map((r) => (r.id === row.drop_off_id ? { ...r, [field]: value.trim() || null } : r)));
    } catch (e) {
      console.error("Saving walk log failed:", e);
      setError("Could not save the walk log.");
    }
  }

  // Add-ons, bath size and package, edited straight from the row.
  //
  // These three change constantly through a day — a dog gets added to the
  // bath list at eleven, staff size it at two — and routing each one through
  // select-row, Edit, change, Save was four interactions for one click of
  // real intent. They save on change, like the walk log above.
  //
  // All three live on the DROP-OFF row: that is where a visit records what it
  // booked, and the pick-up row only carries the final price.
  async function toggleAddonInline(row: MergedRow, key: AddonKey) {
    if (!row.drop_off_id) return;
    const current = (row.addons ?? []) as AddonKey[];
    const next = current.includes(key) ? current.filter((a) => a !== key) : [...current, key];
    // Dropping the bath drops its size with it, or the row keeps a size for
    // an add-on it no longer has and prices a bath nobody gave.
    const bathSize = next.includes("bath") ? (row.bath_size ?? null) : null;
    setRecords((prev) =>
      prev.map((r) =>
        r.id === row.drop_off_id ? { ...r, addons: next, bath_size: bathSize } : r
      )
    );
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase
        .from("signins")
        .update({ addons: next, bath_size: bathSize })
        .eq("id", row.drop_off_id);
      if (err) throw err;
    } catch (e) {
      console.error("Saving add-on failed:", e);
      setError("Could not change that add-on.");
      loadAll(); // put the row back the way the database has it
    }
  }

  async function setBathSizeInline(row: MergedRow, size: BathSize | null) {
    if (!row.drop_off_id) return;
    setRecords((prev) =>
      prev.map((r) => (r.id === row.drop_off_id ? { ...r, bath_size: size } : r))
    );
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase
        .from("signins")
        .update({ bath_size: size })
        .eq("id", row.drop_off_id);
      if (err) throw err;
    } catch (e) {
      console.error("Saving bath size failed:", e);
      setError("Could not set the bath size.");
      loadAll();
    }
  }

  // A meet & greet ends in a verdict, and a pass ends with a photo.
  //
  // The photo requirement is the point of the feature, not decoration: a dog
  // cleared for daycare is a dog staff will have to recognise at the door,
  // and the meet & greet is the one moment everybody is standing still. So a
  // pass cannot be recorded without one — the file picker opens first, and
  // the verdict is only written once the photo has saved.
  const [mgBusyKey, setMgBusyKey] = useState<string | null>(null);
  const [mgNotice, setMgNotice] = useState("");
  const mgPhotoInput = useRef<HTMLInputElement | null>(null);
  const mgPendingRow = useRef<MergedRow | null>(null);

  async function writeMeetGreetResult(row: MergedRow, result: MeetGreetResult) {
    if (!row.drop_off_id) return;
    setMgBusyKey(row.key);
    setMgNotice("");
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase
        .from("signins")
        .update({ meet_greet_result: result })
        .eq("id", row.drop_off_id);
      if (err) throw err;
      setRecords((prev) =>
        prev.map((r) => (r.id === row.drop_off_id ? { ...r, meet_greet_result: result } : r))
      );
      // A pass is the moment the rest of the enrollment is worth asking for:
      // the household has been in, the dog has been seen, and the questions
      // that were held back are now questions between people who have met.
      //
      // Sent from here and nowhere else, so that when a client says the form
      // never arrived there is one place to look. Never throws — the verdict
      // is what is being saved, and it must survive a bounced email.
      if (result === "pass") await requestDetailsFor(row);
    } catch (e) {
      console.error("Saving the meet & greet result failed:", e);
      setError(
        "Could not save that result — if this is the first time, run meet-greet-result-migration.sql."
      );
    } finally {
      setMgBusyKey(null);
    }
  }

  /**
   * A meet & greet the dog stayed on from.
   *
   * Two hours is the plan; sometimes the dog settles and the household leaves
   * them for the day, and then it is a daycare day — it belongs in that tab,
   * it should be priced like one, and it should not sit in the meet & greet
   * group looking unfinished.
   *
   * Every row of the visit moves, drop-off and pick-up alike, or the two
   * halves would disagree about what the visit was and the pair would stop
   * merging into one row.
   *
   * meet_greet_result is deliberately left alone. The assessment happened,
   * and it is what lets this dog come back without another one.
   */
  async function convertToDaycare(row: MergedRow) {
    const ids = row.allIds.filter(Boolean);
    if (!ids.length) return;

    // A dog that has already gone home is a different decision.
    //
    // This button is for "they stayed on for the day" — it says so, and it
    // promises the day is priced at pick-up. On a visit that is already
    // closed there is no pick-up left to price at, so converting re-prices
    // what happened: a meet & greet is free, a daycare day is not, and a
    // twenty-minute assessment becomes a half day the client never agreed
    // to. Staff still need it — somebody who forgot to convert a dog that
    // genuinely stayed all day has to be able to put it right — so the
    // charge is shown rather than the button taken away.
    if (row.pick_up_time && row.drop_off_time) {
      const from = new Date(row.drop_off_time);
      const to = new Date(row.pick_up_time);
      const minutes = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
      const estimate = estimatePrice(
        "daycare",
        from,
        to,
        row.addons ?? [],
        false,
        row.bath_size ?? null,
        true
      );
      const length = minutes < 60 ? `${minutes} minutes` : `${(minutes / 60).toFixed(1)} hours`;
      const priced = estimate
        ? `${isFullDayVisit(from, to) ? "a full day" : "a half day"}, $${estimate.amount.toFixed(2)}`
        : "the usual daycare rate";
      if (
        !window.confirm(
          `${row.dog_name} was picked up already — this visit lasted ${length}.\n\n` +
            `Moving it to daycare charges ${priced}. A meet & greet is free, so this is a new charge on their account.\n\n` +
            `Go ahead?`
        )
      ) {
        return;
      }
    }

    setMgBusyKey(row.key);
    setMgNotice("");
    try {
      const { error: err } = await getSupabase()
        .from("signins")
        .update({ service_type: "daycare" })
        .in("id", ids);
      if (err) throw err;
      setRecords((prev) =>
        prev.map((r) => (r.id && ids.includes(r.id) ? { ...r, service_type: "daycare" } : r))
      );
      setMgNotice(
        row.pick_up_time
          ? `${row.dog_name} moved to daycare. The visit is closed, so it is priced now — check the total on their profile.`
          : `${row.dog_name} moved to daycare. The visit prices at pick-up like any other day.`
      );
    } catch (e) {
      console.error("Moving the meet & greet to daycare failed:", e);
      setError("Could not move that to daycare.");
    } finally {
      setMgBusyKey(null);
    }
  }

  async function requestDetailsFor(row: MergedRow) {
    const outcome = await sendDetailsRequest(row.phone);
    switch (outcome.status) {
      case "sent":
        setMgNotice(`✓ ${row.dog_name} passed — details form emailed to ${outcome.to}.`);
        break;
      case "no-email":
        setMgNotice(
          `${row.dog_name} passed, but there is no email on their enrollment — the details form is on Requests, ready to read out.`
        );
        break;
      case "not-configured":
        setMgNotice(
          `${row.dog_name} passed. Email is not set up here, so the details form was not sent — copy the link from Requests.`
        );
        break;
      case "failed":
        setMgNotice(
          `${row.dog_name} passed, but the details form could not be emailed${
            outcome.detail ? ` (${outcome.detail})` : ""
          } — the link is on Requests.`
        );
        break;
      // "no-enrollment" and "already-submitted" are the ordinary quiet cases:
      // a dog enrolled before two-stage forms existed, one added by staff, or
      // a household that has already sent their details back. Nothing to say.
      default:
        break;
    }
  }

  async function setMeetGreetResult(row: MergedRow, result: MeetGreetResult) {
    if (result === "fail") {
      await writeMeetGreetResult(row, "fail");
      return;
    }
    const dog = findDog(dogs, { dogName: row.dog_name, phone: row.phone });
    if (dog?.photo_data) {
      await writeMeetGreetResult(row, "pass");
      return;
    }
    // No photo yet — collect one, then record the pass in the handler below.
    mgPendingRow.current = row;
    mgPhotoInput.current?.click();
  }

  async function onMeetGreetPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const row = mgPendingRow.current;
    mgPendingRow.current = null;
    if (!file || !row) return;

    const dog = findDog(dogs, { dogName: row.dog_name, phone: row.phone });
    if (!dog?.id) {
      setError(`No profile on file for ${row.dog_name}, so the photo has nowhere to go.`);
      return;
    }
    setMgBusyKey(row.key);

    // Reading the picture and storing it are two different failures and they
    // were reported as one. "Could not save that photo, try again" is a lie
    // when the file is an iPhone HEIC the browser will never open — trying
    // again with the same file fails identically, forever, and says nothing
    // about why.
    let dataUrl: string;
    try {
      dataUrl = await fileToBudgetedJpeg(file, 640, 120 * 1024);
    } catch (err) {
      console.error("Reading the meet & greet photo failed:", err, {
        name: file.name,
        type: file.type,
        size: file.size,
      });
      setError(unreadableImageMessage(file));
      setMgBusyKey(null);
      return;
    }

    try {
      const supabase = getSupabase();
      const { error: err } = await supabase
        .from("dogs")
        .update({ photo_data: dataUrl })
        .eq("id", dog.id);
      if (err) throw err;
      setDogs((prev) => prev.map((d) => (d.id === dog.id ? { ...d, photo_data: dataUrl } : d)));
    } catch (err) {
      console.error("Saving the meet & greet photo failed:", err);
      setError(
        `The photo opened but could not be saved to ${row.dog_name}'s profile, so the pass was not recorded. ${
          (err as { message?: string })?.message ?? "Try again."
        }`
      );
      setMgBusyKey(null);
      return;
    }
    setMgBusyKey(null);
    // Only now is the dog on file properly, so the verdict can stand.
    await writeMeetGreetResult(row, "pass");
  }

  // A note about one dog, for today.
  //
  // Kept off the row itself: a note is occasional, often a sentence or two,
  // and giving it a column would cost every row width for something most of
  // them never have. So the row grows a marker, and the note opens under it.
  // Meals live beside the note for the same reason the note is not a column:
  // most dogs eat at home, so a permanent Meals column would cost every row
  // width to say "none" all day. The row shows a chip only once a meal is
  // set, and the detail opens underneath.
  async function saveMeals(row: MergedRow, meals: MealKey[], given: MealKey[]) {
    if (!row.drop_off_id) {
      // A row built from a pick-up whose drop-off is not in the loaded window
      // has nowhere to write meals to. It used to return in silence, so the
      // chips simply did not respond and there was nothing to explain why.
      setError(
        `${row.dog_name}'s drop-off is not on this day, so meals cannot be set from here — open the day they arrived.`
      );
      return;
    }
    setNoteBusy(true);
    // A meal cannot be given if it is no longer due — unticking breakfast
    // must not leave it counted as fed.
    const settled = given.filter((g) => meals.includes(g));
    try {
      const { error: err } = await getSupabase()
        .from("signins")
        .update({ meals, meals_given: settled })
        .eq("id", row.drop_off_id);
      if (err) throw err;

      // Patched in place rather than reloaded, and this is the fix for a real
      // glitch rather than a tidy-up.
      //
      // loadAll() replaces the sign-ins, dogs, packages, boardings and uses,
      // which rebuilds every merged row and re-sorts the table. Every other
      // inline editor either closes first — saveStaffNote sets noteKey to
      // null before reloading — or patches state the way this now does. Meals
      // was the one place a full reload happened with the expanded editor
      // still mounted, an autoFocus textarea inside it, and its row being
      // moved underneath by the re-sort. The result was a mangled panel:
      // chips duplicated, the Save button rendered without its label.
      //
      // It is also just disproportionate. Tapping "lunch" should not refetch
      // seven hundred dogs.
      setRecords((prev) =>
        prev.map((r) =>
          r.id === row.drop_off_id ? { ...r, meals, meals_given: settled } : r
        )
      );
    } catch (e) {
      console.error("Saving meals failed:", e);
      setError("Could not save that — if this is a new install, run signin-meals-migration.sql.");
    } finally {
      setNoteBusy(false);
    }
  }

  function toggleMealDue(row: MergedRow, key: MealKey) {
    const due = row.meals ?? [];
    const next = due.includes(key) ? due.filter((m) => m !== key) : [...due, key];
    saveMeals(row, next, row.meals_given ?? []);
  }

  function toggleMealGiven(row: MergedRow, key: MealKey) {
    const given = row.meals_given ?? [];
    const next = given.includes(key) ? given.filter((m) => m !== key) : [...given, key];
    saveMeals(row, row.meals ?? [], next);
  }

  async function saveStaffNote(row: MergedRow, text: string) {
    if (!row.drop_off_id) return;
    setNoteBusy(true);
    try {
      const { error: err } = await getSupabase()
        .from("signins")
        .update({ staff_note: text.trim() || null })
        .eq("id", row.drop_off_id);
      if (err) throw err;
      setNoteKey(null);
      // Same reasoning as saveMeals: one column on one row does not need the
      // whole day refetched. This one closed the editor first so it never
      // showed the glitch, but it paid for a full reload all the same.
      setRecords((prev) =>
        prev.map((r) =>
          r.id === row.drop_off_id ? { ...r, staff_note: text.trim() || null } : r
        )
      );
    } catch (e) {
      console.error("Saving the note failed:", e);
      setError(
        "Could not save that note — if this is a new install, run signin-notes-migration.sql."
      );
    } finally {
      setNoteBusy(false);
    }
  }

  async function setPackageInline(row: MergedRow, packageId: string, kind: PackageKind) {
    try {
      // A daycare visit past four hours shows the block it is *going* to
      // spend at pick-up, which is not stored anywhere. So choosing No day
      // used asked reassignPackage to change nothing into nothing, it
      // returned early, and the projection painted the block straight back —
      // the choice looked ignored because it was. Record the decision on the
      // visit itself so it survives a reload and reaches checkout.
      if (kind === "daycare" && row.drop_off_id) {
        const optOut = packageId === "";
        if ((row.package_opt_out ?? null) !== optOut) {
          const { error: err } = await getSupabase()
            .from("signins")
            .update({ package_opt_out: optOut })
            .eq("id", row.drop_off_id);
          // Deliberately not fatal. Until signin-notes-migration.sql has
          // run there is no such column, and failing here would take the
          // whole picker down with it — worse than the bug being fixed.
          // Everything below still works; only the No day used override on
          // a dog that is still here needs the column.
          if (err) console.error("Recording the package decision failed:", err);
        }
      }
      await reassignPackage(row, packageId, kind);
      loadAll();
    } catch (e) {
      console.error("Changing the package failed:", e);
      setError("Could not change the package for that visit.");
    }
  }

  // Same idea for a boarding walk, but keyed by stay + day + slot in
  // walk_logs rather than living on a sign-in row.
  async function saveBoardingWalkField(
    boarding: Boarding,
    walkIndex: number,
    field: WalkField,
    value: string
  ) {
    if (!boarding.id) return;
    const trimmed = value.trim() || null;
    const column =
      field === "walk_staff_initials" ? "staff_initials" : (field as "walk_out" | "walk_in");
    const existing = walkLogs.find((w) => w.boarding_id === boarding.id && w.walk_index === walkIndex);
    const next: WalkLog = {
      ...(existing ?? {
        boarding_id: boarding.id,
        date: selectedDate,
        walk_index: walkIndex,
      }),
      // Stamped on every row so the log is per dog rather than per stay.
      dog_id: boarding.dog_id ?? null,
      dog_name: boarding.dog_name,
      [column]: trimmed,
    } as WalkLog;
    setWalkLogs((prev) => [
      ...prev.filter((w) => !(w.boarding_id === boarding.id && w.walk_index === walkIndex)),
      next,
    ]);
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase.from("walk_logs").upsert(
        {
          boarding_id: boarding.id,
          dog_id: boarding.dog_id ?? null,
          dog_name: boarding.dog_name,
          date: selectedDate,
          walk_index: walkIndex,
          walk_out: next.walk_out ?? null,
          walk_in: next.walk_in ?? null,
          staff_initials: next.staff_initials ?? null,
        },
        { onConflict: "boarding_id,date,walk_index" }
      );
      if (err) throw err;
    } catch (e) {
      console.error("Saving boarding walk log failed:", e);
      setError("Could not save the walk log.");
    }
  }

  // Which rows are ticked. Keyed by row key, which survives a reload.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggleSelected(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selectedRows = filtered.filter((r) => selected.has(r.key));
  const allVisibleSelected = filtered.length > 0 && selectedRows.length === filtered.length;

  // One confirm for the whole selection, and one delete per visit — a visit
  // can span several sign-in rows, which is what allIds holds.
  async function deleteSelected() {
    if (!selectedRows.length) return;
    const names = selectedRows.map((r) => `${r.dog_name} (${r.dateKey})`).join(", ");
    if (
      !window.confirm(
        `Delete ${selectedRows.length} ${selectedRows.length === 1 ? "visit" : "visits"}?\n\n${names}\n\nThis removes the whole entry, drop-off and pick-up together, and can't be undone.`
      )
    ) {
      return;
    }
    setError("");
    try {
      const ids = selectedRows.flatMap((r) => r.allIds);
      if (ids.length) {
        const supabase = getSupabase();
        const { error: err } = await supabase.from("signins").delete().in("id", ids);
        if (err) throw err;
      }
      setSelected(new Set());
      loadAll();
    } catch (e) {
      console.error("Deleting records failed:", e);
      setError("Could not delete those records.");
    }
  }


  return (
    <div className="mx-auto max-w-6xl px-6 py-10 print:px-0 print:py-0">
      <style>{`
        @media print {
          @page { margin: 0.4in; size: portrait; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          table { font-size: 6px; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; }
          .print-header {
            background: linear-gradient(135deg, rgb(var(--print-from)) 0%, rgb(var(--print-to)) 100%);
            border-radius: 20px;
            position: relative;
            overflow: hidden;
          }
          .print-paw {
            position: absolute;
            font-size: 48px;
            opacity: 0.15;
            transform: rotate(-15deg);
          }
          tbody tr:nth-child(even) td { background: rgb(var(--print-tint)); }
          .print-footer {
            text-align: center;
            color: rgb(var(--print-ink));
            font-size: 8px;
            margin-top: 10px;
          }
        }
      `}</style>

      <StaffNav current="/in-house" />

      {/* Opened by the Pass button when the dog has no photo yet. capture
          prefers the rear camera on a tablet, which is what the desk has in
          its hand at that moment. */}
      <input
        ref={mgPhotoInput}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onMeetGreetPhoto}
        className="hidden"
      />

      {/* The heading changes with the view — and grows a badge — so it has to
          take the slack rather than push the controls. It was sized by its
          text before, which walked the whole toolbar sideways on every tab
          change. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="min-w-0 flex-1 font-display text-xl font-semibold text-ink">
          {view === "signins" ? "Daycare" : view === "boarding" ? "Boarding" : "Walk log"}
          {/* A bare count answers half the question. "3 still here" out of how
              many? And for boarding, how many of today's stays have actually
              turned up? Both now carry their denominator. */}
          {view === "signins" && filtered.length > 0 && (
            <span className="ml-2.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
              🟢 {stillInCount} of {filtered.length} still here
            </span>
          )}
          {view === "boarding" && boardingRows.length > 0 && (
            <span className="ml-2.5 inline-flex flex-wrap items-center gap-1.5 align-middle">
              <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-800">
                🛏️ {boardingRows.length} staying
              </span>
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                🟢 {boardingOnSite} in
              </span>
              {boardingToArrive > 0 && (
                <span
                  title="Booked for today, but no drop-off recorded yet"
                  className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800"
                >
                  ⏳ {boardingToArrive} to arrive
                </span>
              )}
              {boardingGone > 0 && (
                <span className="rounded-full bg-surface-3 px-2.5 py-1 text-xs font-semibold text-ink-3">
                  ✓ {boardingGone} gone home
                </span>
              )}
            </span>
          )}
        </h1>
        {/* shrink-0 keeps this on one line beside the heading at a desk, which
            is right there and wrong on a phone: at 375px these controls come
            to 832px, and refusing to shrink made the whole PAGE scroll
            sideways rather than the toolbar wrap. Below sm it takes the full
            width and wraps; from sm up it behaves exactly as before. */}
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap sm:shrink-0">
          <DateField
            value={selectedDate}
            onChange={setSelectedDate}
            wrapperClassName="w-40"
            className="rounded-xl border border-line bg-surface px-3.5 py-2 text-sm text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
            ariaLabel="Date"
          />
          {/* Three views over the same day. Boarding earns its own rather
              than living as a band in the sign-in list: a stay spans days, so
              the questions asked of it — which night is this, when does it go
              home, what is owed so far — have no column on a list built
              around one day's arrivals. */}
          <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
            {(
              [
                { key: "signins", label: "🐕 Daycare" },
                { key: "boarding", label: "🛏️ Boarding" },
                { key: "walklog", label: "🚶 Walks" },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                onClick={() => setView(t.key)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  view === t.key
                    ? "bg-accent-500 text-accent-ink shadow-card"
                    : "text-ink-3 hover:text-ink-2"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setDeskOpen((v) => !v)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              deskOpen
                ? "bg-slate-700 text-white shadow-card hover:bg-slate-800"
                : "border border-line bg-surface text-ink-2 hover:border-line"
            }`}>
            {/* Short on a phone, where this and Print each took a row of
                their own. "a dog" and "front desk" are the words that can go:
                the list underneath is dogs, and the panel this opens says
                Front desk at the top of it. */}
            {deskOpen ? (
              <>
                ✕ Close<span className="hidden sm:inline"> front desk</span>
              </>
            ) : (
              <>
                🚗 Sign<span className="hidden sm:inline"> a dog</span> in / out
              </>
            )}
          </button>
          <button
            onClick={() => window.print()}
            className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-accent-ink shadow-card hover:bg-accent-600">
            🖨️ Print<span className="hidden sm:inline"> / Save as PDF</span>
          </button>
        </div>
      </div>

      {/* Front desk — for when a client doesn't use the lobby kiosk. Writes
          through the same path the kiosk does, and reloads the list after. */}
      {deskOpen && (
        <div className="mb-6 print:hidden">
          <StaffCheckIn onDone={loadAll} />
        </div>
      )}

      {/* Say so when a deep link narrowed the list, or a sort replaced the
          default grouping — otherwise a filtered view reads as a quiet day. */}
      {(serviceFilter || sort) && (
        <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
          {serviceFilter && (
            <>
              <span className="rounded-full bg-accent-50 px-3 py-1 text-xs font-medium text-accent-700">
                Showing {SERVICE_TYPES.find((s) => s.key === serviceFilter)?.label ?? serviceFilter}{" "}
                only
              </span>
              <button
                onClick={() => setServiceFilter(null)}
                className="text-xs font-medium text-ink-3 hover:text-ink-2">
                Show all services
              </button>
            </>
          )}
          {sort && (
            <>
              <span className="rounded-full bg-surface-3 px-3 py-1 text-xs font-medium text-ink-2">
                Sorted by {SORT_LABELS[sort.key]} {sort.dir === "asc" ? "↑" : "↓"}
              </span>
              <button
                onClick={() => setSort(null)}
                className="text-xs font-medium text-ink-3 hover:text-ink-2">
                Back to grouped by service
              </button>
            </>
          )}
        </div>
      )}

      <div className="print-header mb-5 hidden px-6 py-5 print:block">
        <span className="print-paw" style={{ top: -10, right: 30 }}>
          🐾
        </span>
        <span className="print-paw" style={{ bottom: -20, left: "40%" }}>
          🐾
        </span>
        <div className="relative flex items-center justify-between">
          <div>
            <h2 className="font-display text-2xl font-bold text-white">
              🐾 {business.name}
            </h2>
            <p className="text-base font-medium text-white/90">
              {view === "signins" ? "Sign-in list" : "Daycare walk log"} — {prettyDate}
            </p>
          </div>
          <div className="rounded-2xl bg-white/20 px-4 py-2 text-right text-xs font-medium text-white">
            <p>
              {view === "signins"
                ? `${filtered.length} dog${filtered.length === 1 ? "" : "s"} today`
                : `${walkRows.length} walk${walkRows.length === 1 ? "" : "s"} today`}
            </p>
            <p className="text-white/80">Printed {printedAt}</p>
          </div>
        </div>
      </div>

      {loading && (
        <p className="text-sm text-ink-3 print:hidden">Loading…</p>
      )}
      {error && (
        <p className="text-xs font-medium text-rose-500 print:hidden">
          {error}
        </p>
      )}
      {mgNotice && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 print:hidden">
          <p className="text-sm font-medium text-emerald-800">{mgNotice}</p>
          <Link
            href="/requests?tab=enrollments"
            className="text-xs font-medium text-emerald-700 underline hover:text-emerald-900"
          >
            Open Requests
          </Link>
          <button
            onClick={() => setMgNotice("")}
            className="ml-auto text-xs font-medium text-emerald-700 hover:text-emerald-900"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* One Edit and one Delete for the whole table, driven by what is
          ticked. Per-row buttons were repeated on every line and pushed the
          Price column off the right-hand edge of a laptop screen.
          Editing stays single-row: the editor is one form over one visit. */}
      {/* Save and Cancel live here rather than in the row being edited.
          They used to occupy a tenth cell in a nine-column table, which grew
          the table an extra column the moment anything was edited and shifted
          every heading out from under its data. In the action bar they sit
          where Edit and Delete already are, and the row keeps its shape. */}
      {view === "signins" && editingKey && editState && (
        <div className="sticky top-3 z-30 mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-accent-300 bg-accent-50 px-4 py-2.5 shadow-card print:hidden">
          <p className="text-sm font-medium text-ink">
            Editing{" "}
            <span className="font-semibold">
              {filtered.find((r) => r.key === editingKey)?.dog_name ?? "visit"}
            </span>
          </p>
          <button
            onClick={() => {
              const row = filtered.find((r) => r.key === editingKey);
              if (row) saveEdit(row);
            }}
            disabled={savingEdit}
            className="rounded-xl bg-accent-500 px-4 py-1.5 text-xs font-medium text-accent-ink shadow-card transition hover:bg-accent-600 disabled:opacity-60"
          >
            {savingEdit ? "Saving…" : "Save changes"}
          </button>
          <button
            onClick={cancelEdit}
            className="rounded-xl border border-line bg-surface px-3.5 py-1.5 text-xs font-medium text-ink-2 transition hover:border-accent-400"
          >
            Cancel
          </button>
          <span className="ml-auto text-[11px] text-ink-3">
            Times and price save together
          </span>
        </div>
      )}

      {view === "signins" && !editingKey && selectedRows.length > 0 && (
        <div className="sticky top-3 z-30 mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-accent-200 bg-accent-50 px-4 py-2.5 shadow-card print:hidden">
          <p className="text-sm font-medium text-ink">
            {selectedRows.length} selected
          </p>
          <button
            onClick={() => startEdit(selectedRows[0])}
            disabled={selectedRows.length !== 1}
            title={
              selectedRows.length === 1
                ? undefined
                : "Pick a single visit to edit — the editor works on one at a time"
            }
            className="rounded-xl border border-line bg-surface px-3.5 py-1.5 text-xs font-medium text-ink-2 transition hover:border-accent-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Edit
          </button>
          <button
            onClick={deleteSelected}
            className="rounded-xl border border-rose-200 bg-surface px-3.5 py-1.5 text-xs font-medium text-rose-500 transition hover:border-rose-400"
          >
            Delete {selectedRows.length > 1 ? `all ${selectedRows.length}` : ""}
          </button>
          {/* Select-all lost its column when the checkboxes went. It lives
              here instead, which costs one tap to reach — select a row, then
              select the rest — and costs every row nothing. */}
          {!allVisibleSelected && filtered.length > selectedRows.length && (
            <button
              onClick={() => setSelected(new Set(filtered.map((r) => r.key)))}
              className="rounded-xl border border-line bg-surface px-3.5 py-1.5 text-xs font-medium text-ink-2 transition hover:border-accent-400"
            >
              Select all {filtered.length}
            </button>
          )}
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs font-medium text-ink-3 hover:text-ink-2"
          >
            Clear
          </button>
        </div>
      )}

      {view === "signins" && (
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card print:overflow-visible print:rounded-2xl print:border print:border-paper-rule print:shadow-none">
        <CardTable className="table-cards w-full text-left text-sm print:border-collapse">
          <thead>
            <tr className="border-b border-line-soft text-xs font-medium uppercase tracking-wide text-ink-3 print:border-b-2 print:border-paper-rule print:bg-paper-band print:text-paper-ink">
              {/* No selection column at all. The row tints when it is
                  selected, and that is the whole indicator — a checkbox
                  beside it would be a second way of saying the same thing,
                  taking width from every row to do it. Select-all lives in
                  the toolbar that appears once anything is selected. */}
              <SortableTh label="🐕 Dog" sortKey="dog_name" sort={sort} onSort={toggleSort} />
              <SortableTh label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
              <SortableTh label="Owner" sortKey="last_name" sort={sort} onSort={toggleSort} />
              {/* A native time input has a floor of its own, wider than
                  "8:55 AM". Reserving that width here means the column is
                  already the right size, so flipping a row into edit mode
                  cannot push the neighbouring columns around. */}
              <SortableTh
                label="In"
                sortKey="drop_off_time"
                sort={sort}
                onSort={toggleSort}
                width="min-w-[8.75rem] print:min-w-0"
              />
              <SortableTh
                label="Out"
                sortKey="pick_up_time"
                sort={sort}
                onSort={toggleSort}
                width="min-w-[8.75rem] print:min-w-0"
              />
              <th className="min-w-[8rem] px-3 py-3 print:min-w-0 print:border print:border-paper-rule print:px-2 print:py-1.5">
                Add-ons
              </th>
              <th className="px-3 py-3 print:border print:border-paper-rule print:px-2 print:py-1.5">
                Package
              </th>
              <SortableTh label="Price" sortKey="price" sort={sort} onSort={toggleSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              // Two kinds, shown differently. The daycare block is what the
              // column is mostly for; the walk block only matters when this
              // visit actually booked a walk, and only on daycare — a stay's
              // walks bill per walk on the reservation.
              const pkg = findPackage(r.phone, r.dog_name, "daycare");
              const left = pkg ? Math.max(0, pkg.total_days - pkg.days_used) : null;
              const walkPkgRow =
                r.service_type === "daycare" && (r.addons ?? []).includes("walk")
                  ? findPackage(r.phone, r.dog_name, "walk")
                  : null;
              const walkLeft = walkPkgRow
                ? Math.max(0, walkPkgRow.total_days - walkPkgRow.days_used)
                : null;
              const isEditing = editingKey === r.key;
              // Bands survive sorting, because sorting now happens inside
              // each one rather than across the whole list.
              const showGroupHeader =
                i === 0 || r.service_type !== filtered[i - 1].service_type;
              const groupInfo = SERVICE_TYPES.find(
                (s) => s.key === r.service_type,
              );
              const groupHeader = showGroupHeader && (
                <tr key={`${r.key}-group`}>
                  <td
                    colSpan={8}
                    data-span="2"
                    className="bg-surface-3 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3 print:border print:border-paper-rule print:bg-paper-band print:px-2 print:text-paper-ink">
                    {groupInfo
                      ? `${groupInfo.icon} ${groupInfo.label}`
                      : "Other"}
                  </td>
                </tr>
              );

              if (isEditing && editState) {
                return (
                  <Fragment key={r.key}>
                    {groupHeader}
                    <tr className="border-b border-line-soft bg-accent-50/40 align-top print:hidden">
                      {/* There was a spacer cell here, left over from a
                          selection column that no longer exists. It gave this
                          row nine cells against eight headers, so every cell
                          in an open editor sat one column right of the one it
                          was headed by. */}
                      <td className="px-3 py-3 font-medium text-ink">
                        {r.dog_name}
                      </td>
                      {/* Status is derived from the times below, so it's shown
                          rather than edited — keeps the columns aligned. */}
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">
                          {isStillIn(r) ? "🟢 In" : "✓ Left"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          value={editState.last_name}
                          onChange={(e) =>
                            setEditState({
                              ...editState,
                              last_name: e.target.value,
                            })
                          }
                          className="w-full min-w-0 rounded-lg border border-line px-2 py-1 text-xs outline-none focus:border-accent-500"
                        />
                        <span className="mt-1 block text-[11px] text-ink-3">{r.phone}</span>
                      </td>

                      {/* Time over "by", matching the display row so the
                          columns line up when a row flips into edit mode. */}
                      <td className="px-4 py-3">
                        {r.drop_off_id ? (
                          <>
                            <input
                              type="time"
                              value={editState.drop_off_time}
                              onChange={(e) =>
                                setEditState({ ...editState, drop_off_time: e.target.value })
                              }
                              className="w-full min-w-0 rounded-lg border border-line px-2 py-1 text-xs outline-none focus:border-accent-500"
                            />
                            <input
                              value={editState.drop_off_by}
                              onChange={(e) =>
                                setEditState({ ...editState, drop_off_by: e.target.value })
                              }
                              placeholder="by"
                              className="mt-1 w-full min-w-0 rounded-lg border border-line px-2 py-1 text-[11px] outline-none focus:border-accent-500"
                            />
                          </>
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {r.pick_up_id ? (
                          <>
                            <input
                              type="time"
                              value={editState.pick_up_time}
                              onChange={(e) =>
                                setEditState({ ...editState, pick_up_time: e.target.value })
                              }
                              className="w-full min-w-0 rounded-lg border border-line px-2 py-1 text-xs outline-none focus:border-accent-500"
                            />
                            <input
                              value={editState.pick_up_by}
                              onChange={(e) =>
                                setEditState({ ...editState, pick_up_by: e.target.value })
                              }
                              placeholder="by"
                              className="mt-1 w-full min-w-0 rounded-lg border border-line px-2 py-1 text-[11px] outline-none focus:border-accent-500"
                            />
                          </>
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                      {/* Capped to the column's own width so the editor wraps
                          inside it rather than stretching it. The bath prices
                          are dropped here — they are on the inline control and
                          on the price breakdown, and spelling them out was
                          what made this the one cell that still moved. */}
                      <td className="px-4 py-3">
                        <div className="max-w-[8rem]">
                          <div className="flex flex-wrap gap-1">
                            {ADDONS.map((a) => (
                              <button
                                key={a.key}
                                onClick={() => toggleEditAddon(a.key)}
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
                                  editState.addons.includes(a.key)
                                    ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                                    : "border-line bg-surface text-ink-3"
                                }`}>
                                {a.label}
                              </button>
                            ))}
                          </div>
                          {editState.addons.includes("bath") && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1">
                              <span className="text-[10px] text-ink-3">Bath</span>
                              {BATH_SIZES.map((size) => (
                                <button
                                  key={size}
                                  onClick={() => selectBathSize(size)}
                                  title={`Bath size ${size} — $${BATH_PRICES[size].toFixed(2)}`}
                                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
                                    editState.bath_size === size
                                      ? "border-sky-500 bg-sky-50 text-sky-700"
                                      : "border-line bg-surface text-ink-3"
                                  }`}>
                                  {size}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-ink-3">
                        {/* Which package this visit spent. Changing it refunds
                            the old block and deducts the new one. */}
                        {(() => {
                          const options = eligiblePackagesFor(
                            packages,
                            r.phone,
                            r.dog_name,
                            "daycare"
                          );
                          if (!options.length) return "—";
                          return (
                            <select
                              value={editState.package_id}
                              onChange={(e) =>
                                setEditState({ ...editState, package_id: e.target.value })
                              }
                              className="w-full rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent-500"
                            >
                              <option value="">No package used</option>
                              {options.map((p) => (
                                <option key={p.id} value={p.id ?? ""}>
                                  {packageLabel(p)}
                                </option>
                              ))}
                            </select>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        {r.pick_up_id ? (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={editState.price}
                            onChange={(e) =>
                              setEditState({
                                ...editState,
                                price: e.target.value,
                              })
                            }
                            placeholder="0.00"
                            className="w-full min-w-0 rounded-lg border border-line px-2 py-1 text-xs outline-none focus:border-accent-500"
                          />
                        ) : (
                          (() => {
                            const liveEstimate = computeEstimate(r, pkg);
                            return liveEstimate ? (
                              <span
                                className="text-xs text-ink-3"
                                title="Live estimate — finalizes at pick-up">
                                ~${liveEstimate.amount.toFixed(2)}
                              </span>
                            ) : (
                              <span
                                className="text-xs text-ink-3"
                                title="Set once this visit has a pick-up">
                                —
                              </span>
                            );
                          })()
                        )}
                      </td>
                    </tr>
                  </Fragment>
                );
              }

              const stillIn = isStillIn(r);
              const isSelected = selected.has(r.key);
              return (
                <Fragment key={r.key}>
                  {groupHeader}
                  {/* A left edge and faint tint make the dogs still on site
                      scannable without reading the times column. */}
                  {/* align-top on the row, not on one cell. The price cell
                      was top-aligned while everything else centred, so a row
                      that grew — a bath size, a second package dropdown —
                      pulled its neighbours out of line with the row above. */}
                  {/* The whole row selects. A checkbox is a small target on a
                      tablet at the front desk, and this row is already the
                      thing being pointed at.

                      Clicks on anything interactive inside are left alone —
                      the dog link, the note and meal buttons, every input and
                      dropdown in the inline editor. Without that check,
                      opening a dog profile or typing a time would also toggle
                      the selection underneath it. */}
                  <tr
                    aria-selected={isSelected}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("a, button, input, select, textarea, label")) return;
                      toggleSelected(r.key);
                    }}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleSelected(r.key);
                      }
                    }}
                    tabIndex={0}
                    className={`cursor-pointer border-b border-line-soft align-top outline-none transition-colors last:border-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-300 print:border-b-0 print:cursor-auto ${
                      isSelected
                        ? // Selection wins over the still-here tint, because it
                          // is the state being acted on. The left edge stays
                          // green so a selected dog does not stop looking like
                          // one that is still on site.
                          `border-l-4 bg-accent-100/70 dark:bg-accent-400/20 print:bg-transparent ${
                            stillIn ? "border-l-emerald-400" : "border-l-accent-400"
                          }`
                        : stillIn
                          ? "border-l-4 border-l-emerald-400 bg-emerald-50/40 hover:bg-emerald-50/70 dark:bg-emerald-400/10 print:bg-transparent"
                          : "border-l-4 border-l-transparent hover:bg-surface-2"
                    }`}>
                    <td data-label="Dog" data-span="2" className="whitespace-nowrap px-3 py-3 font-medium text-ink print:border print:border-paper-line print:px-2 print:py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <DogLink
                          dog={findDog(dogs, { dogName: r.dog_name, phone: r.phone })}
                          name={r.dog_name}
                          badges={{ packageDaysLeft: left }}
                          className="font-medium text-ink"
                          avatar
                        />
                        {r.drop_off_id && (
                          <button
                            type="button"
                            onClick={() => {
                              const opening = noteKey !== r.key;
                              setNoteKey(opening ? r.key : null);
                              setNoteDraft(opening ? (r.staff_note ?? "") : "");
                            }}
                            aria-label={
                              r.staff_note ? `Note for ${r.dog_name}` : `Add a note for ${r.dog_name}`
                            }
                            aria-expanded={noteKey === r.key}
                            title={r.staff_note || "Add a note for today"}
                            className={`rounded px-1 text-[11px] leading-none transition print:hidden ${
                              r.staff_note
                                ? "text-amber-600 hover:text-amber-700"
                                : "text-ink-3/40 hover:text-ink-3"
                            }`}>
                            {r.staff_note ? "📝" : "✏️"}
                          </button>
                        )}
                        {/* Only appears once a meal is due, so the vast
                            majority of rows are unchanged. Amber until every
                            meal is given, then it stops asking for attention. */}
                        {(r.meals?.length ?? 0) > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              const opening = noteKey !== r.key;
                              setNoteKey(opening ? r.key : null);
                              setNoteDraft(opening ? (r.staff_note ?? "") : "");
                            }}
                            aria-label={`Meals for ${r.dog_name}`}
                            title={MEALS.filter((m) => r.meals?.includes(m.key))
                              .map(
                                (m) =>
                                  `${m.label}: ${r.meals_given?.includes(m.key) ? "given" : "due"}`
                              )
                              .join(" · ")}
                            className={`rounded px-1 text-[10px] font-semibold leading-none tabular-nums transition ${
                              (r.meals_given?.length ?? 0) >= (r.meals?.length ?? 0)
                                ? "text-emerald-600"
                                : "text-amber-600"
                            }`}>
                            🍽 {r.meals_given?.length ?? 0}/{r.meals?.length ?? 0}
                          </button>
                        )}
                      </span>
                    </td>
                    <td data-label="Status" className="whitespace-nowrap px-3 py-3 print:border print:border-paper-line print:px-2 print:py-1.5">
                      {stillIn ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-800 print:bg-transparent print:px-0 print:font-bold">
                          🟢 In
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3 print:bg-transparent print:px-0">
                          ✓ Left
                        </span>
                      )}
                    </td>
                    {/* Owner and contact are one fact about the household,
                        and the person who handed the dog over belongs with
                        the time they did it — twelve columns did not fit on
                        a laptop, so Price was scrolled off the right. */}
                    <td data-label="Owner" className="whitespace-nowrap px-4 py-3 text-ink-2 print:border print:border-paper-line print:px-2 print:py-1.5">
                      <span className="block text-ink-2">{r.last_name}</span>
                      <span className="block text-[11px] text-ink-3">{r.phone}</span>
                    </td>
                    <td data-label="In" className="whitespace-nowrap px-4 py-3 text-ink-2 print:border print:border-paper-line print:px-2 print:py-1.5">
                      <span className="block text-ink-2">{timeOnly(r.drop_off_time)}</span>
                      {r.drop_off_by && (
                        <span className="block text-[11px] text-ink-3" title={r.drop_off_by}>
                          by {firstNameOnly(r.drop_off_by)}
                        </span>
                      )}
                    </td>
                    <td data-label="Out" className="whitespace-nowrap px-4 py-3 text-ink-2 print:border print:border-paper-line print:px-2 print:py-1.5">
                      {r.pick_up_time ? (
                        <>
                          <span className="block text-ink-2">{timeOnly(r.pick_up_time)}</span>
                          {r.pick_up_by && (
                            <span className="block text-[11px] text-ink-3" title={r.pick_up_by}>
                              by {firstNameOnly(r.pick_up_by)}
                            </span>
                          )}
                        </>
                      ) : r.pickup_window ? (
                        // The window the client asked for. It belongs here,
                        // under the question this column already asks — when
                        // is the dog going home — rather than crowding the
                        // add-ons it was booked alongside.
                        <span className="text-[11px] text-sky-700">🕑 {r.pickup_window}</span>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>

                    <td data-label="Add-ons" data-span="2" className="whitespace-nowrap px-4 py-3 text-ink-2 print:border print:border-paper-line print:px-2 print:py-1.5">
                      {/* Tap to add or remove, but only while the dog is
                          here. Once it has gone home the visit is priced and
                          often paid, so the row freezes on what was actually
                          given — a retrospective add-on would change a bill
                          that has already been settled. Corrections still go
                          through Edit, which is deliberate.

                          Printed sheets get the plain list either way — a row
                          of buttons on paper is noise. */}
                      {/* A meet & greet has no add-ons to sell — it has a
                          verdict. The column carries that instead. */}
                      {r.service_type === "meet_greet" ? (
                        <div className="flex flex-wrap items-center gap-1 print:hidden">
                          {r.meet_greet_result === "pass" ? (
                            <>
                              <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                                ✓ Passed
                              </span>
                              {/* Offered here because a pass is when the photo
                                  exists, and the photo is what makes the sheet
                                  worth handing over. Opened rather than printed
                                  straight off: staff fill it in first. */}
                              {(() => {
                                const d = findDog(dogs, { dogName: r.dog_name, phone: r.phone });
                                return d?.id ? (
                                  <a
                                    href={`/first-day?dog=${d.id}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    title={`Write ${r.dog_name}'s first day report for the owner`}
                                    className="rounded-md border border-accent-300 px-2 py-0.5 text-[11px] font-medium text-accent-700 transition hover:bg-accent-50">
                                    🖨 First day report
                                  </a>
                                ) : null;
                              })()}
                              {/* A meet & greet that turns into a day.
                                  Offered once the verdict is in — the
                                  assessment is the point of the visit and
                                  should not be skippable, and the verdict
                                  controls live in this same cell, so a row
                                  converted first would lose them.

                                  And only while the dog is still here. This
                                  means "they stayed on for the day", which is
                                  a decision somebody makes with the dog in
                                  front of them. On a row that has gone home
                                  it re-prices a visit that already happened:
                                  a meet & greet is free, a daycare day is
                                  not, so one tap turned a twenty-minute
                                  assessment into a charge the client never
                                  agreed to — and greyed to match the other
                                  quiet controls, it read as something you
                                  could not press at all.

                                  The cost of hiding it is that a dog which
                                  genuinely stayed all day, and was signed out
                                  as a meet & greet by mistake, stays free.
                                  That is the safer way to be wrong.

                                  It costs no width anywhere else. Only a meet
                                  & greet row renders this cell at all, so the
                                  table stays the same size for the twenty
                                  daycare dogs underneath it. */}
                              {stillIn && (
                                <button
                                  onClick={() => convertToDaycare(r)}
                                  disabled={mgBusyKey === r.key}
                                  title="They stayed on for the day — move this to Daycare. The pass is kept, and the day is priced at pick-up like any other."
                                  className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-ink-3 transition hover:border-accent-400 hover:text-accent-600 disabled:opacity-50">
                                  → Daycare
                                </button>
                              )}
                            </>
                          ) : r.meet_greet_result === "fail" ? (
                            <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                              ✕ Not passed
                            </span>
                          ) : stillIn ? (
                            <>
                              <button
                                onClick={() => setMeetGreetResult(r, "pass")}
                                disabled={mgBusyKey === r.key}
                                title="Cleared for daycare — a photo of the dog is required"
                                className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 transition hover:bg-emerald-200 disabled:opacity-50"
                              >
                                {mgBusyKey === r.key ? "Saving…" : "✓ Pass"}
                              </button>
                              <button
                                onClick={() => setMeetGreetResult(r, "fail")}
                                disabled={mgBusyKey === r.key}
                                className="rounded-md bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-ink-3 transition hover:text-rose-600 disabled:opacity-50"
                              >
                                ✕ No
                              </button>
                              <span className="block w-full text-[10px] text-ink-3">
                                A pass needs a photo
                              </span>
                            </>
                          ) : (
                            <span className="text-[11px] text-ink-3">Not assessed</span>
                          )}
                        </div>
                      ) : (
                      <div className="flex flex-wrap items-center gap-1 print:hidden">
                        {stillIn
                          ? ADDONS.map((a) => {
                              const on = (r.addons ?? []).includes(a.key);
                              return (
                                <button
                                  key={a.key}
                                  onClick={() => toggleAddonInline(r, a.key)}
                                  disabled={!r.drop_off_id}
                                  title={
                                    r.drop_off_id
                                      ? `${on ? "Remove" : "Add"} ${a.label}`
                                      : "This visit has no drop-off row to change"
                                  }
                                  className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                                    on
                                      ? "bg-accent-100 text-accent-800 ring-1 ring-accent-300"
                                      : "bg-surface-3 text-ink-3 hover:text-ink-2"
                                  }`}
                                >
                                  {a.label}
                                </button>
                              );
                            })
                          : (() => {
                              const chosen = ADDONS.filter((a) =>
                                (r.addons ?? []).includes(a.key)
                              );
                              if (!chosen.length) return <span className="text-ink-3">—</span>;
                              return chosen.map((a) => (
                                <span
                                  key={a.key}
                                  title="Locked — this visit has ended"
                                  className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] font-medium text-ink-2"
                                >
                                  {a.label}
                                  {a.key === "bath" && r.bath_size ? ` (${r.bath_size})` : ""}
                                </span>
                              ));
                            })()}
                      {stillIn && r.addons?.includes("bath") && (
                          <span
                            className={`ml-1 inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 print:hidden ${
                              r.bath_size ? "bg-surface-3" : "bg-amber-100"
                            }`}
                            title={
                              r.bath_size
                                ? `Bath size ${r.bath_size}`
                                : "This bath has no size yet, so it is not being charged"
                            }
                          >
                            {BATH_SIZES.map((sz) => (
                              <button
                                key={sz}
                                onClick={() => setBathSizeInline(r, r.bath_size === sz ? null : sz)}
                                title={`Bath size ${sz} — $${BATH_PRICES[sz].toFixed(2)}`}
                                className={`rounded px-1 py-0 text-[10px] font-bold transition ${
                                  r.bath_size === sz
                                    ? "bg-accent-500 text-accent-ink"
                                    : "text-ink-3 hover:text-ink-2"
                                }`}
                              >
                                {sz}
                              </button>
                            ))}
                          </span>
                        )}
                      </div>
                      )}
                      <span className="hidden print:inline">
                        {r.addons && r.addons.length
                          ? r.addons
                              .map((a) =>
                                a === "bath" && r.bath_size
                                  ? `Bath (${r.bath_size})`
                                  : a === "bath"
                                    ? "Bath"
                                    : a === "nail_trim"
                                      ? "Nail trim"
                                      : a === "walk"
                                        ? "Walk"
                                        : a
                              )
                              .join(", ")
                          : "—"}
                      </span>
                      {/* A bath that left without a size was never priced. It
                          is too late to fix from here, but staff should still
                          see that it happened. */}
                      {!stillIn && r.addons?.includes("bath") && !r.bath_size && (
                        <span className="mt-0.5 block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 print:hidden">
                          ⚠️ Left with no bath size — unbilled
                        </span>
                      )}
                    </td>
                    <td data-label="Package" className="whitespace-nowrap px-4 py-3 text-ink-2 print:border print:border-paper-line print:px-2 print:py-1.5">
                      {/* Which block this visit draws from, changeable in
                          place. Only offered where it can actually apply: a
                          daycare day for the daycare block, a booked walk for
                          the walk block. Boarding walks bill per walk and
                          never touch a package. */}
                      {(() => {
                        const dayOptions =
                          r.service_type === "daycare"
                            ? eligiblePackagesFor(packages, r.phone, r.dog_name, "daycare")
                            : [];
                        const walkOptions =
                          r.service_type === "daycare" && (r.addons ?? []).includes("walk")
                            ? eligiblePackagesFor(packages, r.phone, r.dog_name, "walk")
                            : [];
                        if (!dayOptions.length && !walkOptions.length) {
                          return <span className="text-ink-3">—</span>;
                        }
                        const dayCurrent = useForRow(r, "daycare")?.package_id ?? "";
                        const walkCurrent = useForRow(r, "walk")?.package_id ?? "";

                        // Frozen once the dog leaves: the day or walk has been
                        // spent and the visit priced against it, so switching
                        // blocks here would move a use that is already billed.
                        if (!stillIn) {
                          const spentDay = packages.find((p) => p.id === dayCurrent);
                          const spentWalk = packages.find((p) => p.id === walkCurrent);
                          if (!spentDay && !spentWalk) {
                            return <span className="text-ink-3">—</span>;
                          }
                          return (
                            <div className="flex flex-col gap-1" title="Locked — this visit has ended">
                              {spentDay && (
                                <span className="inline-flex w-fit items-center gap-1 rounded-md bg-accent-50 px-1.5 py-0.5 text-[11px] font-medium text-accent-700 print:bg-transparent print:px-0 print:text-ink">
                                  <span aria-hidden>📦</span>
                                  <span className="text-ink-3 print:text-ink">Day</span>
                                  {daysLeft(spentDay)} / {spentDay.total_days}
                                </span>
                              )}
                              {spentWalk && (
                                <span className="inline-flex w-fit items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 print:bg-transparent print:px-0 print:text-ink">
                                  <span aria-hidden>🚶</span>
                                  <span className="text-ink-3 print:text-ink">Walk</span>
                                  {daysLeft(spentWalk)} / {spentWalk.total_days}
                                </span>
                              )}
                            </div>
                          );
                        }
                        const selectClass =
                          "w-full max-w-[9.5rem] rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] text-ink outline-none focus:border-accent-500 print:hidden";
                        // Past four hours the day is going to be spent at
                        // pick-up whether or not anyone touches this dropdown,
                        // so show it selected rather than "No day used" — the
                        // list should not say one thing while checkout does
                        // another. Nothing is written until pick-up, or until
                        // staff pick a different block here.
                        const projectedDay =
                          !dayCurrent &&
                          // Staff have said no. Their answer outranks the rule.
                          r.package_opt_out !== true &&
                          r.service_type === "daycare" &&
                          r.drop_off_time
                            ? isFullDayVisit(new Date(r.drop_off_time), new Date())
                              ? findPackageFor(packages, r.phone, r.dog_name, "daycare")
                              : null
                            : null;
                        const dayValue = dayCurrent || projectedDay?.id || "";
                        return (
                          <div className="flex flex-col gap-1">
                            {dayOptions.length > 0 && (
                              <select
                                value={dayValue}
                                onChange={(e) => setPackageInline(r, e.target.value, "daycare")}
                                title={
                                  projectedDay
                                    ? "This visit is past four hours, so a day will be spent at pick-up"
                                    : "Daycare package this visit spends a day from"
                                }
                                className={selectClass}
                              >
                                <option value="">📦 No day used</option>
                                {dayOptions.map((p) => (
                                  <option key={p.id} value={p.id ?? ""}>
                                    📦 {daysLeft(p)}/{p.total_days}
                                    {p.dog_name ? "" : " shared"}
                                  </option>
                                ))}
                              </select>
                            )}
                            {walkOptions.length > 0 && (
                              <select
                                value={walkCurrent}
                                onChange={(e) => setPackageInline(r, e.target.value, "walk")}
                                title="Walk package this visit spends a walk from"
                                className={selectClass}
                              >
                                <option value="">🚶 No walk used</option>
                                {walkOptions.map((p) => (
                                  <option key={p.id} value={p.id ?? ""}>
                                    🚶 {daysLeft(p)}/{p.total_days}
                                    {p.dog_name ? "" : " shared"}
                                  </option>
                                ))}
                              </select>
                            )}
                            {projectedDay && (
                              <span className="text-[10px] text-ink-3 print:hidden">
                                spends at pick-up
                              </span>
                            )}
                            <span className="hidden print:inline">
                              {pkg ? `Day ${left}/${pkg.total_days}` : ""}
                              {pkg && walkPkgRow ? " · " : ""}
                              {walkPkgRow ? `Walk ${walkLeft}/${walkPkgRow.total_days}` : ""}
                              {!pkg && !walkPkgRow ? "—" : ""}
                            </span>
                          </div>
                        );
                      })()}
                    </td>
                    <td data-label="Price" data-align="right" className="px-4 py-3 text-right align-top font-medium print:border print:border-paper-line print:px-2 print:py-1.5">
                      {(() => {
                        const estimate = computeEstimate(r, pkg);
                        if (!estimate)
                          return <span className="text-ink-3">—</span>;
                        const finalAmount =
                          r.price != null ? r.price : estimate.amount;
                        const isFinal = r.price != null;
                        const showBreakdown = breakdownOpenKey === r.key;
                        return (
                          <div>
                            <button
                              onClick={() =>
                                setBreakdownOpenKey(
                                  showBreakdown ? null : r.key,
                                )
                              }
                              title={isFinal ? "Final price" : "Running estimate"}
                              className="inline-flex w-full items-baseline justify-end gap-1 hover:underline">
                              {/* A running estimate is not a debt, so it stays
                                  neutral until the dog is signed out and the
                                  visit becomes a real charge. */}
                              <Money
                                amount={finalAmount}
                                state={isFinal ? stateFor(signinChargeKey(r.pick_up_id ?? "")) : "estimate"}
                              />
                              <span className="text-ink-3 print:hidden">🧾</span>
                            </button>
                            {!isFinal && (
                              <span className="block text-right text-[10px] font-normal text-ink-3 print:hidden">
                                estimate
                              </span>
                            )}
                            {showBreakdown && (
                              <ul className="mt-1 space-y-0.5 text-[10px] font-normal text-ink-3">
                                {estimate.breakdown.map((item, i) => (
                                  <li
                                    key={i}
                                    className="flex justify-between gap-3">
                                    <span>{item.label}</span>
                                    <span>${item.amount.toFixed(2)}</span>
                                  </li>
                                ))}
                                {isFinal &&
                                  Math.abs(finalAmount - estimate.amount) >
                                    0.01 && (
                                    <li className="pt-0.5 text-ink-3">
                                      (price manually adjusted)
                                    </li>
                                  )}
                              </ul>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>

                  {/* The note, under the dog it belongs to. Never printed:
                      the day sheets go to owners, and this is a handover
                      note between shifts. */}
                  {noteKey === r.key && (
                    <tr className="print:hidden">
                      <td colSpan={8} className="bg-surface-2 px-4 pb-3 pt-1">
                        <p className="mb-1 text-[11px] font-medium text-ink-3">
                          Meals for {r.dog_name} today
                        </p>
                        <div className="mb-3 flex flex-wrap items-center gap-1.5">
                          {MEALS.map((m) => {
                            const due = r.meals?.includes(m.key) ?? false;
                            const given = r.meals_given?.includes(m.key) ?? false;
                            return (
                              <span key={m.key} className="inline-flex overflow-hidden rounded-lg">
                                <button
                                  onClick={() => toggleMealDue(r, m.key)}
                                  disabled={noteBusy}
                                  title={due ? `${m.label} is due — tap to remove` : `Add ${m.label}`}
                                  className={`border px-2.5 py-1 text-xs font-medium transition disabled:opacity-60 ${
                                    due
                                      ? "border-amber-300 bg-amber-50 text-amber-800"
                                      : "border-line bg-surface text-ink-3 hover:border-accent-400"
                                  } ${due ? "rounded-l-lg" : "rounded-lg"}`}>
                                  {m.icon} {m.label}
                                </button>
                                {/* Marking one given is the action staff take
                                    ten times a day, so it is one tap and it
                                    only exists once the meal is actually due. */}
                                {due && (
                                  <button
                                    onClick={() => toggleMealGiven(r, m.key)}
                                    disabled={noteBusy}
                                    title={given ? "Given — tap to undo" : `Mark ${m.label} given`}
                                    className={`rounded-r-lg border border-l-0 px-2.5 py-1 text-xs font-semibold transition disabled:opacity-60 ${
                                      given
                                        ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                                        : "border-line bg-surface text-ink-3 hover:border-emerald-300"
                                    }`}>
                                    {given ? "✓ given" : "mark given"}
                                  </button>
                                )}
                              </span>
                            );
                          })}
                        </div>

                        <label
                          htmlFor={`note-${r.key}`}
                          className="mb-1 block text-[11px] font-medium text-ink-3">
                          Note for {r.dog_name} today — staff only, not printed
                        </label>
                        <textarea
                          id={`note-${r.key}`}
                          autoFocus
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setNoteKey(null);
                            // Enter saves; Shift+Enter is a new line. A note
                            // is usually one sentence typed one-handed.
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              saveStaffNote(r, noteDraft);
                            }
                          }}
                          rows={2}
                          placeholder="Picking up early, no treats, owner bringing medication at 3…"
                          className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
                        />
                        <div className="mt-1.5 flex items-center gap-2">
                          <button
                            onClick={() => saveStaffNote(r, noteDraft)}
                            disabled={noteBusy}
                            className="rounded-lg bg-accent-500 px-3 py-1 text-xs font-medium text-accent-ink hover:bg-accent-600 disabled:opacity-60">
                            {noteBusy ? "Saving…" : "Save"}
                          </button>
                          <button
                            onClick={() => setNoteKey(null)}
                            className="rounded-lg border border-line px-3 py-1 text-xs text-ink-2 hover:border-accent-400">
                            Cancel
                          </button>
                          {r.staff_note && (
                            <button
                              onClick={() => saveStaffNote(r, "")}
                              disabled={noteBusy}
                              className="ml-auto text-xs text-ink-3 hover:text-rose-500 disabled:opacity-60">
                              Clear
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {filtered.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-6 text-center text-sm text-ink-3 print:border print:border-paper-line">
                  No sign-ins for this date.
                </td>
              </tr>
            )}
          </tbody>
        </CardTable>
      </div>
      )}

      {view === "boarding" && (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card print:overflow-visible print:rounded-2xl print:border print:border-paper-rule print:shadow-none">
          <CardTable className="w-full text-left text-sm print:border-collapse">
            <thead>
              <tr className="border-b border-line-soft text-xs font-medium uppercase tracking-wide text-ink-3 print:border-b-2 print:border-paper-rule print:bg-paper-band print:text-paper-ink">
                <th className="px-3 py-3 print:border print:border-paper-rule print:px-2 print:py-1.5">
                  🐕 Dog
                </th>
                <th className="px-3 py-3 print:border print:border-paper-rule print:px-2 print:py-1.5">
                  Status
                </th>
                <th className="px-3 py-3 print:border print:border-paper-rule print:px-2 print:py-1.5">
                  Owner
                </th>
                <th className="px-3 py-3 print:border print:border-paper-rule print:px-2 print:py-1.5">
                  Stay
                </th>
                <th className="px-3 py-3 print:border print:border-paper-rule print:px-2 print:py-1.5">
                  Progress
                </th>
                <th className="px-3 py-3 print:border print:border-paper-rule print:px-2 print:py-1.5">
                  Goes home
                </th>
                <th className="px-3 py-3 print:border print:border-paper-rule print:px-2 print:py-1.5">
                  Care
                </th>
                <th className="px-3 py-3 print:border print:border-paper-rule print:px-2 print:py-1.5">
                  Est. total
                </th>
                <th className="px-3 py-3 print:hidden" />
              </tr>
            </thead>
            <tbody>
              {boardingRows.map((row) => {
                const b = row.b;
                return (
                  <tr
                    key={b.id}
                    className={`border-b border-line-soft last:border-0 print:border-b-0 ${
                      row.onSite ? "bg-emerald-50/40" : ""
                    }`}
                  >
                    <td className="whitespace-nowrap px-3 py-3 print:border print:border-paper-line print:px-2 print:py-1.5">
                      <DogLink
                        dog={row.dog}
                        name={b.dog_name}
                        className="font-medium text-ink"
                        avatar
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 print:border print:border-paper-line print:px-2 print:py-1.5">
                      {row.onSite ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
                          🟢 In
                        </span>
                      ) : row.departed ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-ink-3">
                          ✓ Left
                        </span>
                      ) : (
                        // A stay whose dates have started but with no drop-off
                        // recorded is the one worth chasing.
                        <span
                          title="Booked, but no drop-off has been recorded"
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                            row.isArrival
                              ? "bg-sky-100 text-sky-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {row.isArrival ? "Due in" : "⚠️ No drop-off"}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-ink-2 print:border print:border-paper-line print:px-2 print:py-1.5">
                      {b.last_name}
                      <span className="block text-[11px] text-ink-3">{b.phone}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-ink-2 print:border print:border-paper-line print:px-2 print:py-1.5">
                      {prettyDateKey(b.start_date)}
                      <span className="block text-[11px] text-ink-3">
                        → {prettyDateKey(b.end_date)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-ink-2 print:border print:border-paper-line print:px-2 print:py-1.5">
                      {row.isDeparture ? (
                        <span className="font-medium text-sky-700">Going home</span>
                      ) : (
                        <>
                          Night {row.elapsed} of {row.nights}
                          <span className="mt-1 block h-1 w-20 overflow-hidden rounded-full bg-surface-3 print:hidden">
                            <span
                              className="block h-full rounded-full bg-accent-400"
                              style={{ width: `${Math.round((row.elapsed / row.nights) * 100)}%` }}
                            />
                          </span>
                        </>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 print:border print:border-paper-line print:px-2 print:py-1.5">
                      <span className="font-medium text-ink">{prettyDateKey(b.end_date)}</span>
                      <span
                        className={`block text-[11px] ${
                          row.isDeparture ? "font-semibold text-sky-700" : "text-ink-3"
                        }`}
                      >
                        {untilLabel(b.end_date)}
                      </span>
                    </td>
                    <td className="px-3 py-3 print:border print:border-paper-line print:px-2 print:py-1.5">
                      <div className="flex max-w-[11rem] flex-wrap gap-1">
                        {(b.addons ?? []).map((a) => {
                          const meta = BOARDING_ADDONS.find((x) => x.key === a);
                          const label =
                            a === "walk" && b.walks_per_day
                              ? `${meta?.label ?? a} ×${b.walks_per_day}/day`
                              : a === "bath" && b.bath_size
                                ? `${meta?.label ?? a} (${b.bath_size})`
                                : (meta?.label ?? a);
                          return (
                            <span
                              key={a}
                              className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                                a === "medication"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-surface-3 text-ink-2"
                              }`}
                            >
                              {meta?.icon} {label}
                            </span>
                          );
                        })}
                        {!(b.addons ?? []).length && <span className="text-ink-3">—</span>}
                      </div>
                      {b.feeding_instructions && (
                        <span
                          title={b.feeding_instructions}
                          className="mt-1 block max-w-[11rem] truncate text-[11px] text-ink-3"
                        >
                          🍽️ {b.feeding_instructions}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-medium text-emerald-700 print:border print:border-paper-line print:px-2 print:py-1.5">
                      ${row.estimate.amount.toFixed(2)}
                      <span className="block text-[10px] font-normal text-ink-3">
                        {row.nights} night{row.nights === 1 ? "" : "s"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 print:hidden">
                      <Link
                        href={`/stay-report?boardingId=${b.id}`}
                        className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink-2 transition hover:border-accent-400"
                      >
                        Details
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {boardingRows.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-6 text-center text-sm text-ink-3 print:border print:border-paper-line"
                  >
                    No boarding stays covering this date.
                  </td>
                </tr>
              )}
            </tbody>
          </CardTable>
        </div>
      )}

      {view === "walklog" && (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card print:overflow-visible print:rounded-2xl print:border print:border-paper-rule print:shadow-none">
          <CardTable className="w-full text-left text-sm print:border-collapse">
            <thead>
              <tr className="border-b border-line-soft text-xs font-medium uppercase tracking-wide text-ink-3 print:border-b-2 print:border-paper-rule print:bg-paper-band print:text-paper-ink">
                <th className="px-3 py-3 print:border print:border-paper-rule print:px-2 print:py-1.5">
                  🐕 Dog
                </th>
                <th className="px-3 py-3 print:border print:border-paper-rule print:px-2 print:py-1.5">
                  Status
                </th>
                <th className="px-3 py-3 print:border print:border-paper-rule print:px-2 print:py-1.5">
                  Owner
                </th>
                <th className="px-3 py-3 print:border print:border-paper-rule print:px-2 print:py-1.5">
                  Walk
                </th>
                <th className="min-w-[13rem] px-3 py-3 print:min-w-0 print:border print:border-paper-rule print:px-2 print:py-1.5">
                  Out → back
                </th>
                <th className="px-3 py-3 print:border print:border-paper-rule print:px-2 print:py-1.5">
                  By
                </th>
                <th className="px-3 py-3 print:hidden">Package</th>
              </tr>
            </thead>
            <tbody>
              {walkRows.map((r, i) => {
                const showGroupHeader = i === 0 || r.service !== walkRows[i - 1].service;
                const groupInfo = SERVICE_TYPES.find((s) => s.key === r.service);
                const dog = findDog(dogs, {
                  dogId: r.dogId,
                  dogName: r.dogName,
                  phone: r.phone,
                });
                const pkg = findPackageFor(packages, r.phone, r.dogName);
                // A dog with three walks a day filled the column with its own
                // name three times. Name it once; the slot below distinguishes
                // the rest.
                const prev = walkRows[i - 1];
                const sameDogAsAbove =
                  !showGroupHeader && !!prev && prev.dogName === r.dogName && prev.phone === r.phone;
                // The walk package is a property of the whole stay, not of
                // one slot, so it is offered once per stay rather than
                // repeated beside every walk of the day. Daycare keeps its
                // own picker on every row: two rows for one dog there are two
                // separate visits, each drawing its own walk.
                const samePickerAsAbove =
                  sameDogAsAbove &&
                  r.service === "boarding" &&
                  !!r.boarding?.id &&
                  prev?.boarding?.id === r.boarding.id;
                const done = !!r.out && !!r.back;
                const outNotBack = !!r.out && !r.back;
                const minutes = walkMinutes(r.out, r.back);
                return (
                  <Fragment key={r.key}>
                    {showGroupHeader && (
                      <tr>
                        <td
                          colSpan={7}
                          className="bg-surface-3 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3 print:border print:border-paper-rule print:bg-paper-band print:px-2 print:text-paper-ink">
                          {groupInfo ? `${groupInfo.icon} ${groupInfo.label}` : r.service}
                        </td>
                      </tr>
                    )}
                    <tr
                      className={`border-b border-line-soft last:border-0 print:border-b-0 ${
                        done ? "bg-emerald-50/40" : outNotBack ? "bg-amber-50/40" : ""
                      }`}
                    >
                      <td className="whitespace-nowrap px-3 py-3 font-medium text-ink print:border print:border-paper-line print:px-2 print:py-1.5">
                        {sameDogAsAbove ? (
                          // Printed sheets have no row grouping to lean on, so
                          // the name comes back for paper.
                          <span className="hidden print:inline">{r.dogName}</span>
                        ) : (
                          <DogLink
                            dog={dog}
                            name={r.dogName}
                            badges={{
                              packageDaysLeft: pkg
                                ? Math.max(0, pkg.total_days - pkg.days_used)
                                : null,
                            }}
                            className="font-medium text-ink"
                            avatar
                          />
                        )}
                      </td>
                      {/* Where this walk has got to. A dog that went out and
                          has not come back is the one thing on this page that
                          needs acting on, so it gets its own colour rather
                          than being inferred from a blank second dropdown. */}
                      <td className="whitespace-nowrap px-3 py-3 print:border print:border-paper-line print:px-2 print:py-1.5">
                        {done ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-800 print:bg-transparent print:px-0">
                            ✓ Done
                          </span>
                        ) : outNotBack ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-800 print:bg-transparent print:px-0">
                            🚶 Out now
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-ink-3 print:bg-transparent print:px-0">
                            ⏳ To do
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-ink-2 print:border print:border-paper-line print:px-2 print:py-1.5">
                        {sameDogAsAbove ? (
                          <span className="hidden print:inline">{r.lastName}</span>
                        ) : (
                          <>
                            {r.lastName}
                            <span className="block text-[11px] text-ink-3">{r.phone}</span>
                          </>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 print:border print:border-paper-line print:px-2 print:py-1.5">
                        <span className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] font-medium text-ink-2 print:bg-transparent print:px-0">
                          {r.slotOf > 1 ? `${r.slotNo} of ${r.slotOf}` : "Walk"}
                        </span>
                      </td>
                      <td className="px-3 py-3 print:border print:border-paper-line print:px-2 print:py-1.5">
                        <div className="flex items-center gap-1.5">
                          <TimeSelect
                            ariaLabel={`${r.dogName} walk out`}
                            value={r.out}
                            onSave={(v) => r.save("walk_out", v)}
                          />
                          <span className="text-ink-3" aria-hidden>
                            →
                          </span>
                          <TimeSelect
                            ariaLabel={`${r.dogName} walk back`}
                            value={r.back}
                            onSave={(v) => r.save("walk_in", v)}
                          />
                        </div>
                        {minutes != null && (
                          <span className="mt-0.5 block text-[10px] text-ink-3">
                            {minutes} min
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 print:border print:border-paper-line print:px-2 print:py-1.5">
                        <StaffSelect
                          ariaLabel={`${r.dogName} walked by`}
                          value={r.initials}
                          onSave={(v) => r.save("walk_staff_initials", v)}
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 print:hidden">
                        {/* A walk package covers the daycare walk add-on, so
                            only daycare rows draw from one — boarding walks
                            are billed per walk on the reservation. */}
                        {samePickerAsAbove ? null : r.service === "boarding" ? (
                          <span className="whitespace-normal text-[11px] leading-snug text-ink-3">
                            Billed per walk on the reservation
                          </span>
                        ) : r.service === "daycare" && r.row ? (
                          (() => {
                            const options = eligiblePackagesFor(
                              packages,
                              r.phone,
                              r.dogName,
                              "walk"
                            );
                            if (!options.length)
                              return <span className="text-xs text-ink-3">—</span>;
                            const current = useForRow(r.row!, "walk")?.package_id ?? "";
                            return (
                              <WalkSelect
                                ariaLabel={`${r.dogName} walk package`}
                                value={current}
                                width="w-52"
                                onSave={async (v) => {
                                  await reassignPackage(r.row!, v, "walk");
                                  loadAll();
                                }}>
                                <option value="">No walk package</option>
                                {options.map((p) => (
                                  <option key={p.id} value={p.id ?? ""}>
                                    {packageLabel(p)}
                                  </option>
                                ))}
                              </WalkSelect>
                            );
                          })()
                        ) : (
                          <span className="text-xs text-ink-3">—</span>
                        )}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
              {walkRows.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-6 text-center text-sm text-ink-3 print:border print:border-paper-line">
                    No walks booked for this date.
                  </td>
                </tr>
              )}
            </tbody>
          </CardTable>
        </div>
      )}

      <p className="print-footer hidden print:block">
        🐾 Thanks for a pawsome day! 🐾
      </p>
    </div>
  );
}

// Uncontrolled so typing stays snappy, saving on blur only when the value
// actually changed. Degrades to a dotted line in print so a partly-filled
// sheet is still writable by hand.
