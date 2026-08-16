// Vaccine expiry status, shared by the dog profile's vaccine table and the
// DogLink hover card so both describe a dog's records the same way.

import { parseDateKey, todayKey } from "@/lib/dates";
import { Vaccination, VACCINES } from "@/types";

export type VaccineStatus = "missing" | "expired" | "expiring" | "valid";

// How far ahead of expiry a record starts warning.
export const EXPIRING_SOON_DAYS = 30;

export function vaccineStatus(record: Vaccination | undefined): VaccineStatus {
  if (!record?.expires_on) return "missing";
  const today = parseDateKey(todayKey());
  const expires = parseDateKey(record.expires_on);
  const days = Math.round((expires.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return "expired";
  if (days <= EXPIRING_SOON_DAYS) return "expiring";
  return "valid";
}

export const STATUS_LABELS: Record<VaccineStatus, string> = {
  missing: "No record",
  expired: "Expired",
  expiring: "Expiring soon",
  valid: "Up to date",
};

export const STATUS_CLASSES: Record<VaccineStatus, string> = {
  missing: "bg-slate-100 text-slate-500",
  expired: "bg-rose-100 text-rose-700",
  expiring: "bg-amber-100 text-amber-800",
  valid: "bg-emerald-100 text-emerald-700",
};

// The single worst status across every vaccine on the fixed list — what the
// hover card and profile header summarize a dog with.
export function overallVaccineStatus(records: Vaccination[]): VaccineStatus {
  const order: VaccineStatus[] = ["expired", "missing", "expiring", "valid"];
  const statuses = VACCINES.map((v) => vaccineStatus(records.find((r) => r.vaccine === v.key)));
  return order.find((s) => statuses.includes(s)) ?? "valid";
}
