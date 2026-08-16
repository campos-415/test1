// Small shared date helpers — "YYYY-MM-DD" local date keys, used for
// boarding reservation ranges, meal log dates, and calendar grids so
// every page compares dates the same way (no UTC/timezone drift).

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function todayKey(): string {
  return dateKey(new Date());
}

// "YYYY-MM-DD" -> local Date at midnight (avoids the UTC shift you'd
// get from `new Date("YYYY-MM-DD")` in non-UTC timezones).
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function prettyDateKey(key: string): string {
  return parseDateKey(key).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// Inclusive list of every "YYYY-MM-DD" key from start to end.
export function dateRange(startKey: string, endKey: string): string[] {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  const out: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    out.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}
