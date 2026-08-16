// Two-factor authentication, using Supabase Auth as it comes.
//
// Nothing here implements TOTP. Supabase generates the secret, renders the
// QR code, checks the code against the clock with the drift window an
// authenticator app needs, and raises the session assurance level to aal2
// when a code is accepted. This file is a set of names for those calls plus
// the error handling the screens want; if it grew a base32 decoder or a HMAC
// we would be doing the one thing the development principle says not to.
//
// The database is what enforces it. mfa_ok in security-roles-migration.sql
// reads the aal claim out of the session token, and every manager or owner
// capability is written in terms of it, so a session that has not presented
// a code cannot export, cannot delete and cannot change a permission -
// whatever the interface allows.

import { getSupabase } from "@/lib/supabase";

/** What an authenticator app needs to add the account. */
export interface EnrolmentStart {
  factorId: string;
  /** An SVG data URL, ready to put in an img tag. Supabase renders it. */
  qrCode: string;
  /** The same secret as text, for typing in by hand when a camera will not read. */
  secret: string;
  uri: string;
}

export interface MfaFactor {
  id: string;
  friendlyName: string;
  verified: boolean;
}

export interface AssuranceLevel {
  /** Where this session is: aal1 is password only, aal2 has presented a code. */
  current: string | null;
  /** Where it could be. aal2 here with aal1 current means a code is owed. */
  next: string | null;
  /** True when this account has a factor and this session has not used it. */
  challengeOwed: boolean;
}

export interface MfaResult {
  ok: boolean;
  error?: string;
}

const FRIENDLY_NAME = "Authenticator app";

/**
 * Begins enrolment and hands back the QR code to show.
 *
 * The factor exists but is unverified until a code from it is accepted, so
 * an abandoned enrolment leaves a stray unverified factor. Those are cleaned
 * up on the next attempt rather than left to accumulate, because Supabase
 * refuses a second factor with the same friendly name and the second attempt
 * is exactly when somebody is trying again after a false start.
 */
export async function startEnrolment(): Promise<EnrolmentStart> {
  const supabase = getSupabase();

  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const factor of existing?.all ?? []) {
    if (factor.status !== "verified") {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: FRIENDLY_NAME,
  });
  if (error) throw error;
  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  };
}

/**
 * Finishes enrolment with the first code from the app.
 *
 * Succeeding here does two things at once: it marks the factor verified, and
 * it raises this session to aal2 - so somebody who has just set MFA up does
 * not then have to enter a second code to carry on working.
 */
export async function confirmEnrolment(factorId: string, code: string): Promise<MfaResult> {
  return challengeAndVerify(factorId, code, "That code was not accepted. Check the app and try the next one.");
}

/** Presents a code for an already-enrolled factor, raising the session to aal2. */
export async function verifyCode(factorId: string, code: string): Promise<MfaResult> {
  return challengeAndVerify(factorId, code, "That code was not accepted. Codes last 30 seconds - try the next one.");
}

async function challengeAndVerify(
  factorId: string,
  code: string,
  wrongCodeMessage: string
): Promise<MfaResult> {
  const cleaned = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleaned)) {
    return { ok: false, error: "Enter the six digits from your authenticator app." };
  }
  try {
    const { error } = await getSupabase().auth.mfa.challengeAndVerify({
      factorId,
      code: cleaned,
    });
    if (error) {
      // Supabase distinguishes a wrong code from a rate limit, and they need
      // different advice: one is try again, the other is wait.
      const message = error.message.toLowerCase();
      if (message.includes("rate") || message.includes("too many")) {
        return { ok: false, error: "Too many attempts. Wait a minute and try again." };
      }
      return { ok: false, error: wrongCodeMessage };
    }
    return { ok: true };
  } catch (e) {
    console.error("MFA verification failed:", e);
    return { ok: false, error: "Could not reach the server. Check the connection." };
  }
}

export async function listFactors(): Promise<MfaFactor[]> {
  const { data, error } = await getSupabase().auth.mfa.listFactors();
  if (error) throw error;
  return (data.all ?? []).map((f) => ({
    id: f.id,
    friendlyName: f.friendly_name ?? FRIENDLY_NAME,
    verified: f.status === "verified",
  }));
}

/** The verified factor to challenge against, or null if there is none yet. */
export async function verifiedFactor(): Promise<MfaFactor | null> {
  const factors = await listFactors();
  return factors.find((f) => f.verified) ?? null;
}

export async function assuranceLevel(): Promise<AssuranceLevel> {
  const { data, error } = await getSupabase().auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  const current = data.currentLevel ?? null;
  const next = data.nextLevel ?? null;
  return {
    current,
    next,
    challengeOwed: next === "aal2" && current === "aal1",
  };
}

/**
 * Removes a factor. The account can enrol again afterwards.
 *
 * Note what this does NOT do: it does not clear require_mfa on the account.
 * An owner turning MFA off for somebody is a permission change and belongs
 * in the roles editor where it is recorded as one, not a side effect of
 * somebody removing their own phone.
 */
export async function removeFactor(factorId: string): Promise<MfaResult> {
  try {
    const { error } = await getSupabase().auth.mfa.unenroll({ factorId });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    console.error("Removing the factor failed:", e);
    return { ok: false, error: "Could not reach the server." };
  }
}
