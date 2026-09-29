/** Skeleton while a portal page loads. */
export default function PortalLoading() {
  return (
    <div className="space-y-4 py-4" aria-busy="true">
      <div className="h-8 w-56 animate-pulse rounded-lg bg-slate-200" />
      <div className="h-20 animate-pulse rounded-xl bg-slate-200" />
      <div className="h-32 animate-pulse rounded-xl bg-slate-200" />
    </div>
  );
}
