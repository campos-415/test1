import { expect, test } from "@playwright/test";
import { submitEnrollment, uniqueName, uniquePhone } from "./helpers";

// The public enrollment form — the first thing a new client ever touches, and
// the only screen in the app a stranger can reach. It runs with no session at
// all, which is the point: if this needs a sign-in, nobody can enrol.

test.describe("the public enrollment form", () => {
  test("takes a submission from a stranger and says so", async ({ page }) => {
    const phone = uniquePhone();
    const dogName = uniqueName("Spec");

    await submitEnrollment(page, { phone, dogName });

    // The thank-you is asserted inside the helper. What matters here is that
    // it did not quietly need an account to get there.
    await expect(page.getByText(/review the profile/i)).toBeVisible();
  });

  test("refuses to submit until the required answers are given", async ({ page }) => {
    // A form that submits half-filled puts an unassessed dog into the review
    // queue with no vaccination record and no signature.
    await page.goto("/enroll");
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByText(/Thanks — we.ve got it/)).toBeHidden();
    // And it says what is missing rather than failing silently.
    await expect(page.locator("body")).toContainText(/please|required|accept|sign/i);
  });
});
