// Shared passcode-unlock state for the staff pages (/records, /boardings,
// /report, /packages). Entering the passcode once unlocks all four for
// STAFF_UNLOCK_MINUTES, so staff can move between pages without
// re-entering it every time — but it re-locks automatically once that
// long has passed since the last time a staff page was open, so a kiosk
// left unattended doesn't stay unlocked indefinitely.

const STORAGE_KEY = "staff_unlocked_at";
const STAFF_UNLOCK_MINUTES = Number(process.env.NEXT_PUBLIC_STAFF_UNLOCK_MINUTES) || 30;

// True if a staff page was unlocked within the last STAFF_UNLOCK_MINUTES.
// Also slides the window forward on every call, so active navigation
// between staff pages keeps it from expiring mid-task — only real idle
// time (no staff page open) counts toward the timeout.
export function isStaffUnlocked(): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const unlockedAt = raw ? Number(raw) : NaN;
  if (!unlockedAt || Date.now() - unlockedAt > STAFF_UNLOCK_MINUTES * 60_000) {
    window.localStorage.removeItem(STORAGE_KEY);
    return false;
  }
  window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
  return true;
}

export function markStaffUnlocked(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
}
