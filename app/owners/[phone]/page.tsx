"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { daysLeft, dogHref, findDog, hasWaiver, packageKind } from "@/lib/dogs";
import DogLink from "@/components/DogLink";
import { prettyDateKey, todayKey } from "@/lib/dates";
import {
  Boarding,
  Dog,
  HEARD_ABOUT,
  Owner,
  PAYMENT_METHODS,
  Package,
  Payment,
  PaymentMethod,
  SignInRecord,
} from "@/types";
import { Balance, computeBalance, loadPayments, unpaidCharges } from "@/lib/billing";
import BalanceBadge from "@/components/BalanceBadge";
import StaffGate from "@/components/StaffGate";
import StaffNav from "@/components/StaffNav";
import { ChoiceWithOther } from "@/components/FormBits";
import Panel from "@/components/Panel";
import CustomerAccountPanel from "@/components/CustomerAccountPanel";
import { activeDogs, isRetired, retireReasonLabel, retiredDogs } from "@/lib/retire";

export default function OwnerProfilePage() {
  return (
    <StaffGate title="Owner profile">
      <OwnerProfile />
    </StaffGate>
  );
}

const EMPTY_OWNER = {
  owner_name: "",
  email: "",
  address: "",
  emergency_name: "",
  emergency_phone: "",
  emergency_relation: "",
  notes: "",
  city: "",
  state: "",
  zip: "",
  // Collected once per household on the enrollment form. A dog with its own
  // vet overrides this on its profile.
  vet_name: "",
  vet_phone: "",
  vet_address: "",
  heard_about: "",
};

const EMPTY_DOG = { dog_name: "", last_name: "", drop_off_by: "", waiver_on_file: false };

function OwnerProfile() {
  const params = useParams<{ phone: string }>();
  // The route segment carries the phone exactly as stored — older rows
  // aren't all formatted the same way, so it's encoded rather than
  // rebuilt from digits.
  const phone = params?.phone ? decodeURIComponent(params.phone) : "";

  const [owner, setOwner] = useState<Owner | null>(null);
  const [form, setForm] = useState(EMPTY_OWNER);
  const [dogs, setDogs] = useState<Dog[]>([]);
  const [boardings, setBoardings] = useState<Boarding[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [signins, setSignins] = useState<SignInRecord[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [payForm, setPayForm] = useState({ amount: "", method: "card" as PaymentMethod, note: "" });
  const [savingPay, setSavingPay] = useState(false);
  const [deletingPayId, setDeletingPayId] = useState<string | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // Adding or editing a dog on this number. One draft is enough — only one
  // card is ever open at a time.
  const [addingDog, setAddingDog] = useState(false);
  const [editingDogId, setEditingDogId] = useState<string | null>(null);
  const [dogForm, setDogForm] = useState(EMPTY_DOG);
  const [savingDog, setSavingDog] = useState(false);
  const [deletingDogId, setDeletingDogId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!phone) return;
    setLoading(true);
    setError("");
    try {
      const supabase = getSupabase();
      const [ownerRes, dogRes, boardingRes, pkgRes, signinRes, payRes] = await Promise.all([
        // maybeSingle: the owner row is created lazily on first save, so a
        // profile with no details yet is normal, not an error.
        supabase.from("owners").select("*").eq("phone", phone).maybeSingle(),
        supabase.from("dogs").select("*").eq("phone", phone).order("created_at", { ascending: true }),
        supabase.from("boardings").select("*").eq("phone", phone).order("start_date", { ascending: false }),
        supabase.from("packages").select("*").eq("phone", phone).order("created_at", { ascending: false }),
        // Same reason as lib/billing.ts: this feeds the balance shown on the
        // profile, and a truncated history quietly changes the total.
        supabase.from("signins").select("*").eq("phone", phone).limit(100000),
        loadPayments(phone),
      ]);
      if (ownerRes.error) throw ownerRes.error;
      if (dogRes.error) throw dogRes.error;
      if (boardingRes.error) throw boardingRes.error;
      if (pkgRes.error) throw pkgRes.error;
      if (signinRes.error) throw signinRes.error;

      const ownerRow = (ownerRes.data as Owner | null) ?? null;
      setOwner(ownerRow);
      if (ownerRow) {
        setForm({
          owner_name: ownerRow.owner_name ?? "",
          email: ownerRow.email ?? "",
          address: ownerRow.address ?? "",
          emergency_name: ownerRow.emergency_name ?? "",
          emergency_phone: ownerRow.emergency_phone ?? "",
          emergency_relation: ownerRow.emergency_relation ?? "",
          notes: ownerRow.notes ?? "",
          city: ownerRow.city ?? "",
          state: ownerRow.state ?? "",
          zip: ownerRow.zip ?? "",
          vet_name: ownerRow.vet_name ?? "",
          vet_phone: ownerRow.vet_phone ?? "",
          vet_address: ownerRow.vet_address ?? "",
          heard_about: ownerRow.heard_about ?? "",
        });
      }
      setDogs((dogRes.data as Dog[]) ?? []);
      setBoardings((boardingRes.data as Boarding[]) ?? []);
      setPackages((pkgRes.data as Package[]) ?? []);
      setSignins((signinRes.data as SignInRecord[]) ?? []);
      setPayments(payRes);
    } catch (e) {
      console.error("Loading owner profile failed:", e);
      setError("Could not load this owner's profile.");
    } finally {
      setLoading(false);
    }
  }, [phone]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveOwner() {
    setSaving(true);
    setError("");
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase
        .from("owners")
        .upsert({ phone, ...trimmed(form) }, { onConflict: "phone" });
      if (err) throw err;
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      load();
    } catch (e) {
      console.error("Saving owner failed:", e);
      setError("Could not save those details.");
    } finally {
      setSaving(false);
    }
  }

  async function addDog() {
    if (!dogForm.dog_name.trim()) {
      setError("Give the dog a name.");
      return;
    }
    setSavingDog(true);
    setError("");
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase.from("dogs").insert({
        phone,
        dog_name: dogForm.dog_name.trim(),
        // Default the surname to whatever the household already uses.
        last_name: dogForm.last_name.trim() || dogs[0]?.last_name || "",
        drop_off_by: dogForm.drop_off_by.trim(),
        // No signature is captured here — the signup flow is what does
        // that. Staff tick the box when a waiver was signed elsewhere, and
        // the card flags the dog until one way or the other is true.
        signature_data: "",
        waiver_on_file: dogForm.waiver_on_file,
      });
      if (err) throw err;
      setDogForm(EMPTY_DOG);
      setAddingDog(false);
      load();
    } catch (e) {
      console.error("Adding dog failed:", e);
      setError("Could not add that dog.");
    } finally {
      setSavingDog(false);
    }
  }

  async function saveDog(dog: Dog) {
    if (!dog.id || !dogForm.dog_name.trim()) {
      setError("Give the dog a name.");
      return;
    }
    const nextName = dogForm.dog_name.trim();
    const nextLast = dogForm.last_name.trim();
    setSavingDog(true);
    setError("");
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase
        .from("dogs")
        .update({
          dog_name: nextName,
          last_name: nextLast,
          drop_off_by: dogForm.drop_off_by.trim(),
          waiver_on_file: dogForm.waiver_on_file,
        })
        .eq("id", dog.id);
      if (err) throw err;

      // Reservations and packages are matched to a dog by name, not by id,
      // so a rename has to carry across or the dog silently loses its
      // stays and package. Scoped to this phone number.
      if (nextName.toLowerCase() !== dog.dog_name.trim().toLowerCase()) {
        const [boardingErr, pkgErr] = await Promise.all([
          supabase
            .from("boardings")
            .update({ dog_name: nextName, last_name: nextLast })
            .eq("phone", phone)
            .ilike("dog_name", dog.dog_name)
            .then((r) => r.error),
          supabase
            .from("packages")
            .update({ dog_name: nextName })
            .eq("phone", phone)
            .ilike("dog_name", dog.dog_name)
            .then((r) => r.error),
        ]);
        if (boardingErr) throw boardingErr;
        if (pkgErr) throw pkgErr;
      }

      setEditingDogId(null);
      setDogForm(EMPTY_DOG);
      load();
    } catch (e) {
      console.error("Saving dog failed:", e);
      setError("Could not save that dog.");
    } finally {
      setSavingDog(false);
    }
  }

  async function deleteDog(dog: Dog) {
    if (!dog.id) return;
    // Sign-ins and reservations reference the dog but aren't cascaded, so
    // say plainly what survives the delete before doing it.
    const stays = boardings.filter(
      (b) => b.dog_name.trim().toLowerCase() === dog.dog_name.trim().toLowerCase()
    ).length;
    const warning = stays
      ? `\n\n${dog.dog_name} has ${stays} boarding reservation${stays === 1 ? "" : "s"} on file. `
      : "\n\n";
    if (
      !window.confirm(
        `Delete ${dog.dog_name} from this number?${warning}Their profile, photo, and vaccine records are removed. Past sign-ins and reservations stay in the records for bookkeeping, but stop being linked to a profile. This can't be undone.`
      )
    ) {
      return;
    }
    setDeletingDogId(dog.id);
    setError("");
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase.from("dogs").delete().eq("id", dog.id);
      if (err) throw err;
      load();
    } catch (e) {
      console.error("Deleting dog failed:", e);
      setError("Could not delete that dog.");
    } finally {
      setDeletingDogId(null);
    }
  }

  function startEditDog(dog: Dog) {
    setAddingDog(false);
    setEditingDogId(dog.id ?? null);
    setDogForm({
      dog_name: dog.dog_name,
      last_name: dog.last_name,
      drop_off_by: dog.drop_off_by ?? "",
      waiver_on_file: !!dog.waiver_on_file,
    });
  }

  const balance: Balance = useMemo(
    () => computeBalance(signins, packages, payments),
    [signins, packages, payments]
  );

  // What the outstanding figure is actually made of, oldest charge first.
  //
  // "You owe $1,150" is not an answer staff can give a client at the counter.
  // Payments are not tied to a specific charge — money settles the account —
  // so they are applied oldest-first, which is both the conventional
  // allocation and what makes the dates meaningful: the top row is where the
  // debt starts.
  const unpaid = useMemo(
    () => [...unpaidCharges(balance)].sort((a, b) => a.date.localeCompare(b.date)),
    [balance]
  );

  function daysAgo(day: string): number {
    if (!day) return 0;
    const then = new Date(`${day}T12:00:00`).getTime();
    const now = new Date(`${todayKey()}T12:00:00`).getTime();
    return Math.max(0, Math.round((now - then) / 86_400_000));
  }

  function agoLabel(day: string): string {
    const n = daysAgo(day);
    if (n === 0) return "today";
    if (n === 1) return "yesterday";
    if (n < 60) return `${n} days ago`;
    const months = Math.round(n / 30);
    return `${months} month${months === 1 ? "" : "s"} ago`;
  }

  async function recordPayment() {
    const amount = parseFloat(payForm.amount);
    if (Number.isNaN(amount) || amount <= 0) {
      setError("Enter how much was paid.");
      return;
    }
    setSavingPay(true);
    setError("");
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase.from("payments").insert({
        phone,
        amount,
        method: payForm.method,
        note: payForm.note.trim() || null,
        paid_on: todayKey(),
      });
      if (err) throw err;
      setPayForm({ amount: "", method: payForm.method, note: "" });
      load();
    } catch (e) {
      console.error("Recording payment failed:", e);
      setError("Could not record that payment.");
    } finally {
      setSavingPay(false);
    }
  }

  async function deletePayment(pay: Payment) {
    if (!pay.id) return;
    if (!window.confirm(`Remove the $${pay.amount.toFixed(2)} payment from ${pay.paid_on}?`)) return;
    setDeletingPayId(pay.id);
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase.from("payments").delete().eq("id", pay.id);
      if (err) throw err;
      load();
    } catch (e) {
      console.error("Deleting payment failed:", e);
      setError("Could not remove that payment.");
    } finally {
      setDeletingPayId(null);
    }
  }

  const upcoming = useMemo(() => {
    const today = todayKey();
    return boardings
      .filter((b) => b.end_date >= today)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
  }, [boardings]);

  // The surname on file for any of their dogs, as a display name fallback
  // when no owner name has been entered yet.
  const displayName = form.owner_name || dogs[0]?.last_name || "Owner";

  const contactSummary = [form.email, [form.city, form.state].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(" · ");
  const vetSummary = [form.vet_name, form.vet_phone].filter(Boolean).join(" · ");
  const emergencySummary = [form.emergency_name, form.emergency_relation]
    .filter(Boolean)
    .join(" · ");

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <StaffNav current="" />
        <p className="text-sm text-ink-3">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <StaffNav current="" />

      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold text-ink">
          {displayName}
        </h1>
        <p className="text-sm text-ink-3">{phone}</p>
        <div className="mt-2">
          <BalanceBadge outstanding={balance.outstanding} />
        </div>
        {!owner && (
          <p className="mt-1 text-xs text-amber-700">
            No contact details saved yet — fill in what you know and hit save.
          </p>
        )}
      </div>

      {error && (
        <p className="mb-4 text-xs font-medium text-rose-500">{error}</p>
      )}

      {/* Balance */}
      <Panel
        id="owner-balance"
        defaultOpen
        summary={
          balance.outstanding > 0.005
            ? `$${balance.outstanding.toFixed(2)} outstanding`
            : balance.outstanding < -0.005
              ? `$${Math.abs(balance.outstanding).toFixed(2)} in credit`
              : "Settled"
        }
        tone={balance.outstanding > 0.005 ? "alert" : "default"}
        title="Balance"
        blurb="One bill for the household — every dog on this number, and payments settle across all of them."
      >
        <div className="grid grid-cols-3 gap-3">
          <Figure label="Charged" value={`$${balance.charged.toFixed(2)}`} />
          <Figure label="Paid" value={`$${balance.paid.toFixed(2)}`} />
          <Figure
            label={balance.outstanding < 0 ? "In credit" : "Outstanding"}
            value={`$${Math.abs(balance.outstanding).toFixed(2)}`}
            tone={
              balance.outstanding > 0.005
                ? "text-rose-700"
                : balance.outstanding < -0.005
                  ? "text-sky-700"
                  : "text-emerald-700"
            }
          />
        </div>

        {/* What the outstanding figure is FROM, and WHEN it started. Always
            visible when money is owed — the full ledger stays behind the
            toggle below, but a client asking "what is this for?" should not
            need staff to expand anything. */}
        {balance.outstanding > 0.005 && unpaid.length > 0 && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/50 p-3.5">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-800">
                What is unpaid
              </p>
              <p className="text-[11px] text-rose-900/70">
                {unpaid.length} charge{unpaid.length === 1 ? "" : "s"}, oldest first
              </p>
            </div>

            <ul className="mt-2 divide-y divide-rose-200/70">
              {unpaid.map((c) => (
                <li key={c.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
                  <span className="w-28 shrink-0 text-xs font-medium text-ink-2">
                    {prettyDateKey(c.date)}
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-ink-2">
                    {c.label}
                    <span className="ml-1.5 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-800">
                      {c.kind === "package" ? "package" : "visit"}
                    </span>
                    <span className="ml-1.5 text-[11px] text-ink-3">{agoLabel(c.date)}</span>
                  </span>
                  <span className="whitespace-nowrap text-sm font-semibold text-rose-700">
                    ${c.remaining.toFixed(2)}
                    {/* A charge part-covered by an earlier payment would
                        otherwise look like it was always this small. */}
                    {c.remaining < c.amount - 0.005 && (
                      <span className="ml-1 text-[11px] font-normal text-ink-3">
                        of ${c.amount.toFixed(2)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-2 border-t border-rose-200 pt-2 text-[11px] text-rose-900">
              Balance started <strong>{prettyDateKey(unpaid[0].date)}</strong> —{" "}
              {daysAgo(unpaid[0].date) === 0
                ? "today"
                : `${daysAgo(unpaid[0].date)} day${daysAgo(unpaid[0].date) === 1 ? "" : "s"} outstanding`}
              . Payments are applied to the oldest charge first, so anything paid has already
              cleared the charges above this list.
            </p>
          </div>
        )}

        {/* Credit needs the same answer, in reverse: where did it come from? */}
        {balance.outstanding < -0.005 && balance.payments.length > 0 && (
          <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50/60 p-3.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">
              Why there is credit
            </p>
            <p className="mt-1 text-sm text-ink-2">
              Paid ${balance.paid.toFixed(2)} against ${balance.charged.toFixed(2)} of charges —{" "}
              <strong>${Math.abs(balance.outstanding).toFixed(2)} overpaid</strong>. Last payment{" "}
              {prettyDateKey(balance.payments[0].paid_on)} ({agoLabel(balance.payments[0].paid_on)})
              {balance.payments[0].note ? `, noted "${balance.payments[0].note}"` : ""}.
            </p>
            <p className="mt-1 text-[11px] text-sky-900">
              It comes off the next visit automatically — nothing to refund unless they ask.
            </p>
          </div>
        )}

        {/* Record a payment */}
        <div className="mt-4 grid gap-3 border-t border-line-soft pt-4 sm:grid-cols-4">
          <Field label="Amount">
            <input
              type="number"
              min="0"
              step="0.01"
              value={payForm.amount}
              onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
              placeholder={balance.outstanding > 0 ? balance.outstanding.toFixed(2) : "0.00"}
              className={inputClass}
            />
          </Field>
          <Field label="Method">
            <select
              value={payForm.method}
              onChange={(e) => setPayForm({ ...payForm, method: e.target.value as PaymentMethod })}
              className={inputClass}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.icon} {m.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Note (optional)">
              <input
                value={payForm.note}
                onChange={(e) => setPayForm({ ...payForm, note: e.target.value })}
                placeholder="Reference, who took it…"
                className={inputClass}
              />
            </Field>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={recordPayment}
            disabled={savingPay}
            className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-accent-ink shadow-card hover:bg-accent-600 disabled:opacity-60"
          >
            {savingPay ? "Saving…" : "Record payment"}
          </button>
          {balance.outstanding > 0.005 && (
            <button
              onClick={() =>
                setPayForm({ ...payForm, amount: balance.outstanding.toFixed(2) })
              }
              className="text-xs font-medium text-accent-600 hover:underline"
            >
              Pay full balance (${balance.outstanding.toFixed(2)})
            </button>
          )}
          <button
            onClick={() => setLedgerOpen((v) => !v)}
            className="ml-auto text-xs font-medium text-ink-3 hover:text-ink-2"
          >
            {ledgerOpen ? "Hide" : "Show"} charges &amp; payments
          </button>
        </div>

        {ledgerOpen && (
          <div className="mt-4 grid gap-4 border-t border-line-soft pt-4 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-3">
                Charges ({balance.charges.length})
              </p>
              <div className="max-h-56 overflow-y-auto">
                {balance.charges.length === 0 ? (
                  <p className="text-xs text-ink-3">Nothing charged yet.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {balance.charges.map((c) => (
                      <li key={c.key} className="flex items-baseline justify-between gap-3">
                        <span className="text-ink-2">
                          <span className="text-ink-3">{c.date}</span> {c.label}
                        </span>
                        <span className="whitespace-nowrap font-medium text-ink-2">
                          ${c.amount.toFixed(2)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-3">
                Payments ({balance.payments.length})
              </p>
              <div className="max-h-56 overflow-y-auto">
                {balance.payments.length === 0 ? (
                  <p className="text-xs text-ink-3">No payments recorded.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {balance.payments.map((p) => (
                      <li key={p.id} className="flex items-baseline justify-between gap-3">
                        <span className="text-ink-2">
                          <span className="text-ink-3">{p.paid_on}</span>{" "}
                          {PAYMENT_METHODS.find((m) => m.key === p.method)?.label ?? "Payment"}
                          {p.note && <span className="text-ink-3"> · {p.note}</span>}
                        </span>
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          <span className="font-medium text-emerald-700">
                            ${p.amount.toFixed(2)}
                          </span>
                          <button
                            onClick={() => deletePayment(p)}
                            disabled={deletingPayId === p.id}
                            className="text-[10px] text-rose-400 hover:text-rose-600 disabled:opacity-50"
                          >
                            remove
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </Panel>

      {/* Dogs */}
      {/* The household is the one place a retired dog still belongs, so they
          are shown here rather than hidden — sorted to the end, marked, and
          counted separately from the dogs who are still coming. */}
      <Panel
        id="owner-dogs"
        title="Dogs"
        count={activeDogs(dogs).length}
        defaultOpen
        summary={
          [
            activeDogs(dogs).map((d) => d.dog_name).join(", "),
            retiredDogs(dogs).length ? `${retiredDogs(dogs).length} retired` : "",
          ]
            .filter(Boolean)
            .join(" · ") || "None on file"
        }
      >
        {dogs.length === 0 && !addingDog && (
          <p className="mb-3 text-sm text-ink-3">
            No dogs on file for this number.
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          {[...activeDogs(dogs), ...retiredDogs(dogs)].map((d) =>
            editingDogId === d.id ? (
              <div
                key={d.id}
                className="w-full rounded-2xl border border-accent-200 bg-accent-50/40 p-4">
                <p className="mb-2 text-xs font-medium text-ink-2">
                  Editing {d.dog_name}
                </p>
                <DogFields form={dogForm} setForm={setDogForm} />
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => saveDog(d)}
                    disabled={savingDog}
                    className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-accent-ink shadow-card hover:bg-accent-600 disabled:opacity-60">
                    {savingDog ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={() => {
                      setEditingDogId(null);
                      setDogForm(EMPTY_DOG);
                    }}
                    className="rounded-xl border border-line px-4 py-2 text-sm text-ink-3 hover:border-line">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={d.id}
                className={`flex w-44 flex-col items-center gap-2 rounded-2xl border p-3 text-center ${
                  isRetired(d) ? "border-line-soft bg-surface-2" : "border-line"
                }`}>
                <Link
                  href={d.id ? dogHref(d.id) : "#"}
                  className="flex flex-col items-center gap-2 transition hover:opacity-80">
                  {d.photo_data ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={d.photo_data}
                      alt={`${d.dog_name}'s photo`}
                      className={`h-16 w-16 rounded-full object-cover ${
                        isRetired(d) ? "grayscale" : ""
                      }`}
                    />
                  ) : (
                    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-3 text-2xl">
                      🐕
                    </span>
                  )}
                  <span className={`text-sm font-medium ${isRetired(d) ? "text-ink-3" : "text-ink"}`}>
                    {d.dog_name}
                  </span>
                  <span className="text-[11px] text-accent-600">
                    Open profile →
                  </span>
                </Link>

                {isRetired(d) && (
                  <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-semibold text-ink-3">
                    {retireReasonLabel(d.retired_reason)}
                  </span>
                )}

                {/* Covered either by a signature from signup or by staff
                    confirming one signed elsewhere. Not worth saying about a
                    dog that is no longer coming. */}
                {!isRetired(d) && !hasWaiver(d) && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                    No waiver on file
                  </span>
                )}
                {!d.signature_data && d.waiver_on_file && (
                  <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-semibold text-ink-3">
                    Waiver on file (paper)
                  </span>
                )}
                {d.signature_data && !d.waiver_on_file && (
                  <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-semibold text-ink-3">
                    Waiver on file (digital)
                  </span>
                )}

                <div className="flex gap-1.5">
                  <button
                    onClick={() => startEditDog(d)}
                    className="rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-2 hover:border-line">
                    Edit
                  </button>
                  <button
                    onClick={() => deleteDog(d)}
                    disabled={deletingDogId === d.id}
                    className="rounded-lg border border-rose-200 px-2.5 py-1 text-[11px] text-rose-500 hover:border-rose-300 disabled:opacity-60">
                    {deletingDogId === d.id ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            ),
          )}
        </div>

        {addingDog ? (
          <div className="mt-3 rounded-2xl border border-accent-200 bg-accent-50/40 p-4">
            <p className="mb-2 text-xs font-medium text-ink-2">
              Add a dog to this number
            </p>
            <DogFields form={dogForm} setForm={setDogForm} />
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={addDog}
                disabled={savingDog}
                className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-accent-ink shadow-card hover:bg-accent-600 disabled:opacity-60">
                {savingDog ? "Adding…" : "Add dog"}
              </button>
              <button
                onClick={() => {
                  setAddingDog(false);
                  setDogForm(EMPTY_DOG);
                }}
                className="rounded-xl border border-line px-4 py-2 text-sm text-ink-3 hover:border-line">
                Cancel
              </button>
            </div>
            <p className="mt-2 text-[11px] text-ink-3">
              To capture an actual signature, send the client through{" "}
              <Link href="/signup" className="text-accent-600 hover:underline">
                signup
              </Link>{" "}
              instead.
            </p>
          </div>
        ) : (
          <button
            onClick={() => {
              setEditingDogId(null);
              setDogForm({ ...EMPTY_DOG, last_name: dogs[0]?.last_name ?? "" });
              setAddingDog(true);
            }}
            className="mt-3 rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-2 hover:border-accent-300">
            + Add a dog
          </button>
        )}
      </Panel>

      {/* Contact */}
      <Panel id="owner-contact" title="Contact" summary={contactSummary || "Nothing saved yet"}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Owner name">
            <input
              value={form.owner_name}
              onChange={(e) => setForm({ ...form, owner_name: e.target.value })}
              placeholder="First and last name"
              className={inputClass}
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="name@example.com"
              className={inputClass}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Street address">
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="1300 26th Ave"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="City">
            <input
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="State">
              <input
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
                maxLength={2}
                className={inputClass}
              />
            </Field>
            <Field label="ZIP">
              <input
                value={form.zip}
                onChange={(e) => setForm({ ...form, zip: e.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
        </div>
      </Panel>

      {/* Their own login. Sits under Contact because it depends on the email
          address up there — the invitation goes to whatever is on file.

          dogNames is active only. That list is not decoration: it goes into
          the portal invitation email as "your account for Buki and Koda".
          Naming a dog that died in a cheerful invite is the kind of thing a
          client remembers about a business. */}
      <CustomerAccountPanel
        ownerId={owner?.id ?? null}
        ownerName={form.owner_name || displayName}
        email={form.email}
        dogNames={activeDogs(dogs).map((d) => d.dog_name).filter(Boolean)}
      />

      {/* Veterinarian */}
      <Panel
        id="owner-vet"
        summary={vetSummary || "Not recorded"}
        title="Veterinarian"
        blurb="Who we call in an emergency. A dog with a different vet has it on their own profile."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Hospital name">
            <input
              value={form.vet_name}
              onChange={(e) => setForm({ ...form, vet_name: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Phone">
            <input
              value={form.vet_phone}
              onChange={(e) => setForm({ ...form, vet_phone: e.target.value })}
              inputMode="tel"
              className={inputClass}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address">
              <input
                value={form.vet_address}
                onChange={(e) => setForm({ ...form, vet_address: e.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
        </div>
      </Panel>

      {/* Emergency contact */}
      <Panel id="owner-emergency" title="Emergency contact" summary={emergencySummary || "Not recorded"}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name">
            <input
              value={form.emergency_name}
              onChange={(e) =>
                setForm({ ...form, emergency_name: e.target.value })
              }
              className={inputClass}
            />
          </Field>
          <Field label="Phone">
            <input
              value={form.emergency_phone}
              onChange={(e) =>
                setForm({ ...form, emergency_phone: e.target.value })
              }
              inputMode="numeric"
              className={inputClass}
            />
          </Field>
          <Field label="Relationship">
            <input
              value={form.emergency_relation}
              onChange={(e) =>
                setForm({ ...form, emergency_relation: e.target.value })
              }
              placeholder="Sister, neighbour…"
              className={inputClass}
            />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="How they heard about us">
            <ChoiceWithOther
              options={HEARD_ABOUT}
              value={form.heard_about}
              onChange={(v) => setForm({ ...form, heard_about: v })}
              ariaLabel="How they heard about us"
            />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              placeholder="Anything staff should know about this client"
              className={inputClass}
            />
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={saveOwner}
            disabled={saving}
            className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-accent-ink shadow-card hover:bg-accent-600 disabled:opacity-60">
            {saving ? "Saving…" : "Save details"}
          </button>
          {saved && (
            <span className="text-xs font-medium text-emerald-600">
              Saved ✓
            </span>
          )}
        </div>
      </Panel>

      {/* Upcoming reservations */}
      <Panel id="owner-upcoming" title="Upcoming reservations" count={upcoming.length} summary={upcoming[0] ? `Next: ${prettyDateKey(upcoming[0].start_date)}` : "None booked"}>
        {upcoming.length === 0 ? (
          <p className="text-sm text-ink-3">
            No upcoming stays for any of their dogs.
          </p>
        ) : (
          <ul className="space-y-2">
            {upcoming.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line-soft px-3.5 py-2.5 text-sm">
                <span className="font-medium text-ink">
                  🛏️{" "}
                  <DogLink
                    dog={findDog(dogs, { dogId: b.dog_id, dogName: b.dog_name, phone: b.phone })}
                    name={b.dog_name}
                  />
                </span>
                <span className="text-ink-2">
                  {prettyDateKey(b.start_date)} → {prettyDateKey(b.end_date)}
                </span>
                <Link
                  href={`/stay-report?boardingId=${b.id}`}
                  className="text-xs font-medium text-accent-600 hover:underline">
                  Stay report →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* Packages */}
      <Panel id="owner-packages" title="Packages" count={packages.length} summary={packages.length ? "On file" : "None"}>
        {packages.length === 0 ? (
          <p className="text-sm text-ink-3">No packages on this number.</p>
        ) : (
          <ul className="space-y-2">
            {packages.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line-soft px-3.5 py-2.5 text-sm">
                <span className="flex flex-wrap items-center gap-2 text-ink-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      packageKind(p) === "walk"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-accent-50 text-accent-700"
                    }`}
                  >
                    {packageKind(p) === "walk" ? "🚶 Walks" : "🐕 Daycare"}
                  </span>
                  {p.dog_name || (
                    <span className="text-ink-3">Shared across dogs</span>
                  )}
                  {p.price != null && (
                    <span className="text-xs text-ink-3">${p.price.toFixed(2)}</span>
                  )}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                    daysLeft(p) > 0
                      ? "bg-accent-50 text-accent-700"
                      : "bg-rose-50 text-rose-600"
                  }`}>
                  {daysLeft(p)} of {p.total_days}{" "}
                  {packageKind(p) === "walk" ? "walks" : "days"} left
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100";

function trimmed(form: typeof EMPTY_OWNER) {
  return Object.fromEntries(
    Object.entries(form).map(([k, v]) => [k, v.trim() || null])
  ) as Record<string, string | null>;
}

function Section({
  title,
  count,
  blurb,
  children,
}: {
  title: string;
  count?: number;
  blurb?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 rounded-2xl border border-line bg-surface p-5 shadow-card">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
        {title}
        {count != null && <span className="ml-1.5 font-normal text-ink-3">({count})</span>}
      </h2>
      {blurb ? <p className="mb-3 mt-1 text-[11px] text-ink-3">{blurb}</p> : <div className="mb-3" />}
      {children}
    </section>
  );
}

function Figure({
  label,
  value,
  tone = "text-ink",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-line-soft px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-ink-3">{label}</p>
      <p className={`text-lg font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] text-ink-3">{label}</label>
      {children}
    </div>
  );
}

// The same three fields whether staff are adding a dog or editing one.
// Photo and vaccines live on the dog's own profile, not here.
function DogFields({
  form,
  setForm,
}: {
  form: typeof EMPTY_DOG;
  setForm: (f: typeof EMPTY_DOG) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Dog name">
        <input
          value={form.dog_name}
          onChange={(e) => setForm({ ...form, dog_name: e.target.value })}
          placeholder="Bella"
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
          placeholder="Parent/guardian"
          className={inputClass}
        />
      </Field>
      <label className="flex items-start gap-2 sm:col-span-3">
        <input
          type="checkbox"
          checked={form.waiver_on_file}
          onChange={(e) => setForm({ ...form, waiver_on_file: e.target.checked })}
          className="mt-0.5 h-4 w-4 rounded border-line text-accent-500 focus:ring-accent-100"
        />
        <span className="text-xs text-ink-2">
          Waiver signed and on file
          <span className="block text-[11px] text-ink-3">
            Tick this only if the client has actually signed — on paper or at another location. It
            clears the &ldquo;no waiver&rdquo; flag without capturing a signature.
          </span>
        </span>
      </label>
    </div>
  );
}
