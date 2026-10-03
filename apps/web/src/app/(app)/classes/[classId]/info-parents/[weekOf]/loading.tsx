/** What a week's message shows while it loads: the notice, the header and the sections. */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="h-8 w-64 animate-pulse rounded-lg bg-slate-200" />
      <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
      <div className="h-28 animate-pulse rounded-xl bg-slate-100" />
      <div className="h-64 animate-pulse rounded-xl bg-slate-200" />
    </div>
  );
}
