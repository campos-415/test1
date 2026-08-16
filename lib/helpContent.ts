/**
 * The how-to text behind the ? on every staff screen.
 *
 * Written here rather than in a wiki nobody opens, and keyed by route so the
 * ? in the header can answer the screen the person is actually looking at.
 * A manual is read once during training and never again; a question mark is
 * read at the moment somebody is stuck.
 *
 * Content rules, learned from what staff actually get wrong in this app:
 *
 *   - Say what the SCREEN does, not what the button says. "Tap Confirm" is
 *     not help. "Confirming emails the client" is.
 *   - Name the thing that costs money or cannot be undone.
 *   - Say where a thing lives when it is not on this screen.
 *
 * These are defaults. If a daycare wants its own procedures alongside them,
 * the shape to follow is siteContent.ts — ship these, let Settings override.
 */

export interface HelpTopic {
  /** The nav route this answers, or "general". */
  key: string;
  title: string;
  /** One line under the title: what this screen is for. */
  summary: string;
  points: { heading: string; body: string }[];
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    key: "/dashboard",
    title: "Dashboard",
    summary: "Where today stands, at a glance, and the fastest way into a dog.",
    points: [
      {
        heading: "The four counts are today only",
        body: "In house, still to arrive, dropped off and picked up all reset overnight. Tap one to open the list behind it rather than searching for the dogs yourself.",
      },
      {
        heading: "Search finds a dog by its name or its owner",
        body: "Either works, and it is usually quicker than the In House list when a client is standing in front of you.",
      },
      {
        heading: "What is on today",
        body: "Walks, baths, nail trims and medications booked for the day, counted across daycare and boarding together. It is the list to read before the first dog arrives.",
      },
    ],
  },
  {
    key: "/in-house",
    title: "In House",
    summary: "Who is here now, and the desk for signing dogs in and out yourself.",
    points: [
      {
        heading: "Sign in / out is for when the client does not use the kiosk",
        body: "It writes exactly what the lobby iPad would write, so a visit signed in here is priced and recorded the same way. Use it when somebody is in a hurry or the iPad is busy.",
      },
      {
        heading: "A green edge means the dog is still on site",
        body: "The row tints and keeps a green left edge until it is signed out. Tapping a row selects it — no checkbox to hit.",
      },
      {
        heading: "Notes are for today, and do not print",
        body: "The small note button on a row is for a special request on this visit — a late pick-up, half portions. It stays out of the printed sheet on purpose.",
      },
      {
        heading: "Meals and walks are recorded on the row",
        body: "Tick them as they happen rather than at the end of the day. The day report reads from the same records.",
      },
    ],
  },
  {
    key: "/calendar",
    title: "Calendar",
    summary: "Boarding stays and meet & greets across the month.",
    points: [
      {
        heading: "The pills above the grid choose what the lists below show",
        body: "The month you are looking at drives them too — the lists are always for the month on screen, not for today.",
      },
      {
        heading: "A bar spans the nights, not the days",
        body: "A stay from Friday to Sunday is two nights, and that is what it is billed as. The bar runs across the days it covers.",
      },
      {
        heading: "Unpaid money is red everywhere",
        body: "In the lists here, on a dog profile, in packages. Red means it has not been paid, not that something is wrong.",
      },
    ],
  },
  {
    key: "/packages",
    title: "Packages",
    summary: "Day and walk packages: what has been sold, what is left, what is owed.",
    points: [
      {
        heading: "Anyone can look, a manager can sell",
        body: "The front desk needs to see how many days a dog has left in order to sign it in. Selling, correcting and refunding need a manager or the owner.",
      },
      {
        heading: "A package is used automatically at sign-in",
        body: "You do not deduct a day by hand. If a visit should not come out of the package, use the opt-out on the visit itself.",
      },
      {
        heading: "Corrections are behind the row",
        body: "Expand a package to fix a miscount. The number of days used is a record of visits, so changing it by hand is a last resort — fix the visit if you can.",
      },
    ],
  },
  {
    key: "/requests",
    title: "Requests",
    summary: "Everything the public has sent in: new clients and boarding requests. Nothing takes effect until it is approved.",
    points: [
      {
        heading: "Enter the vaccination dates before approving",
        body: "Owners upload the certificate and confirm the shots are current; they no longer type dates, because the dates they typed were checked against the document anyway. Read them off the record on this screen. Approval stays blocked until rabies, DHPP and Bordetella are in.",
      },
      {
        heading: "Approving creates the dog and the household",
        body: "Until then nothing exists in the system. Declining does not delete the submission, so a decision can be explained later.",
      },
      {
        heading: "Both decisions email the client",
        body: "The wording is yours, under Settings → Messaging. If email is not set up, the decision is still saved and nothing is sent.",
      },
      {
        heading: "Details outstanding means stage two is unfinished",
        body: "A household that has passed its meet & greet is emailed a link for the rest of the questions. Until they finish, address, vet and behaviour answers are blank because they were never asked, not because they were skipped.",
      },
    ],
  },
  {
    key: "/day-report",
    title: "Day report",
    summary: "The printable sheet of the day.",
    points: [
      {
        heading: "It prints what is on screen",
        body: "Set the date first. Print opens your browser's print dialog, where Save as PDF keeps a copy instead of using paper.",
      },
      {
        heading: "It reads the same records the floor writes",
        body: "Meals, walks and medications ticked off in In House appear here. There is nothing to copy across.",
      },
    ],
  },
  {
    key: "/settings",
    title: "Settings",
    summary: "Everything that makes the app this daycare rather than any other. Manager or owner only.",
    points: [
      {
        heading: "Brand changes the app and the website together",
        body: "The logo you upload here is used on the public site, the lobby kiosk, the staff header and the sign-in screen. One upload, four places.",
      },
      {
        heading: "Prices here are the prices charged",
        body: "Changing a rate changes what new visits cost. It does not go back and re-price visits already recorded.",
      },
      {
        heading: "Reports hold the exports",
        body: "The CSV downloads are refused to employees — that restriction is in the database, not just hidden here.",
      },
      {
        heading: "Security is where roles and two-factor live",
        body: "Client accounts are never listed there and cannot be given staff access by mistake. Every role change is written to the activity log.",
      },
    ],
  },
  {
    key: "general",
    title: "Things worth knowing",
    summary: "The handful of rules that apply everywhere.",
    points: [
      {
        heading: "The lobby iPad is a separate account",
        body: "It signs dogs in and out and cannot read the owner list at all. That is deliberate: it sits unattended in a public room.",
      },
      {
        heading: "Your role decides what you can do, not the screen",
        body: "The database refuses what your account may not do, so there is no way to get at something by finding another route to it. If a control is missing, it is missing on purpose.",
      },
      {
        heading: "A dog with no meet & greet cannot be signed in",
        body: "The kiosk sends a household whose dog has not been assessed to book one instead. It is not a fault.",
      },
      {
        heading: "Red is unpaid",
        body: "Anywhere money appears. Green means settled.",
      },
    ],
  },
];

/** The topic for a route, falling back to the general one. */
export function helpFor(route: string): HelpTopic {
  return (
    HELP_TOPICS.find((t) => t.key === route) ??
    HELP_TOPICS.find((t) => t.key === "general")!
  );
}
