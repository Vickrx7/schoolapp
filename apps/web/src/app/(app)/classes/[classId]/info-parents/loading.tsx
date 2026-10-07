/** What « Info-parents » shows while it loads: the title, the buttons and the list. */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-slate-200" />
      <div className="h-12 animate-pulse rounded-xl bg-slate-100" />
      <div className="h-11 w-72 animate-pulse rounded-lg bg-slate-200" />
      <div className="h-40 animate-pulse rounded-xl bg-slate-100" />
    </div>
  );
}
