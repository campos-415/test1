// Formats digits as (555) 123-4567 progressively as the user types.
// Used in both the kiosk form and the packages page so phone numbers
// are stored in exactly the same format everywhere — that's what makes
// the package lookup-by-phone reliable.
export function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  const len = digits.length;
  if (len === 0) return "";
  if (len < 4) return `(${digits}`;
  if (len < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
