// src/utils/assetAudit.ts
//
// The monthly asset audit, as the screens need it (owner, 2026-10-14). The server decides and
// re-checks everything (`nirmaan_stack/services/asset_audit.py`, `services/asset_audit_open.py`,
// `api/assets/audits.submit_audit`); this copy decides what a screen shows and enables.

import { formatDate } from "@/utils/FormatDate";

/** What the holder can say about the asset. Mirrors `AUDIT_CONDITIONS` in services/asset_audit.py -- change both. */
export const AUDIT_CONDITIONS = ["Good", "Fair", "Poor", "Damaged"] as const;
export type AuditCondition = (typeof AUDIT_CONDITIONS)[number];

/** These need remarks of at least MIN_AUDIT_REMARKS_LENGTH characters (same as the server). */
export const CONDITIONS_NEEDING_REMARKS: readonly string[] = ["Poor", "Damaged"];
export const MIN_AUDIT_REMARKS_LENGTH = 10;

export const AUDIT_PENDING = "Pending";
export const AUDIT_FULFILLED = "Fulfilled";

/** The month an audit is for, as `Asset Management.audit_month` stores it: "09/2026". */
export function auditMonthLabel(day: Date): string {
  return `${String(day.getMonth() + 1).padStart(2, "0")}/${day.getFullYear()}`;
}

/**
 * The cycle (owner, 2026-10-14): from the 28th an audit belongs to the next month. Mirrors
 * `OPEN_NEXT_MONTH_DAY` in services/asset_audit.py -- change both.
 */
export const OPEN_NEXT_MONTH_DAY = 28;

/** The 1st of the month an audit opened on `day` is for: this month, or next month from the 28th. */
export function cycleMonth(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth() + (day.getDate() >= OPEN_NEXT_MONTH_DAY ? 1 : 0), 1);
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface AuditCycleRange {
  /** "1–27 Oct", "28–31 Oct" (just "28 Feb" when the month ends on the 28th). */
  days: string;
  /** The month an audit opened on those days is for: "10/2026", "11/2026". */
  month: string;
  /** `today` falls on these days. */
  current: boolean;
}

/**
 * `today`'s month split by the cycle (`cycleMonth`): opened the 1st–27th, the audit is for this month; from the
 * 28th, for the next. The category switch's confirm dialog shows it, so 11/2026 on 29 Oct is no surprise.
 */
export function auditCycleRanges(today: Date): [AuditCycleRange, AuditCycleRange] {
  const name = SHORT_MONTHS[today.getMonth()];
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const early = today.getDate() < OPEN_NEXT_MONTH_DAY;
  const late = lastDay > OPEN_NEXT_MONTH_DAY ? `${OPEN_NEXT_MONTH_DAY}–${lastDay}` : `${OPEN_NEXT_MONTH_DAY}`;
  return [
    { days: `1–${OPEN_NEXT_MONTH_DAY - 1} ${name}`, month: auditMonthLabel(today), current: early },
    { days: `${late} ${name}`, month: auditMonthLabel(new Date(today.getFullYear(), today.getMonth() + 1, 1)), current: !early },
  ];
}

/** "09/2026" -> the 1st of that month; null when it isn't MM/YYYY. */
function parseAuditMonth(label: string | null | undefined): Date | null {
  const match = /^(0[1-9]|1[0-2])\/(\d{4})$/.exec(label ?? "");
  return match ? new Date(Number(match[2]), Number(match[1]) - 1, 1) : null;
}

/**
 * True when an audit was sent after the month it was for: in the grace days, the 1st to the 7th of the next
 * month. One sent early (from the 28th, for the next month) is on time.
 */
export function sentLate(forMonth: string | null | undefined, sentOn: string | null | undefined): boolean {
  const month = parseAuditMonth(forMonth);
  if (!month || !sentOn) return false;
  const day = new Date(sentOn.slice(0, 10) + "T00:00:00");
  return !Number.isNaN(day.getTime()) && cycleMonth(day) > month;
}

/**
 * An open audit that is red (overdue): a month was recorded Missed on the 7th and nothing has been sent since
 * (`audit_overdue_since`, cleared by the server when an audit is sent). The grace days (to the 7th) are never
 * red. The badge, the sidebar icon and the Project / IT tab marks.
 */
export function isAuditOverdue(row: AuditRowFields): boolean {
  return row.audit_status === AUDIT_PENDING && !!row.audit_overdue_since;
}

/** The months recorded Missed in a row: from `audit_overdue_since` up to the month before the open audit's. */
export function overdueMonths(row: AuditRowFields): string[] {
  const since = parseAuditMonth(row.audit_overdue_since);
  if (!since) return row.audit_overdue_since ? [row.audit_overdue_since] : [];
  const open = parseAuditMonth(row.audit_month);
  const nextMonth = (day: Date) => new Date(day.getFullYear(), day.getMonth() + 1, 1);
  const labels = [auditMonthLabel(since)];
  for (let month = nextMonth(since); open && month < open; month = nextMonth(month)) labels.push(auditMonthLabel(month));
  return labels;
}

/** "09/2026, 10/2026, 11/2026, +2 more" -- a hover stays one line. */
function shortList(labels: string[], max = 3): string {
  return (labels.length > max ? [...labels.slice(0, max), `+${labels.length - max} more`] : labels).join(", ");
}

/** True when `remarks` must be given for `condition`. */
export function remarksRequired(condition: string | null | undefined): boolean {
  return CONDITIONS_NEEDING_REMARKS.includes(condition ?? "");
}

/**
 * Why the Submit audit form can't be sent yet, or null when it can. Same rules as the server's
 * `submit_refusal` (minus the status, which the card already decides).
 */
export function auditFormProblem(condition: string | null | undefined, hasPhoto: boolean, remarks: string): string | null {
  if (!AUDIT_CONDITIONS.includes(condition as AuditCondition)) return "Choose the asset's condition.";
  if (!hasPhoto) return "Add a photo of the asset.";
  if (remarksRequired(condition) && remarks.trim().length < MIN_AUDIT_REMARKS_LENGTH) {
    return `Say what is wrong with it (at least ${MIN_AUDIT_REMARKS_LENGTH} characters).`;
  }
  return null;
}

export interface AuditRowFields {
  audit_status?: string | null;
  audit_month?: string | null;
  last_audit_on?: string | null;
  audit_proof?: string | null;
  /** The first month of an unbroken run recorded Missed (MM/YYYY); cleared when an audit is sent. */
  audit_overdue_since?: string | null;
}

export type AuditBadgeTone = "pending" | "overdue" | "done" | "none" | "off";

export interface AuditBadge {
  /** "overdue" = red: a month was recorded Missed and nothing has been sent since (`isAuditOverdue`). */
  tone: AuditBadgeTone;
  /** Short, one line: "Audit pending · 11/2026", "Audit overdue since 09/2026", "Audit done 14-Oct-2026". */
  text: string;
  /** The longer detail, for a hover: "Overdue: 09/2026, 10/2026 · audit for 11/2026 open · last audit 04-Aug-2026". */
  hint?: string;
}

/**
 * The audit line an assignment shows (profile card, asset page, Assigned tab). No count of missed months
 * (owner, 2026-10-14): only since when it is overdue; the Missed rows stay in the history.
 *
 * @param categoryAudited the asset's category has "Monthly audit required" ticked.
 * @param category the category's name, for "Not audited: Chair".
 */
export function auditBadge(row: AuditRowFields, categoryAudited: boolean, category: string | null | undefined): AuditBadge {
  if (row.audit_status === AUDIT_PENDING) {
    const last = row.last_audit_on ? `last audit ${formatDate(row.last_audit_on)}` : "no audit sent yet";
    if (isAuditOverdue(row)) {
      return {
        tone: "overdue",
        text: `Audit overdue since ${row.audit_overdue_since}`,
        hint: `Overdue: ${shortList(overdueMonths(row))} · audit for ${row.audit_month} open · ${last}`,
      };
    }
    return { tone: "pending", text: `Audit pending · ${row.audit_month}`, hint: `Audit for ${row.audit_month} waiting to be sent · ${last}` };
  }
  if (row.audit_status === AUDIT_FULFILLED) {
    return { tone: "done", text: row.last_audit_on ? `Audit done ${formatDate(row.last_audit_on)}` : "Audit done" };
  }
  if (!categoryAudited) return { tone: "off", text: category ? `Not audited: ${category}` : "Not audited" };
  return { tone: "none", text: "No audit yet" };
}

export interface AuditSubmitContext {
  viewerId: string | null | undefined;
  /** `Asset Management.asset_assigned_to`. */
  assignedTo: string | null | undefined;
  /** `Asset Master.current_assignee`. */
  currentAssignee: string | null | undefined;
  auditStatus: string | null | undefined;
}

/** The holder, on their own asset, with an audit open: show Submit audit. */
export function canSubmitAudit({ viewerId, assignedTo, currentAssignee, auditStatus }: AuditSubmitContext): boolean {
  if (!viewerId || !assignedTo) return false;
  return viewerId === assignedTo && currentAssignee === assignedTo && auditStatus === AUDIT_PENDING;
}

/**
 * The audits the viewer can send now -- the sidebar badge, beside declarations to sign.
 *
 * @param heldAssets the assets whose `current_assignee` is `viewerId`.
 */
export function auditsToSubmit<T extends { asset: string; asset_assigned_to: string; audit_status?: string | null }>(
  viewerId: string | null | undefined,
  assignments: ReadonlyArray<T>,
  heldAssets: ReadonlySet<string>
): T[] {
  return assignments.filter((assignment) =>
    canSubmitAudit({
      viewerId,
      assignedTo: assignment.asset_assigned_to,
      currentAssignee: heldAssets.has(assignment.asset) ? viewerId : undefined,
      auditStatus: assignment.audit_status,
    })
  );
}

/** How many audits the viewer can send now (`auditsToSubmit`). */
export function countAuditsToSubmit(
  viewerId: string | null | undefined,
  assignments: ReadonlyArray<{ asset: string; asset_assigned_to: string; audit_status?: string | null }>,
  heldAssets: ReadonlySet<string>
): number {
  return auditsToSubmit(viewerId, assignments, heldAssets).length;
}

export interface FulfilledAudit {
  condition: string;
  /** The condition before this audit, when it changed. */
  previous: string | null;
  /** The month the audit was for (MM/YYYY); null on a row written before it was recorded. */
  forMonth: string | null;
  remarks: string | null;
}

/**
 * Reads an "Audit Fulfilled" history text back: "Damaged · was Fair · for 09/2026 · screen cracked".
 * Written by the server's `fulfilled_text`, which always starts with the condition.
 */
export function parseFulfilledText(reason: string | null | undefined): FulfilledAudit {
  const parts = (reason ?? "").split(" · ");
  const condition = parts.shift() ?? "";
  let previous: string | null = null;
  if (parts[0]?.startsWith("was ")) previous = parts.shift()!.slice(4);
  let forMonth: string | null = null;
  if (/^for \d{2}\/\d{4}$/.test(parts[0] ?? "")) forMonth = parts.shift()!.slice(4);
  const remarks = parts.join(" · ").trim();
  return { condition, previous, forMonth, remarks: remarks || null };
}

/** True when `condition` is worse than `previous` (Good < Fair < Poor < Damaged; "New" counts as Good). */
export function conditionGotWorse(previous: string | null | undefined, condition: string | null | undefined): boolean {
  const rank = (value: string | null | undefined) => {
    if (value === "New") return 0;
    const index = AUDIT_CONDITIONS.indexOf(value as AuditCondition);
    return index;
  };
  const before = rank(previous);
  const after = rank(condition);
  return before >= 0 && after >= 0 && after > before;
}
