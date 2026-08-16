import { NextRequest, NextResponse } from "next/server";

// -----------------------------------------------------------------------
// Adding somebody who works here.
//
// Until this existed, hiring meant giving the owner Supabase dashboard
// credentials so they could create the account themselves. That is not
// "add a staff member" access - it is read every customer record, run any
// SQL, drop any table. The most routine job in the business needed the most
// dangerous login in it.
//
// SECRET KEY. This is the second place in the application that uses
// SUPABASE_SECRET_KEY, after /api/claim, and the reasoning is the same: the
// key bypasses Row Level Security completely, so it is used for exactly one
// thing here - creating the auth account, which no policy can express - and
// nothing else.
//
// WHO IS ALLOWED. Not decided here. The route takes the caller's own access
// token and asks the database, through is_owner_admin(), which already means
// "owner_admin AND multi-factor satisfied". A role sent from the browser is
// not consulted, because the browser is not a source of truth about what the
// browser may do.
//
// THE ROLE ROW is written with the caller's token, not the secret key. Two
// reasons: the manage-roles policy in rls-lockdown.sql gets to refuse it,
// and the audit trigger records the actor from the session - so the log says
// which owner hired whom, rather than "service_role".
//
// PASSWORDS. A generated one, returned once, never stored anywhere by this
// application. An invite email would be nicer but cannot work here: the
// kiosk and front desk accounts use @staff.local addresses, which are not
// mailboxes, so there is nowhere for a link to go.
// -----------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const TIMEOUT_MS = 15_000;
const ROLES = ["owner_admin", "manager", "employee", "kiosk"] as const;
type Role = (typeof ROLES)[number];

/**
 * A readable password that is still worth having.
 *
 * No I, l, 1, O or 0: this gets read aloud across a front desk or written on
 * a scrap of paper once, and a password nobody can transcribe is a password
 * that becomes "password".
 */
function generatePassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(16);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return [
    chars.slice(0, 4).join(""),
    chars.slice(4, 8).join(""),
    chars.slice(8, 12).join(""),
    chars.slice(12, 16).join(""),
  ].join("-");
}

async function withTimeout(path: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${SUPABASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: NextRequest) {
  if (!SUPABASE_URL || !SECRET_KEY || !ANON_KEY) {
    console.error("SUPABASE_SECRET_KEY is not set, so staff accounts cannot be created.");
    return NextResponse.json(
      { error: "This deployment cannot create accounts. Ask whoever set it up." },
      { status: 503 }
    );
  }

  // The caller's own session, forwarded by the browser.
  const authHeader = request.headers.get("authorization") ?? "";
  const callerToken = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!callerToken) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  let payload: { email?: string; role?: string };
  try {
    payload = (await request.json()) as { email?: string; role?: string };
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const email = (payload.email ?? "").trim().toLowerCase();
  const role = (payload.role ?? "") as Role;

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Enter an email address." }, { status: 400 });
  }
  if (!ROLES.includes(role)) {
    return NextResponse.json({ error: "Choose a role." }, { status: 400 });
  }

  // ---- Is the caller allowed? The database answers, not this route. ----
  const gate = await withTimeout("/rest/v1/rpc/is_owner_admin", {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${callerToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const allowed = gate.ok && (await gate.json()) === true;
  if (!allowed) {
    return NextResponse.json(
      {
        error:
          "Adding someone needs an owner account with two-factor sign-in completed this session.",
      },
      { status: 403 }
    );
  }

  // ---- Create the account. Only the secret key can do this. ----
  const password = generatePassword();
  const created = await withTimeout("/auth/v1/admin/users", {
    method: "POST",
    headers: {
      apikey: SECRET_KEY,
      Authorization: `Bearer ${SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    // Confirmed on creation: nobody is going to click a link in a
    // @staff.local mailbox that does not exist.
    body: JSON.stringify({ email, password, email_confirm: true }),
  });

  const createdBody = (await created.json().catch(() => null)) as { id?: string; msg?: string } | null;
  if (!created.ok || !createdBody?.id) {
    const already = created.status === 422 || created.status === 409;
    return NextResponse.json(
      {
        error: already
          ? "There is already an account with that address. Give it a role in the list below instead."
          : `Could not create that account. ${createdBody?.msg ?? ""}`.trim(),
      },
      { status: already ? 409 : 502 }
    );
  }

  // ---- Give it the role, as the caller, so the policy and the audit
  //      trigger both see who actually did this. ----
  const roleRow = await withTimeout("/rest/v1/staff_roles", {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${callerToken}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ user_id: createdBody.id, role, note: "Added from Settings → Security" }),
  });

  if (!roleRow.ok) {
    // An account that exists but can do nothing, created by someone who
    // thought they had hired a person, is worse than a failure. Undo it -
    // the same rollback /api/claim does when the second half fails.
    await withTimeout(`/auth/v1/admin/users/${createdBody.id}`, {
      method: "DELETE",
      headers: { apikey: SECRET_KEY, Authorization: `Bearer ${SECRET_KEY}` },
    }).catch(() => {});
    return NextResponse.json(
      { error: "The account was refused a role, so it has been removed. Nothing was changed." },
      { status: 502 }
    );
  }

  // Shown once, by the screen that asked. Never stored by this application:
  // Supabase Auth holds only its hash.
  return NextResponse.json({ email, role, password });
}
