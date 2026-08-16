// Turns the two colours a business picks in /settings into the full set of
// CSS variables the app paints with.
//
// Staff choose one brand colour and one print colour, not a twelve-step
// ramp — asking a front desk to pick `accent-400` would be absurd, and a
// hand-picked ramp is where off-brand tints creep in. The shades are derived
// by mixing toward white and black.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const h = (v: number) => Math.round(clamp(v)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, v));
}

/** Relative luminance, per WCAG. */
function luminance({ r, g, b }: Rgb): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const NEAR_BLACK: Rgb = { r: 17, g: 24, b: 39 };

/** Whichever of white or near-black is more readable on this background. */
export function readableInk(bg: Rgb): Rgb {
  return contrast(bg, WHITE) >= contrast(bg, NEAR_BLACK) ? WHITE : NEAR_BLACK;
}

/** Mix toward white (amount > 0) or black (amount < 0), -1..1. */
function shade(c: Rgb, amount: number): Rgb {
  const target = amount > 0 ? 255 : 0;
  const t = Math.abs(amount);
  return {
    r: c.r + (target - c.r) * t,
    g: c.g + (target - c.g) * t,
    b: c.b + (target - c.b) * t,
  };
}

const triple = (c: Rgb) => `${Math.round(clamp(c.r))} ${Math.round(clamp(c.g))} ${Math.round(clamp(c.b))}`;

// How far each step sits from the chosen base. Tuned so 500 is exactly the
// picked colour and the tints stay light enough to read dark text on.
const ACCENT_STEPS: [string, number][] = [
  ["--accent-50", 0.94],
  ["--accent-100", 0.86],
  // 200 and 300 exist because the app already asked for them in about sixty
  // places — hover borders, selected states, soft rings. They were never on
  // the ramp, so Tailwind generated nothing and every one of those styles
  // silently did nothing at all.
  ["--accent-200", 0.72],
  ["--accent-300", 0.53],
  ["--accent-400", 0.34],
  ["--accent-500", 0],
  ["--accent-600", -0.16],
  ["--accent-700", -0.34],
  // Dark enough to read as text on a 100-tinted background.
  ["--accent-800", -0.48],
];

const PRINT_STEPS: [string, number][] = [
  ["--print-from", 0],
  ["--print-to", -0.16], // the header gradient's darker end
  ["--print-rule", 0.55], // heavier table rules
  ["--print-line", 0.72], // hairline cell borders
  ["--print-band", 0.82], // group-header band
  ["--print-tint", 0.93], // zebra striping — must stay near-white in print
  ["--print-ink", -0.45], // footer text, dark enough to read
];

export interface ThemeVars {
  [k: string]: string;
}

export function themeVars(accentHex: string, printHex: string): ThemeVars {
  const vars: ThemeVars = {};
  const accent = hexToRgb(accentHex);
  const print = hexToRgb(printHex);
  if (accent) {
    for (const [name, amt] of ACCENT_STEPS) vars[name] = triple(shade(accent, amt));
    // Text laid over a solid accent button. Chosen by contrast rather than
    // fixed to white: a pale brand colour (a cyan, a yellow) leaves white
    // text at around 2:1, which is unreadable and fails WCAG AA. Whichever
    // of white or near-black reads better against their colour wins.
    vars["--accent-ink"] = triple(readableInk(accent));
  }
  if (print) for (const [name, amt] of PRINT_STEPS) vars[name] = triple(shade(print, amt));
  return vars;
}

// Applied to <html> so both Tailwind's colour utilities and the inline
// @media print blocks resolve against the same values.
export function applyTheme(accentHex: string, printHex: string): void {
  if (typeof document === "undefined") return;
  const vars = themeVars(accentHex, printHex);
  for (const [name, value] of Object.entries(vars)) {
    document.documentElement.style.setProperty(name, value);
  }
}
