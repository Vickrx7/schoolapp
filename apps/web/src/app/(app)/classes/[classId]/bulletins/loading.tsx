/** What « Bulletins » shows while it loads: the title, the notice, the filters and the students. */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="h-8 w-64 animate-pulse rounded-lg bg-slate-200" />
      <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
      <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
      <div className="h-64 animate-pulse rounded-xl bg-slate-200" />
    </div>
  );
}
