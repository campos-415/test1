"use client";

import { daysLeft, findDog, packageKind } from "@/lib/dogs";
import { prettyDateKey } from "@/lib/dates";
import { boughtAgo } from "@/lib/packageMoney";
import { Dog, Package, PackageUse } from "@/types";
import DogLink from "@/components/DogLink";
import Money, { PayState } from "@/components/Money";

// A package rendered as a single collapsible line.
//
// The money that briefly lived here moved to Settings, Reports - see the
// note on the packages page header for why.

export function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// A package as one line, opening to reveal its history and the buttons that
// change it.
//
// Every one of those buttons used to sit on the row itself — five of them,
// on every row, with Delete a thumb's width from a count nobody meant to
// touch. What staff actually read down a list is how much is left, so that
// is what stays out: a meter and a number. Corrections live next to the
// history they rewrite, which is the only place they can be checked.
export function PackageRow({
  pkg,
  allDogs,
  usesByPackage,
  editingId,
  setEditingId,
  editTotal,
  setEditTotal,
  saveEditTotal,
  adjustUsed,
  deletePackage,
  deletingId,
  showOwner,
  payState,
  mayManage,
}: {
  pkg: Package;
  allDogs: Dog[];
  usesByPackage: Map<string, PackageUse[]>;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  editTotal: number;
  setEditTotal: (n: number) => void;
  saveEditTotal: (pkg: Package) => void;
  adjustUsed: (pkg: Package, delta: number) => void;
  deletePackage: (pkg: Package) => void;
  deletingId: string | null;
  /** Used-up packages are listed flat, so they carry their own owner name. */
  showOwner?: boolean;
  /** Whether the sale itself has been paid for. */
  payState: PayState;
  /** Selling and deleting packages are manager actions. */
  mayManage: boolean;
}) {
  const left = daysLeft(pkg);
  const history = pkg.id ? (usesByPackage.get(pkg.id) ?? []) : [];
  const isEditing = editingId === pkg.id;
  const isWalk = packageKind(pkg) === "walk";
  const unit = isWalk ? "walks" : "days";
  const dog = pkg.dog_name ? findDog(allDogs, { dogName: pkg.dog_name, phone: pkg.phone }) : null;
  const age = boughtAgo(pkg.created_at, new Date());
  const pct = pkg.total_days > 0 ? Math.round((left / pkg.total_days) * 100) : 0;

  const meter =
    left === 0
      ? "bg-ink-3/40"
      : left <= 2
        ? "bg-rose-400"
        : age.stale
          ? "bg-amber-400"
          : "bg-accent-500";

  return (
    <details className="group border-t border-line-soft">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 transition hover:bg-surface-2">
        <span className="shrink-0 text-[10px] text-ink-3 transition group-open:rotate-90">▶</span>

        <span className="min-w-0 flex-1 truncate text-sm">
          {pkg.dog_name ? (
            <span onClick={(e) => e.stopPropagation()}>
              <DogLink dog={dog} name={pkg.dog_name} className="font-medium text-ink" />
            </span>
          ) : (
            <span className="font-medium text-ink-3">Shared · all dogs</span>
          )}
          {showOwner && <span className="ml-1.5 text-ink-3">· {pkg.client_name}</span>}
          <span
            className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              isWalk ? "bg-emerald-50 text-emerald-700" : "bg-accent-50 text-accent-700"
            }`}>
            {isWalk ? "🚶" : "🐕"}
          </span>
        </span>

        {/* The one thing worth reading down a whole list. */}
        <span className="hidden h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-3 sm:block">
          <span className={`block h-full rounded-full ${meter}`} style={{ width: `${pct}%` }} />
        </span>
        <span
          className={`w-28 shrink-0 text-right text-xs tabular-nums ${
            left <= 0 ? "text-ink-3" : left <= 2 ? "font-medium text-rose-600" : "text-ink-2"
          }`}>
          {left} of {pkg.total_days} {unit}
        </span>

        <span
          className={`hidden w-24 shrink-0 text-right text-[11px] sm:block ${
            age.stale && left > 0 ? "text-amber-700" : "text-ink-3"
          }`}
          title={age.stale && left > 0 ? "Bought a while ago and still unused" : undefined}>
          {age.label}
        </span>
        <span className="w-24 shrink-0 text-right text-xs">
          {pkg.price != null ? (
            <Money amount={pkg.price} state={payState} />
          ) : (
            <span className="text-amber-700">no price</span>
          )}
        </span>
      </summary>

      <div className="border-t border-line-soft bg-surface-2 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-ink-3">Correct the count</span>
          <button
            onClick={() => adjustUsed(pkg, 1)}
            className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-ink-2 hover:border-accent-400"
            title={`Take one ${unit.slice(0, -1)} off this package`}>
            − Take one
          </button>
          <button
            onClick={() => adjustUsed(pkg, -1)}
            disabled={pkg.days_used === 0}
            className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-ink-2 hover:border-accent-400 disabled:opacity-40"
            title={`Give one ${unit.slice(0, -1)} back`}>
            + Give one back
          </button>

          {isEditing ? (
            <>
              <input
                type="number"
                min={1}
                value={editTotal}
                onChange={(e) => setEditTotal(Math.max(1, parseInt(e.target.value) || 1))}
                aria-label={`Total ${unit}`}
                className="w-20 rounded-lg border border-line bg-surface px-2 py-1 text-xs outline-none focus:border-accent-500"
              />
              <button
                onClick={() => saveEditTotal(pkg)}
                className="rounded-lg bg-accent-500 px-2.5 py-1 text-xs font-medium text-accent-ink hover:bg-accent-600">
                Save
              </button>
              <button
                onClick={() => setEditingId(null)}
                className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-3">
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                setEditingId(pkg.id ?? null);
                setEditTotal(pkg.total_days);
              }}
              className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-ink-2 hover:border-accent-400">
              Edit total
            </button>
          )}

          {mayManage && (
            <button
              onClick={() => deletePackage(pkg)}
              disabled={deletingId === pkg.id}
              className="ml-auto rounded-lg border border-rose-200 px-2.5 py-1 text-xs text-rose-500 hover:border-rose-300 disabled:opacity-60">
              {deletingId === pkg.id ? "Deleting…" : "Delete"}
            </button>
          )}
        </div>

        {/* Saying so here is the guard against the count being taken twice —
            once by the kiosk and once by a helpful hand on this page. */}
        <p className="mt-2 text-[11px] text-ink-3">
          Signing out already takes {isWalk ? "a walk" : "a day"} off automatically. These buttons
          are for correcting a visit that was missed or counted twice.
        </p>

        <div className="mt-3 border-t border-line-soft pt-3">
          <p className="mb-1.5 text-[11px] font-medium text-ink-3">
            {history.length > 0
              ? `${plural(history.length, unit.slice(0, -1))} recorded`
              : "Nothing recorded yet"}
          </p>
          {history.length === 0 ? (
            <p className="text-xs text-ink-3">
              Days consumed before this history existed aren&apos;t listed — the count above is
              still correct.
            </p>
          ) : (
            <ul className="space-y-1 text-xs text-ink-2">
              {history.map((u) => (
                <li
                  key={u.id ?? `${u.package_id}-${u.used_on}`}
                  className="flex justify-between gap-3">
                  <span>{prettyDateKey(u.used_on)}</span>
                  <span className="text-ink-3">{u.dog_name ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </details>
  );
}
