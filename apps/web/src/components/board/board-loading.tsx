/** What « Conseil » pages show while they load: the title, the tabs and two cards. */
export function BoardLoading() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-slate-200" />
      <div className="h-11 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-24 animate-pulse rounded-xl bg-slate-200" />
      <div className="h-24 animate-pulse rounded-xl bg-slate-200" />
    </div>
  );
}
