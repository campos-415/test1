"use client";

import { dateKey, prettyDateKey } from "@/lib/dates";
import { CalendarItem, layoutWeek } from "@/lib/calendarLayout";
import { Dog } from "@/types";
import DogLink from "@/components/DogLink";

// The month grid.
//
// It knows nothing about boardings or meet and greets — the page hands it
// entries that already carry a name, a colour and a date range. That is what
// lets a stay and an appointment sit in the same lane system without this
// file growing a branch for each.

export interface MonthEntry extends CalendarItem {
  name: string;
  /** Shown on hover. The grid is too small for dates and owners. */
  detail: string;
  dog: Dog | null;
  /** Tailwind background and text classes for the bar. */
  color: string;
  icon?: string;
}

export default function MonthGrid({
  month,
  weeks,
  entries,
  rowsPerDay,
  today,
  selectedDay,
  onSelectDay,
}: {
  month: Date;
  weeks: Date[][];
  entries: MonthEntry[];
  rowsPerDay: number;
  today: string;
  selectedDay: string | null;
  onSelectDay: (key: string | null) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase tracking-wide text-ink-3">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      {/* One row per week, because a bar can only span days on the same row.
          Each row is three stacked layers: the day cells, which take the
          clicks; the day numbers; and the bars. The upper two let clicks
          through, so tapping anywhere on a day still opens it. */}
      <div className="space-y-1">
        {weeks.map((week) => {
          const keys = week.map(dateKey);
          const { visible, hiddenPerCol, laneCount } = layoutWeek(entries, keys, rowsPerDay);
          return (
            <div key={keys[0]} className="relative min-h-[74px]">
              <div className="absolute inset-0 grid grid-cols-7 gap-1">
                {week.map((d, i) => {
                  const key = keys[i];
                  const inMonth = d.getMonth() === month.getMonth();
                  return (
                    <div
                      key={key}
                      role="button"
                      tabIndex={0}
                      aria-pressed={key === selectedDay}
                      aria-label={prettyDateKey(key)}
                      onClick={() => onSelectDay(key === selectedDay ? null : key)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectDay(key === selectedDay ? null : key);
                        }
                      }}
                      className={`cursor-pointer rounded-lg border transition ${
                        key === today ? "border-accent-400 bg-accent-50/40" : "border-line-soft"
                      } ${key === selectedDay ? "ring-2 ring-accent-400" : ""} ${
                        inMonth ? "bg-surface" : "bg-surface-2"
                      }`}
                    />
                  );
                })}
              </div>

              <div className="pointer-events-none relative grid grid-cols-7 gap-1">
                {week.map((d, i) => {
                  const key = keys[i];
                  const inMonth = d.getMonth() === month.getMonth();
                  return (
                    <div
                      key={key}
                      className="flex items-baseline justify-between px-1.5 pt-1 text-[11px]">
                      <span
                        className={`font-medium ${
                          key === today
                            ? "text-accent-600"
                            : inMonth
                              ? "text-ink-2"
                              : "text-ink-3/60"
                        }`}>
                        {d.getDate()}
                      </span>
                      {hiddenPerCol[i] > 0 && (
                        <span
                          className="text-[10px] font-medium text-ink-3"
                          title={`${hiddenPerCol[i]} more not shown — open the day, or switch to Everything`}>
                          +{hiddenPerCol[i]}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {visible.length > 0 && (
                <div
                  className="pointer-events-none relative mt-1 grid grid-cols-7 gap-x-1 pb-1"
                  style={{ gridTemplateRows: `repeat(${laneCount}, 18px)`, rowGap: "2px" }}>
                  {visible.map((seg) => (
                    <div
                      key={seg.item.id}
                      title={seg.item.detail}
                      style={{
                        gridColumn: `${seg.startCol + 1} / span ${seg.span}`,
                        gridRow: seg.lane + 1,
                      }}
                      // A flat edge is the signal that a stay carries on past
                      // the end of the row rather than finishing there.
                      className={`pointer-events-auto flex min-w-0 items-center gap-1 overflow-hidden px-1.5 text-[11px] leading-[18px] ${
                        seg.item.color
                      } ${seg.openLeft ? "rounded-l-none" : "ml-0.5 rounded-l-full"} ${
                        seg.openRight ? "rounded-r-none" : "mr-0.5 rounded-r-full"
                      }`}>
                      {seg.item.icon && <span aria-hidden>{seg.item.icon}</span>}
                      <span className="truncate" onClick={(e) => e.stopPropagation()}>
                        <DogLink dog={seg.item.dog} name={seg.item.name} />
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
