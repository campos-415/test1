import { redirect } from "next/navigation";

// Renamed to /day-report — the end-of-day report. Kept so bookmarks, the lobby tablet and links
// inside already-printed sheets keep working.
//
// The query string has to be carried across by hand: redirect() only takes
// a path, and dropping it would send /report?boardingId=… to a stay report
// with no stay selected — the exact link printed on every stay sheet.
export default function DailyRedirect({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams ?? {})) {
    if (Array.isArray(v)) v.forEach((one) => qs.append(k, one));
    else if (v !== undefined) qs.set(k, v);
  }
  const query = qs.toString();
  redirect(query ? `/day-report?${query}` : "/day-report");
}
