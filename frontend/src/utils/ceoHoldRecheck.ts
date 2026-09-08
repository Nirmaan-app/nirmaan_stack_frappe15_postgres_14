import { CEO_AUTHORIZED_USER } from "@/constants/ceoHold";

/**
 * CEO Hold — scheduled recheck (the "release now, decide on a named date" path).
 *
 * The authorized user may take a project OFF CEO Hold without its reasons having been
 * resolved, by naming the date on which the system re-runs the same evaluation. Until
 * that date the project is in scheduled-recheck mode and every backend CEO Hold hook
 * (payment / inflow / DN) skips its decision — only the daily cron can put the hold back.
 *
 * This module is the pure, testable half of that flow: WHEN the dialog must ask for a
 * date, and WHETHER the date it was given is usable. Both rules are mirrored server-side
 * in `Projects._validate_ceo_hold_recheck`; the UI copy of them exists so the CEO is
 * never shown a save that is going to be rejected.
 */

export const CEO_HOLD_STATUS = "CEO Hold";

/**
 * Target statuses that must NEVER schedule a recheck.
 *
 * "CEO Hold" is not a change at all, and Completed / Halted are terminal — a finished or
 * abandoned project must never be dragged back onto CEO Hold by a schedule left behind
 * on it. The backend normalises the same three away in `validate`, so this list is a
 * courtesy, not the enforcement.
 */
export const RECHECK_EXCLUDED_TARGET_STATUSES = [
  CEO_HOLD_STATUS,
  "Completed",
  "Halted",
] as const;

export interface RecheckTriggerInput {
  /** The project's status right now (before the change). */
  currentStatus?: string | null;
  /** The status the user just picked. */
  newStatus?: string | null;
  /** The logged-in user's id (`user_id` from the session). */
  userId?: string | null;
}

/**
 * True when the status change being made must ask for a CEO Hold recheck date.
 *
 * All four conditions have to hold: the project is on CEO Hold, the actor is the one
 * authorized CEO account, and the target status is a real change that is not terminal.
 * Anyone else moving a project off CEO Hold is rejected by the backend anyway — they are
 * never offered the date.
 */
export function shouldScheduleCeoHoldRecheck({
  currentStatus,
  newStatus,
  userId,
}: RecheckTriggerInput): boolean {
  if (currentStatus !== CEO_HOLD_STATUS) return false;
  if (userId !== CEO_AUTHORIZED_USER) return false;
  if (!newStatus) return false;
  return !RECHECK_EXCLUDED_TARGET_STATUSES.includes(
    newStatus as (typeof RECHECK_EXCLUDED_TARGET_STATUSES)[number]
  );
}

/** Today as `YYYY-MM-DD` in the browser's local timezone — the date input's min value. */
export function todayISO(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().split("T")[0];
}

/**
 * How far ahead the dialog pre-fills the recheck date: today + 2 days, i.e. the day after
 * tomorrow. A default, not a floor — the picker's `min` stays today, so the CEO can move
 * it either way, and in practice moves it further out.
 */
export const DEFAULT_RECHECK_OFFSET_DAYS = 2;

/**
 * The date the dialog opens with. Computed by day arithmetic on the LOCAL date (never by
 * adding milliseconds), so a DST shift in the window cannot land it on the wrong day.
 */
export function defaultRecheckDate(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  local.setUTCDate(local.getUTCDate() + DEFAULT_RECHECK_OFFSET_DAYS);
  return local.toISOString().split("T")[0];
}

/**
 * The recheck date is mandatory and may not be in the past; today itself is fine (the
 * cron picks it up on its next run, and it selects on `<= today`).
 */
export function isValidRecheckDate(
  date: string | undefined | null,
  now: Date = new Date()
): boolean {
  if (!date) return false;
  return date >= todayISO(now);
}
