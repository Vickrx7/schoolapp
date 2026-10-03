/** What « Couverture » shows while it loads: the tabs, the title and the subjects. */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="h-11 w-72 animate-pulse rounded-full bg-slate-100" />
      <div className="h-8 w-64 animate-pulse rounded-lg bg-slate-200" />
      <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
      <div className="h-64 animate-pulse rounded-xl bg-slate-200" />
    </div>
  );
}
