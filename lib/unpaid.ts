// What is still owed, per individual charge, across the whole book.
//
// Colouring a price for whether it has been paid needs one thing that is
// easy to get wrong: payments settle oldest first, so whether a particular
// visit is paid depends on every charge older than it in that household.
// Ask the question with a partial set of charges — one day of sign-ins, one
// page of packages — and the answer is confidently wrong, which is worse
// than not colouring anything.
//
// So this loads the whole picture once and hands back a flat map of charge
// key to the amount still outstanding. A key that is absent is settled.

import { computeBalance, unpaidByKey } from "@/lib/billing";
import { fetchAll } from "@/lib/fetchAll";
import { Package, Payment, SignInRecord } from "@/types";

export type UnpaidIndex = Map<string, number>;

/** Only the columns the balance maths reads — sign-in rows carry signatures. */
const SIGNIN_COLUMNS = "id, dog_name, dog_id, phone, action, service_type, price, created_at";

export async function loadUnpaidIndex(): Promise<UnpaidIndex> {
  // Paged, not capped. Whether a charge is settled depends on every payment
  // and every older charge in that household, so a first-page answer would be
  // wrong rather than incomplete — it would show paid visits as unpaid the
  // moment the book passed a thousand priced pick-ups.
  const [signins, packages, payments] = await Promise.all([
    fetchAll<SignInRecord>("signins", SIGNIN_COLUMNS, (q) =>
      (q as never as { eq: (a: string, b: string) => { not: (a: string, b: string, c: null) => unknown } })
        .eq("action", "pick_up")
        .not("price", "is", null)
    ),
    fetchAll<Package>("packages"),
    fetchAll<Payment>("payments"),
  ]);

  return buildUnpaidIndex(signins, packages, payments);
}

/** Split out from the query so it can be tested without a database. */
export function buildUnpaidIndex(
  signins: SignInRecord[],
  packages: Package[],
  payments: Payment[]
): UnpaidIndex {
  interface Household {
    signins: SignInRecord[];
    packages: Package[];
    payments: Payment[];
  }
  const byPhone = new Map<string, Household>();
  // Digits only: one household writes its number three different ways across
  // a year of forms, and a balance split across those spellings would show
  // charges as unpaid that a payment on the same number already cleared.
  const bucket = (phone: string): Household => {
    const key = phone.replace(/\D/g, "");
    let found = byPhone.get(key);
    if (!found) byPhone.set(key, (found = { signins: [], packages: [], payments: [] }));
    return found;
  };

  for (const r of signins) if (r.phone) bucket(r.phone).signins.push(r);
  for (const r of packages) if (r.phone) bucket(r.phone).packages.push(r);
  for (const r of payments) if (r.phone) bucket(r.phone).payments.push(r);

  const out: UnpaidIndex = new Map();
  byPhone.forEach((h) => {
    unpaidByKey(computeBalance(h.signins, h.packages, h.payments)).forEach((amount, key) =>
      out.set(key, amount)
    );
  });
  return out;
}
