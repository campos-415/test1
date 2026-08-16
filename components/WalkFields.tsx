"use client";

import { useSettings } from "@/components/SettingsProvider";

// The two controls a walk log row needs, shared by the daycare log on
// /in-house and the boarding log on /stay-report so both behave the same.
//
// Both were free-text before. Times arrived as "2:15pm", "~2pm", "14:15"
// and staff as "RM", "R. Marsh", "Rob" — fine to jot down, useless for
// answering "who walked this dog and when".

/** "9:30am" for 9h30. The stored format stays what it always was. */
export function formatTime(hour: number, minute: number): string {
  const suffix = hour < 12 ? "am" : "pm";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, "0")}${suffix}`;
}

export function walkTimeOptions(startHour: number, endHour: number, step: number): string[] {
  const out: string[] = [];
  const safeStep = step > 0 ? step : 30;
  for (let m = startHour * 60; m <= endHour * 60; m += safeStep) {
    out.push(formatTime(Math.floor(m / 60), m % 60));
  }
  return out;
}

// The dropdown used across both walk logs.
//
// The native control chrome and the chevron are handled once for the whole
// app in globals.css, so what is left here is the sizing that suits a dense
// table row, plus the focus ring every other input in the app has and these
// were missing.
const selectClass =
  "w-full rounded-lg border border-line bg-surface-2 py-1.5 pl-2.5 text-xs font-medium text-ink outline-none transition " +
  "hover:border-accent-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-100 " +
  // On paper it is a value, not a control.
  "print:border-0 print:bg-transparent print:py-0 print:pl-0 print:font-normal print:text-paper-ink";

export function WalkSelect({
  value,
  onSave,
  ariaLabel,
  title,
  width,
  children,
}: {
  value: string;
  onSave: (v: string) => void;
  ariaLabel: string;
  title?: string;
  width: string;
  children: React.ReactNode;
}) {
  return (
    <select
      aria-label={ariaLabel}
      title={title}
      value={value}
      onChange={(e) => onSave(e.target.value)}
      className={`${selectClass} ${width}`}
    >
      {children}
    </select>
  );
}

export function TimeSelect({
  value,
  onSave,
  ariaLabel,
  width = "w-24",
}: {
  value: string;
  onSave: (v: string) => void;
  ariaLabel: string;
  width?: string;
}) {
  const { settings } = useSettings();
  const { walkDayStartHour, walkDayEndHour, walkStepMinutes } = settings.staff;
  const options = walkTimeOptions(walkDayStartHour, walkDayEndHour, walkStepMinutes);
  // Anything already logged that isn't on the grid — "9:40am" from before
  // this was a dropdown — stays selectable, so editing another field on the
  // row cannot silently rewrite the time.
  const extra = value && !options.includes(value) ? value : null;

  return (
    <WalkSelect value={value} onSave={onSave} ariaLabel={ariaLabel} width={width}>
      <option value="">—</option>
      {extra && <option value={extra}>{extra}</option>}
      {options.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </WalkSelect>
  );
}

export function StaffSelect({
  value,
  onSave,
  ariaLabel,
  width = "w-24",
}: {
  value: string;
  onSave: (v: string) => void;
  ariaLabel: string;
  width?: string;
}) {
  const { settings } = useSettings();
  const names = settings.staff.names ?? [];
  const extra = value && !names.includes(value) ? value : null;

  return (
    <WalkSelect
      value={value}
      onSave={onSave}
      ariaLabel={ariaLabel}
      width={width}
      title={names.length ? undefined : "Add staff names under Settings → Brand"}
    >
      <option value="">—</option>
      {extra && <option value={extra}>{extra}</option>}
      {names.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </WalkSelect>
  );
}
