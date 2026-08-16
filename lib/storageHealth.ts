// How full the database is getting, and what is filling it.
//
// The rows themselves are never the problem: a busy daycare writes tens of
// thousands of sign-ins a year at well under a kilobyte each, which is tens
// of megabytes a year. What fills a database here is images — photos,
// signed waivers and uploaded vaccination records are base64 strings stored
// inside the rows rather than in file storage, and one record can be a third
// of a megabyte on its own.
//
// The point of measuring is that the ceiling arrives without warning
// otherwise: everything is fast until the day enough dogs have been
// photographed, and then every page that loads the whole book is downloading
// tens of megabytes.
//
// Row counts are exact and cost nothing — PostgREST returns them in a header
// without sending any rows. Blob sizes are ESTIMATED from a small sample,
// because measuring them exactly would mean downloading every image to add up
// its length, which is the very thing being warned about.

import { getSupabase } from "@/lib/supabase";

/** Rows sampled per table to estimate an average blob size. */
const SAMPLE = 12;

export interface TableHealth {
  table: string;
  label: string;
  rows: number;
  /** Estimated bytes held in image columns on this table. */
  blobBytes: number;
  /** How many of the sampled rows actually carried an image. */
  sampleWithBlob: number;
  sampleSize: number;
}

export interface StorageHealth {
  tables: TableHealth[];
  totalRows: number;
  totalBlobBytes: number;
  /** Free-tier database allowance, for the "how close am I" bar. */
  limitBytes: number;
  measuredAt: string;
}

const FREE_TIER_BYTES = 500 * 1024 * 1024;

// Which columns on each table hold images. Everything else is small enough
// that counting it would be noise.
const BLOB_COLUMNS: { table: string; label: string; columns: string[] }[] = [
  { table: "dogs", label: "Dogs", columns: ["photo_data", "signature_data"] },
  { table: "dog_docs", label: "Vaccination records", columns: ["data"] },
  { table: "signins", label: "Visits", columns: ["signature_data"] },
  { table: "boardings", label: "Boarding reservations", columns: ["photo_data"] },
  { table: "enrollments", label: "Enrollment forms", columns: ["data"] },
  { table: "site_photos", label: "Website photos", columns: ["data"] },
];

// No images, but worth showing so the row counts add up to the whole app.
const COUNT_ONLY: { table: string; label: string }[] = [
  { table: "owners", label: "Owners" },
  { table: "packages", label: "Packages" },
  { table: "package_uses", label: "Package days used" },
  { table: "payments", label: "Payments" },
  { table: "vaccinations", label: "Vaccination dates" },
  { table: "walk_logs", label: "Walk logs" },
  { table: "boarding_requests", label: "Boarding requests" },
];

/** Exact row count, from the Content-Range header — no rows are transferred. */
async function countRows(table: string): Promise<number | null> {
  try {
    const supabase = getSupabase();
    const { count, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true });
    // A table that does not exist is not an error worth showing — the app
    // treats several as optional.
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

async function sampleBlobBytes(
  table: string,
  columns: string[]
): Promise<{ avg: number; withBlob: number; size: number }> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from(table)
      .select(columns.join(", "))
      .limit(SAMPLE);
    if (error || !data) return { avg: 0, withBlob: 0, size: 0 };
    const rows = data as unknown as Record<string, string | null>[];
    let total = 0;
    let withBlob = 0;
    for (const row of rows) {
      const bytes = columns.reduce((sum, c) => sum + (row[c]?.length ?? 0), 0);
      total += bytes;
      if (bytes > 0) withBlob += 1;
    }
    return { avg: rows.length ? total / rows.length : 0, withBlob, size: rows.length };
  } catch {
    return { avg: 0, withBlob: 0, size: 0 };
  }
}

export async function loadStorageHealth(): Promise<StorageHealth> {
  const withBlobs = await Promise.all(
    BLOB_COLUMNS.map(async ({ table, label, columns }) => {
      const [rows, sample] = await Promise.all([
        countRows(table),
        sampleBlobBytes(table, columns),
      ]);
      if (rows === null) return null;
      return {
        table,
        label,
        rows,
        // The sample average across every row. Rough by construction, which
        // is why it is labelled as an estimate wherever it is shown.
        blobBytes: Math.round(sample.avg * rows),
        sampleWithBlob: sample.withBlob,
        sampleSize: sample.size,
      } satisfies TableHealth;
    })
  );

  const countsOnly = await Promise.all(
    COUNT_ONLY.map(async ({ table, label }) => {
      const rows = await countRows(table);
      if (rows === null) return null;
      return { table, label, rows, blobBytes: 0, sampleWithBlob: 0, sampleSize: 0 } satisfies TableHealth;
    })
  );

  const tables = [...withBlobs, ...countsOnly].filter((t): t is TableHealth => t !== null);

  return {
    tables: tables.sort((a, b) => b.blobBytes - a.blobBytes || b.rows - a.rows),
    totalRows: tables.reduce((n, t) => n + t.rows, 0),
    totalBlobBytes: tables.reduce((n, t) => n + t.blobBytes, 0),
    limitBytes: FREE_TIER_BYTES,
    measuredAt: new Date().toISOString(),
  };
}

export function formatBytes(n: number): string {
  if (n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
