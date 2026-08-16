import { Page, expect } from "@playwright/test";

/**
 * A phone number no other run will use.
 *
 * Every spec creates its own household rather than leaning on one that
 * happens to be in the sandbox. Two reasons: a test that depends on existing
 * data fails the day somebody tidies up, and a shared household makes two
 * runs fight over the same review queue. The 555 prefix is the reserved
 * fictional range, so these can never collide with a real client.
 */
export function uniquePhone(): string {
  // Last seven digits of the clock, formatted the way the app formats input.
  const digits = String(Date.now()).slice(-7);
  return `(555) ${digits.slice(0, 3)}-${digits.slice(3)}`;
}

export function uniqueName(prefix: string): string {
  return `${prefix}${String(Date.now()).slice(-5)}`;
}

/** Types into a DateField, which commits on blur rather than on keystroke. */
export async function fillDate(page: Page, label: string, value: string) {
  const field = page.getByLabel(label, { exact: true });
  await field.fill(value);
  await field.blur();
}

/**
 * Submits the public enrollment form for one dog and returns what it used.
 *
 * The long way round on purpose: this is the path a real client takes, and
 * every shortcut past it — inserting the row directly, calling the library
 * function — would stop testing the thing that actually breaks, which is the
 * form.
 */
export async function submitEnrollment(
  page: Page,
  opts: { phone: string; dogName: string; ownerFirst?: string; ownerLast?: string }
): Promise<void> {
  const { phone, dogName, ownerFirst = "E2E", ownerLast = "Tester" } = opts;

  await page.goto("/enroll");

  // 1. The contract.
  await page.getByRole("checkbox").first().check();

  // 2. Owner.
  const textboxes = page.getByRole("textbox");
  await textboxes.nth(0).fill(ownerFirst);
  await textboxes.nth(1).fill(ownerLast);
  await page.getByPlaceholder("(123) 456-7890").fill(phone.replace(/\D/g, ""));
  await page.getByPlaceholder("name@example.com").fill("e2e@example.com");

  // 3. The dog.
  await textboxes.nth(4).fill(dogName); // dog's name
  await page.getByPlaceholder("Mixed breed").fill("Test breed");
  await textboxes.nth(6).fill("Brindle"); // colour
  await fillDate(page, "Birthday", "01/15/2024");
  await page.getByRole("spinbutton").fill("30");
  await page.getByRole("combobox").selectOption("female");
  await page.getByRole("button", { name: "Yes", exact: true }).click(); // spayed

  // The vaccination record. A one-pixel PNG is a real upload as far as the
  // form is concerned, and the reviewer only needs the row to exist.
  await page.getByLabel(/Choose a photo or PDF|Replace file/).setInputFiles({
    name: "vaccines.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    ),
  });
  await page.getByRole("checkbox", { name: /I confirm/ }).check();

  // 4. The visit and the signature.
  await fillDate(page, "Meet and greet date", "12/01/2026");
  await page.getByRole("button", { name: /8:00/ }).click();
  await page.getByRole("checkbox", { name: /meet & greet policy/i }).check();
  await drawSignature(page);

  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText(/Thanks — we.ve got it/)).toBeVisible();
}

/** Scribbles on the signature canvas, which will not accept a typed value. */
export async function drawSignature(page: Page) {
  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no signature canvas on the page");
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(
      box.x + box.width * (0.2 + i * 0.06),
      box.y + box.height * (0.6 - Math.sin(i / 2) * 0.2)
    );
  }
  await page.mouse.up();
}
