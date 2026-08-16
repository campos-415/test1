"use client";

import { useEffect, useRef, useState } from "react";

// A date field that can be typed, pasted, or picked.
//
// A bare <input type="date"> can't be pasted into — browsers don't deliver
// clipboard text to the segmented editor — and its internals can't be styled,
// so it fights dark mode. This renders a normal text input (pasteable and
// fully themeable) with a calendar button that opens the real native picker
// via showPicker() on a hidden date input.
//
// Values are always emitted as "YYYY-MM-DD" — what every caller and Postgres
// expects — regardless of what format was pasted in.

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const US = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;
const YMD_SLASH = /^(\d{4})[/](\d{1,2})[/](\d{1,2})$/;

function pad(n: number | string) {
  return String(n).padStart(2, "0");
}

/** Parses the formats people actually paste. Returns "" when unrecognisable. */
export function parseDateInput(raw: string): string {
  const t = raw.trim();
  if (!t) return "";

  let m = ISO.exec(t);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;

  m = YMD_SLASH.exec(t);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;

  // Ambiguous by nature; US order is the assumption for a US daycare.
  m = US.exec(t);
  if (m) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;

  // Anything purely numeric that got this far is incomplete — a half-typed
  // "08/10/20" must not be quietly read as the year 2020. Only worded dates
  // reach the parser below.
  if (/^[\d/\-. ]+$/.test(t)) return "";

  // Last resort for things like "Aug 9, 2026". Parsed as local noon so a
  // timezone offset can't roll it onto the previous day.
  const d = new Date(`${t} 12:00`);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return "";
}

/** "2026-08-10" -> "08/10/2026". Anything else is passed through. */
function isoToUs(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

export default function DateField({
  value,
  onChange,
  className = "",
  wrapperClassName = "w-full",
  placeholder = "MM/DD/YYYY",
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  // Sizing belongs on the wrapper, because the calendar button is positioned
  // against it. A narrow input inside a full-width wrapper leaves the button
  // stranded at the far right, nowhere near the field.
  wrapperClassName?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  // Shown and typed in US order, which is what everyone using this actually
  // writes. ISO is still what leaves the component — see commit.
  const [text, setText] = useState(isoToUs(value ?? ""));
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(isoToUs(value ?? ""));
  }, [value]);

  // Slashes appear as you type, so eight digits become a date without
  // reaching for a separator on a numeric keypad.
  //
  // Everything is rebuilt from the digits rather than from what is on screen.
  // The previous version bailed out the moment it saw a separator, which is
  // why the month and day ran together the instant one was typed.
  function formatWhileTyping(raw: string): string {
    // Text that arrives whole — pasted, autofilled, dropped — is left for
    // commit() to normalise. Reflowing it into MM/DD groups first turned
    // "2026-12-25" into "20/26/1225".
    if (/[a-z]/i.test(raw) || /^\d{4}-\d{1,2}-\d{1,2}$/.test(raw.trim())) return raw;
    let digits = raw.replace(/\D/g, "");
    // A separator typed after a single digit means that group is finished:
    // "8/" is August, not the start of a two-digit month.
    if (/[/\-. ]$/.test(raw)) {
      if (digits.length === 1) digits = `0${digits}`;
      else if (digits.length === 3) digits = `${digits.slice(0, 2)}0${digits.slice(2)}`;
    }
    digits = digits.slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  }

  // What the typed text currently resolves to, echoed back in words. A date
  // is easy to fat-finger and impossible to sanity-check as digits.
  const preview = (() => {
    const iso = parseDateInput(text);
    if (!iso || iso === value) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  })();

  function commit(raw: string) {
    const iso = parseDateInput(raw);
    if (iso) {
      setText(isoToUs(iso));
      onChange(iso);
    } else if (!raw.trim()) {
      setText("");
      onChange("");
    } else {
      setText(isoToUs(value ?? "")); // unparseable — put the old value back
    }
  }

  return (
    <span className={`relative inline-flex items-center ${wrapperClassName}`}>
      <input
        type="text"
        inputMode="numeric"
        value={text}
        aria-label={ariaLabel}
        placeholder={placeholder}
        onChange={(e) => setText(formatWhileTyping(e.target.value))}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
        }}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData("text");
          const iso = parseDateInput(pasted);
          if (iso) {
            e.preventDefault();
            setText(isoToUs(iso));
            onChange(iso);
          }
        }}
        className={`${className} w-full pr-9`}
      />
      {/* The calendar affordance.

          This used to be a button calling showPicker() on a hidden input.
          Browsers refuse that: a date input with no size and zero opacity is
          not something they will open a picker for, so the button did
          nothing at all. Instead the real date input sits ON the icon,
          transparent and full-size — clicking the icon IS clicking a date
          input, which every browser opens without being asked twice. */}
      <span
        className="pointer-events-none absolute right-1.5 flex h-6 w-6 items-center justify-center text-xs opacity-60 print:hidden"
        aria-hidden
      >
        📅
      </span>
      <input
        ref={picker}
        type="date"
        aria-label={ariaLabel ? `${ariaLabel} — open calendar` : "Open calendar"}
        value={parseDateInput(text)}
        onChange={(e) => {
          setText(isoToUs(e.target.value));
          onChange(e.target.value);
        }}
        // Bigger than the icon it sits under, on purpose. This input is
        // invisible, so its size is a hit area and nothing else: at the 24px
        // the icon is drawn at, it was a target a thumb misses. Full height
        // and 44px wide is the usual floor for a touch target, and because
        // it is transparent the field looks exactly the same.
        className="absolute inset-y-0 right-0 w-11 cursor-pointer opacity-0 print:hidden"
      />
      {preview && (
        <span className="pointer-events-none absolute -bottom-4 left-0 text-[10px] text-ink-3">
          {preview}
        </span>
      )}
    </span>
  );
}
