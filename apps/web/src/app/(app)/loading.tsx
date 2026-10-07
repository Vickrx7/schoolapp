export default function Loading() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-slate-200" />
      <div className="h-24 animate-pulse rounded-xl bg-slate-200" />
      <div className="h-24 animate-pulse rounded-xl bg-slate-200" />
    </div>
  );
}
