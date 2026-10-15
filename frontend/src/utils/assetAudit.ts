// src/utils/assetAudit.ts
//
// The monthly asset audit, as the screens need it (owner, 2026-10-14). The server decides and
// re-checks everything (`nirmaan_stack/services/asset_audit.py`, `services/asset_audit_open.py`,
// `api/assets/audits.submit_audit`); this copy decides what a screen shows and enables.

import { formatDate } from "@/utils/FormatDate";

/**
 * The conditions an audit sent before 2026-10-15 started its history text with ("Poor · was Good · for 11/2026").
 * Audits no longer set a condition (owner, 2026-10-15); this only reads those rows. Mirrors `AUDIT_CONDITIONS` in
 * services/asset_audit.py.
 */
export const AUDIT_CONDITIONS = ["Good", "Fair", "Poor", "Damaged"] as const;
export type AuditCondition = (typeof AUDIT_CONDITIONS)[number];

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

/** The profile asset card's background: light red, light yellow, or plain. */
export type AssetCardTone = "overdue" | "pending" | null;

/**
 * The profile asset card's tint (owner, 2026-10-15): red while its audit is overdue, yellow while the
 * declaration or the audit is pending, plain otherwise -- the worse one wins. Read from the same audit
 * badge the card shows, so the tint and the audit line always agree (grace days stay yellow).
 */
export function assetCardTone(declarationPending: boolean, audit: AuditBadge | null | undefined): AssetCardTone {
  if (audit?.tone === "overdue") return "overdue";
  if (declarationPending || audit?.tone === "pending") return "pending";
  return null;
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
  /** The month the audit was for (MM/YYYY); null on a row written before it was recorded. */
  forMonth: string | null;
  remarks: string | null;
}

/**
 * Reads an "Audit Fulfilled" history text back: "for 09/2026 · Kept in the site store" (the server's
 * `fulfilled_text`); a row sent before 2026-10-15 also starts with a condition, which is skipped.
 */
export function parseFulfilledText(reason: string | null | undefined): FulfilledAudit {
  const parts = (reason ?? "").split(" · ");
  // A row sent before 2026-10-15 starts with a condition and maybe "was <old>": skipped, audits no longer set one.
  if (AUDIT_CONDITIONS.includes(parts[0] as AuditCondition)) {
    parts.shift();
    if (parts[0]?.startsWith("was ")) parts.shift();
  }
  let forMonth: string | null = null;
  if (/^for \d{2}\/\d{4}$/.test(parts[0] ?? "")) forMonth = parts.shift()!.slice(4);
  const remarks = parts.join(" · ").trim();
  return { forMonth, remarks: remarks || null };
}


// ---------------------------------------------------------------------------------------------------------------
// The audit questions (owner, 2026-10-15) live in `assetAuditQuestions.ts`, one fixed set per category type; the
// dialog shows them with no request. Here: their shape, the dialog's check, what it sends (each answer with its
// question and choice text -- the server checks only the shape, `services/asset_audit.clean_answers`) and the one
// reader of the saved answers.

/** One choice of a question; a `flag` choice is a red answer that opens an optional text box. */
export interface AuditChoice {
  id: string;
  label: string;
  flag: boolean;
}

/** A question of `assetAuditQuestions.ts`. */
export interface AuditQuestion {
  id: string;
  question: string;
  hint: string | null;
  /** The prompt over the text box a red answer opens: "What's damaged?". */
  text_prompt: string;
  choices: AuditChoice[];
}

/** What the holder picked for one question in the dialog (the text only matters under a red answer). */
export interface PickedAnswer {
  choice: string;
  text?: string;
}

/** A saved answer: the question and the choice as they were asked, the red mark, and the optional text. */
export interface AuditAnswer {
  id: string;
  q: string;
  a: string;
  flag?: 1;
  text?: string;
}

/** Why the questions block isn't done yet, or null. */
export function auditAnswersProblem(questions: readonly AuditQuestion[], picked: Readonly<Record<string, PickedAnswer>>): string | null {
  const left = questions.filter((q) => !picked[q.id]?.choice).length;
  return left ? `Answer all ${questions.length} questions (${left} left).` : null;
}

/**
 * The `answers` argument of `submit_audit`: each answered question with its question and choice text as shown,
 * `flag: 1` on a red answer, and the note typed under a red answer (trimmed; left out when empty).
 */
export function auditAnswersPayload(
  questions: readonly AuditQuestion[],
  picked: Readonly<Record<string, PickedAnswer>>
): AuditAnswer[] {
  return questions.flatMap((q) => {
    const answer = picked[q.id];
    const choice = q.choices.find((c) => c.id === answer?.choice);
    if (!choice) return [];
    if (!choice.flag) return [{ id: q.id, q: q.question, a: choice.label }];
    const text = (answer?.text ?? "").trim();
    return [text ? { id: q.id, q: q.question, a: choice.label, flag: 1 as const, text } : { id: q.id, q: q.question, a: choice.label, flag: 1 as const }];
  });
}

/**
 * The one reader of a saved `audit_answers` (Asset Management, or an Audit Fulfilled history row). The server stores
 * `{"answers": [...]}`; a field may arrive as that object or as its JSON text, and anything else reads as no answers
 * (an audit sent before the questions existed).
 */
export function parseAuditAnswers(raw: unknown): AuditAnswer[] {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  const list = value && typeof value === "object" ? (value as { answers?: unknown }).answers : undefined;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { id, q, a, flag, text } = item as Record<string, unknown>;
    if (typeof q !== "string" || typeof a !== "string") return [];
    const answer: AuditAnswer = { id: typeof id === "string" ? id : q, q, a };
    if (flag) answer.flag = 1;
    if (typeof text === "string" && text.trim()) answer.text = text;
    return [answer];
  });
}

/** How many answers were red ("2 issues" on the Fulfilled list). */
export function countAuditIssues(answers: readonly AuditAnswer[]): number {
  return answers.filter((answer) => answer.flag).length;
}

/** "All OK", "1 issue", "2 issues"; null when the audit has no answers (sent before the questions). */
export function auditChecksLabel(answers: readonly AuditAnswer[]): string | null {
  if (!answers.length) return null;
  const issues = countAuditIssues(answers);
  return issues ? `${issues} ${issues === 1 ? "issue" : "issues"}` : "All OK";
}

/** The longest text under a red answer. Mirrors `MAX_ANSWER_TEXT_LENGTH` in services/asset_audit.py -- change both. */
export const MAX_AUDIT_ANSWER_TEXT = 200;

// ---------------------------------------------------------------------------------------------------------------
// The audit rows of the asset's history, in words (owner, 2026-10-15). The server writes compact text the screens
// read back ("Poor · was Good · for 11/2026"); people see labelled lines instead.

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "11/2026" -> "November 2026"; anything that isn't MM/YYYY comes back as it was. */
export function auditMonthName(label: string | null | undefined): string {
  const match = /^(0[1-9]|1[0-2])\/(\d{4})$/.exec(label ?? "");
  return match ? `${MONTH_NAMES[Number(match[1]) - 1]} ${match[2]}` : (label ?? "");
}

/** Why an audit opened outside the monthly runs: the note after the month on an "Audit Requested" row. */
const OPENED_BECAUSE: Record<string, string> = {
  handover: "opened when the declaration was signed",
  "category audit switched on": "opened when the category's audit was switched on",
  "return rejected": "opened when the return was rejected",
};

/** An audit history row in a few words, plus what the holder typed (sent audits only). */
export interface AuditHistorySummary {
  /** "For November 2026", "For November 2026 · opened by the monthly run", "October 2026 was not sent". */
  line: string;
  remarks: string | null;
}

/**
 * One short line for an audit history row, read from its stored text, so the entry stays small:
 * - Audit Requested "11/2026 · handover" -> "For November 2026 · opened when the declaration was signed"
 * - Audit Missed "10/2026" -> "October 2026 was not sent"
 * - Audit Fulfilled "for 11/2026 · Kept in store" -> "For November 2026", remarks "Kept in store"
 * Any other event, or no text: null.
 */
export function auditHistorySummary(event: string, reason: string | null | undefined): AuditHistorySummary | null {
  if (!reason) return null;
  if (event === "Audit Missed") return { line: `${auditMonthName(reason.trim())} was not sent`, remarks: null };
  if (event === "Audit Requested") {
    const [month, ...note] = reason.split(" · ");
    const why = note.join(" · ").trim();
    return { line: `For ${auditMonthName(month.trim())} · ${why ? (OPENED_BECAUSE[why] ?? why) : "opened by the monthly run"}`, remarks: null };
  }
  if (event === "Audit Fulfilled") {
    const sent = parseFulfilledText(reason);
    return { line: sent.forMonth ? `For ${auditMonthName(sent.forMonth)}` : "", remarks: sent.remarks };
  }
  return null;
}
