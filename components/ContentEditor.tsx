"use client";

import { ChangeEvent, Dispatch, SetStateAction, useRef, useState } from "react";
import { SiteImageError, uploadSiteImage } from "@/lib/siteStorage";
import { AppSettings } from "@/lib/settings";
import { DEFAULT_CONTENT, Card, Heading, Hero, SiteContent } from "@/lib/siteContent";

// The editor for every word on the public website.
//
// The whole of it is around 120 fields, which as one form is unusable — you
// cannot find the sentence you came to change. So it is sliced twice: pick a
// page, then open only the block you want. Everything else stays shut, and
// what is on screen at any moment is a handful of inputs about one part of
// one page.
//
// SEO is closed by default everywhere. It matters, but nobody opens this page
// to rewrite a meta description.

type PageKey = Exclude<keyof SiteContent, "tagline" | "footerBlurb" | "cta">;

const PAGES: { key: PageKey | "shared"; label: string }[] = [
  { key: "shared", label: "Shared" },
  { key: "home", label: "Home" },
  { key: "daycare", label: "Daycare" },
  { key: "boarding", label: "Boarding" },
  { key: "bath", label: "Bath" },
  { key: "walking", label: "Dog Walking" },
  { key: "prices", label: "Prices" },
  { key: "gallery", label: "Gallery" },
  { key: "about", label: "About" },
  { key: "contact", label: "Contact" },
];

const PATHS: Record<PageKey, string> = {
  home: "/",
  daycare: "/dog-daycare",
  boarding: "/boarding",
  bath: "/bath",
  walking: "/dog-walking",
  prices: "/prices",
  gallery: "/gallery",
  about: "/about-us",
  contact: "/contact",
};

export default function ContentEditor({
  draft,
  setDraft,
}: {
  draft: AppSettings;
  setDraft: Dispatch<SetStateAction<AppSettings>>;
}) {
  const [page, setPage] = useState<PageKey | "shared">("shared");
  const c = draft.content;

  function patchContent(patch: Partial<SiteContent>) {
    setDraft((d) => ({ ...d, content: { ...d.content, ...patch } }));
  }

  function patchPage<K extends PageKey>(key: K, patch: Partial<SiteContent[K]>) {
    setDraft((d) => ({
      ...d,
      content: { ...d.content, [key]: { ...d.content[key], ...patch } },
    }));
  }

  return (
    <>
      <div className="mb-5 rounded-2xl border border-line bg-surface p-4 shadow-card">
        <p className="mb-3 text-[11px] text-ink-3">
          Everything the website says, in your words. Prices, opening hours and the address come
          from their own tabs — change them once there and every page follows.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PAGES.map((p) => (
            <button
              key={p.key}
              onClick={() => setPage(p.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                page === p.key
                  ? "bg-accent-500 text-accent-ink"
                  : "bg-surface-2 text-ink-2 hover:bg-surface-3"
              }`}>
              {p.label}
            </button>
          ))}
        </div>
        {page !== "shared" && (
          <a
            href={PATHS[page]}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block text-[11px] font-medium text-accent-600 hover:underline">
            Open {PATHS[page]} in a new tab →
          </a>
        )}
      </div>

      {page === "shared" && (
        <>
          <Block title="Headline" blurb="The big line on the home page, above everything else.">
            <Para
              label="Headline"
              value={c.tagline}
              onChange={(v) => patchContent({ tagline: v })}
              rows={2}
            />
            <Para
              label="Footer sentence"
              value={c.footerBlurb}
              onChange={(v) => patchContent({ footerBlurb: v })}
              rows={2}
              hint="Follows the headline under the logo, at the foot of every page."
            />
          </Block>

          <Block
            title="Call to action"
            blurb="The coloured band at the bottom of nearly every page. Individual pages can override it — Daycare and Boarding do.">
            <CtaFields value={c.cta} onChange={(v) => patchContent({ cta: v })} />
          </Block>
        </>
      )}

      {page === "home" && (
        <>
          <Block title="Opening" defaultOpen>
            <Para
              label="Paragraph under the headline"
              value={c.home.intro}
              onChange={(v) => patchPage("home", { intro: v })}
            />
            <Two>
              <Text
                label="Main button"
                value={c.home.primaryCta}
                onChange={(v) => patchPage("home", { primaryCta: v })}
                hint="Also the button on every call-to-action band."
              />
              <Text
                label="Second button"
                value={c.home.secondaryCta}
                onChange={(v) => patchPage("home", { secondaryCta: v })}
              />
            </Two>
          </Block>

          <Block title="What we offer" blurb="The four service tiles.">
            <HeadingFields value={c.home.offer} onChange={(v) => patchPage("home", { offer: v })} />
            <ListEditor
              items={c.home.services}
              onChange={(services) => patchPage("home", { services })}
              blank={{ href: "/", title: "", description: "", image: "", imageAlt: "" }}
              addLabel="Add a service"
              render={(s, set) => (
                <>
                  <Two>
                    <Text label="Name" value={s.title} onChange={(v) => set({ title: v })} />
                    <Text
                      label="Links to"
                      value={s.href}
                      onChange={(v) => set({ href: v })}
                      hint="A page on this site, like /boarding."
                    />
                  </Two>
                  <Para
                    label="Description"
                    value={s.description}
                    onChange={(v) => set({ description: v })}
                    rows={2}
                  />
                  <Text
                    label="Photo address"
                    value={s.image}
                    onChange={(v) => set({ image: v })}
                    hint="A web address ending in .jpg or .png."
                  />
                  <Text
                    label="Photo description"
                    value={s.imageAlt}
                    onChange={(v) => set({ imageAlt: v })}
                    hint="Read aloud to visitors who cannot see it."
                  />
                </>
              )}
            />
          </Block>

          <Block title="Why parents choose us">
            <HeadingFields value={c.home.why} onChange={(v) => patchPage("home", { why: v })} />
            <CardList
              items={c.home.valueProps}
              onChange={(valueProps) => patchPage("home", { valueProps })}
              addLabel="Add a reason"
            />
          </Block>

          <Block title="Team teaser" blurb="The short pitch that links through to the About page.">
            <HeadingFields
              value={c.home.teamTeaser}
              onChange={(v) => patchPage("home", { teamTeaser: v })}
            />
            <Text
              label="Link wording"
              value={c.home.teamLinkLabel}
              onChange={(v) => patchPage("home", { teamLinkLabel: v })}
            />
          </Block>

          <Block title="Reviews heading" blurb="The reviews themselves live on the Website tab.">
            <HeadingFields
              value={c.home.reviewsHeading}
              onChange={(v) => patchPage("home", { reviewsHeading: v })}
            />
          </Block>

          <SeoBlock value={c.home.seo} onChange={(seo) => patchPage("home", { seo })} />
        </>
      )}

      {page === "daycare" && (
        <>
          <Block title="Top of the page" defaultOpen>
            <HeroFields value={c.daycare.hero} onChange={(hero) => patchPage("daycare", { hero })} />
          </Block>

          <Block title="How it works">
            <HeadingFields value={c.daycare.how} onChange={(how) => patchPage("daycare", { how })} />
            <CardList
              items={c.daycare.options}
              onChange={(options) => patchPage("daycare", { options })}
              addLabel="Add an option"
            />
            <Para
              label="Note underneath"
              value={c.daycare.note}
              onChange={(note) => patchPage("daycare", { note })}
              rows={2}
              hint="A link to the prices page is added after this automatically."
            />
          </Block>

          <Block title="Before their first visit">
            <HeadingFields
              value={c.daycare.requirements}
              onChange={(requirements) => patchPage("daycare", { requirements })}
            />
            <LineList
              items={c.daycare.requirementItems}
              onChange={(requirementItems) => patchPage("daycare", { requirementItems })}
              addLabel="Add a requirement"
            />
          </Block>

          <Block title="Cross-sell" blurb="The section pointing daycare visitors at another service.">
            <HeadingFields
              value={c.daycare.extra}
              onChange={(extra) => patchPage("daycare", { extra })}
            />
            <Two>
              <Text
                label="Link wording"
                value={c.daycare.extraLinkLabel}
                onChange={(extraLinkLabel) => patchPage("daycare", { extraLinkLabel })}
              />
              <Text
                label="Links to"
                value={c.daycare.extraLinkHref}
                onChange={(extraLinkHref) => patchPage("daycare", { extraLinkHref })}
              />
            </Two>
          </Block>

          <Block title="Call to action">
            <CtaFields value={c.daycare.cta} onChange={(cta) => patchPage("daycare", { cta })} />
          </Block>

          <SeoBlock value={c.daycare.seo} onChange={(seo) => patchPage("daycare", { seo })} />
        </>
      )}

      {page === "boarding" && (
        <>
          <Block title="Top of the page" defaultOpen>
            <HeroFields
              value={c.boarding.hero}
              onChange={(hero) => patchPage("boarding", { hero })}
            />
          </Block>

          <Block title="What's included">
            <HeadingFields
              value={c.boarding.included}
              onChange={(included) => patchPage("boarding", { included })}
            />
            <CardList
              items={c.boarding.amenities}
              onChange={(amenities) => patchPage("boarding", { amenities })}
              addLabel="Add an amenity"
            />
          </Block>

          <Block title="Good to know">
            <HeadingFields
              value={c.boarding.goodToKnow}
              onChange={(goodToKnow) => patchPage("boarding", { goodToKnow })}
            />
            <LineList
              items={c.boarding.goodToKnowItems}
              onChange={(goodToKnowItems) => patchPage("boarding", { goodToKnowItems })}
              addLabel="Add a point"
            />
            <Para
              label="Note underneath"
              value={c.boarding.note}
              onChange={(note) => patchPage("boarding", { note })}
              rows={2}
              hint="A link to the prices page is added after this automatically."
            />
          </Block>

          <Block title="Call to action">
            <CtaFields value={c.boarding.cta} onChange={(cta) => patchPage("boarding", { cta })} />
          </Block>

          <SeoBlock value={c.boarding.seo} onChange={(seo) => patchPage("boarding", { seo })} />
        </>
      )}

      {page === "bath" && (
        <>
          <Block title="Top of the page" defaultOpen>
            <HeroFields value={c.bath.hero} onChange={(hero) => patchPage("bath", { hero })} />
          </Block>

          <Block title="What's included">
            <HeadingFields
              value={c.bath.included}
              onChange={(included) => patchPage("bath", { included })}
            />
            <CardList
              items={c.bath.items}
              onChange={(items) => patchPage("bath", { items })}
              addLabel="Add an item"
            />
            <Para
              label="Note underneath"
              value={c.bath.note}
              onChange={(note) => patchPage("bath", { note })}
              rows={2}
              hint="A link to the prices page is added after this automatically."
            />
          </Block>

          <Block title="Call to action">
            <CtaFields value={c.bath.cta} onChange={(cta) => patchPage("bath", { cta })} />
          </Block>

          <SeoBlock value={c.bath.seo} onChange={(seo) => patchPage("bath", { seo })} />
        </>
      )}

      {page === "walking" && (
        <>
          <Block title="Top of the page" defaultOpen>
            <HeroFields value={c.walking.hero} onChange={(hero) => patchPage("walking", { hero })} />
          </Block>

          <Block title="How it works">
            <HeadingFields value={c.walking.how} onChange={(how) => patchPage("walking", { how })} />
            <CardList
              items={c.walking.options}
              onChange={(options) => patchPage("walking", { options })}
              addLabel="Add an option"
            />
            <Para
              label="Note underneath"
              value={c.walking.note}
              onChange={(note) => patchPage("walking", { note })}
              rows={2}
              hint="A link to the prices page is added after this automatically."
            />
          </Block>

          <Block title="Call to action">
            <CtaFields value={c.walking.cta} onChange={(cta) => patchPage("walking", { cta })} />
          </Block>

          <SeoBlock value={c.walking.seo} onChange={(seo) => patchPage("walking", { seo })} />
        </>
      )}

      {page === "prices" && (
        <>
          <Block title="Page heading" blurb="The rates below it come from the Pricing tab." defaultOpen>
            <HeadingFields
              value={c.prices.heading}
              onChange={(heading) => patchPage("prices", { heading })}
            />
          </Block>
          <SeoBlock value={c.prices.seo} onChange={(seo) => patchPage("prices", { seo })} />
        </>
      )}

      {page === "gallery" && (
        <>
          <Block
            title="Page heading"
            blurb="The photos themselves are uploaded on the Website tab."
            defaultOpen>
            <HeadingFields
              value={c.gallery.heading}
              onChange={(heading) => patchPage("gallery", { heading })}
            />
          </Block>
          <SeoBlock value={c.gallery.seo} onChange={(seo) => patchPage("gallery", { seo })} />
        </>
      )}

      {page === "about" && (
        <>
          <Block title="Top of the page" defaultOpen>
            <Text
              label="Eyebrow"
              value={c.about.eyebrow}
              onChange={(eyebrow) => patchPage("about", { eyebrow })}
            />
            <Para
              label="Headline"
              value={c.about.title}
              onChange={(title) => patchPage("about", { title })}
              rows={2}
            />
            <Para
              label="Opening paragraph"
              value={c.about.intro}
              onChange={(intro) => patchPage("about", { intro })}
            />
          </Block>

          <Block title="The team">
            <HeadingFields
              value={c.about.teamHeading}
              onChange={(teamHeading) => patchPage("about", { teamHeading })}
            />
            <ListEditor
              items={c.about.team}
              onChange={(team) => patchPage("about", { team })}
              blank={{ name: "", role: "", bio: "", photo: "" }}
              addLabel="Add a team member"
              render={(m, set) => (
                <div className="flex gap-3.5">
                  <PhotoPicker value={m.photo} name={m.name} onChange={(photo) => set({ photo })} />
                  <div className="min-w-0 flex-1 space-y-2.5">
                    <Two>
                      <Text label="Name" value={m.name} onChange={(v) => set({ name: v })} />
                      <Text label="Role" value={m.role} onChange={(v) => set({ role: v })} />
                    </Two>
                    <Para label="Short bio" value={m.bio} onChange={(v) => set({ bio: v })} />
                  </div>
                </div>
              )}
            />
          </Block>

          <Block title="Our approach">
            <HeadingFields
              value={c.about.approach}
              onChange={(approach) => patchPage("about", { approach })}
            />
          </Block>

          <SeoBlock value={c.about.seo} onChange={(seo) => patchPage("about", { seo })} />
        </>
      )}

      {page === "contact" && (
        <>
          <Block
            title="Page heading"
            blurb="The phone, email and address below it come from the Website tab."
            defaultOpen>
            <HeadingFields
              value={c.contact.heading}
              onChange={(heading) => patchPage("contact", { heading })}
            />
          </Block>
          <SeoBlock value={c.contact.seo} onChange={(seo) => patchPage("contact", { seo })} />
        </>
      )}

      <ResetRow page={page} draft={draft} setDraft={setDraft} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

const inputClass =
  "w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100";

function Block({
  title,
  blurb,
  children,
  defaultOpen = false,
}: {
  title: string;
  blurb?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="group mb-3 rounded-2xl border border-line bg-surface shadow-card">
      <summary className="cursor-pointer list-none px-5 py-3.5 text-xs font-semibold uppercase tracking-wide text-ink-3 marker:hidden">
        <span className="mr-2 inline-block text-ink-3 transition group-open:rotate-90">▸</span>
        {title}
      </summary>
      <div className="border-t border-line px-5 py-4">
        {blurb && <p className="mb-3 text-[11px] text-ink-3">{blurb}</p>}
        <div className="space-y-3">{children}</div>
      </div>
    </details>
  );
}

function Two({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

function Text({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] text-ink-3">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />
      {hint && <p className="mt-1 text-[10px] text-ink-3">{hint}</p>}
    </div>
  );
}

function Para({
  label,
  value,
  onChange,
  rows = 3,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  hint?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] text-ink-3">{label}</label>
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} resize-y leading-relaxed`}
      />
      {hint && <p className="mt-1 text-[10px] text-ink-3">{hint}</p>}
    </div>
  );
}

function HeadingFields({
  value,
  onChange,
}: {
  value: Heading;
  onChange: (v: Heading) => void;
}) {
  return (
    <>
      <Two>
        <Text
          label="Eyebrow"
          value={value.eyebrow}
          onChange={(eyebrow) => onChange({ ...value, eyebrow })}
          hint="The small line above the heading."
        />
        <Text
          label="Heading"
          value={value.title}
          onChange={(title) => onChange({ ...value, title })}
        />
      </Two>
      <Para
        label="Intro paragraph"
        value={value.description}
        onChange={(description) => onChange({ ...value, description })}
        rows={2}
        hint="Leave blank to show nothing."
      />
    </>
  );
}

function HeroFields({ value, onChange }: { value: Hero; onChange: (v: Hero) => void }) {
  return (
    <>
      <Text
        label="Eyebrow"
        value={value.eyebrow}
        onChange={(eyebrow) => onChange({ ...value, eyebrow })}
      />
      <Para
        label="Headline"
        value={value.title}
        onChange={(title) => onChange({ ...value, title })}
        rows={2}
      />
      <Para
        label="Opening paragraph"
        value={value.description}
        onChange={(description) => onChange({ ...value, description })}
      />
      <Text
        label="Photo address"
        value={value.image}
        onChange={(image) => onChange({ ...value, image })}
        hint="A web address ending in .jpg or .png."
      />
      <Text
        label="Photo description"
        value={value.imageAlt}
        onChange={(imageAlt) => onChange({ ...value, imageAlt })}
        hint="Read aloud to visitors who cannot see it."
      />
    </>
  );
}

function CtaFields({
  value,
  onChange,
}: {
  value: { title: string; description: string };
  onChange: (v: { title: string; description: string }) => void;
}) {
  return (
    <>
      <Para
        label="Heading"
        value={value.title}
        onChange={(title) => onChange({ ...value, title })}
        rows={2}
      />
      <Para
        label="Paragraph"
        value={value.description}
        onChange={(description) => onChange({ ...value, description })}
        rows={2}
      />
    </>
  );
}

function SeoBlock({ value, onChange }: { value: { title: string; description: string }; onChange: (v: { title: string; description: string }) => void }) {
  return (
    <Block
      title="Search engines"
      blurb="What Google shows in its results, and what appears when someone shares the link. Not visible on the page itself.">
      <Text
        label="Page title"
        value={value.title}
        onChange={(title) => onChange({ ...value, title })}
        hint="Around 60 characters. Your business name is added automatically."
      />
      <Para
        label="Description"
        value={value.description}
        onChange={(description) => onChange({ ...value, description })}
        rows={2}
        hint="Around 155 characters."
      />
    </Block>
  );
}

/** Rows of anything, with reorder, remove and add. */
function ListEditor<T>({
  items,
  onChange,
  blank,
  addLabel,
  render,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  blank: T;
  addLabel: string;
  render: (item: T, set: (patch: Partial<T>) => void, index: number) => React.ReactNode;
}) {
  function move(index: number, delta: number) {
    const to = index + delta;
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    [next[index], next[to]] = [next[to], next[index]];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface-2 p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wide text-ink-3">
              {i + 1}
            </span>
            <div className="flex items-center gap-1">
              <MiniButton onClick={() => move(i, -1)} disabled={i === 0} label="Move up">
                ↑
              </MiniButton>
              <MiniButton
                onClick={() => move(i, 1)}
                disabled={i === items.length - 1}
                label="Move down">
                ↓
              </MiniButton>
              <button
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                className="rounded-md px-2 py-1 text-[11px] font-medium text-rose-500 hover:bg-rose-50">
                Remove
              </button>
            </div>
          </div>
          <div className="space-y-2.5">
            {render(
              item,
              (patch) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x))),
              i
            )}
          </div>
        </div>
      ))}
      <button
        onClick={() => onChange([...items, blank])}
        className="rounded-lg border border-dashed border-line px-3 py-1.5 text-xs font-medium text-ink-2 hover:border-accent-300 hover:text-accent-600">
        + {addLabel}
      </button>
    </div>
  );
}

function CardList({
  items,
  onChange,
  addLabel,
}: {
  items: Card[];
  onChange: (items: Card[]) => void;
  addLabel: string;
}) {
  return (
    <ListEditor
      items={items}
      onChange={onChange}
      blank={{ title: "", body: "" }}
      addLabel={addLabel}
      render={(item, set) => (
        <>
          <Text label="Heading" value={item.title} onChange={(v) => set({ title: v })} />
          <Para label="Text" value={item.body} onChange={(v) => set({ body: v })} rows={2} />
        </>
      )}
    />
  );
}

/** A bullet list — one line each, so it stays a list rather than a form. */
function LineList({
  items,
  onChange,
  addLabel,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  addLabel: string;
}) {
  function move(index: number, delta: number) {
    const to = index + delta;
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    [next[index], next[to]] = [next[to], next[index]];
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <textarea
            value={item}
            rows={1}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            className={`${inputClass} min-h-[42px] resize-y`}
          />
          <MiniButton onClick={() => move(i, -1)} disabled={i === 0} label="Move up">
            ↑
          </MiniButton>
          <MiniButton onClick={() => move(i, 1)} disabled={i === items.length - 1} label="Move down">
            ↓
          </MiniButton>
          <button
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            aria-label="Remove"
            className="rounded-md px-2 py-2 text-[11px] font-medium text-rose-500 hover:bg-rose-50">
            ✕
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...items, ""])}
        className="rounded-lg border border-dashed border-line px-3 py-1.5 text-xs font-medium text-ink-2 hover:border-accent-300 hover:text-accent-600">
        + {addLabel}
      </button>
    </div>
  );
}

// The headshot, sitting beside the name it belongs to.
//
// It saves with everything else on this page rather than the moment a file is
// chosen, which is why the picture is held as a data URL in the draft: an
// upload that wrote straight to the database would leave the photo changed
// and the bio not, if you then walked away without saving.
//
// Resized to 256px because it renders at 112 — a phone photo pasted in raw
// would be two megabytes of the settings row, fetched on every page load.
function PhotoPicker({
  value,
  name,
  onChange,
}: {
  value: string;
  name: string;
  onChange: (v: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    try {
      onChange(await uploadSiteImage(file, "team", 256, 40 * 1024));
    } catch (e) {
      console.error("Team photo upload failed:", e);
      setError(
        e instanceof SiteImageError && e.kind === "upload"
          ? "Storage refused it. Run site-storage-migration.sql."
          : "Could not read that image — try a PNG or JPEG."
      );
    }
  }

  return (
    <div className="w-[84px] shrink-0 text-center">
      <button
        onClick={() => input.current?.click()}
        title={value ? "Replace photo" : "Add a photo"}
        className="relative flex h-[84px] w-[84px] items-center justify-center overflow-hidden rounded-full border border-line bg-surface-3 transition hover:border-accent-300">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-2xl font-semibold text-ink-3">
            {name.trim().charAt(0).toUpperCase() || "+"}
          </span>
        )}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        onChange={pick}
        className="hidden"
        aria-label={`Photo of ${name || "team member"}`}
      />
      <div className="mt-1 flex justify-center gap-1.5 text-[10px]">
        <button
          onClick={() => input.current?.click()}
          className="font-medium text-accent-600 hover:underline">
          {value ? "Replace" : "Add photo"}
        </button>
        {value && (
          <button onClick={() => onChange("")} className="text-ink-3 hover:text-rose-500">
            Clear
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-[10px] text-rose-500">{error}</p>}
    </div>
  );
}

function MiniButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="rounded-md px-2 py-1 text-xs text-ink-3 hover:bg-surface-3 disabled:opacity-30">
      {children}
    </button>
  );
}

// Rewriting a page and wanting the original back is common enough — and
// retyping four paragraphs from memory is impossible enough — that undo needs
// to exist. Scoped to the page on screen so it cannot wipe the whole site.
function ResetRow({
  page,
  draft,
  setDraft,
}: {
  page: PageKey | "shared";
  draft: AppSettings;
  setDraft: Dispatch<SetStateAction<AppSettings>>;
}) {
  const label = PAGES.find((p) => p.key === page)?.label ?? "";

  function reset() {
    if (!window.confirm(`Put the ${label} wording back to what the app shipped with?`)) return;
    setDraft((d) => ({
      ...d,
      content:
        page === "shared"
          ? {
              ...d.content,
              tagline: DEFAULT_CONTENT.tagline,
              footerBlurb: DEFAULT_CONTENT.footerBlurb,
              cta: DEFAULT_CONTENT.cta,
            }
          : { ...d.content, [page]: DEFAULT_CONTENT[page] },
    }));
  }

  const changed =
    page === "shared"
      ? JSON.stringify([draft.content.tagline, draft.content.footerBlurb, draft.content.cta]) !==
        JSON.stringify([
          DEFAULT_CONTENT.tagline,
          DEFAULT_CONTENT.footerBlurb,
          DEFAULT_CONTENT.cta,
        ])
      : JSON.stringify(draft.content[page]) !== JSON.stringify(DEFAULT_CONTENT[page]);

  return (
    <div className="mb-5 mt-4 flex items-center gap-3">
      <button
        onClick={reset}
        disabled={!changed}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-2 hover:border-accent-300 hover:text-accent-600 disabled:cursor-not-allowed disabled:opacity-40">
        Restore original {label} wording
      </button>
      {!changed && <span className="text-[11px] text-ink-3">Unchanged from the original.</span>}
    </div>
  );
}
