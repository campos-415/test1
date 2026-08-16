import { expect, test as setup } from "@playwright/test";
import fs from "node:fs";

// Signs in once per run and saves the sessions the gated specs reuse.
//
// The passwords are yours and stay yours: they are read from .env.e2e, which
// is gitignored and which you fill in. Nothing here logs them, and a failure
// message names the variable rather than its value.
//
// Two accounts, because the app has two doors. The staff gate gets a real
// person's account; the kiosk gate gets the lobby iPad's, which has the
// narrow `kiosk` role and cannot do anything else.

const STAFF_STATE = ".auth/staff.json";
const KIOSK_STATE = ".auth/kiosk.json";

function credentials(role: "STAFF" | "KIOSK") {
  const username = process.env[`E2E_${role}_USERNAME`];
  const password = process.env[`E2E_${role}_PASSWORD`];
  if (!username || !password) {
    throw new Error(
      `Missing E2E_${role}_USERNAME or E2E_${role}_PASSWORD. Copy .env.e2e.example ` +
        `to .env.e2e and fill it in — see docs/E2E-TESTS.md.`
    );
  }
  return { username, password };
}

/**
 * Fills whichever sign-in form is on screen and waits for it to give way.
 *
 * Both gates render the same two fields and a button, and both replace
 * themselves with the page behind on success — so "the username box is gone"
 * is the signal, rather than a URL change that never happens.
 */
async function signIn(page: import("@playwright/test").Page, role: "STAFF" | "KIOSK") {
  const { username, password } = credentials(role);
  const user = page.getByPlaceholder("Username");
  await expect(user, `the ${role.toLowerCase()} sign-in form should be on screen`).toBeVisible();
  await user.fill(username);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    user,
    `sign-in as ${role.toLowerCase()} did not go through — check the credentials in .env.e2e`
  ).toBeHidden({ timeout: 30_000 });
}

setup("sign in as staff", async ({ page }) => {
  fs.mkdirSync(".auth", { recursive: true });
  // /dashboard is behind StaffGate, so an unauthenticated visit renders the
  // staff sign-in form in place. That is also what the app relies on when
  // somebody signs out — see STAFF_SIGNED_OUT_HREF.
  await page.goto("/dashboard");
  await signIn(page, "STAFF");
  await page.context().storageState({ path: STAFF_STATE });
});

setup("sign in as the kiosk", async ({ page }) => {
  fs.mkdirSync(".auth", { recursive: true });
  await page.goto("/kiosk");
  await signIn(page, "KIOSK");
  await page.context().storageState({ path: KIOSK_STATE });
});
