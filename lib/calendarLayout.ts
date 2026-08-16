// Packing a week row of the month calendar.
//
// The month grid used to draw one pill per dog per day, so a single dog
// staying a week appeared seven times. Ten dogs over a busy week meant
// seventy pills, and the only way to fit them was to cut each day off at
// three and hide the rest behind "+4 more" — crowded and incomplete at once.
//
// A stay is one thing that lasts a while, so it should be one bar that lasts
// a while. This works out, for one week row, where each bar starts, how many
// days it spans, and which lane it sits in so bars never overlap.
//
// Lanes are assigned longest-first: a seven-day stay claims lane 0 across the
// whole row, and the one-day appointments fill in around it. Doing it the
// other way round leaves a short booking sitting in the middle of lane 0 and
// forces every long stay down a level for no reason.

export interface CalendarItem {
  id: string;
  /** Long stays are laid out first; single-day appointments fill the gaps. */
  kind: "stay" | "meet";
  /** Inclusive YYYY-MM-DD bounds. A single-day item has start === end. */
  start: string;
  end: string;
}

export interface CalendarSegment<T> {
  item: T;
  /** 0-6, where in the week row the bar begins. */
  startCol: number;
  span: number;
  lane: number;
  /** True when the item began before this week — draw a flat left edge. */
  openLeft: boolean;
  /** True when it continues past this week — draw a flat right edge. */
  openRight: boolean;
}

export interface WeekLayout<T> {
  visible: CalendarSegment<T>[];
  /** How many items each day had to hide, indexed by column. */
  hiddenPerCol: number[];
  /** Lanes actually occupied, so the row can size itself to its content. */
  laneCount: number;
}

/**
 * @param weekKeys the seven YYYY-MM-DD keys of the row, Sunday first.
 * @param maxLanes rows of bars to draw before the rest become a "+n" count.
 */
export function layoutWeek<T extends CalendarItem>(
  items: T[],
  weekKeys: string[],
  maxLanes: number
): WeekLayout<T> {
  const first = weekKeys[0];
  const last = weekKeys[weekKeys.length - 1];

  const overlapping = items.filter((i) => i.start <= last && i.end >= first);

  // Longest first so multi-day stays get the top lanes and keep them; ties
  // broken by date then id purely so the order never wobbles between renders.
  const ordered = [...overlapping].sort((a, b) => {
    const spanA = span(a, weekKeys);
    const spanB = span(b, weekKeys);
    if (spanA !== spanB) return spanB - spanA;
    if (a.start !== b.start) return a.start.localeCompare(b.start);
    return a.id.localeCompare(b.id);
  });

  // What each lane already holds, as inclusive column ranges.
  const lanes: { from: number; to: number }[][] = [];
  const placed: CalendarSegment<T>[] = [];

  for (const item of ordered) {
    const from = startCol(item, weekKeys);
    const to = endCol(item, weekKeys);

    let lane = lanes.findIndex((taken) =>
      taken.every((r) => to < r.from || from > r.to)
    );
    if (lane === -1) {
      lanes.push([]);
      lane = lanes.length - 1;
    }
    lanes[lane].push({ from, to });

    placed.push({
      item,
      startCol: from,
      span: to - from + 1,
      lane,
      openLeft: item.start < weekKeys[from],
      openRight: item.end > weekKeys[to],
    });
  }

  const hiddenPerCol = new Array(weekKeys.length).fill(0);
  const visible: CalendarSegment<T>[] = [];
  for (const seg of placed) {
    if (seg.lane < maxLanes) {
      visible.push(seg);
      continue;
    }
    for (let c = seg.startCol; c < seg.startCol + seg.span; c++) hiddenPerCol[c] += 1;
  }

  return {
    visible,
    hiddenPerCol,
    laneCount: visible.reduce((n, s) => Math.max(n, s.lane + 1), 0),
  };
}

function startCol(item: CalendarItem, weekKeys: string[]): number {
  const i = weekKeys.findIndex((k) => k >= item.start);
  return i === -1 ? 0 : i;
}

function endCol(item: CalendarItem, weekKeys: string[]): number {
  for (let i = weekKeys.length - 1; i >= 0; i--) {
    if (weekKeys[i] <= item.end) return i;
  }
  return 0;
}

function span(item: CalendarItem, weekKeys: string[]): number {
  return endCol(item, weekKeys) - startCol(item, weekKeys) + 1;
}
