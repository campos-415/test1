import { getSupabase } from "@/lib/supabase";

// Reads a whole table, not the first page of it.
//
// PostgREST returns 1000 rows unless told otherwise, and a query that asks
// for no limit gets that silently — no error, no marker, just fewer rows than
// there are. That is survivable for a list somebody scrolls, and not
// survivable for a total: a balance computed from the first 1000 of 1400
// visits is not a smaller number, it is a wrong one, and nothing on screen
// says so.
//
// Anything feeding a sum, a balance or an export should come through here.

const PAGE = 1000;

export async function fetchAll<T>(
  table: string,
  columns = "*",
  refine?: (q: ReturnType<ReturnType<typeof getSupabase>["from"]>) => unknown
): Promise<T[]> {
  const supabase = getSupabase();
  const out: T[] = [];

  for (let from = 0; ; from += PAGE) {
    let query = supabase.from(table).select(columns).range(from, from + PAGE - 1);
    if (refine) query = refine(query as never) as typeof query;

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data as T[]) ?? [];
    out.push(...rows);
    // A short page is the last page. Stopping on an exact multiple would cost
    // one wasted round trip and nothing else.
    if (rows.length < PAGE) break;
  }

  return out;
}
