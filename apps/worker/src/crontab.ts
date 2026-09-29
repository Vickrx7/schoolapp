/**
 * The worker's schedule (graphile-worker crontab lines: `<cron> <task> ?jobKey=…`). Every task
 * named here needs an entry in `buildTaskList` (tasks.ts); a test checks it.
 */
export const CRONTAB_LINES: readonly string[] = [
  // Safety net: sweep the outbox every minute in case a notification was missed.
  '* * * * * dispatch_outbox ?jobKey=dispatch_outbox&jobKeyMode=preserve_run_at',
  '17 * * * * ai_maintenance ?jobKey=ai_maintenance',
  // Daily substitute access retention (old codes, sign-in attempts, report notes).
  '43 3 * * * sub_access_maintenance ?jobKey=sub_access_maintenance',
  // Class mode (D-089): expired sessions lose their answers even if nobody calls again.
  '*/5 * * * * class_mode_maintenance ?jobKey=class_mode_maintenance',
  // Bulk generation (D-095): submits, cancels and collects batches; also woken by its events.
  '*/5 * * * * library_bulk_tick ?jobKey=library_bulk_tick',
  // Library clean-up (D-101): bulk runs and requests, staged pack imports.
  '23 3 * * * library_maintenance ?jobKey=library_maintenance',
];

/** The task a crontab line runs. */
export function cronTask(line: string): string {
  const task = line.trim().split(/\s+/)[5];
  if (!task) throw new Error(`crontab line without a task: ${line}`);
  return task;
}
