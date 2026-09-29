/** Skeleton while an absence page or plan loads. */
export default function AbsencesLoading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="h-8 w-64 animate-pulse rounded-lg bg-slate-200" />
      <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
      <div className="h-32 animate-pulse rounded-xl bg-slate-200" />
      <div className="h-32 animate-pulse rounded-xl bg-slate-200" />
    </div>
  );
}
