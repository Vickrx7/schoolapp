/** While a class device's page loads: calm, white, no flash on a tablet. */
export default function JouerLoading() {
  return (
    <div className="mx-auto max-w-xl space-y-6 py-4" aria-busy="true">
      <div className="h-12 w-3/4 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" />
      <div className="h-20 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none" />
      <div className="h-16 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none" />
    </div>
  );
}
