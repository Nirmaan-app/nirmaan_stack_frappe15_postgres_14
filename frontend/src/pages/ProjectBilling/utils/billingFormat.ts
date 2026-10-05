// Pure display helpers for the billing tracker. No React, no data fetching.

import {
  APPROVED_STATUSES,
  BILL_STATUSES,
  NA_STATUS,
  PENDING_STATUSES,
  SUBMITTED_OR_LATER,
  SUBMITTED_STATUS,
} from "../billing.constants";
import type { BillingManagerRef } from "../types";

export type Tone = "neutral" | "warning" | "serious" | "critical" | "good";

/** Badge classes per tone (Tailwind). */
export const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-gray-100 text-gray-600 border-gray-200",
  warning: "bg-amber-50 text-amber-700 border-amber-200",
  serious: "bg-orange-50 text-orange-700 border-orange-200",
  critical: "bg-red-50 text-red-700 border-red-200",
  good: "bg-green-50 text-green-700 border-green-200",
};

export const isApproved = (status?: string | null) => !!status && APPROVED_STATUSES.includes(status);
export const isPending = (status?: string | null) => !!status && PENDING_STATUSES.includes(status);
export const isNA = (status?: string | null) => status === NA_STATUS;

/** Colour of a bill status badge. */
export function statusTone(status?: string | null): Tone {
  if (!status || status === "Not Started" || isNA(status)) return "neutral";
  if (status === "Client Hold") return "critical";
  if (status === "Revision Pending") return "serious";
  if (isApproved(status)) return "good";
  return "warning";
}

const TONE_URGENCY: Tone[] = ["critical", "serious", "warning", "neutral", "good"];

/**
 * Colour of a count that stands for several statuses (a manager-summary column): the most
 * urgent of their status-badge tones, so the count reads like the badges it stands for.
 */
export function columnTone(statuses: readonly string[]): Tone {
  const tones = new Set(statuses.map(statusTone));
  return TONE_URGENCY.find((t) => tones.has(t)) ?? "neutral";
}

/** Indian-grouped rupees, e.g. 8663892 -> "₹86,63,892". Empty -> "—". */
export function inr(value?: number | string | null): string {
  if (value === null || value === undefined || value === "") return "—";
  const num = Number(value);
  if (Number.isNaN(num)) return "—";
  const neg = num < 0;
  const digits = String(Math.round(Math.abs(num)));
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `${neg ? "-" : ""}₹${grouped}`;
}

/** Short rupees for tight spaces: "₹1.24 Cr", "₹18.5 L", else full. */
export function inrShort(value?: number | string | null): string {
  if (value === null || value === undefined || value === "") return "—";
  const num = Number(value);
  if (Number.isNaN(num)) return "—";
  const abs = Math.abs(num);
  const sign = num < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2).replace(/\.?0+$/, "")} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1).replace(/\.0$/, "")} L`;
  return inr(num);
}

/** Whole percent of part / whole, 0 when whole is 0. */
export function pct(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

function dayDiff(iso: string, today: Date): number {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d.getTime() - t.getTime()) / 86_400_000);
}

/** Tag beside an ETA: "3d overdue", "Today", "Tomorrow", "In 5d", or null. */
export function etaTag(iso?: string | null, today: Date = new Date()): { label: string; tone: Tone } | null {
  if (!iso) return null;
  const diff = dayDiff(iso, today);
  if (diff < 0) return { label: `${-diff}d overdue`, tone: "critical" };
  if (diff === 0) return { label: "Today", tone: "serious" };
  if (diff === 1) return { label: "Tomorrow", tone: "warning" };
  if (diff <= 7) return { label: `In ${diff}d`, tone: "warning" };
  return null;
}

/** How fresh a package's Supply DC is. */
export function dcFreshness(iso?: string | null, today: Date = new Date()): { label: string; tone: Tone; isToday: boolean } {
  if (!iso) return { label: "Never updated", tone: "warning", isToday: false };
  const ago = -dayDiff(iso, today);
  if (ago <= 0) return { label: "Updated today", tone: "good", isToday: true };
  if (ago === 1) return { label: "Updated yesterday", tone: "neutral", isToday: false };
  return { label: `${ago} days ago`, tone: "warning", isToday: false };
}

/**
 * A typed billing package name: outer spaces dropped, inner runs of spaces made one.
 * Mirrors `rules.clean_package_name`, which the server applies before saving.
 */
export function cleanPackageName(name?: string | null): string {
  return (name ?? "").split(/\s+/).filter(Boolean).join(" ");
}

/** The existing package a new name clashes with, ignoring case; null when it is free. */
export function clashingPackage(name: string, existing: readonly string[]): string | null {
  const wanted = cleanPackageName(name).toLowerCase();
  return (wanted && existing.find((n) => n.toLowerCase() === wanted)) || null;
}

/**
 * A typed PO value in rupees, plain amounts only (no L / cr): blank is 0; unreadable or negative
 * is null. A package can only be saved with a PO value greater than 0 (owner, 2026-10-05).
 */
export function poAmount(typed: string): number | null {
  if (!typed.trim()) return 0;
  const n = parsePlainAmount(typed);
  return n === null || n < 0 ? null : n;
}

/** A saved PO value as the setup box shows it: "92,00,000"; blank for 0. */
export function poInputOf(value?: number | null): string {
  if (!value) return "";
  return Number.isInteger(value) ? inr(value).replace("₹", "") : String(value);
}

/** Manager names in the order they were picked; empty when nobody is assigned. */
export function managerNames(managers?: BillingManagerRef[] | null): string[] {
  return (managers || []).map((m) => m.full_name || m.user);
}

/** Filter value meaning "packages with no manager". */
export const UNASSIGNED = "__unassigned__";

/** Everyone who manages any of `trackers`, by name, then "Unassigned" when some package has nobody. */
export function assigneeOptions(trackers: { billing_managers?: BillingManagerRef[] | null }[]): { value: string; label: string }[] {
  const seen = new Map<string, string>();
  let anyUnassigned = false;
  trackers.forEach((t) => {
    if (!t.billing_managers?.length) anyUnassigned = true;
    t.billing_managers?.forEach((m) => {
      if (!seen.has(m.user)) seen.set(m.user, m.full_name || m.user);
    });
  });
  const people = [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  return anyUnassigned ? [...people, { value: UNASSIGNED, label: "Unassigned" }] : people;
}

/**
 * Names of the trackers assigned to any of `people` (user ids, or UNASSIGNED for packages with
 * no manager). Assignees live on the package, so this is how a bill list filters by person.
 */
export function trackersAssignedTo(
  trackers: { name: string; billing_managers?: BillingManagerRef[] | null }[],
  people: readonly string[],
): string[] {
  const wanted = new Set(people);
  return trackers
    .filter((t) =>
      t.billing_managers?.length
        ? t.billing_managers.some((m) => wanted.has(m.user))
        : wanted.has(UNASSIGNED),
    )
    .map((t) => t.name);
}

/** One package row of the setup dialog. */
export interface PackageSetup {
  managers: string[];
  /** As typed: "4500000", "45L", "1.2cr". Blank = not entered yet. */
  po: string;
}

/** The setup dialog's figures: total PO value and which ticked packages still lack something. */
export function setupSummary(rows: Record<string, PackageSetup>) {
  const entries = Object.entries(rows);
  const missing = (test: (row: PackageSetup) => boolean) => entries.filter(([, row]) => test(row)).map(([pkg]) => pkg);
  return {
    count: entries.length,
    total: entries.reduce((sum, [, row]) => sum + (poAmount(row.po) ?? 0), 0),
    noManager: missing((row) => !row.managers.length),
    noPoValue: missing((row) => poAmount(row.po) === 0),
    unreadable: missing((row) => poAmount(row.po) === null),
  };
}

export type DcEntryMode = "add" | "correct";

/**
 * Which bill fields the bill's status makes required (owner, 2026-10-05). An NA bill (NA status or
 * NA bill type) needs none. Mirrors `rules.missing_bill_fields`, which the server applies on save.
 */
export function billRequirements(status: string, billType: string) {
  const na = status === NA_STATUS || billType === NA_STATUS;
  return {
    billValue: !na,
    eta: !na && PENDING_STATUSES.includes(status),
    document: !na && SUBMITTED_OR_LATER.includes(status),
    payment: !na && status === "Partial Payment Received",
  };
}

/**
 * Is this save moving a bill past Submitted without ever being Submitted? Only Submitted stamps the
 * first submission date (owner, 2026-10-05), so such a bill keeps it empty; the drawer warns.
 * `savedStatus` is the status as saved (undefined for a new bill).
 */
export function skipsSubmitted(status: string, savedStatus: string | undefined, hasFirstSubmission: boolean): boolean {
  return (
    !hasFirstSubmission &&
    status !== savedStatus &&
    status !== SUBMITTED_STATUS &&
    SUBMITTED_OR_LATER.includes(status)
  );
}

export interface BillForCheck {
  status: string;
  bill_type: string;
  bill_value: string;
  eta_date: string;
  hasDocument: boolean;
  payment_received: string;
}

/** Which fields the bill's status requires and are still empty (or not above 0, for amounts). */
export function billMissingFields(bill: BillForCheck) {
  const need = billRequirements(bill.status, bill.bill_type);
  const positive = (typed: string) => (parsePlainAmount(typed) ?? 0) > 0;
  return {
    billValue: need.billValue && !positive(bill.bill_value),
    eta: need.eta && !bill.eta_date,
    document: need.document && !bill.hasDocument,
    payment: need.payment && !positive(bill.payment_received),
  };
}

/** What a bill still lacks for its status, as labels in the server's order; [] when it can be saved. */
export function billMissing(bill: BillForCheck): string[] {
  const gaps = billMissingFields(bill);
  return [
    gaps.billValue ? "Bill value (greater than 0)" : "",
    gaps.eta ? "ETA date" : "",
    gaps.document ? "Bill document (a link or an attachment)" : "",
    gaps.payment ? "Payment received (greater than 0)" : "",
  ].filter(Boolean);
}

/**
 * A typed money box that is filled in must hold a plain amount greater than 0 (owner, 2026-10-05).
 * Empty is fine: the field is optional. Returns the message to show, or "" when it is fine.
 */
export function amountProblem(typed: string): string {
  if (!typed.trim()) return "";
  const n = parsePlainAmount(typed);
  if (n === null) return "Numbers only, e.g. 250000";
  return n > 0 ? "" : "Enter an amount greater than 0";
}

/**
 * A plain rupee amount as typed in a billing money box: digits, an optional minus and up to two
 * decimals; spaces, commas and ₹ are ignored. No shorthand: "2.5L" or "1.2cr" is not a number
 * here (owner, 2026-10-05). Null when empty or not a plain number.
 */
export function parsePlainAmount(input?: string | null): number | null {
  const s = String(input ?? "").replace(/[₹,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Number(s);
}

/**
 * What a typed Supply DC value would save: "add" logs the typed amount, "correct" logs the
 * difference to the typed total. A non-empty `problem` blocks the save.
 * - The typed value must be greater than 0 in both modes (owner, 2026-10-05): a lower total is
 *   entered through "Correct total", and a zero day through "No delivery today".
 * - With a PO value set, the total may not rise above it (owner, 2026-10-05); the server checks
 *   the same rule.
 */
export function dcEntryPlan(
  mode: DcEntryMode,
  typed: number | null,
  current: number,
  poValue = 0,
): { amount: number | null; newTotal: number | null; problem: string } {
  if (typed === null) return { amount: null, newTotal: null, problem: "" };
  const amount = mode === "add" ? typed : typed - current;
  const newTotal = mode === "add" ? current + typed : typed;
  if (mode === "add" && Math.abs(typed) < 0.005) {
    return { amount, newTotal, problem: `0 can't be saved. If nothing was delivered, use "No delivery today".` };
  }
  if (typed < 0.005) {
    const problem =
      mode === "add" ? "Enter an amount greater than 0. To lower the total, use Correct total." : "Enter a total greater than 0.";
    return { amount, newTotal, problem };
  }
  if (Math.abs(amount) < 0.005) return { amount, newTotal, problem: "Same as the current total. Nothing to save." };
  if (poValue > 0 && newTotal > poValue + 0.005 && newTotal > current + 0.005) {
    return { amount, newTotal, problem: `More than the PO value (${inr(poValue)})` };
  }
  return { amount, newTotal, problem: "" };
}

/** One line under a package's progress bar: what is left between billed and approved. */
export function progressNote(billed: number, approved: number): string {
  if (!billed) return "Nothing billed yet";
  if (!approved) return "None approved yet";
  if (approved >= billed) return "All billed value approved";
  return `${inr(billed - approved)} awaiting approval`;
}

/** Colour of a project's status chip (Projects.status) in the Project Wise view. */
export function projectStatusTone(status?: string | null): Tone {
  if (!status) return "neutral";
  if (status === "WIP") return "warning";
  if (status === "Completed" || status === "Handover") return "good";
  if (status === "Halted" || status === "CEO Hold") return "critical";
  return "neutral";
}

export type BillDocMode = "link" | "file";

/**
 * Which input a bill's document opens in: Attachment when the bill has a file, else Link
 * (also when it has neither). A bill keeps one or the other, never both.
 */
export function billDocMode(bill?: { bill_attachment?: string | null } | null): BillDocMode {
  return bill?.bill_attachment ? "file" : "link";
}

/** A readable name for an attachment URL: its `file_name` query value, else the last path part. */
export function fileNameOf(url?: string | null): string {
  if (!url) return "";
  const [path, query = ""] = url.split("?");
  const named = new URLSearchParams(query).get("file_name");
  if (named) return named;
  const key = new URLSearchParams(query).get("key");
  const last = (key || path).split("/").pop() || url;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Frappe filters for the Bill Wise "Deadline" choice. A deadline only matters while a
 * bill is pending, so every choice keeps pending bills only (mirrors the server rule).
 */
export function deadlineFilters(choice: string, today: Date = new Date()): any[] {
  const pending = ["status", "in", [...PENDING_STATUSES]];
  const t = isoDate(today);
  if (choice === "overdue") return [pending, ["eta_date", "<", t]];
  if (choice === "week") {
    const week = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
    return [pending, ["eta_date", "between", [t, isoDate(week)]]];
  }
  if (choice === "none") return [pending, ["eta_date", "is", "not set"]];
  return [];
}

/** A project's deadline: the earliest ETA among its packages' next (pending) bills; null when none has one. */
export function projectDeadline(packages: { next_bill?: { eta_date?: string | null } | null }[]): string | null {
  const etas = packages.map((p) => p.next_bill?.eta_date).filter((d): d is string => !!d);
  return etas.length ? etas.sort()[0] : null;
}

/** The Project Wise billing-status filter's "no filter" choice. */
export const ALL_STATUSES = "All statuses";

/**
 * Project Wise billing-status filter options: every bill status some project's bills are in, in the
 * standard status order (Not Started → … → NA). A status outside that list goes last, A to Z.
 */
export function billStatusOptions(rows: { bill_statuses: string[] }[]): string[] {
  const present = new Set(rows.flatMap((r) => r.bill_statuses));
  const known = BILL_STATUSES.filter((s) => present.has(s));
  const other = [...present].filter((s) => !(BILL_STATUSES as readonly string[]).includes(s)).sort();
  return [...known, ...other];
}

/** A project matches the billing-status filter when any of its bills is in that status. */
export function matchesBillStatus(row: { bill_statuses: string[] }, status: string): boolean {
  return status === ALL_STATUSES || row.bill_statuses.includes(status);
}

export type SortDir = "asc" | "desc";

/**
 * Project Wise order: by deadline (`projectDeadline`), "asc" = earliest first. A project with no
 * deadline always comes last, whichever way; ties go A to Z by project name.
 */
export function sortProjectsByDeadline<
  T extends { project: string; project_name: string; packages: { next_bill?: { eta_date?: string | null } | null }[] },
>(rows: T[], dir: SortDir): T[] {
  const name = (r: T) => r.project_name || r.project;
  return rows
    .map((row) => ({ row, deadline: projectDeadline(row.packages) }))
    .sort((a, b) => {
      if (a.deadline !== b.deadline) {
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        const earlier = a.deadline < b.deadline ? -1 : 1;
        return dir === "asc" ? earlier : -earlier;
      }
      return name(a.row).localeCompare(name(b.row));
    })
    .map(({ row }) => row);
}
