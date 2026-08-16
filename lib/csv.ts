// Turning rows into a spreadsheet staff can open.
//
// Everything here runs in the browser: the data is already loaded to show on
// screen, so building the file client-side avoids a server round trip and any
// question of client details passing through a third service.

/** Columns that are megabytes of base64 and useless in a spreadsheet. */
const BLOB_COLUMNS = new Set(["photo_data", "signature_data", "file_data", "data"]);

/**
 * One cell.
 *
 * Three cases that bite if they are not handled:
 *
 *   * A leading =, +, - or @ makes Excel and Sheets treat the value as a
 *     formula. Client-supplied text lands in these files, so a note reading
 *     "=cmd|..." would execute on open. Prefixed with a quote, which
 *     spreadsheets strip on display.
 *   * Arrays (allergies, play_style) come back from Postgres as JS arrays and
 *     would stringify with commas, splitting into extra columns.
 *   * A value containing a quote, comma or newline has to be quoted, with
 *     inner quotes doubled.
 */
function cell(value: unknown): string {
  if (value == null) return "";
  let text: string;
  if (Array.isArray(value)) text = value.join("; ");
  else if (typeof value === "boolean") text = value ? "yes" : "no";
  else if (typeof value === "object") text = JSON.stringify(value);
  else text = String(value);

  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export interface CsvColumn<T> {
  key: string;
  /** Header text. Defaults to a prettified key. */
  label?: string;
  value?: (row: T) => unknown;
}

function pretty(key: string): string {
  return key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/**
 * Every column present across the rows, in first-seen order, minus the blobs.
 * Used by the "everything on file" exports so a column added to the database
 * later shows up without this file needing to know about it.
 */
export function columnsOf<T extends Record<string, unknown>>(rows: T[]): CsvColumn<T>[] {
  const seen: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (BLOB_COLUMNS.has(key)) continue;
      if (!seen.includes(key)) seen.push(key);
    }
  }
  return seen.map((key) => ({ key, label: pretty(key) }));
}

export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns?: CsvColumn<T>[]
): string {
  const cols = columns ?? columnsOf(rows);
  const header = cols.map((c) => cell(c.label ?? pretty(c.key))).join(",");
  const body = rows.map((row) =>
    cols.map((c) => cell(c.value ? c.value(row) : row[c.key])).join(",")
  );
  return [header, ...body].join("\r\n");
}

/**
 * Hands the file to the browser.
 *
 * The BOM is not decoration: without it Excel on Windows reads the file as
 * the local codepage and mangles every accented name.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick so Safari has read it before it disappears.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "dogs-2026-08-10.csv" */
export function stampedName(stem: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${stem}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.csv`;
}
