export function PriceTable({
  title,
  rows,
  note,
}: {
  title: string;
  rows: { label: string; price: string }[];
  note?: string;
}) {
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-card">
      <div className="border-b border-slate-100 bg-slate-50 px-6 py-4">
        <h3 className="font-display text-lg font-semibold text-slate-900">{title}</h3>
      </div>
      <ul className="divide-y divide-slate-100">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between px-6 py-3.5 text-sm">
            <span className="text-slate-600">{row.label}</span>
            <span className="font-semibold text-slate-900">{row.price}</span>
          </li>
        ))}
      </ul>
      {note && (
        <p className="border-t border-slate-100 bg-slate-50 px-6 py-3 text-xs text-slate-500">
          {note}
        </p>
      )}
    </div>
  );
}
