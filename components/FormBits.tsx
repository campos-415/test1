"use client";

// The controls the enrollment questionnaire is built from. They live here
// rather than inside the form because the staff dog profile has to edit the
// same answers — sharing the widgets is what keeps the two from drifting
// apart as questions get added.

export const inputClass =
  "w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-accent-500 focus:bg-surface focus:ring-2 focus:ring-accent-100";

export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-ink-3">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-ink-3">{hint}</p>}
    </div>
  );
}

// Three-state on purpose. `null` is "nobody has answered this", which reads
// very differently on a behaviour question than a recorded "No" — a dog
// whose bite history is unknown is not a dog with no bite history.
export function YesNo({
  value,
  onChange,
  yesLabel = "Yes",
  noLabel = "No",
}: {
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  yesLabel?: string;
  noLabel?: string;
}) {
  const base =
    "rounded-xl border px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-accent-100";
  return (
    <div className="flex gap-2">
      {[
        { v: true, label: yesLabel },
        { v: false, label: noLabel },
      ].map((o) => (
        <button
          key={o.label}
          type="button"
          // Clicking the chosen answer again clears it back to unanswered,
          // so a mis-tap on a required question is recoverable.
          onClick={() => onChange(value === o.v ? null : (o.v as boolean))}
          className={`${base} ${
            value === o.v
              ? "border-accent-500 bg-accent-500 text-accent-ink shadow-card"
              : "border-line bg-surface text-ink-2 hover:border-accent-300"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// A checkbox group whose value is a plain string array. Anything selected
// that isn't in `options` is treated as a free-typed "other" and surfaced in
// the text box, so a stored answer always round-trips through the editor
// unchanged.
export function CheckGrid({
  options,
  value,
  onChange,
  otherPlaceholder = "Anything else…",
  columns = "sm:grid-cols-3",
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  otherPlaceholder?: string;
  columns?: string;
}) {
  const known = new Set(options);
  const extras = value.filter((v) => !known.has(v));

  function toggle(option: string, on: boolean) {
    onChange(on ? [...value, option] : value.filter((v) => v !== option));
  }

  function setExtras(raw: string) {
    const typed = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    onChange([...value.filter((v) => known.has(v)), ...typed]);
  }

  return (
    <div>
      <div className={`grid grid-cols-2 gap-x-3 gap-y-1.5 ${columns}`}>
        {options.map((o) => (
          <label key={o} className="flex items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={value.includes(o)}
              onChange={(e) => toggle(o, e.target.checked)}
              className="h-4 w-4 shrink-0 rounded border-line text-accent-500 focus:ring-accent-100"
            />
            <span>{o}</span>
          </label>
        ))}
      </div>
      <input
        // Uncontrolled between edits: re-joining the array on every keystroke
        // would eat the comma the moment it's typed.
        key={extras.join(",")}
        defaultValue={extras.join(", ")}
        onBlur={(e) => setExtras(e.target.value)}
        placeholder={otherPlaceholder}
        className={`${inputClass} mt-2`}
      />
    </div>
  );
}

// A single choice from a fixed list, plus "Other". A stored value outside
// the list selects Other and fills the text box with it.
export function ChoiceWithOther({
  options,
  value,
  onChange,
  placeholder = "Please specify",
  ariaLabel,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const isOther = !!value && !options.includes(value);
  return (
    <div className="space-y-2">
      <select
        aria-label={ariaLabel}
        value={isOther ? "__other" : value}
        onChange={(e) =>
          // Switching to Other starts blank; the text box below is what
          // actually carries the value from then on.
          onChange(e.target.value === "__other" ? " " : e.target.value)
        }
        className={inputClass}
      >
        <option value="">Not answered</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value="__other">Other…</option>
      </select>
      {isOther && (
        <input
          value={value.trim()}
          onChange={(e) => onChange(e.target.value || " ")}
          placeholder={placeholder}
          className={inputClass}
        />
      )}
    </div>
  );
}

// A yes/no question that reveals a follow-up box when the answer is yes —
// the shape almost every incident question on the form takes.
export function YesNoDetail({
  label,
  value,
  onChange,
  detail,
  onDetailChange,
  detailLabel,
  detailPlaceholder,
  required,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  detail: string;
  onDetailChange: (v: string) => void;
  detailLabel: string;
  detailPlaceholder?: string;
  required?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line-soft p-3">
      <p className="mb-2 text-sm text-ink-2">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </p>
      <YesNo value={value} onChange={onChange} />
      {value === true && (
        <div className="mt-2">
          <Field label={detailLabel}>
            <input
              value={detail}
              onChange={(e) => onDetailChange(e.target.value)}
              placeholder={detailPlaceholder}
              className={inputClass}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

// Read-only rendering of an answer, for the parts of a profile that are
// summarised rather than edited.
export function answerText(value: boolean | null | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Not answered";
}
