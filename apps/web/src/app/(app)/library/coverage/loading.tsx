/** « Couverture du curriculum » while it loads (the overview, the grades, the attentes). */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="h-8 w-72 animate-pulse rounded-lg bg-slate-200" />
      <div className="h-40 animate-pulse rounded-xl bg-slate-200" />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-11 w-24 animate-pulse rounded-full bg-slate-200" />
        ))}
      </div>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-200" />
      ))}
    </div>
  );
}
