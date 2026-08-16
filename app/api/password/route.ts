import { NextRequest, NextResponse } from "next/server";

// -----------------------------------------------------------------------
// Changing your own password, with the old one required.
//
// WHY THIS IS NOT DONE IN THE BROWSER. supabase.auth.updateUser({ password })
// changes the password of whoever holds the session, and asks for nothing
// else. On a front desk that is signed in from open to close, that means
// anybody who walks past an unattended tablet can take the account over —
// and every audit entry after that names a person who did not do it.
//
// WHY NOT JUST RE-SIGN-IN CLIENT-SIDE. Calling signInWithPassword to check
// the old password replaces the caller's session with a fresh one at aal1.
// A manager who had satisfied two-factor would silently drop to a session
// that cannot export or delete, in the middle of changing their password.
// Verifying here, on a throwaway request, leaves their session untouched.
//
// SECRET KEY. The third place in the app that uses it, after /api/claim and
// /api/staff, for one thing only: setting the password once the old one has
// been proven. It never touches anything else.
//
// WHOSE PASSWORD. Never a parameter. The account is read from the caller's
// own token, so this route cannot be pointed at anybody else — there is no
// field in which to name a victim.
// -----------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const TIMEOUT_MS = 15_000;
const MIN_LENGTH = 8;

async function withTimeout(path: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${SUPABASE_URL}${path}`, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: NextRequest) {
  if (!SUPABASE_URL || !SECRET_KEY || !ANON_KEY) {
    console.error("SUPABASE_SECRET_KEY is not set, so passwords cannot be changed.");
    return NextResponse.json(
      { error: "This deployment cannot change passwords. Ask whoever set it up." },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const callerToken = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!callerToken) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  let payload: { currentPassword?: string; newPassword?: string };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const currentPassword = payload.currentPassword ?? "";
  const newPassword = (payload.newPassword ?? "").trim();

  if (!currentPassword) {
    return NextResponse.json({ error: "Enter your current password." }, { status: 400 });
  }
  if (newPassword.length < MIN_LENGTH) {
    return NextResponse.json(
      { error: `Use at least ${MIN_LENGTH} characters.` },
      { status: 400 }
    );
  }
  if (newPassword === currentPassword) {
    return NextResponse.json(
      { error: "That is the password you already have — pick a different one." },
      { status: 400 }
    );
  }

  // ---- Who is asking? Their token says, not the request body. ----------
  const whoRes = await withTimeout("/auth/v1/user", {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${callerToken}` },
  });
  if (!whoRes.ok) {
    return NextResponse.json({ error: "Sign in again and retry." }, { status: 401 });
  }
  const who = (await whoRes.json()) as { id?: string; email?: string };
  if (!who.id || !who.email) {
    return NextResponse.json({ error: "Sign in again and retry." }, { status: 401 });
  }

  // ---- Prove the old password, without disturbing the live session. ----
  //
  // A separate token request against the anon key. Whatever session this
  // mints is thrown away with the response; the caller's own session, and
  // the two-factor level it has reached, are never touched.
  const check = await withTimeout("/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: who.email, password: currentPassword }),
  });

  if (!check.ok) {
    // Deliberately the same answer whatever went wrong underneath. The
    // caller already knows who they are, so naming the reason only helps
    // somebody sitting at a tablet that is not theirs.
    return NextResponse.json({ error: "That is not your current password." }, { status: 403 });
  }

  // ---- Set the new one. -------------------------------------------------
  const update = await withTimeout(`/auth/v1/admin/users/${who.id}`, {
    method: "PUT",
    headers: {
      apikey: SECRET_KEY,
      Authorization: `Bearer ${SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: newPassword }),
  });

  if (!update.ok) {
    const detail = await update.text();
    console.error("Setting the new password failed:", detail);
    return NextResponse.json({ error: "Could not change the password." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
