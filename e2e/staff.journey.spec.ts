import { expect, test } from "@playwright/test";
import { submitEnrollment, uniqueName, uniquePhone } from "./helpers";

// The spine of the app, end to end, in one test.
//
// A stranger enrols → staff approve → the dog can check in at the kiosk →
// the dog is retired → it can no longer check in. Every step is done through
// the screen a person would use, and each one depends on the last, so this
// fails if any link in the chain breaks.
//
// It is deliberately one test rather than four. The steps are not independent
// — there is no approving without an enrollment — and four tests sharing
// setup would either repeat the whole chain or leave each other's data lying
// about.

test.describe.configure({ mode: "serial" });

test("a household enrols, is approved, checks in, and is retired", async ({ page, browser }) => {
  test.slow(); // several round trips to Supabase

  const phone = uniquePhone();
  const dogName = uniqueName("Journey");

  await test.step("a stranger submits the enrollment form", async () => {
    await submitEnrollment(page, { phone, dogName });
  });

  // The one card this run created. Scoped by test id rather than by a
  // Tailwind class, so restyling the queue does not break the test.
  const ourCard = () =>
    page.getByTestId("enrollment-card").filter({ hasText: dogName });

  await test.step("it lands in the review queue", async () => {
    await page.goto("/requests");
    await expect(ourCard()).toHaveCount(1);
    await expect(ourCard()).toContainText(phone);
  });

  await test.step("the reviewer sees no warning — this number is new", async () => {
    // "Already a client" belongs on a household that has dogs on file. A new
    // number showing it would send staff looking for a profile that is not
    // there.
    await expect(ourCard().getByText("Already a client")).toBeHidden();
  });

  await test.step("staff approve it, and the dog is ADDED", async () => {
    await ourCard().getByRole("button", { name: "Approve" }).click();
    // "Added" rather than "Updated": a new name on a new number is a new dog.
    await expect(page.getByText(new RegExp(`Added ${dogName}`))).toBeVisible();
  });

  await test.step("the kiosk can now find them by phone number", async () => {
    // A separate context, because the lobby iPad signs in as itself and has
    // only the kiosk role. Running this as the owner would prove nothing
    // about what the iPad can actually do.
    const kiosk = await browser.newContext({ storageState: ".auth/kiosk.json" });
    const kioskPage = await kiosk.newPage();
    try {
      await kioskPage.goto("/kiosk");
      await kioskPage.getByRole("button", { name: /Drop off/ }).click();
      await kioskPage.getByPlaceholder("(123) 456-7890").fill(phone.replace(/\D/g, ""));
      await expect(kioskPage.getByText(dogName).first()).toBeVisible();
      await expect(kioskPage.getByText(/No profile found/)).toBeHidden();
    } finally {
      await kiosk.close();
    }
  });

  await test.step("staff retire the dog", async () => {
    await page.goto(`/owners/${encodeURIComponent(phone)}`);
    await page.getByRole("link", { name: /Open profile/ }).first().click();
    await expect(page.getByRole("heading", { name: dogName })).toBeVisible();

    await page.getByRole("button", { name: new RegExp(`Retire ${dogName} —`) }).click();
    await page.getByRole("button", { name: "Passed away" }).click();
    await page.getByRole("button", { name: `Retire ${dogName}`, exact: true }).click();

    await expect(page.getByText(new RegExp(`${dogName} is retired`))).toBeVisible();
  });

  await test.step("the record survives retiring — nothing is deleted", async () => {
    // The whole point of retiring rather than deleting. The profile is still
    // there to be read.
    await expect(page.getByRole("heading", { name: dogName })).toBeVisible();
    await expect(page.getByText(/Everything on this page stays/)).toBeVisible();
  });

  await test.step("and the kiosk no longer offers them", async () => {
    const kiosk = await browser.newContext({ storageState: ".auth/kiosk.json" });
    const kioskPage = await kiosk.newPage();
    try {
      await kioskPage.goto("/kiosk");
      await kioskPage.getByRole("button", { name: /Drop off/ }).click();
      await kioskPage.getByPlaceholder("(123) 456-7890").fill(phone.replace(/\D/g, ""));
      // Their only dog is retired, so the household drops out of check-in
      // entirely rather than showing a name nobody can sign in.
      await expect(kioskPage.getByText(/No profile found/)).toBeVisible();
      await expect(kioskPage.getByText(dogName)).toBeHidden();
    } finally {
      await kiosk.close();
    }
  });
});
