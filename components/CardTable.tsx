"use client";

import { useEffect, useRef } from "react";

/**
 * A table that stops being a table on a phone.
 *
 * Below sm each row becomes a card and the cells lay out in two columns —
 * see the table-cards block in globals.css. A cell needs to carry its own
 * label once it does, because the header row it was sitting under is gone.
 *
 * Those labels are copied from the header rather than written out beside
 * every cell. Eight columns across seventeen tables is roughly ninety
 * hand-written attributes, and the moment a column is renamed the copy
 * beside the cell says something the header no longer does. Reading them
 * from the thead means there is one name per column and it cannot go stale.
 *
 * A row that is one cell spanning the table is a band, not a record — the
 * service headings in the sign-in list — so it keeps the full width instead
 * of being given a label.
 *
 * data-span and data-align set by hand are left alone. The header knows what
 * a column is called; it does not know that the dog belongs across the top
 * of the card and the price in the bottom corner.
 */
export default function CardTable({
  className = "",
  children,
  ...rest
}: React.TableHTMLAttributes<HTMLTableElement>) {
  const ref = useRef<HTMLTableElement>(null);

  useEffect(() => {
    const table = ref.current;
    if (!table) return;

    const sync = () => {
      const headings = Array.from(table.querySelectorAll("thead th")).map((th) =>
        (th.textContent ?? "").trim()
      );
      if (!headings.length) return;

      table.querySelectorAll("tbody tr").forEach((row) => {
        const cells = Array.from(row.children).filter(
          (child): child is HTMLTableCellElement => child.tagName === "TD"
        );

        // A single cell spanning the table is a heading for the rows under
        // it. Labelling it would be labelling a label.
        if (cells.length === 1 && cells[0].hasAttribute("colspan")) {
          cells[0].setAttribute("data-span", "2");
          return;
        }

        cells.forEach((cell, i) => {
          const heading = headings[i];
          // An empty header is a column with no name — a row of buttons, or
          // the spacer some of these tables open with. Nothing to say.
          if (heading) cell.setAttribute("data-label", heading);

          // The first column is the identifier in every one of these tables —
          // the date, the vaccine, the household, the account — so it runs
          // across the top of the card and reads as its title. It also stops
          // an odd number of columns leaving a half-empty last row: five
          // cells paired off as 2/2/1 looked like a mistake, where a title
          // and two pairs does not.
          //
          // Not applied over a data-span written by hand: a table that has
          // already said how it wants to sit knows better than this does.
          if (i === 0 && !cell.hasAttribute("data-span")) {
            cell.setAttribute("data-span", "2");
          }
        });
      });
    };

    sync();

    // Rows arrive after the first paint, and change as staff edit them. The
    // observer watches structure only: setting an attribute does not fire a
    // childList record, so this cannot re-trigger itself.
    const observer = new MutationObserver(sync);
    observer.observe(table, { childList: true, subtree: true });
    return () => observer.disconnect();
  });

  return (
    <table ref={ref} className={`table-cards ${className}`} {...rest}>
      {children}
    </table>
  );
}
