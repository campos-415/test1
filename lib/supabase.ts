import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Add them to .env.local (see README)."
      );
    }
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        // Next replaces the global fetch, and in a server component an
        // un-annotated GET is cached with revalidate 31536000 — a year.
        // The site layout reads settings on the server, so the first render
        // froze them: turning the built-in website off in Settings wrote to
        // the database and changed nothing on screen, because the layout kept
        // being handed the snapshot from server start.
        //
        // Nothing behind this client is ever safe to serve from a cache. It
        // is the live database: dogs sign in, prices change, staff save
        // settings mid-shift.
        fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
      },
      auth: {
        // The lobby iPad signs in once and must stay signed in across
        // reboots, so the session is persisted and refreshed in the
        // background rather than expiring mid-shift.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
