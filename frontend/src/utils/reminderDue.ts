import { differenceInCalendarDays, parseISO } from "date-fns";

/** How close a reminder's Next Due Date is, for the Reminders page colour chip. */
export type DueTone = "soon" | "month" | "later" | "past";

export interface DueChip {
  tone: DueTone;
  /** Whole calendar days from today to the due date (negative once it has passed). */
  days: number;
  /** "today", "in 8d", or "2d ago". */
  label: string;
}

/**
 * Classify a reminder's stored Next Due Date against today.
 *
 * - `soon`  — due within 7 days, or its Reminds On date has already arrived;
 * - `month` — due within 31 days;
 * - `later` — further out;
 * - `past`  — the date has passed (the 8 AM job has not rolled it forward yet).
 *
 * Dates are the backend's `YYYY-MM-DD` strings, read as local calendar days so the
 * count never shifts by a day across time zones. Returns null when there is no date.
 */
export function dueChip(
  nextDue: string | null | undefined,
  remindsOn: string | null | undefined,
  today: Date = new Date()
): DueChip | null {
  if (!nextDue) return null;
  const days = differenceInCalendarDays(parseISO(nextDue), today);
  const fired = !!remindsOn && differenceInCalendarDays(parseISO(remindsOn), today) <= 0;

  let tone: DueTone;
  if (days < 0) tone = "past";
  else if (days <= 7 || fired) tone = "soon";
  else if (days <= 31) tone = "month";
  else tone = "later";

  const label = days === 0 ? "today" : days > 0 ? `in ${days}d` : `${-days}d ago`;
  return { tone, days, label };
}

/** Tailwind classes for each tone, light and dark. */
export const DUE_TONE_CLASS: Record<DueTone, string> = {
  soon: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  month: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  later: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  past: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
};

/**
 * A Role Profile name without the "Nirmaan " prefix and " Profile" suffix, for compact
 * chips ("Nirmaan Accountant Lead Profile" -> "Accountant Lead"). Display only; the full
 * name stays the value everywhere else.
 */
export function shortRoleProfile(name: string): string {
  const short = name.replace(/^Nirmaan\s+/, "").replace(/\s+Profile$/, "").trim();
  return short || name;
}

// Role chip colours, light and dark. The first three are reserved for the roles nearly every
// reminder targets, so those three never share a colour; every other role hashes into the rest.
const ROLE_TONES = [
  "bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:ring-indigo-800",
  "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-800",
  "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:ring-sky-800",
  "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-800",
  "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-800",
  "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:ring-violet-800",
  "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-950/50 dark:text-teal-300 dark:ring-teal-800",
  "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950/50 dark:text-orange-300 dark:ring-orange-800",
  "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200 dark:bg-fuchsia-950/50 dark:text-fuchsia-300 dark:ring-fuchsia-800",
  "bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-950/50 dark:text-cyan-300 dark:ring-cyan-800",
];
const FIXED_ROLE_TONE: Record<string, number> = { Admin: 0, Accountant: 1, "Accountant Lead": 2 };
const RESERVED = Object.keys(FIXED_ROLE_TONE).length;

/**
 * Colour classes for a Role Profile chip. The same role always gets the same colour (full or
 * short name), so a role can be spotted across rows at a glance.
 */
export function roleChipClass(name: string): string {
  const short = shortRoleProfile(name);
  const fixed = FIXED_ROLE_TONE[short];
  if (fixed !== undefined) return ROLE_TONES[fixed];
  let hash = 0;
  for (const ch of short) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return ROLE_TONES[RESERVED + (hash % (ROLE_TONES.length - RESERVED))];
}
