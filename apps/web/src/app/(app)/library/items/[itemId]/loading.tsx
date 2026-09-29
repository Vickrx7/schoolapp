/** « Fiche de la ressource » while it loads: header, badges, version chips, tabs and a sheet. */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
      <div className="h-8 w-3/4 animate-pulse rounded-lg bg-slate-200" />
      <div className="flex gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-6 w-24 animate-pulse rounded-full bg-slate-200" />
        ))}
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-11 w-28 animate-pulse rounded-full bg-slate-200" />
        ))}
      </div>
      <div className="h-11 animate-pulse rounded-lg bg-slate-200" />
      <div className="h-72 animate-pulse rounded-xl bg-slate-200" />
    </div>
  );
}
