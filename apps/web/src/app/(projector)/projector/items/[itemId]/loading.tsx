/** While the slides load: a white screen with the shape of the player (no flash on a projector). */
export default function PresenterLoading() {
  return (
    <div className="flex h-dvh flex-col bg-white" aria-busy="true">
      <div className="flex-1 space-y-6 px-[5vw] py-[8vh]">
        <div className="h-16 w-3/5 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" />
        <div className="h-10 w-4/5 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" />
        <div className="h-10 w-2/3 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" />
      </div>
      <div className="h-[4.5rem] border-t border-slate-200 bg-slate-50" />
    </div>
  );
}
