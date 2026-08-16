"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { dogHref } from "@/lib/dogs";
import { STATUS_CLASSES, STATUS_LABELS, VaccineStatus } from "@/lib/vaccines";
import { prettyDateKey } from "@/lib/dates";
import { Dog } from "@/types";

export interface DogLinkBadges {
  packageDaysLeft?: number | null;
  nextStay?: { start_date: string; end_date: string } | null;
  vaccineStatus?: VaccineStatus | null;
}

// A dog's name, rendered as a link into its profile with an on-hover
// summary card. Everything it shows is passed in — the pages using it
// already load clients/packages/boardings, so this issues no queries and
// stays cheap to drop into a table cell.
export default function DogLink({
  dog,
  name,
  badges,
  className = "",
  avatar = false,
}: {
  dog: Dog | null;
  // Falls back to a plain name when the dog has no client profile on file
  // (older sign-ins written before signup existed).
  name: string;
  badges?: DogLinkBadges;
  className?: string;
  // Shows a thumbnail beside the name. Screen only — it's an aid for
  // recognising a dog at the desk, and it would waste ink and space on a
  // printed list, so it carries print:hidden.
  avatar?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const CARD_W = 256; // w-64
  const GAP = 4;

  // The card is positioned fixed rather than absolute. Its usual home is a
  // table cell inside a wrapper with overflow-x-auto, and an overflow on one
  // axis clips the other too — so an absolutely-positioned card gets cut off
  // whenever the table is short enough not to leave room beneath the row.
  // Fixed coordinates measured off the trigger escape every ancestor.
  const place = useCallback(() => {
    const t = triggerRef.current?.getBoundingClientRect();
    if (!t) return;
    const h = cardRef.current?.offsetHeight ?? 190; // estimate on first paint
    const below = window.innerHeight - t.bottom;
    const top = below < h + GAP && t.top > h + GAP ? t.top - h - GAP : t.bottom + GAP;
    const left = Math.min(Math.max(8, t.left), window.innerWidth - CARD_W - 8);
    setPos({ top, left });
  }, []);

  // Re-measure once the real card height is known, and keep it anchored if
  // the page moves underneath it.
  useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  // A dog with no profile still gets the spacer, so names stay aligned
  // down the column instead of stepping in and out.
  const thumb = avatar ? (
    <span className="mr-2 inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-3 align-middle print:hidden">
      {dog?.photo_data ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dog.photo_data} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="text-xs">🐕</span>
      )}
    </span>
  ) : null;

  if (!dog?.id) {
    return (
      <span className={`inline-flex items-center ${className}`}>
        {thumb}
        <span>{name}</span>
      </span>
    );
  }

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex items-center"
      onMouseEnter={() => {
        place();
        setOpen(true);
      }}
      onMouseLeave={() => setOpen(false)}
    >
      {thumb}
      <Link
        href={dogHref(dog.id)}
        className={`underline decoration-dotted underline-offset-2 hover:text-accent-600 ${className}`}
      >
        {name}
      </Link>

      {open && (
        <span
          ref={cardRef}
          style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
          className="fixed z-50 block w-64 rounded-2xl border border-line bg-surface p-3 text-left shadow-lg print:hidden"
        >
          <span className="flex items-start gap-3">
            {dog.photo_data ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={dog.photo_data}
                alt=""
                className="h-12 w-12 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-3 text-lg">
                🐕
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-ink">{dog.dog_name}</span>
              <span className="block text-xs text-ink-3">{dog.last_name}</span>
              <span className="block text-xs text-ink-3">{dog.phone}</span>
            </span>
          </span>

          <span className="mt-2 flex flex-wrap gap-1.5">
            {badges?.vaccineStatus && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_CLASSES[badges.vaccineStatus]}`}
              >
                💉 {STATUS_LABELS[badges.vaccineStatus]}
              </span>
            )}
            {badges?.packageDaysLeft != null && (
              <span className="rounded-full bg-accent-50 px-2 py-0.5 text-[10px] font-semibold text-accent-700">
                📦 {badges.packageDaysLeft} left
              </span>
            )}
          </span>

          {badges?.nextStay && (
            <span className="mt-1.5 block text-[10px] text-ink-3">
              🛏️ {prettyDateKey(badges.nextStay.start_date)} → {prettyDateKey(badges.nextStay.end_date)}
            </span>
          )}

          <span className="mt-2 block text-[10px] font-medium text-accent-600">
            Click to open profile →
          </span>
        </span>
      )}
    </span>
  );
}
