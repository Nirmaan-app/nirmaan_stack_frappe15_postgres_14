// Pure display helpers for the billing tracker. No React, no data fetching.

import { APPROVED_STATUSES, BILL_STATUSES, NA_STATUS, PENDING_STATUSES } from "../billing.constants";
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
 * Parse an amount typed the way site teams write it: "250000", "2,50,000",
 * "2.5L", "2.5 lakh", "1.2cr", "75k", "-1.5L". Returns null when unreadable.
 */
export function parseAmount(input?: string | null): number | null {
  if (input === null || input === undefined) return null;
  let s = String(input).trim().toLowerCase().replace(/[₹,\s]/g, "");
  if (!s) return null;
  let mult = 1;
  if (/(crores|crore|cr)$/.test(s)) {
    mult = 1e7;
    s = s.replace(/(crores|crore|cr)$/, "");
  } else if (/(lakhs|lakh|lacs|lac|l)$/.test(s)) {
    mult = 1e5;
    s = s.replace(/(lakhs|lakh|lacs|lac|l)$/, "");
  } else if (/k$/.test(s)) {
    mult = 1e3;
    s = s.replace(/k$/, "");
  }
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : Math.round(n * mult);
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

/** A typed PO value in rupees: blank is 0; unreadable or negative is null. */
export function poAmount(typed: string): number | null {
  if (!typed.trim()) return 0;
  const n = parseAmount(typed);
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
 * What a typed Supply DC value would save: "add" logs the typed amount, "correct" logs the
 * difference to the typed total. A non-empty `problem` blocks the save. An entry of 0 is never
 * saved from the box; "No delivery today" is the one way to log a zero day.
 */
export function dcEntryPlan(
  mode: DcEntryMode,
  typed: number | null,
  current: number,
): { amount: number | null; newTotal: number | null; problem: string } {
  if (typed === null) return { amount: null, newTotal: null, problem: "" };
  const amount = mode === "add" ? typed : typed - current;
  const newTotal = mode === "add" ? current + typed : typed;
  if (Math.abs(amount) < 0.005) {
    const problem =
      mode === "add"
        ? `0 can't be saved. If nothing was delivered, use "No delivery today".`
        : "Same as the current total. Nothing to save.";
    return { amount, newTotal, problem };
  }
  if (newTotal < 0) return { amount, newTotal, problem: "Total would go below zero" };
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
