import { NextRequest, NextResponse } from "next/server";

// -----------------------------------------------------------------------
// Setting up a client account from an invitation link.
//
// This runs on the server for one reason: the email address must come from
// the owner record rather than from whoever is at the keyboard.
//
// The first version did it in the browser. It asked for an email address,
// called supabase.auth.signUp with whatever was typed, and then claimed the
// household with the token. Nothing tied the two together, so a forwarded
// link could be claimed by whoever received it, under their own address -
// and the argument this whole design rests on (the token was emailed to the
// address on file, so holding it proves control of that address) stopped
// being true the moment somebody hit forward.
//
// So the browser never supplies the address and is never shown it. It sends
// a token and a password; the server reads the address off the record.
//
// SECRET KEY. This is the only place in the application that uses
// SUPABASE_SECRET_KEY, and it must stay that way. The key bypasses Row
// Level Security completely - every policy written in rls-lockdown.sql is
// inert in front of it - so the two database functions it calls are narrow
// on purpose, are granted to service_role alone, and do the deciding
// themselves. This route decides nothing about who may claim what.
//
// Without the key set the route returns a clear 503 rather than half
// working, because an install where clients cannot set up accounts should
// say so rather than fail at the last step.
// -----------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
// The ordinary browser-safe key, used here for the one call that is an
// ordinary sign-in. Deliberately not the secret key: a session minted with
// that would carry service_role and bypass every policy in the app.
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Long enough to be worth having, short enough that nobody gives up. The
// database never sees it: Supabase Auth hashes it.
const MIN_PASSWORD = 8;

const TIMEOUT_MS = 15_000;

interface ClaimPayload {
  token?: string;
  password?: string;
}

/** A Supabase REST or Auth call, with the secret key and a timeout. */
async function callSupabase(
  path: string,
  init: { method: string; body?: unknown }
): Promise<{ status: number; json: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}${path}`, {
      method: init.method,
      headers: {
        apikey: SECRET_KEY as string,
        Authorization: `Bearer ${SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: NextRequest) {
  if (!SUPABASE_URL || !SECRET_KEY) {
    console.error("SUPABASE_SECRET_KEY is not set, so client accounts cannot be created.");
    return NextResponse.json(
      { error: "Accounts are not set up on this site yet. Please let us know." },
      { status: 503 }
    );
  }

  let payload: ClaimPayload;
  try {
    payload = (await request.json()) as ClaimPayload;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const token = (payload.token ?? "").trim();
  const password = payload.password ?? "";

  if (!token) {
    return NextResponse.json({ error: "That link is missing its invitation." }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json(
      { error: `Choose a password of at least ${MIN_PASSWORD} characters.` },
      { status: 400 }
    );
  }

  // 1. What address was this invitation sent to? Null covers unknown, used
  //    and expired alike - the client is told one thing for all three, so
  //    the route cannot be used to find out which tokens are real.
  const lookup = await callSupabase("/rest/v1/rpc/invite_email_for_token", {
    method: "POST",
    body: { p_token: token },
  });

  const email = typeof lookup.json === "string" ? lookup.json : null;
  if (lookup.status >= 400 || !email) {
    return NextResponse.json(
      { error: "That invitation is not valid any more. Ask us to send a new one." },
      { status: 400 }
    );
  }

  // 2. Create the account, with the address off the record and never one
  //    the browser chose. email_confirm is set because the invitation
  //    itself was the confirmation: it only reached them at that address.
  const created = await callSupabase("/auth/v1/admin/users", {
    method: "POST",
    body: { email, password, email_confirm: true },
  });

  if (created.status >= 400) {
    const message = String(
      (created.json as { msg?: string; message?: string } | null)?.msg ??
        (created.json as { message?: string } | null)?.message ??
        ""
    ).toLowerCase();
    if (message.includes("already") || created.status === 422) {
      // They have signed up before, or staff invited them twice. Sending
      // them to sign in is right: the claim page finishes the binding on
      // its own once there is a session.
      return NextResponse.json(
        {
          error:
            "There is already an account for the address we have on file. Sign in below and we will finish setting things up.",
          signInInstead: true,
        },
        { status: 409 }
      );
    }
    console.error("Creating the client account failed:", created.json);
    return NextResponse.json(
      { error: "We could not set that up just now. Please let us know." },
      { status: 502 }
    );
  }

  const userId = (created.json as { id?: string } | null)?.id;
  if (!userId) {
    console.error("Supabase created an account but returned no id:", created.json);
    return NextResponse.json({ error: "We could not set that up just now." }, { status: 502 });
  }

  // 3. Bind it to the household. The database re-checks the token here
  //    rather than trusting step 1 - between the two calls it could have
  //    been used - and refuses a staff account or one already attached
  //    somewhere.
  const bound = await callSupabase("/rest/v1/rpc/bind_owner_account", {
    method: "POST",
    body: { p_token: token, p_user_id: userId },
  });

  if (bound.status >= 400) {
    // The account exists and has no household. That is the orphan this
    // route is meant not to leave behind, so it goes.
    await callSupabase(`/auth/v1/admin/users/${userId}`, { method: "DELETE" }).catch(() => {});
    console.error("Binding the household failed, so the new account was removed:", bound.json);
    return NextResponse.json(
      { error: "That invitation is not valid any more. Ask us to send a new one." },
      { status: 400 }
    );
  }

  // 4. Hand back a session rather than the address.
  //
  // The browser has a password but no email, and cannot sign itself in
  // without one. Returning the address would work and would tell whoever
  // opened the link which address the invitation went to, so instead the
  // sign-in happens here - with the PUBLISHABLE key, exactly as the browser
  // would have done it - and the session goes back for setSession.
  const signedIn = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY as string,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });

  if (!signedIn.ok) {
    // The account and the household are both fine at this point, so this is
    // not a failure of the claim - only of the convenience. Saying so lets
    // them carry on rather than trying again and hitting "already exists".
    console.error("Signed up but could not sign in:", await signedIn.text());
    return NextResponse.json({ ok: true, signInYourself: true });
  }

  const session = (await signedIn.json()) as { access_token?: string; refresh_token?: string };
  return NextResponse.json({
    ok: true,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
}
