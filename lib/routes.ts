// Which half of the app a path belongs to.
//
// The deployment serves two things: a public marketing website at the root,
// and the kiosk plus back office underneath it. Several behaviours differ
// between them — dark mode, the runtime tab title — and each needs the same
// answer, so the list lives here rather than being restated per component.

/** The back office. Staff-only, and the only place dark mode applies. */
export const STAFF_ROUTES = [
  "/dashboard",
  "/in-house",
  "/calendar",
  "/packages",
  "/requests",
  "/enrollments",
  "/boarding-requests",
  "/day-report",
  "/stay-report",
  "/settings",
  "/dogs",
  "/owners",
  // Opened from the sign-in list and only ever by staff. Missing from this
  // list, it lost dark mode halfway through a shift for whoever had it on.
  "/first-day",
];

/**
 * The lobby kiosk and the forms clients fill in. Public, but not marketing.
 *
 * The client portal at `/account` is deliberately in NEITHER list.
 *
 * Not STAFF_ROUTES: dark mode is a back-office affordance for a screen
 * somebody stares at all day, and the portal should look like the website
 * the client arrived from.
 *
 * Not APP_ROUTES either, which is subtler. The only thing that list does is
 * let SettingsProvider retitle the tab "<business> — sign in" at runtime.
 * That is right for the kiosk and the enrollment form, which are sign-in
 * screens; it is wrong for a client reading their billing history, and it
 * would overwrite the portal own title to say so. The portal layout sets
 * its title through Next metadata instead, which picks the business name up
 * the same way.
 */
export const APP_ROUTES = ["/kiosk", "/signup", "/enroll", "/book"];

function matches(pathname: string | null, routes: string[]): boolean {
  if (!pathname) return false;
  return routes.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

export function isStaffRoute(pathname: string | null): boolean {
  return matches(pathname, STAFF_ROUTES);
}

/**
 * True for anything that is part of the application rather than the
 * marketing website. The website owns its own page titles for SEO, so the
 * runtime white-label title is only applied here.
 */
export function isAppRoute(pathname: string | null): boolean {
  return isStaffRoute(pathname) || matches(pathname, APP_ROUTES);
}
