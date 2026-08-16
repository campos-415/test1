import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  DogDraft,
  EnrollmentDraft,
  OwnerDraft,
  emptyDog,
  hydrateDraft,
  stageTwoDogPatch,
  stageTwoOwnerPatch,
  validateEnrollmentDetails,
} from "@/lib/enrollment";
import { Dog, Enrollment } from "@/types";
import { activeDogs } from "@/lib/retire";

// -----------------------------------------------------------------------
// The public half of two-stage enrollment: reading a household's details
// form by its token, and saving it.
//
// Runs server-side because it has to. The anon key in the public bundle may
// insert an enrollment and nothing more (rls-lockdown.sql), so a browser
// holding a token can neither read the submission back nor touch the dog
// profiles it belongs to. Nor can that be fixed with a policy: RLS sees the
// row, not the filter, so "rows with a token" is the narrowest an anon
// select could be — which is every applicant's name, phone and signature.
//
// So the token is checked here, against the service key, and what it buys
// is deliberately small:
//
//   - reading returns stage one's answers without the signature and without
//     the uploaded vaccination records;
//   - writing goes through a fixed whitelist of stage-two columns. Nothing
//     a link-holder posts can change a vaccination date, a dog's name, the
//     household's email, or the enrollment's status.
//
// SETUP: SUPABASE_SECRET_KEY in .env.local (Supabase → Settings → API), and
// two-stage-enrollment-migration.sql run once. Without the key this route
// answers "not-configured" and the details link explains itself rather than
// failing blankly.
// -----------------------------------------------------------------------

const SELECTED = "id, phone, owner_name, last_name, dog_names, status, data, details_submitted_at";

function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// A uuid, and nothing else, reaches a query.
function cleanToken(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t) ? t : "";
}

async function rowForToken(
  db: SupabaseClient,
  token: string
): Promise<{ row?: Enrollment; error?: NextResponse }> {
  const { data, error } = await db
    .from("enrollments")
    .select(SELECTED)
    .eq("details_token", token)
    .maybeSingle();
  if (error) {
    const missingColumn = error.code === "42703" || /does not exist/i.test(error.message);
    if (missingColumn) {
      console.error(
        "enrollments.details_token is missing — run two-stage-enrollment-migration.sql"
      );
      return { error: NextResponse.json({ error: "not-configured" }, { status: 503 }) };
    }
    console.error("Looking up a details token failed:", error);
    return { error: NextResponse.json({ error: "unavailable" }, { status: 500 }) };
  }
  if (!data) return { error: NextResponse.json({ error: "not-found" }, { status: 404 }) };
  return { row: data as unknown as Enrollment };
}

export async function GET(req: NextRequest) {
  const token = cleanToken(req.nextUrl.searchParams.get("token"));
  if (!token) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const db = serviceClient();
  if (!db) {
    console.error("SUPABASE_SECRET_KEY is not set — the details form cannot be opened.");
    return NextResponse.json({ error: "not-configured" }, { status: 503 });
  }

  const { row, error } = await rowForToken(db, token);
  if (error) return error;

  const draft = hydrateDraft(row!);
  return NextResponse.json({
    form: {
      phone: row!.phone,
      owner_name: row!.owner_name,
      last_name: row!.last_name,
      status: row!.status,
      details_submitted_at: row!.details_submitted_at ?? null,
      draft: {
        ...draft,
        // The signature rides along inside `data`, and the uploaded record
        // inside each dog. Neither is shown or edited by the details form,
        // and both are the heaviest and most personal part of a submission,
        // so neither leaves the server.
        signature: undefined,
        dogs: draft.dogs.map((d) => ({ ...d, doc: null })),
      },
    },
  });
}

export async function POST(req: NextRequest) {
  let body: { token?: string; owner?: Partial<OwnerDraft>; dogs?: Partial<DogDraft>[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const token = cleanToken(body.token);
  if (!token) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const db = serviceClient();
  if (!db) {
    console.error("SUPABASE_SECRET_KEY is not set — the details form cannot be saved.");
    return NextResponse.json({ error: "not-configured" }, { status: 503 });
  }

  const { row, error } = await rowForToken(db, token);
  if (error) return error;
  if (row!.status !== "approved")
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  // Already in. Not an error — somebody clicked the same email twice — and
  // the page shows what was submitted rather than a blank form.
  if (row!.details_submitted_at)
    return NextResponse.json({ updated: [], unmatched: [], alreadySubmitted: true });

  // The stored submission is the base; the request may only overwrite the
  // stage-two answers on top of it. This is what stops a link-holder
  // rewriting a vaccination expiry or a dog's name by posting a fuller draft.
  const stored = hydrateDraft(row!);
  const posted = hydrateDraft({
    data: { owner: body.owner ?? {}, dogs: body.dogs ?? [] },
    dog_names: row!.dog_names,
  });
  const merged: EnrollmentDraft = {
    ...stored,
    owner: { ...stored.owner, ...stageTwoOwnerDraft(posted.owner) },
    dogs: stored.dogs.map((dog) => {
      const from = posted.dogs.find(
        (d) => d.dog_name.trim().toLowerCase() === dog.dog_name.trim().toLowerCase()
      );
      return from ? { ...dog, ...stageTwoDogDraft(from) } : dog;
    }),
  };

  const problem = validateEnrollmentDetails(merged);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const phone = row!.phone.trim();
  const { error: ownerError } = await db
    .from("owners")
    .upsert({ phone, ...stageTwoOwnerPatch(merged.owner) }, { onConflict: "phone" });
  if (ownerError) {
    console.error("Saving the household details failed:", ownerError);
    return NextResponse.json({ error: "unavailable" }, { status: 500 });
  }

  // Merges, never creates. By now the enrollment has been approved and the
  // dogs exist, so a name with no match means staff renamed or removed it —
  // and a public form that could conjure a dog nobody approved would undo
  // the point of the review queue.
  // select("*") rather than a column list because this has to keep working on
  // an install that has not run dog-retire-migration.sql — asking for
  // retired_at where it does not exist would fail the whole query and take
  // the public details form down with it. One household is a few rows.
  const { data: existingRows, error: dogsError } = await db
    .from("dogs")
    .select("*")
    .eq("phone", phone);
  if (dogsError) {
    console.error("Looking up the household's dogs failed:", dogsError);
    return NextResponse.json({ error: "unavailable" }, { status: 500 });
  }
  // Retired dogs are excluded, and not only because they need no answers:
  // this map is keyed by name, so a household with a retired Buki and the
  // Buki they have now would keep whichever came back last and write the
  // details onto that one. Skipping the retired row makes it the live dog
  // every time.
  const existing = new Map(
    activeDogs((existingRows as Dog[]) ?? []).map((d) => [
      d.dog_name.trim().toLowerCase(),
      d.id as string,
    ])
  );

  const updated: string[] = [];
  const unmatched: string[] = [];
  for (const dog of merged.dogs) {
    const name = dog.dog_name.trim();
    const id = existing.get(name.toLowerCase());
    if (!id) {
      unmatched.push(name);
      continue;
    }
    const { error: updateError } = await db
      .from("dogs")
      .update(stageTwoDogPatch(dog, merged.owner))
      .eq("id", id);
    if (updateError) {
      console.error(`Saving details for ${name} failed:`, updateError);
      return NextResponse.json({ error: "unavailable" }, { status: 500 });
    }
    updated.push(name);
  }

  // The profiles first, then the submission — the order approving uses, and
  // for the same reason. A failure part-way leaves the link live and the
  // form re-submittable rather than closed with nothing written behind it.
  const { error: rowError } = await db
    .from("enrollments")
    .update({
      // Merged over what stage one stored, so the signature and the uploaded
      // records survive untouched.
      data: { ...((row!.data as object) ?? {}), owner: merged.owner, dogs: merged.dogs, stage: 2 },
      stage: 2,
      details_submitted_at: new Date().toISOString(),
    })
    .eq("id", row!.id);
  if (rowError) {
    console.error("Marking the details form as submitted failed:", rowError);
    return NextResponse.json({ error: "unavailable" }, { status: 500 });
  }

  return NextResponse.json({ updated, unmatched });
}

// The draft fields the details form owns. Anything else in the request body
// is dropped on the floor rather than merged.
function stageTwoOwnerDraft(o: OwnerDraft): Partial<OwnerDraft> {
  const { address, city, state, zip } = o;
  const { emergency_name, emergency_phone, emergency_relation } = o;
  const { authorized_pickup, vet_name, vet_phone, vet_address, heard_about } = o;
  return {
    address,
    city,
    state,
    zip,
    emergency_name,
    emergency_phone,
    emergency_relation,
    authorized_pickup,
    vet_name,
    vet_phone,
    vet_address,
    heard_about,
  };
}

function stageTwoDogDraft(d: DogDraft): Partial<DogDraft> {
  const empty = emptyDog();
  const keys: (keyof DogDraft)[] = [
    "flea_program",
    "dog_source",
    "growled",
    "growled_note",
    "bitten",
    "bitten_note",
    "climbed_fence",
    "fence_height",
    "dog_fight",
    "dog_fight_note",
    "health_problems",
    "health_notes",
    "activity_restrictions",
    "allergies",
    "sensitive_areas",
    "sensitive_areas_note",
    "behavior_traits",
    "play_style",
    "attendance_plan",
    "big_dog_response",
    "crate_trained",
    "kennel_trained",
    "package_interest",
  ];
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = d[key] ?? empty[key];
  return out as Partial<DogDraft>;
}
