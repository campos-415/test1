"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { BusyNote } from "@/components/BusyButton";
import CustomerGate from "@/components/CustomerGate";
import { HouseholdData, loadHouseholdData, uploadVaccinationRecord } from "@/lib/customer";
import { fileToRecordJpeg } from "@/lib/image";
import { prettyDateKey, todayKey } from "@/lib/dates";
import { VACCINES, VaccineKey } from "@/types";

export default function DocumentsPage() {
  return <CustomerGate>{() => <Documents />}</CustomerGate>;
}

function Documents() {
  const [data, setData] = useState<HouseholdData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loadHouseholdData());
      setError("");
    } catch (e) {
      console.error("Loading the documents failed:", e);
      setError("We could not load your records just now. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="text-sm text-ink-3">Loading…</p>;
  if (error) return <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>;
  if (!data) return null;

  const today = todayKey();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Vaccinations
        </h1>
        <p className="mt-1 text-sm text-ink-3">
          What we hold, and where to send a new certificate when one is renewed.
        </p>
      </div>

      {data.dogs.map((dog) => (
        <section key={dog.id} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
          <h2 className="font-display text-base font-semibold text-ink">{dog.dog_name}</h2>

          <ul className="mt-3 space-y-1">
            {VACCINES.map((vaccine) => {
              const row = data.vaccinations.find(
                (v) => v.dog_id === dog.id && v.vaccine === vaccine.key
              );
              return (
                <VaccineRow
                  key={vaccine.key}
                  label={vaccine.label}
                  expiresOn={row?.expires_on ?? null}
                  today={today}
                />
              );
            })}
          </ul>

          <Uploader dogId={dog.id ?? ""} dogName={dog.dog_name} onUploaded={load} />

          {/* Their own uploads, newest first. Kept rather than replaced: what
              was on file and when is the part that matters if anybody ever
              asks. */}
          {data.documents.filter((d) => d.dog_id === dog.id).length > 0 && (
            <div className="mt-4 border-t border-line-soft pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                Records on file
              </p>
              <ul className="mt-2 space-y-1.5">
                {data.documents
                  .filter((d) => d.dog_id === dog.id)
                  .map((doc) => (
                    <li key={doc.id} className="flex items-center gap-2 text-xs">
                      <span className="text-ink-3">
                        {doc.created_at ? prettyDateKey(doc.created_at.slice(0, 10)) : ""}
                      </span>
                      <a
                        href={doc.data}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate font-medium text-accent-600 hover:underline"
                      >
                        {doc.file_name || "Vaccination record"}
                      </a>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </section>
      ))}

      {!data.dogs.length && (
        <p className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink-3">
          We do not have a dog on file for you yet.
        </p>
      )}
    </div>
  );
}

function VaccineRow({
  label,
  expiresOn,
  today,
}: {
  label: string;
  expiresOn: string | null;
  today: string;
}) {
  const state = !expiresOn ? "missing" : expiresOn < today ? "expired" : "ok";
  return (
    <li className="flex items-baseline gap-3 text-sm">
      <span className="w-32 shrink-0 text-ink-2">{label}</span>
      <span
        className={
          state === "expired"
            ? "font-medium text-rose-600"
            : state === "missing"
              ? "text-ink-3"
              : "text-ink-2"
        }
      >
        {state === "missing"
          ? "Not on file"
          : state === "expired"
            ? `Expired ${prettyDateKey(expiresOn!)}`
            : `Good until ${prettyDateKey(expiresOn!)}`}
      </span>
    </li>
  );
}

/**
 * Sending in a new certificate.
 *
 * The file goes through fileToRecordJpeg exactly as it does on the
 * enrollment form: one JPEG under a byte budget, whatever went in, including
 * a PDF from the vet. It is then stored in the database row, behind the same
 * policies as the rest of the household. It does NOT go to the site-photos
 * bucket, which is world-readable and holds marketing images only.
 *
 * The dates are not asked for. Staff read them off the certificate and enter
 * them, which is the only version of this where the dates on the account and
 * the dates on the paper are known to agree.
 */
function Uploader({
  dogId,
  dogName,
  onUploaded,
}: {
  dogId: string;
  dogName: string;
  onUploaded: () => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [problem, setProblem] = useState("");

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setProblem("");
    setDone(false);
    try {
      const jpeg = await fileToRecordJpeg(file);
      await uploadVaccinationRecord(dogId, file.name, jpeg);
      setDone(true);
      await onUploaded();
    } catch (err) {
      console.error("Uploading the record failed:", err);
      setProblem("We could not read that file. A clear photo or a PDF from your vet works best.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-dashed border-line bg-surface-2 px-3.5 py-3">
      <label className="text-xs font-medium text-ink-2">
        Send us a new record for {dogName}
      </label>
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        onChange={pick}
        disabled={busy}
        className="mt-2 block w-full text-xs text-ink-3 file:mr-3 file:rounded-lg file:border-0 file:bg-accent-500 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-accent-ink"
      />
      <p className="mt-1.5 text-[11px] text-ink-3">
        A photo or a PDF is fine. We will read the dates off it and update the account.
      </p>
      {/* A vaccination record goes through a resize, and a PDF pulls down
          pdf.js first, so this is a real wait on a phone. The spinner is the
          part that says so. */}
      {busy && (
        <p className="mt-1.5">
          <BusyNote>Reading the file and sending it…</BusyNote>
        </p>
      )}
      {done && (
        <p className="mt-1.5 text-[11px] font-medium text-emerald-700">
          Got it — thank you. We will update the dates shortly.
        </p>
      )}
      {problem && <p className="mt-1.5 text-[11px] font-medium text-rose-600">{problem}</p>}
    </div>
  );
}
