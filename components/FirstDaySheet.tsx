"use client";

import { ageFromBirthdate } from "@/lib/enrollment";
import { prettyDateKey, todayKey } from "@/lib/dates";
import { Dog, Owner } from "@/types";

// The sheet a household takes home after a meet & greet.
//
// It is designed to survive the car journey and end up on a fridge, which is
// a different brief from the other reports in this app. Those are operational
// documents — a day sheet, a stay sheet — and they are laid out as tables
// because staff read them in a hurry. Nobody keeps a table.
//
// So this one is built around three things:
//
//   The photograph is the hero. It is the first day of a dog somebody is
//   besotted with, and the picture is the reason the paper gets kept. It gets
//   the top third of the page rather than an avatar in a corner.
//
//   The answers read as sentences about one dog, not as fields. On screen
//   staff tap chips; on paper the unchosen options vanish and what is left
//   is "Took a few minutes to settle, then picked a friend". A form with
//   boxes ticked reads as paperwork and gets filed or binned.
//
//   It ends by looking forward. The last thing on the page is what happens
//   next and an invitation, because a keepsake that also books the second
//   visit is doing both jobs.
//
// Split out from the page so it can be rendered and checked without a staff
// sign-in — a print layout only reachable behind a login is one nobody looks
// at, which is how it shipped blank three times.

export interface FirstDayReport {
  settled: string;
  play: string;
  energy: string;
  favourite: string;
  working: string;
  recommend: string;
  staff: string;
}

export const EMPTY_REPORT: FirstDayReport = {
  settled: "",
  play: "",
  energy: "",
  favourite: "",
  working: "",
  recommend: "",
  staff: "",
};

// Offered as taps rather than free text, because this is filled in at a desk
// with somebody waiting. The wording is what will be READ by the household,
// so it is phrased as the finished sentence rather than as a category.
const SETTLED = ["Straight in, no nerves", "Took a few minutes", "Needed some time", "Found it a big day"];
const PLAY = ["Played with everyone", "Picked a favourite friend", "Watched before joining in", "Preferred the humans", "Enjoyed their own company"];
const ENERGY = ["Calm and easy", "Steady all day", "Busy from the off", "Full tilt"];
const RECOMMEND = [
  "Ready for full days",
  "Start with half days",
  "Two days a week to settle in",
  "Best in the small group",
  "Let us talk it through",
];

export default function FirstDaySheet({
  dog,
  owner,
  report,
  onChange,
  businessName,
  businessPhone,
}: {
  dog: Dog;
  owner?: Owner | null;
  report: FirstDayReport;
  onChange: (next: FirstDayReport) => void;
  businessName: string;
  businessPhone?: string;
}) {
  const age = ageFromBirthdate(dog.birthdate);
  const set = <K extends keyof FirstDayReport>(key: K, value: string) =>
    onChange({ ...report, [key]: value });

  const subtitle = [dog.breed, age].filter(Boolean).join(" · ");

  return (
    <article className="overflow-hidden rounded-3xl border border-line bg-surface shadow-card print:rounded-none print:border-0 print:bg-white print:shadow-none">
      {/* The print block every report in this app carries. print-color-adjust
          is the line that matters: without it the browser drops background
          colours, and this page is mostly background colour. */}
      <style>{`
        @media print {
          @page { margin: 0.45in; size: portrait; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .fd-band {
            background: linear-gradient(135deg, rgb(var(--print-from)) 0%, rgb(var(--print-to)) 100%);
          }
          .fd-sheet { break-inside: avoid; }
        }
      `}</style>

      {/* ---- The banner, and the photograph sitting over it ---------------
          The overlap is the whole trick: it turns a document header into a
          portrait frame, and it is what stops the page looking like a
          receipt. */}
      <div className="fd-band relative bg-gradient-to-br from-accent-500 to-accent-600 px-8 pb-20 pt-7 text-center">
        <p className="font-display text-lg font-bold tracking-tight text-white">
          🐾 {businessName}
        </p>
        <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/80">
          My first day
        </p>
      </div>

      {/* relative z-10 so the portrait sits OVER the band. The band is
          positioned, which lifts it above an unpositioned sibling however
          late that sibling comes in the document — without this the top half
          of the dog disappears behind the header. */}
      <div className="relative z-10 -mt-16 flex justify-center">
        {dog.photo_data ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dog.photo_data}
            alt={dog.dog_name}
            className="h-32 w-32 rounded-full border-4 border-surface object-cover shadow-card print:h-28 print:w-28 print:border-white"
          />
        ) : (
          <div className="flex h-32 w-32 items-center justify-center rounded-full border-4 border-surface bg-surface-2 text-5xl shadow-card print:h-28 print:w-28 print:border-white">
            🐕
          </div>
        )}
      </div>

      <div className="px-8 pb-7 pt-3 text-center">
        <h2 className="font-display text-3xl font-bold tracking-tight text-ink">{dog.dog_name}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-ink-3 print:text-ink-2">{subtitle}</p>}
        <p className="mt-1 text-xs text-ink-3 print:text-ink-2">
          {prettyDateKey(todayKey())}
          {owner?.owner_name ? ` · with ${owner.owner_name}` : ""}
        </p>
      </div>

      {/* ---- How it went -------------------------------------------------
          Two columns so the four short answers read as a card of facts about
          a dog rather than a list of questions. */}
      <div className="fd-sheet px-8 pb-2">
        <div className="grid grid-cols-2 gap-3">
          <Tile icon="🚪" label="Settling in">
            <Chips options={SETTLED} value={report.settled} onChange={(v) => set("settled", v)} />
          </Tile>
          <Tile icon="🐕" label="With the other dogs">
            <Chips options={PLAY} value={report.play} onChange={(v) => set("play", v)} />
          </Tile>
          <Tile icon="⚡" label="Energy">
            <Chips options={ENERGY} value={report.energy} onChange={(v) => set("energy", v)} />
          </Tile>
          <Tile icon="⭐" label="Favourite thing">
            <Line
              value={report.favourite}
              onChange={(v) => set("favourite", v)}
              placeholder="The paddling pool, a tennis ball…"
            />
          </Tile>
        </div>

        <div className="mt-3">
          <Tile icon="🎓" label="What we will work on together">
            <Line
              value={report.working}
              onChange={(v) => set("working", v)}
              placeholder="Sharing toys, settling at nap time…"
            />
          </Tile>
        </div>
      </div>

      {/* ---- The invitation ----------------------------------------------
          Last thing on the page on purpose. A keepsake that also says "bring
          them back" is doing both jobs, and this is the moment the household
          is most pleased with us. */}
      <div className="fd-sheet mx-8 mb-6 mt-4 rounded-2xl border border-accent-200 bg-accent-50 px-5 py-4 text-center print:border-paper-rule">
        <p className="font-display text-base font-semibold text-ink">
          We would love to see {dog.dog_name} again
        </p>
        <div className="mt-1.5">
          <Chips
            options={RECOMMEND}
            value={report.recommend}
            onChange={(v) => set("recommend", v)}
            center
          />
        </div>
      </div>

      <div className="mx-8 mb-7 flex items-end justify-between gap-4 border-t border-line-soft pt-3 print:border-paper-rule">
        <div className="min-w-0 flex-1 text-left">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-3 print:text-ink-2">
            Looked after by
          </p>
          {/* An input prints as an input — a box with a border the browser
              draws its own way. On a keepsake it should be a signature. */}
          <input
            value={report.staff}
            onChange={(e) => set("staff", e.target.value)}
            placeholder="Your name"
            className="mt-0.5 w-full max-w-[13rem] border-b border-line bg-transparent pb-0.5 font-display text-base text-ink outline-none focus:border-accent-500 print:hidden"
          />
          <p className="mt-0.5 hidden min-h-[1.5em] max-w-[13rem] border-b border-paper-line font-display text-base text-ink print:block">
            {report.staff}
          </p>
        </div>
        <p className="shrink-0 text-right text-[10px] leading-relaxed text-ink-3 print:text-ink-2">
          {businessName}
          {businessPhone ? (
            <>
              <br />
              {businessPhone}
            </>
          ) : null}
        </p>
      </div>
    </article>
  );
}

/** One answer, framed so the page reads as a card rather than a questionnaire. */
function Tile({
  icon,
  label,
  children,
}: {
  icon: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line-soft bg-surface-2 px-4 py-3 print:break-inside-avoid print:border-paper-line print:bg-white">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-3 print:text-ink-2">
        <span aria-hidden>{icon}</span> {label}
      </p>
      {children}
    </section>
  );
}

/**
 * Choices on screen, a sentence on paper.
 *
 * The unchosen options are not printed. A handout with four boxes and one
 * ticked reads as a form somebody filled in; the same answer on its own
 * reads as something written about your dog.
 */
function Chips({
  options,
  value,
  onChange,
  center = false,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  center?: boolean;
}) {
  return (
    <>
      <div className={`mt-1.5 flex flex-wrap gap-1.5 print:hidden ${center ? "justify-center" : ""}`}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(value === o ? "" : o)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
              value === o
                ? "border-accent-500 bg-accent-500 text-accent-ink"
                : "border-line bg-surface text-ink-2 hover:border-accent-400"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
      <p
        className={`mt-1 hidden font-display text-[15px] leading-snug text-ink print:block ${
          center ? "text-center" : ""
        }`}
      >
        {value || " "}
      </p>
    </>
  );
}

/** A written line. Prints as the words, on a rule when there are none. */
function Line({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1.5 w-full rounded-xl border border-line bg-surface px-3 py-1.5 text-xs text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100 print:hidden"
      />
      <p className="mt-1 hidden min-h-[1.4em] border-b border-paper-line font-display text-[15px] leading-snug text-ink print:block">
        {value}
      </p>
    </>
  );
}
