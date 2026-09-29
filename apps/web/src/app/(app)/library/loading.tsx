/** The library hub and results while they load (search field, category tiles, cards). */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="h-8 w-64 animate-pulse rounded-lg bg-slate-200" />
      <div className="h-11 animate-pulse rounded-lg bg-slate-200" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-200" />
        ))}
      </div>
      <div className="h-24 animate-pulse rounded-xl bg-slate-200" />
    </div>
  );
}
