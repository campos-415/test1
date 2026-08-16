"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { fileToBudgetedJpeg, fileToRecordJpeg, unreadableImageMessage } from "@/lib/image";
import {
  daysLeft,
  findPackageFor,
  hasWaiver,
  ownerHref,
  packageKind,
  preferredPackageId,
} from "@/lib/dogs";
import { dateRange, prettyDateKey, todayKey } from "@/lib/dates";
import { buildOpenVisits } from "@/lib/signin";
import {
  STATUS_CLASSES,
  STATUS_LABELS,
  overallVaccineStatus,
  vaccineStatus,
} from "@/lib/vaccines";
import {
  ACTIVITY_RESTRICTIONS,
  ALLERGENS,
  ATTENDANCE_PLANS,
  BEHAVIOR_TRAITS,
  BIG_DOG_RESPONSES,
  Boarding,
  Dog,
  DogDoc,
  DOG_SEXES,
  DogSex,
  FIXED_STATUSES,
  FLEA_PROGRAMS,
  FixedStatus,
  MEET_GREET_WINDOWS,
  PACKAGE_INTEREST,
  PLAY_STYLES,
  Package,
  SignInRecord,
  VACCINES,
  VaccineKey,
  Vaccination,
  WalkLog,
} from "@/types";
import { Balance, loadBalanceFor } from "@/lib/billing";
import { Enrollment } from "@/types";
import {
  ageFromBirthdate,
  detailsLink,
  isMissingColumn,
  loadOutstandingDetails,
} from "@/lib/enrollment";
import { copyText } from "@/lib/clipboard";
import { RETIRE_REASONS, isRetired, retireReasonLabel } from "@/lib/retire";
import BalanceBadge from "@/components/BalanceBadge";
import StaffGate from "@/components/StaffGate";
import StaffNav from "@/components/StaffNav";
import DateField from "@/components/DateField";
import { CheckGrid, ChoiceWithOther, YesNo, YesNoDetail } from "@/components/FormBits";
import Panel from "@/components/Panel";
import CardTable from "@/components/CardTable";

export default function DogProfilePage() {
  return (
    <StaffGate title="Dog profile">
      <DogProfile />
    </StaffGate>
  );
}

interface WalkRow {
  key: string;
  date: string;
  service: "Daycare" | "Boarding";
  slot: string;
  out: string;
  back: string;
  initials: string;
}

function DogProfile() {
  const params = useParams<{ id: string }>();
  const dogId = params?.id;

  const [dog, setDog] = useState<Dog | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [signins, setSignins] = useState<SignInRecord[]>([]);
  const [boardings, setBoardings] = useState<Boarding[]>([]);
  const [walkLogs, setWalkLogs] = useState<WalkLog[]>([]);
  const [vaccinations, setVaccinations] = useState<Vaccination[]>([]);
  // Balances are per household, so this is the whole number's balance, not
  // just this dog's — the badge links through to where it can be settled.
  const [balance, setBalance] = useState<Balance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoSaved, setInfoSaved] = useState(false);
  // Snapshot of the form as loaded. Anything different means unsaved work.
  const [baseline, setBaseline] = useState("");

  const [docs, setDocs] = useState<DogDoc[]>([]);
  // The household's approved enrollment when the second half of the form has
  // not come back. What makes an empty behaviour section readable: "not
  // asked yet" and "answered no" look identical otherwise.
  const [awaitingDetails, setAwaitingDetails] = useState<Enrollment | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  // Retiring: the panel is open while staff pick a reason, and saving covers
  // both directions since bringing a dog back is the same write in reverse.
  const [retiring, setRetiring] = useState(false);
  const [savingRetire, setSavingRetire] = useState(false);

  // Editable draft, seeded from the loaded profile. Covers the basics plus
  // every enrollment answer, so staff can correct anything a client typed
  // without sending them back through the form.
  const [form, setForm] = useState({
    dog_name: "",
    last_name: "",
    drop_off_by: "",
    breed: "",
    sex: "" as DogSex | "",
    fixed_status: "" as FixedStatus | "",
    birthdate: "",
    weight_lb: "",
    vet: "",
    authorized_pickup: "",
    color: "",
    flea_program: "",
    fixed_scheduled_on: "",
    dog_source: "",
    growled: null as boolean | null,
    growled_note: "",
    bitten: null as boolean | null,
    bitten_note: "",
    climbed_fence: null as boolean | null,
    fence_height: "",
    dog_fight: null as boolean | null,
    dog_fight_note: "",
    health_problems: null as boolean | null,
    health_notes: "",
    activity_restrictions: [] as string[],
    allergies: [] as string[],
    sensitive_areas: null as boolean | null,
    sensitive_areas_note: "",
    behavior_traits: [] as string[],
    play_style: [] as string[],
    attendance_plan: "",
    big_dog_response: "",
    crate_trained: null as boolean | null,
    kennel_trained: null as boolean | null,
    package_interest: "",
    meet_greet_on: "",
    meet_greet_window: "",
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const load = useCallback(async () => {
    if (!dogId) return;
    setLoading(true);
    setError("");
    try {
      const supabase = getSupabase();
      const { data: dogRow, error: dogErr } = await supabase
        .from("dogs")
        .select("*")
        .eq("id", dogId)
        .single();
      if (dogErr) throw dogErr;
      const dog = dogRow as Dog;
      setDog(dog);
      setForm({
        dog_name: dog.dog_name ?? "",
        last_name: dog.last_name ?? "",
        drop_off_by: dog.drop_off_by ?? "",
        breed: dog.breed ?? "",
        sex: dog.sex ?? "",
        fixed_status: dog.fixed_status ?? "",
        birthdate: dog.birthdate ?? "",
        weight_lb: dog.weight_lb != null ? String(dog.weight_lb) : "",
        vet: dog.vet ?? "",
        authorized_pickup: dog.authorized_pickup ?? "",
        color: dog.color ?? "",
        flea_program: dog.flea_program ?? "",
        fixed_scheduled_on: dog.fixed_scheduled_on ?? "",
        dog_source: dog.dog_source ?? "",
        growled: dog.growled ?? null,
        growled_note: dog.growled_note ?? "",
        bitten: dog.bitten ?? null,
        bitten_note: dog.bitten_note ?? "",
        climbed_fence: dog.climbed_fence ?? null,
        fence_height: dog.fence_height ?? "",
        dog_fight: dog.dog_fight ?? null,
        dog_fight_note: dog.dog_fight_note ?? "",
        health_problems: dog.health_problems ?? null,
        health_notes: dog.health_notes ?? "",
        activity_restrictions: dog.activity_restrictions ?? [],
        allergies: dog.allergies ?? [],
        sensitive_areas: dog.sensitive_areas ?? null,
        sensitive_areas_note: dog.sensitive_areas_note ?? "",
        behavior_traits: dog.behavior_traits ?? [],
        play_style: dog.play_style ?? [],
        attendance_plan: dog.attendance_plan ?? "",
        big_dog_response: dog.big_dog_response ?? "",
        crate_trained: dog.crate_trained ?? null,
        kennel_trained: dog.kennel_trained ?? null,
        package_interest: dog.package_interest ?? "",
        meet_greet_on: dog.meet_greet_on ?? "",
        meet_greet_window: dog.meet_greet_window ?? "",
      });
      setBaseline(
        JSON.stringify({
          dog_name: dog.dog_name ?? "",
          last_name: dog.last_name ?? "",
          drop_off_by: dog.drop_off_by ?? "",
          breed: dog.breed ?? "",
          sex: dog.sex ?? "",
          fixed_status: dog.fixed_status ?? "",
          birthdate: dog.birthdate ?? "",
          weight_lb: dog.weight_lb != null ? String(dog.weight_lb) : "",
          vet: dog.vet ?? "",
          authorized_pickup: dog.authorized_pickup ?? "",
          color: dog.color ?? "",
          flea_program: dog.flea_program ?? "",
          fixed_scheduled_on: dog.fixed_scheduled_on ?? "",
          dog_source: dog.dog_source ?? "",
          growled: dog.growled ?? null,
          growled_note: dog.growled_note ?? "",
          bitten: dog.bitten ?? null,
          bitten_note: dog.bitten_note ?? "",
          climbed_fence: dog.climbed_fence ?? null,
          fence_height: dog.fence_height ?? "",
          dog_fight: dog.dog_fight ?? null,
          dog_fight_note: dog.dog_fight_note ?? "",
          health_problems: dog.health_problems ?? null,
          health_notes: dog.health_notes ?? "",
          activity_restrictions: dog.activity_restrictions ?? [],
          allergies: dog.allergies ?? [],
          sensitive_areas: dog.sensitive_areas ?? null,
          sensitive_areas_note: dog.sensitive_areas_note ?? "",
          behavior_traits: dog.behavior_traits ?? [],
          play_style: dog.play_style ?? [],
          attendance_plan: dog.attendance_plan ?? "",
          big_dog_response: dog.big_dog_response ?? "",
          crate_trained: dog.crate_trained ?? null,
          kennel_trained: dog.kennel_trained ?? null,
          package_interest: dog.package_interest ?? "",
          meet_greet_on: dog.meet_greet_on ?? "",
          meet_greet_window: dog.meet_greet_window ?? "",
        })
      );

      // Everything else keys off the dog we just loaded — its id for
      // sign-ins and vaccines, its phone + name for packages and stays,
      // which predate dog_id on some rows.
      const [pkgRes, signinRes, boardingRes, vaxRes] = await Promise.all([
        supabase.from("packages").select("*").eq("phone", dog.phone),
        supabase
          .from("signins")
          .select("*")
          .eq("dog_id", dogId)
          .order("created_at", { ascending: false })
          .limit(400),
        supabase
          .from("boardings")
          .select("*")
          .eq("phone", dog.phone)
          .ilike("dog_name", dog.dog_name)
          .order("start_date", { ascending: false }),
        supabase.from("vaccinations").select("*").eq("dog_id", dogId),
      ]);
      if (pkgRes.error) throw pkgRes.error;
      if (signinRes.error) throw signinRes.error;
      if (boardingRes.error) throw boardingRes.error;
      if (vaxRes.error) throw vaxRes.error;

      setPackages((pkgRes.data as Package[]) ?? []);
      setSignins((signinRes.data as SignInRecord[]) ?? []);

      // Non-fatal, and metadata only: the file itself is fetched on demand
      // when staff click through, so a multi-megabyte scan of a vet record
      // isn't pulled just to open a profile.
      try {
        const { data: docData, error: docErr } = await supabase
          .from("dog_docs")
          .select("id, dog_id, kind, file_name, mime_type, created_at")
          .eq("dog_id", dogId)
          .order("created_at", { ascending: false });
        if (docErr) throw docErr;
        setDocs((docData as DogDoc[]) ?? []);
      } catch (e) {
        console.error("Loading client documents failed:", e);
      }
      // Queried by phone + name because reservations predate dog_id, but a
      // household can now hold two dogs of the same name — a retired one and
      // the dog that came after it. Where the reservation says which dog it is
      // for, that wins; only rows with no dog_id fall back to the name, since
      // for those there is nothing better to go on. Without this the new dog
      // inherits the old one's stays on sight, which is the confusion retiring
      // exists to prevent.
      const stays = ((boardingRes.data as Boarding[]) ?? []).filter(
        (b) => !b.dog_id || b.dog_id === dogId
      );
      setBoardings(stays);
      setVaccinations((vaxRes.data as Vaccination[]) ?? []);

      // Non-fatal: a profile is still useful without a balance on it.
      try {
        setBalance(await loadBalanceFor(dog.phone));
      } catch (e) {
        console.error("Loading balance failed:", e);
      }

      setAwaitingDetails(await loadOutstandingDetails(dog.phone));

      const stayIds = stays.map((b) => b.id).filter(Boolean) as string[];
      if (stayIds.length) {
        const { data: walkData, error: walkErr } = await supabase
          .from("walk_logs")
          .select("*")
          .in("boarding_id", stayIds);
        if (walkErr) throw walkErr;
        setWalkLogs((walkData as WalkLog[]) ?? []);
      } else {
        setWalkLogs([]);
      }
    } catch (e) {
      console.error("Loading dog profile failed:", e);
      setError("Could not load this dog's profile.");
    } finally {
      setLoading(false);
    }
  }, [dogId]);

  useEffect(() => {
    load();
  }, [load]);

  async function copyDetailsLinkFor(row: Enrollment) {
    if (!row.details_token) return;
    const link = detailsLink(row.details_token);
    if (await copyText(link)) {
      setCopiedLink(true);
      return;
    }
    // Clipboard unavailable — put the link where it can be selected or read
    // out rather than losing it behind a dialog.
    setError(`Couldn't reach the clipboard. The link is ${link}`);
  }

  /**
   * Takes a dog off the books, or puts it back.
   *
   * Nothing is deleted. The visits, payments, vaccinations and uploaded
   * records all stay on this row — the dog simply stops appearing anywhere
   * that books, charges or checks one in, and stops being a name a new
   * enrollment can land on top of. Passing null for `reason` is the undo.
   */
  async function setRetired(reason: string | null, note: string) {
    if (!dog?.id) return;
    setSavingRetire(true);
    setError("");
    const patch = {
      retired_at: reason ? new Date().toISOString() : null,
      retired_reason: reason,
      retired_note: reason ? note.trim() || null : null,
    };
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase.from("dogs").update(patch).eq("id", dog.id);
      if (err) throw err;
      setDog({ ...dog, ...patch });
      setRetiring(false);
    } catch (e) {
      console.error("Retiring the dog failed:", e);
      // Worth naming precisely. Everything else on this page works without
      // the migration, so a generic failure here would look like a bug in
      // the button rather than a migration nobody has run.
      setError(
        isMissingColumn(e)
          ? "Retiring needs a column this database does not have yet — run dog-retire-migration.sql in the Supabase SQL editor, then try again."
          : "Could not update this dog."
      );
    } finally {
      setSavingRetire(false);
    }
  }

  async function saveInfo() {
    if (!dog?.id) return;
    setSavingInfo(true);
    setError("");
    try {
      const supabase = getSupabase();
      // Built once and reused, so the row written and the local state can't
      // drift — and so the form's "" placeholders become real nulls.
      const patch = {
        dog_name: form.dog_name.trim(),
        last_name: form.last_name.trim(),
        drop_off_by: form.drop_off_by.trim(),
        breed: form.breed.trim() || null,
        sex: form.sex || null,
        fixed_status: form.fixed_status || null,
        birthdate: form.birthdate || null,
        weight_lb: form.weight_lb.trim() === "" ? null : Number(form.weight_lb),
        vet: form.vet.trim() || null,
        authorized_pickup: form.authorized_pickup.trim() || null,
        color: form.color.trim() || null,
        flea_program: form.flea_program.trim() || null,
        // Only meaningful while the dog is still intact — clearing it once
        // the status changes stops a past appointment reading as upcoming.
        fixed_scheduled_on:
          form.fixed_status === "intact" ? form.fixed_scheduled_on || null : null,
        dog_source: form.dog_source.trim() || null,
        growled: form.growled,
        growled_note: form.growled ? form.growled_note.trim() || null : null,
        bitten: form.bitten,
        bitten_note: form.bitten ? form.bitten_note.trim() || null : null,
        climbed_fence: form.climbed_fence,
        fence_height: form.climbed_fence ? form.fence_height.trim() || null : null,
        dog_fight: form.dog_fight,
        dog_fight_note: form.dog_fight ? form.dog_fight_note.trim() || null : null,
        health_problems: form.health_problems,
        health_notes: form.health_problems ? form.health_notes.trim() || null : null,
        activity_restrictions: form.activity_restrictions,
        allergies: form.allergies,
        sensitive_areas: form.sensitive_areas,
        sensitive_areas_note: form.sensitive_areas
          ? form.sensitive_areas_note.trim() || null
          : null,
        behavior_traits: form.behavior_traits,
        play_style: form.play_style,
        attendance_plan: form.attendance_plan.trim() || null,
        big_dog_response: form.big_dog_response.trim() || null,
        crate_trained: form.crate_trained,
        kennel_trained: form.kennel_trained,
        package_interest: form.package_interest.trim() || null,
        meet_greet_on: form.meet_greet_on || null,
        meet_greet_window: form.meet_greet_on ? form.meet_greet_window || null : null,
      };
      const { error: err } = await supabase.from("dogs").update(patch).eq("id", dog.id);
      if (err) throw err;
      setDog({ ...dog, ...patch });
      setBaseline(JSON.stringify(form));
      setInfoSaved(true);
      setTimeout(() => setInfoSaved(false), 2000);
    } catch (e) {
      console.error("Saving dog info failed:", e);
      setError("Could not save those changes.");
    } finally {
      setSavingInfo(false);
    }
  }

  // Pins a package as the one new visits draw from. Clicking the pinned one
  // again unpins it, handing the choice back to the default rule.
  async function setDefaultPackage(pkg: Package) {
    if (!dog?.id || !pkg.id) return;
    const field = packageKind(pkg) === "walk" ? "default_walk_package_id" : "default_package_id";
    const current = (dog as unknown as Record<string, string | null>)[field];
    const next = current === pkg.id ? null : pkg.id;
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase.from("dogs").update({ [field]: next }).eq("id", dog.id);
      if (err) throw err;
      setDog({ ...dog, [field]: next });
    } catch (e) {
      console.error("Pinning package failed:", e);
      setError("Could not set that as the default package.");
    }
  }

  async function handlePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !dog?.id) return;
    // Two separate failures, said separately. "Try a different file" is only
    // advice when the file is the problem; when the database refused the
    // write, a different file fails the same way.
    let dataUrl: string;
    try {
      dataUrl = await fileToBudgetedJpeg(file, 640, 120 * 1024);
    } catch (e) {
      console.error("Reading dog photo failed:", e, {
        name: file.name,
        type: file.type,
        size: file.size,
      });
      setError(unreadableImageMessage(file));
      return;
    }

    try {
      const supabase = getSupabase();
      const { error: err } = await supabase
        .from("dogs")
        .update({ photo_data: dataUrl })
        .eq("id", dog.id);
      if (err) throw err;
      setDog({ ...dog, photo_data: dataUrl });
    } catch (e) {
      console.error("Saving dog photo failed:", e);
      setError(
        `The photo opened but could not be saved. ${(e as { message?: string })?.message ?? ""}`.trim()
      );
    }
  }

  // Documents are listed by metadata only; the bytes are fetched here, on
  // the click. Opened through a blob URL because browsers refuse to
  // top-level navigate to a data: URL.
  async function openDoc(doc: DogDoc) {
    try {
      const supabase = getSupabase();
      const { data, error: err } = await supabase
        .from("dog_docs")
        .select("data")
        .eq("id", doc.id)
        .single();
      if (err) throw err;
      const res = await fetch((data as { data: string }).data);
      const url = URL.createObjectURL(await res.blob());
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      console.error("Opening document failed:", e);
      setError("Could not open that document.");
    }
  }

  async function deleteDoc(doc: DogDoc) {
    if (!doc.id || !window.confirm(`Remove "${doc.file_name}"? This can't be undone.`)) return;
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase.from("dog_docs").delete().eq("id", doc.id);
      if (err) throw err;
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (e) {
      console.error("Deleting document failed:", e);
      setError("Could not remove that document.");
    }
  }

  async function uploadDoc(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !dog?.id) return;
    setError("");
    try {
      // Same path as the enrollment form: whatever the owner has becomes one
      // budgeted JPEG, PDFs included.
      const data = await fileToRecordJpeg(file);
      const supabase = getSupabase();
      const { data: row, error: err } = await supabase
        .from("dog_docs")
        .insert({
          dog_id: dog.id,
          kind: "vaccination",
          file_name: file.name,
          // Always a JPEG now, whatever was picked — a PDF has been rendered.
          mime_type: "image/jpeg",
          data,
        })
        .select("id, dog_id, kind, file_name, mime_type, created_at")
        .single();
      if (err) throw err;
      setDocs((prev) => [row as DogDoc, ...prev]);
    } catch (e) {
      console.error("Uploading document failed:", e);
      setError("Could not save that file — images work best, and PDFs must be under 4 MB.");
    }
  }

  // Vaccine dates save as they're entered, one row per (dog, vaccine).
  async function saveVaccine(vaccine: VaccineKey, patch: { given_on?: string; expires_on?: string }) {
    if (!dog?.id) return;
    const existing = vaccinations.find((v) => v.vaccine === vaccine);
    const next: Vaccination = {
      ...existing,
      dog_id: dog.id,
      vaccine,
      given_on: patch.given_on !== undefined ? patch.given_on || null : (existing?.given_on ?? null),
      expires_on:
        patch.expires_on !== undefined ? patch.expires_on || null : (existing?.expires_on ?? null),
    };
    // Optimistic — these are two date inputs, and a round trip per keystroke
    // would make them feel broken.
    setVaccinations((prev) => {
      const rest = prev.filter((v) => v.vaccine !== vaccine);
      return [...rest, next];
    });
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase
        .from("vaccinations")
        .upsert(
          {
            dog_id: dog.id,
            vaccine,
            given_on: next.given_on,
            expires_on: next.expires_on,
          },
          { onConflict: "dog_id,vaccine" }
        );
      if (err) throw err;
    } catch (e) {
      console.error("Saving vaccination failed:", e);
      setError("Could not save that vaccine record.");
    }
  }

  // One badge per kind — a dog can hold a daycare block and a walk block at
  // the same time, and showing only the daycare one hides the other entirely.
  const dogPackage = useMemo(
    () =>
      dog
        ? findPackageFor(
            packages,
            dog.phone,
            dog.dog_name,
            "daycare",
            preferredPackageId(dog, "daycare")
          )
        : null,
    [packages, dog]
  );
  const dogWalkPackage = useMemo(
    () =>
      dog
        ? findPackageFor(
            packages,
            dog.phone,
            dog.dog_name,
            "walk",
            preferredPackageId(dog, "walk")
          )
        : null,
    [packages, dog]
  );

  // Walks are only ever spent on a daycare visit, so a walk block means
  // nothing for a dog that only boards — its walks bill per walk on the
  // reservation. Evidence of daycare is either a visit on record or the
  // attendance plan the household gave at enrollment, so a brand-new client
  // who bought walks up front still sees them before their first visit.
  const doesDaycare = useMemo(() => {
    if (signins.some((s) => s.service_type === "daycare")) return true;
    // "Both often" and "Both occasionally" include daycare without saying the
    // word, so matching only "daycare" would hide the pill from half the
    // clients who can actually spend a walk.
    const plan = (dog?.attendance_plan ?? "").toLowerCase();
    return plan.includes("daycare") || plan.includes("both");
  }, [signins, dog]);

  // Every package on the number that could apply to this dog — its own,
  // plus shared ones with no dog_name.
  const relevantPackages = useMemo(
    () =>
      dog
        ? packages.filter(
            (p) =>
              !p.dog_name || p.dog_name.trim().toLowerCase() === dog.dog_name.trim().toLowerCase()
          )
        : [],
    [packages, dog]
  );

  // One line per visit: a drop-off paired with the pick-up that followed.
  const visits = useMemo(() => {
    const ascending = [...signins].sort(
      (a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime()
    );
    const rows: {
      key: string;
      date: string;
      service: string;
      dropOff?: string;
      pickUp?: string;
      addons: string[];
      pickupWindow?: string | null;
      price?: number | null;
    }[] = [];
    let open: SignInRecord | null = null;
    for (const r of ascending) {
      if (r.action === "drop_off") {
        if (open) rows.push(toRow(open, null));
        open = r;
      } else {
        rows.push(toRow(open, r));
        open = null;
      }
    }
    if (open) rows.push(toRow(open, null));
    return rows.reverse();

    function toRow(drop: SignInRecord | null, pick: SignInRecord | null) {
      const anchor = drop ?? pick!;
      return {
        key: `${anchor.id}-${pick?.id ?? "open"}`,
        date: (anchor.created_at ?? "").slice(0, 10),
        service: drop?.service_type ?? pick?.service_type ?? "—",
        dropOff: drop?.created_at,
        pickUp: pick?.created_at,
        addons: drop?.addons ?? [],
        pickupWindow: drop?.pickup_window,
        price: pick?.price ?? null,
      };
    }
  }, [signins]);

  // Walks from both sources: daycare walks live on the sign-in row, boarding
  // walks in walk_logs keyed by stay + day + slot.
  const walkRows: WalkRow[] = useMemo(() => {
    const rows: WalkRow[] = [];
    for (const s of signins) {
      if (s.action !== "drop_off") continue;
      if (!s.walk_out && !s.walk_in && !s.walk_staff_initials) continue;
      rows.push({
        key: `signin-${s.id}`,
        date: (s.created_at ?? "").slice(0, 10),
        service: "Daycare",
        slot: "Walk",
        out: s.walk_out ?? "",
        back: s.walk_in ?? "",
        initials: s.walk_staff_initials ?? "",
      });
    }
    for (const w of walkLogs) {
      if (!w.walk_out && !w.walk_in && !w.staff_initials) continue;
      rows.push({
        key: `walk-${w.id ?? `${w.boarding_id}-${w.date}-${w.walk_index}`}`,
        date: w.date,
        service: "Boarding",
        slot: `Walk ${w.walk_index + 1}`,
        out: w.walk_out ?? "",
        back: w.walk_in ?? "",
        initials: w.staff_initials ?? "",
      });
    }
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  }, [signins, walkLogs]);

  const upcomingStays = useMemo(() => {
    const today = todayKey();
    return boardings.filter((b) => b.end_date >= today);
  }, [boardings]);

  // Is the dog here right now? Derived through the shared rule rather than a
  // local re-implementation, so the profile, the board and the kiosk cannot
  // disagree about what "in" means — including its handling of a drop-off
  // dated in the future.
  const openVisit = useMemo(
    () => (dogId ? (buildOpenVisits(signins).get(dogId) ?? null) : null),
    [signins, dogId]
  );

  // The handful of answers that change how this dog is handled today. They
  // sit at the top of the profile rather than in the questionnaire section
  // below, because "has bitten" is not something to find by scrolling.
  const careFlags = useMemo(() => {
    if (!dog) return [];
    const flags: string[] = [];
    if (dog.bitten) flags.push(`Has bitten${dog.bitten_note ? ` — ${dog.bitten_note}` : ""}`);
    if (dog.growled) flags.push(`Has growled${dog.growled_note ? ` — ${dog.growled_note}` : ""}`);
    if (dog.dog_fight)
      flags.push(`Has been in a dog fight${dog.dog_fight_note ? ` — ${dog.dog_fight_note}` : ""}`);
    if (dog.climbed_fence)
      flags.push(`Climbs fences${dog.fence_height ? ` (cleared ${dog.fence_height})` : ""}`);
    if (dog.health_problems)
      flags.push(`Health: ${dog.health_notes || "details not recorded"}`);
    if (dog.allergies?.length) flags.push(`Allergies: ${dog.allergies.join(", ")}`);
    if (dog.activity_restrictions?.length)
      flags.push(`Restrictions: ${dog.activity_restrictions.join(", ")}`);
    if (dog.sensitive_areas)
      flags.push(
        `Sensitive to touch${dog.sensitive_areas_note ? ` — ${dog.sensitive_areas_note}` : ""}`
      );
    return flags;
  }, [dog]);

  const dirty = !!baseline && JSON.stringify(form) !== baseline;

  // One-line gist per collapsible section. The whole point of closing a
  // section is not having to open it to find out.
  const yn = (v: boolean | null | undefined, yes: string, no: string) =>
    v === true ? yes : v === false ? no : "";

  // What an empty questionnaire section says. A dog whose household has not
  // sent the details form back has not declined to answer — nobody has asked
  // yet, and the two read very differently on a behaviour section.
  const unanswered = awaitingDetails ? "⏳ Waiting on the details form" : "Not answered";

  const healthSummary = [
    yn(dog?.health_problems, `Health: ${dog?.health_notes || "see notes"}`, "No health problems"),
    dog?.allergies?.length ? `Allergies: ${dog.allergies.join(", ")}` : "",
    dog?.activity_restrictions?.length ? `Restrictions: ${dog.activity_restrictions.join(", ")}` : "",
    yn(dog?.sensitive_areas, `Touch-sensitive${dog?.sensitive_areas_note ? `: ${dog.sensitive_areas_note}` : ""}`, ""),
  ].filter(Boolean).join(" · ");

  const historyFlags = [
    dog?.bitten ? "has bitten" : "",
    dog?.growled ? "has growled" : "",
    dog?.dog_fight ? "dog fight" : "",
    dog?.climbed_fence ? "climbs fences" : "",
  ].filter(Boolean);
  const historySummary = historyFlags.length
    ? `⚠️ ${historyFlags.join(", ")}`
    : dog?.bitten === false || dog?.growled === false
      ? "Nothing recorded"
      : awaitingDetails
        ? unanswered
        : "Not asked";

  const behaviourSummary = [
    dog?.behavior_traits?.length ? dog.behavior_traits.slice(0, 3).join(", ") : "",
    dog?.big_dog_response ? `big dogs: ${dog.big_dog_response.toLowerCase()}` : "",
    dog?.attendance_plan || "",
  ].filter(Boolean).join(" · ");

  const basicSummary = [dog?.breed, dog?.color, dog?.weight_lb ? `${dog.weight_lb} lb` : "",
    ageFromBirthdate(dog?.birthdate)].filter(Boolean).join(" · ");

  const vaccineSummary = `${STATUS_LABELS[overallVaccineStatus(vaccinations)]}${
    docs.length ? ` · ${docs.length} record${docs.length === 1 ? "" : "s"} on file` : " · no records uploaded"
  }`;

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <StaffNav current="" />
        <p className="text-sm text-ink-3">Loading…</p>
      </div>
    );
  }

  if (!dog) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <StaffNav current="" />
        <p className="text-sm text-rose-500">{error || "No dog found for this profile."}</p>
      </div>
    );
  }

  const overall = overallVaccineStatus(vaccinations);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <StaffNav current="" />

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start gap-5 rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div className="shrink-0 text-center">
          {dog.photo_data ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={dog.photo_data}
              alt={`${dog.dog_name}'s photo`}
              className="h-24 w-24 rounded-2xl object-cover"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-surface-3 text-3xl text-ink-3">
              🐕
            </div>
          )}
          <label className="mt-1.5 block cursor-pointer text-[11px] font-medium text-accent-600 hover:text-accent-800">
            {dog.photo_data ? "Change photo" : "+ Add photo"}
            <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
          </label>
        </div>

        {/* basis-full on a phone. The photo beside this is a fixed 96px and
            does not shrink, so flex-1 with min-w-0 left the name, surname,
            phone and profile link sharing about 170px of a 327px row. Below
            sm the details take the width and sit under the photo. */}
        <div className="min-w-0 flex-1 basis-full sm:basis-0">
          <h1 className="font-display text-2xl font-semibold text-ink">{dog.dog_name}</h1>
          <p className="text-sm text-ink-3">{dog.last_name}
            <br /> {dog.phone}
          </p>
          <Link href={ownerHref(dog.phone)} className="text-sm text-accent-600 hover:underline">
             Parent/Guardian's profile
          </Link>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_CLASSES[overall]}`}>
              💉 {STATUS_LABELS[overall]}
            </span>
            {balance && (
              <Link href={ownerHref(dog.phone)} title="Balance is for the whole household">
                <BalanceBadge outstanding={balance.outstanding} />
              </Link>
            )}
            {dogWalkPackage && doesDaycare && (
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                🚶 {daysLeft(dogWalkPackage)} of {dogWalkPackage.total_days} walks left
              </span>
            )}
            {dogPackage && (
              <span className="rounded-full bg-accent-50 px-2.5 py-1 text-[11px] font-semibold text-accent-700">
                🐕 {daysLeft(dogPackage)} of {dogPackage.total_days} days left
              </span>
            )}
            {/* Where the dog is, in one pill: here now, or booked to come.
                Never both — a dog that has arrived is not "upcoming" any
                more — and never a "left" state, because having gone home is
                the ordinary case and does not need announcing. */}
            {openVisit ? (
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                🟢 In
                <span className="ml-1 font-medium text-emerald-800/70">
                  since{" "}
                  {openVisit.dropOffTime.toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </span>
            ) : (
              upcomingStays.length > 0 && (
                <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700">
                  🛏️ {upcomingStays.length} upcoming stay{upcomingStays.length === 1 ? "" : "s"}
                </span>
              )
            )}
            {isRetired(dog) && (
              <span className="rounded-full bg-surface-3 px-2.5 py-1 text-[11px] font-semibold text-ink-3">
                Retired
              </span>
            )}
            {!hasWaiver(dog) && (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                ⚠️ No waiver on file
              </span>
            )}
            {awaitingDetails && (
              <span
                title="The second half of their enrollment has not come back yet"
                className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700"
              >
                ⏳ Details outstanding
              </span>
            )}
          </div>
        </div>
      </div>

      {error && <p className="mb-4 break-words text-xs font-medium text-rose-500">{error}</p>}

      {/* Said at the top, plainly. Everything below still works on a retired
          dog — the history is the reason the record is kept — so without this
          the profile looks like any other and the missing kiosk entry looks
          like a bug. */}
      {isRetired(dog) && (
        <div className="mb-5 rounded-2xl border border-line bg-surface-2 p-4">
          <p className="text-sm font-medium text-ink">
            {dog.dog_name} is retired — {retireReasonLabel(dog.retired_reason).toLowerCase()}
            {dog.retired_at && (
              <span className="font-normal text-ink-3">
                {" "}
                · {prettyDateKey(dog.retired_at.slice(0, 10))}
              </span>
            )}
          </p>
          {dog.retired_note && <p className="mt-1 text-xs text-ink-2">{dog.retired_note}</p>}
          <p className="mt-2 text-xs leading-relaxed text-ink-3">
            Everything on this page stays. {dog.dog_name} is only kept out of the kiosk lookup,
            the reservation picker, the packages screen and the calendar — and a new enrollment
            using this name will add a dog rather than write over this one.
          </p>
          <button
            onClick={() => setRetired(null, "")}
            disabled={savingRetire}
            className="mt-3 rounded-xl border border-line bg-surface px-4 py-2 text-xs font-medium text-ink-2 hover:border-accent-300 disabled:opacity-60"
          >
            {savingRetire ? "Working…" : `Bring ${dog.dog_name} back`}
          </button>
        </div>
      )}

      {careFlags.length > 0 && (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
            ⚠️ Handling notes
          </p>
          <ul className="list-inside list-disc space-y-0.5 text-sm text-amber-900">
            {careFlags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Which half of the profile is actually missing, said once at the top
          rather than left for staff to infer from three empty sections. */}
      {awaitingDetails && (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
            ⏳ Second half of the enrollment outstanding
          </p>
          <p className="text-sm text-amber-900">
            This household enrolled in two stages and has not sent the details form back yet, so
            the address, the vet, the emergency contact, and the history, health and behaviour
            answers below are <strong className="font-semibold">unasked, not blank</strong>. It
            was emailed when the meet &amp; greet passed.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {awaitingDetails.details_token && (
              <button
                onClick={() => copyDetailsLinkFor(awaitingDetails)}
                className="rounded-xl border border-amber-300 bg-white/70 px-3 py-1.5 text-[11px] font-medium text-amber-900 hover:border-amber-400"
              >
                {copiedLink ? "✓ Link copied" : "Copy their link"}
              </button>
            )}
            <Link
              href="/requests?tab=enrollments"
              className="text-[11px] font-medium text-amber-800 underline hover:text-amber-900"
            >
              Everyone still outstanding →
            </Link>
            <span className="text-[11px] text-amber-800">
              Anything typed in here is saved to the profile as usual.
            </span>
          </div>
        </div>
      )}

      {/* Basic info */}
      <Panel id="dog-basic" title="Basic info" summary={basicSummary} defaultOpen>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Dog name">
            <input
              value={form.dog_name}
              onChange={(e) => setForm({ ...form, dog_name: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Owner last name">
            <input
              value={form.last_name}
              onChange={(e) => setForm({ ...form, last_name: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Usual drop-off / pick-up">
            <input
              value={form.drop_off_by}
              onChange={(e) => setForm({ ...form, drop_off_by: e.target.value })}
              className={inputClass}
            />
          </Field>

          <Field label="Breed">
            <input
              value={form.breed}
              onChange={(e) => setForm({ ...form, breed: e.target.value })}
              placeholder="Mixed Breed"
              className={inputClass}
            />
          </Field>
          <Field label="Sex">
            <select
              value={form.sex}
              onChange={(e) => setForm({ ...form, sex: e.target.value as DogSex | "" })}
              className={inputClass}
            >
              <option value="">Not recorded</option>
              {DOG_SEXES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Spayed / neutered">
            <select
              value={form.fixed_status}
              onChange={(e) =>
                setForm({ ...form, fixed_status: e.target.value as FixedStatus | "" })
              }
              className={inputClass}
            >
              <option value="">Not recorded</option>
              {FIXED_STATUSES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label={`Date of birth${ageFromBirthdate(form.birthdate) ? ` · ${ageFromBirthdate(form.birthdate)}` : ""}`}>
            <DateField
              value={form.birthdate}
              onChange={(v) => setForm({ ...form, birthdate: v })}
              className={inputClass}
              ariaLabel="Birthdate"
            />
          </Field>
          <Field label="Weight (lb)">
            <input
              type="number"
              min="0"
              step="0.1"
              value={form.weight_lb}
              onChange={(e) => setForm({ ...form, weight_lb: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Colour">
            <input
              value={form.color}
              onChange={(e) => set("color", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Flea program">
            <ChoiceWithOther
              options={FLEA_PROGRAMS}
              value={form.flea_program}
              onChange={(v) => set("flea_program", v)}
              ariaLabel="Flea program"
            />
          </Field>
          <Field label="Where they came from">
            <input
              value={form.dog_source}
              onChange={(e) => set("dog_source", e.target.value)}
              placeholder="Breeder, shelter, rescue…"
              className={inputClass}
            />
          </Field>

          {form.fixed_status === "intact" && (
            <Field label="Spay / neuter scheduled">
              <DateField
                value={form.fixed_scheduled_on}
                onChange={(v) => set("fixed_scheduled_on", v)}
                className={inputClass}
                ariaLabel="Spay or neuter appointment"
              />
            </Field>
          )}
          <Field label="Vet (if different from the owner's)">
            <input
              value={form.vet}
              onChange={(e) => setForm({ ...form, vet: e.target.value })}
              placeholder="Leave blank to use the household vet"
              className={inputClass}
            />
          </Field>

          <div className="sm:col-span-3">
            <Field label="Also authorized to pick up">
              <input
                value={form.authorized_pickup}
                onChange={(e) => setForm({ ...form, authorized_pickup: e.target.value })}
                placeholder="Anyone else allowed to collect this dog"
                className={inputClass}
              />
            </Field>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-ink-3">
          Phone number is the owner&apos;s — change it on the{" "}
          <Link href={ownerHref(dog.phone)} className="text-accent-600 hover:underline">
            owner profile
          </Link>
          .
        </p>
      </Panel>

      {/* Health & grooming — the enrollment answers, editable */}
      <Panel id="dog-health" title="Health &amp; grooming" summary={healthSummary || unanswered} tone={healthSummary.includes("Allergies") || healthSummary.startsWith("Health:") ? "alert" : "default"}>
        {!healthSummary && <AwaitingDetails show={!!awaitingDetails} />}
        <div className="space-y-3">
          <YesNoDetail
            label="Any health problems?"
            value={form.health_problems}
            onChange={(v) => set("health_problems", v)}
            detail={form.health_notes}
            onDetailChange={(v) => set("health_notes", v)}
            detailLabel="Details"
          />
          <Field label="Activity restrictions">
            <CheckGrid
              options={ACTIVITY_RESTRICTIONS}
              value={form.activity_restrictions}
              onChange={(v) => set("activity_restrictions", v)}
              otherPlaceholder="Other restrictions, comma separated"
            />
          </Field>
          <Field label="Allergies">
            <CheckGrid
              options={ALLERGENS}
              value={form.allergies}
              onChange={(v) => set("allergies", v)}
              otherPlaceholder="Other allergies, comma separated"
            />
          </Field>
          <YesNoDetail
            label="Sensitive about being touched anywhere?"
            value={form.sensitive_areas}
            onChange={(v) => set("sensitive_areas", v)}
            detail={form.sensitive_areas_note}
            onDetailChange={(v) => set("sensitive_areas_note", v)}
            detailLabel="Where?"
            detailPlaceholder="Paws, ears, tail…"
          />
        </div>
      </Panel>

      {/* Incident history */}
      <Panel id="dog-history" title="History" summary={historySummary} tone={historyFlags.length ? "alert" : "default"}>
        {!historyFlags.length && <AwaitingDetails show={!!awaitingDetails} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <YesNoDetail
            label="Has growled at a person or dog?"
            value={form.growled}
            onChange={(v) => set("growled", v)}
            detail={form.growled_note}
            onDetailChange={(v) => set("growled_note", v)}
            detailLabel="What happened?"
          />
          <YesNoDetail
            label="Has bitten a person or dog?"
            value={form.bitten}
            onChange={(v) => set("bitten", v)}
            detail={form.bitten_note}
            onDetailChange={(v) => set("bitten_note", v)}
            detailLabel="What happened?"
          />
          <YesNoDetail
            label="Has climbed or jumped a fence?"
            value={form.climbed_fence}
            onChange={(v) => set("climbed_fence", v)}
            detail={form.fence_height}
            onDetailChange={(v) => set("fence_height", v)}
            detailLabel="How high?"
          />
          <YesNoDetail
            label="Has been in a fight with another dog?"
            value={form.dog_fight}
            onChange={(v) => set("dog_fight", v)}
            detail={form.dog_fight_note}
            onDetailChange={(v) => set("dog_fight_note", v)}
            detailLabel="What happened?"
          />
        </div>
      </Panel>

      {/* Behaviour */}
      <Panel id="dog-behaviour" title="Behaviour &amp; play" summary={behaviourSummary || unanswered}>
        {!behaviourSummary && <AwaitingDetails show={!!awaitingDetails} />}
        <div className="space-y-3">
          <Field label="Traits">
            <CheckGrid
              options={BEHAVIOR_TRAITS}
              value={form.behavior_traits}
              onChange={(v) => set("behavior_traits", v)}
              otherPlaceholder="Anything else, comma separated"
            />
          </Field>
          <Field label="At play">
            <CheckGrid
              options={PLAY_STYLES}
              value={form.play_style}
              onChange={(v) => set("play_style", v)}
              otherPlaceholder="Anything else, comma separated"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Expected visit frequency">
              <ChoiceWithOther
                options={ATTENDANCE_PLANS}
                value={form.attendance_plan}
                onChange={(v) => set("attendance_plan", v)}
                ariaLabel="Expected visit frequency"
              />
            </Field>
            <Field label="Around big dogs">
              <ChoiceWithOther
                options={BIG_DOG_RESPONSES}
                value={form.big_dog_response}
                onChange={(v) => set("big_dog_response", v)}
                ariaLabel="Around big dogs"
              />
            </Field>
            <Field label="Crate trained">
              <YesNo value={form.crate_trained} onChange={(v) => set("crate_trained", v)} />
            </Field>
            <Field label="Kennel trained">
              <YesNo value={form.kennel_trained} onChange={(v) => set("kennel_trained", v)} />
            </Field>
            <Field label="Interested in a package">
              <ChoiceWithOther
                options={PACKAGE_INTEREST}
                value={form.package_interest}
                onChange={(v) => set("package_interest", v)}
                ariaLabel="Interested in a package"
              />
            </Field>
            <Field label="Meet &amp; greet date">
              <DateField
                value={form.meet_greet_on}
                onChange={(v) => set("meet_greet_on", v)}
                className={inputClass}
                ariaLabel="Meet and greet date"
              />
            </Field>
            <Field label="Meet &amp; greet window">
              <select
                value={form.meet_greet_window}
                onChange={(e) => set("meet_greet_window", e.target.value)}
                className={inputClass}
              >
                <option value="">Not set</option>
                {MEET_GREET_WINDOWS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      </Panel>

      {/* Vaccines */}
      <Panel id="dog-vaccines" title="Vaccines" summary={vaccineSummary} defaultOpen>
        <div className="overflow-x-auto">
          <CardTable className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line-soft text-xs font-medium uppercase tracking-wide text-ink-3">
                <th className="py-2 pr-3">Vaccine</th>
                <th className="py-2 pr-3">Date given</th>
                <th className="py-2 pr-3">Expires</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {VACCINES.map((v) => {
                const record = vaccinations.find((r) => r.vaccine === v.key);
                const status = vaccineStatus(record);
                return (
                  <tr key={v.key} className="border-b border-line-soft last:border-0">
                    <td className="py-2 pr-3 font-medium text-ink-2">{v.label}</td>
                    <td className="py-2 pr-3">
                      <DateField
                        value={record?.given_on ?? ""}
                        onChange={(val) => saveVaccine(v.key, { given_on: val })}
                        wrapperClassName="w-36"
                        className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent-500"
                        ariaLabel={`${v.label} date given`}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <DateField
                        value={record?.expires_on ?? ""}
                        onChange={(val) => saveVaccine(v.key, { expires_on: val })}
                        wrapperClassName="w-36"
                        className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent-500"
                        ariaLabel={`${v.label} expiry`}
                      />
                    </td>
                    <td className="py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_CLASSES[status]}`}
                      >
                        {STATUS_LABELS[status]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </CardTable>
        </div>

        {/* The paperwork behind those dates — uploaded with the enrollment
            form, or added here when a client brings an updated record in. */}
        <div className="mt-4 border-t border-line-soft pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            Uploaded records
          </p>
          {docs.length === 0 ? (
            <p className="text-xs text-ink-3">Nothing on file.</p>
          ) : (
            <ul className="mb-2 space-y-1">
              {docs.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    onClick={() => openDoc(d)}
                    className="font-medium text-accent-600 hover:underline"
                  >
                    📎 {d.file_name}
                  </button>
                  <span className="text-ink-3">
                    {(d.created_at ?? "").slice(0, 10)}
                  </span>
                  <button
                    onClick={() => deleteDoc(d)}
                    className="text-[10px] text-rose-400 hover:text-rose-600"
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="inline-block cursor-pointer rounded-xl border border-line px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:border-accent-300">
            + Upload a record
            <input
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={uploadDoc}
            />
          </label>
        </div>
      </Panel>

      {/* Packages */}
      <Panel id="dog-packages" title="Packages" count={relevantPackages.length} summary={dogPackage || dogWalkPackage ? "Active" : "None on file"}>
        <ScrollBox>
          <CardTable className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line-soft text-xs font-medium uppercase tracking-wide text-ink-3">
                <th className="py-2 pr-3">Bought</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">For</th>
                <th className="py-2 pr-3">Paid</th>
                <th className="py-2 pr-3">Left</th>
                <th className="py-2">Use next</th>
              </tr>
            </thead>
            <tbody>
              {relevantPackages.map((p) => (
                <tr key={p.id} className="border-b border-line-soft last:border-0">
                  <td className="py-2 pr-3 text-ink-2">{(p.created_at ?? "").slice(0, 10) || "—"}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        packageKind(p) === "walk"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-accent-50 text-accent-700"
                      }`}
                    >
                      {packageKind(p) === "walk" ? "🚶 Walks" : "🐕 Daycare"}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-ink-2">
                    {p.dog_name ? p.dog_name : <span className="text-ink-3">Shared</span>}
                  </td>
                  <td className="py-2 pr-3 text-ink-2">
                    {p.price != null ? `$${p.price.toFixed(2)}` : "—"}
                  </td>
                  <td className="py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        daysLeft(p) > 0 ? "bg-accent-50 text-accent-700" : "bg-rose-50 text-rose-600"
                      }`}
                    >
                      {daysLeft(p)} of {p.total_days}{" "}
                      {packageKind(p) === "walk" ? "walks" : "days"}
                    </span>
                  </td>
                  <td className="py-2">
                    {(() => {
                      const pinned =
                        preferredPackageId(dog, packageKind(p)) === p.id && !!p.id;
                      const spent = daysLeft(p) === 0;
                      return (
                        <button
                          onClick={() => setDefaultPackage(p)}
                          disabled={spent && !pinned}
                          title={
                            spent
                              ? "This package is used up"
                              : pinned
                                ? "New visits draw from this one — click to unpin"
                                : "Make this the package new visits draw from"
                          }
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition disabled:opacity-40 ${
                            pinned
                              ? "bg-accent-500 text-accent-ink"
                              : "border border-line text-ink-3 hover:border-accent-400"
                          }`}
                        >
                          {pinned ? "📌 Default" : "Set default"}
                        </button>
                      );
                    })()}
                  </td>
                </tr>
              ))}
              {relevantPackages.length === 0 && <EmptyRow colSpan={6}>No packages on file.</EmptyRow>}
            </tbody>
          </CardTable>
        </ScrollBox>
      </Panel>

      {/* Stays */}
      <Panel id="dog-stays" title="Boarding stays" count={boardings.length} summary={upcomingStays.length ? `${upcomingStays.length} upcoming` : "None upcoming"}>
        <ScrollBox>
          <CardTable className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line-soft text-xs font-medium uppercase tracking-wide text-ink-3">
                <th className="py-2 pr-3">Dates</th>
                <th className="py-2 pr-3">Nights</th>
                <th className="py-2 pr-3">Add-ons</th>
                <th className="py-2">Report</th>
              </tr>
            </thead>
            <tbody>
              {boardings.map((b) => (
                <tr key={b.id} className="border-b border-line-soft last:border-0">
                  <td className="whitespace-nowrap py-2 pr-3 text-ink-2">
                    {prettyDateKey(b.start_date)} → {prettyDateKey(b.end_date)}
                  </td>
                  <td className="py-2 pr-3 text-ink-2">
                    {Math.max(1, dateRange(b.start_date, b.end_date).length - 1)}
                  </td>
                  <td className="py-2 pr-3 text-ink-2">
                    {(b.addons ?? []).length ? (b.addons ?? []).join(", ") : "—"}
                  </td>
                  <td className="py-2">
                    <Link
                      href={`/stay-report?boardingId=${b.id}`}
                      className="text-xs font-medium text-accent-600 hover:underline"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
              {boardings.length === 0 && <EmptyRow colSpan={4}>No boarding stays on file.</EmptyRow>}
            </tbody>
          </CardTable>
        </ScrollBox>
      </Panel>

      {/* Visits */}
      <Panel id="dog-visits" title="Visits" count={visits.length} summary={visits[0] ? `Last: ${visits[0].date}` : "No visits yet"}>
        <ScrollBox>
          <CardTable className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line-soft text-xs font-medium uppercase tracking-wide text-ink-3">
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Service</th>
                <th className="py-2 pr-3">In</th>
                <th className="py-2 pr-3">Out</th>
                <th className="py-2 pr-3">Add-ons</th>
                <th className="py-2">Price</th>
              </tr>
            </thead>
            <tbody>
              {visits.map((v) => (
                <tr key={v.key} className="border-b border-line-soft last:border-0">
                  <td className="whitespace-nowrap py-2 pr-3 text-ink-2">{v.date}</td>
                  <td className="py-2 pr-3 capitalize text-ink-2">
                    {String(v.service).replace("_", " ")}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-ink-2">{timeOnly(v.dropOff)}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-ink-2">{timeOnly(v.pickUp)}</td>
                  <td className="py-2 pr-3 text-ink-2">
                    {v.addons.length ? v.addons.join(", ") : "—"}
                    {v.pickupWindow && (
                      <span className="ml-1 text-[10px] text-ink-3">({v.pickupWindow})</span>
                    )}
                  </td>
                  <td className="py-2 font-medium text-emerald-700">
                    {v.price != null ? `$${v.price.toFixed(2)}` : "—"}
                  </td>
                </tr>
              ))}
              {visits.length === 0 && <EmptyRow colSpan={6}>No visits on file.</EmptyRow>}
            </tbody>
          </CardTable>
        </ScrollBox>
      </Panel>

      {/* Walks */}
      <Panel id="dog-walks" title="Walks" count={walkRows.length} summary={walkRows[0] ? `Last: ${walkRows[0].date}` : "None logged"}>
        <ScrollBox>
          <CardTable className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line-soft text-xs font-medium uppercase tracking-wide text-ink-3">
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Service</th>
                <th className="py-2 pr-3">Slot</th>
                <th className="py-2 pr-3">Out</th>
                <th className="py-2 pr-3">Back</th>
                <th className="py-2">By</th>
              </tr>
            </thead>
            <tbody>
              {walkRows.map((w) => (
                <tr key={w.key} className="border-b border-line-soft last:border-0">
                  <td className="whitespace-nowrap py-2 pr-3 text-ink-2">{w.date}</td>
                  <td className="py-2 pr-3 text-ink-2">{w.service}</td>
                  <td className="py-2 pr-3 text-ink-2">{w.slot}</td>
                  <td className="py-2 pr-3 text-ink-2">{w.out || "—"}</td>
                  <td className="py-2 pr-3 text-ink-2">{w.back || "—"}</td>
                  <td className="py-2 text-ink-2">{w.initials || "—"}</td>
                </tr>
              ))}
              {walkRows.length === 0 && <EmptyRow colSpan={6}>No walks logged yet.</EmptyRow>}
            </tbody>
          </CardTable>
        </ScrollBox>
      </Panel>

      {/* Housekeeping, at the bottom and away from everything that edits the
          profile. Retiring is not a correction to the record — it is the end
          of one. */}
      {!isRetired(dog) && (
        <div className="mt-5">
          {retiring ? (
            <RetirePanel
              dogName={dog.dog_name}
              busy={savingRetire}
              onConfirm={(reason, note) => setRetired(reason, note)}
              onCancel={() => setRetiring(false)}
            />
          ) : (
            <button
              onClick={() => setRetiring(true)}
              className="text-xs font-medium text-ink-3 transition hover:text-ink-2"
            >
              Retire {dog.dog_name} — passed away, moved, or no longer coming
            </button>
          )}
        </div>
      )}

      {/* One save for the whole profile. Every panel edits the same row, so
          four identical buttons only raised the question of which one saved
          what. Sticky, because the field you changed may be several panels
          up by the time you finish. */}
      {dirty && (
        <div className="sticky bottom-4 z-40 mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-card">
          <p className="text-xs font-medium text-amber-900">Unsaved changes to this profile.</p>
          <button
            onClick={saveInfo}
            disabled={savingInfo}
            className="ml-auto rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-accent-ink shadow-card hover:bg-accent-600 disabled:opacity-60"
          >
            {savingInfo ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}
      {infoSaved && !dirty && (
        <p className="mt-3 text-xs font-medium text-emerald-600">Saved ✓</p>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100";

/**
 * Taking a dog off the books.
 *
 * A reason is required, and it is the first thing asked, because the three
 * answers are not the same event: staff writing "passed away" are recording
 * something they may have to say out loud to the owner next week, and the
 * profile should be able to show it back to them. The note is theirs.
 */
function RetirePanel({
  dogName,
  busy,
  onConfirm,
  onCancel,
}: {
  dogName: string;
  busy: boolean;
  onConfirm: (reason: string, note: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <p className="text-sm font-medium text-ink">Retire {dogName}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-3">
        Nothing is deleted. {dogName} keeps every visit, payment, vaccination and document, and
        can be brought back at any time — they just stop appearing anywhere staff book, charge or
        check a dog in.
      </p>

      <p className="mb-1.5 mt-4 text-[11px] text-ink-3">What happened?</p>
      <div className="flex flex-wrap gap-2">
        {RETIRE_REASONS.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setReason(r.key)}
            className={`rounded-xl border px-3.5 py-2 text-xs font-medium transition ${
              reason === r.key
                ? "border-accent-500 bg-accent-500 text-accent-ink"
                : "border-line bg-surface text-ink-2 hover:border-accent-300"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <label className="mb-1 mt-4 block text-[11px] text-ink-3" htmlFor="retire-note">
        Note (optional)
      </label>
      <input
        id="retire-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Anything worth remembering"
        className={inputClass}
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => onConfirm(reason, note)}
          disabled={busy || !reason}
          className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-accent-ink shadow-card hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Working…" : `Retire ${dogName}`}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-2 hover:border-line disabled:opacity-60"
        >
          Cancel
        </button>
        {!reason && <p className="text-[11px] text-ink-3">Pick a reason first.</p>}
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 rounded-2xl border border-line bg-surface p-5 shadow-card">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">
        {title}
        {count != null && <span className="ml-1.5 font-normal text-ink-3">({count})</span>}
      </h2>
      {children}
    </section>
  );
}

// History tables can run long — capping them keeps the profile scannable
// instead of pushing everything below the fold.
function ScrollBox({ children }: { children: React.ReactNode }) {
  return <div className="max-h-64 overflow-y-auto overflow-x-auto">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] text-ink-3">{label}</label>
      {children}
    </div>
  );
}

// Sits at the top of a section whose questions have never been put to this
// household. Without it a screen of unanswered yes/no questions looks like a
// profile somebody could not be bothered to fill in, and staff either chase
// answers that are already coming or assume the dog has no history.
function AwaitingDetails({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
      ⏳ Not asked yet — these come from the details form the owner has not sent back. Blank here
      does not mean &ldquo;no&rdquo;. Fill anything in yourself and it saves as normal.
    </p>
  );
}

// Every editable section writes the same `clients` row, so they all share one
// save action — the button repeats so staff never have to scroll back up to
// find it.

function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-5 text-center text-sm text-ink-3">
        {children}
      </td>
    </tr>
  );
}

function timeOnly(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
