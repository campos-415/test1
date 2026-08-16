import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Driven by CSS variables so /settings can change the brand colour at
        // runtime. The variables hold raw "R G B" triples rather than hex, so
        // Tailwind's opacity modifiers (bg-accent-500/40) keep working.
        accent: {
          50: "rgb(var(--accent-50) / <alpha-value>)",
          100: "rgb(var(--accent-100) / <alpha-value>)",
          200: "rgb(var(--accent-200) / <alpha-value>)",
          300: "rgb(var(--accent-300) / <alpha-value>)",
          400: "rgb(var(--accent-400) / <alpha-value>)",
          500: "rgb(var(--accent-500) / <alpha-value>)",
          600: "rgb(var(--accent-600) / <alpha-value>)",
          700: "rgb(var(--accent-700) / <alpha-value>)",
          800: "rgb(var(--accent-800) / <alpha-value>)",
          // Text to place on a solid accent background. Derived from the
          // accent's luminance — see readableInk in lib/theme.ts.
          ink: "rgb(var(--accent-ink) / <alpha-value>)",
        },
        surface: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          2: "rgb(var(--surface-2) / <alpha-value>)",
          3: "rgb(var(--surface-3) / <alpha-value>)",
        },
        line: {
          DEFAULT: "rgb(var(--line) / <alpha-value>)",
          soft: "rgb(var(--line-soft) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--ink) / <alpha-value>)",
          2: "rgb(var(--ink-2) / <alpha-value>)",
          3: "rgb(var(--ink-3) / <alpha-value>)",
        },
        // The printed report's palette, same trick. Named by role rather than
        // by hue so a business can print in any colour without the class
        // names lying about it.
        paper: {
          line: "rgb(var(--print-line) / <alpha-value>)",
          rule: "rgb(var(--print-rule) / <alpha-value>)",
          tint: "rgb(var(--print-tint) / <alpha-value>)",
          band: "rgb(var(--print-band) / <alpha-value>)",
          ink: "rgb(var(--print-ink) / <alpha-value>)",
        },
      },
      fontFamily: {
        display: ["var(--font-display)"],
        body: ["var(--font-body)"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(20,20,20,0.04), 0 12px 28px -12px rgba(20,20,20,0.10)",
      },
      borderRadius: {
        "2xl": "1.1rem",
        "3xl": "1.6rem",
      },
    },
  },
  plugins: [],
};
export default config;
