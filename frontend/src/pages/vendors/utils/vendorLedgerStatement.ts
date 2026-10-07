// src/pages/vendors/utils/vendorLedgerStatement.ts
//
// Vendor ledger statement — opening balance, rows with running balance, totals and
// closing balance for one view of the Ledger tab. Mirror of
// nirmaan_stack/services/vendor_ledger.py (which the "Vendor Ledger" PDF uses):
// keep the two in step, so the PDF always matches the screen.

import {
  endOfMonth, endOfQuarter, endOfWeek, endOfYear, format, parseISO,
  startOfMonth, startOfQuarter, startOfWeek, startOfYear,
  subDays, subMonths, subQuarters, subWeeks, subYears,
} from "date-fns";
import type { DateFilterValue } from "../components/AdvancedDateFilter";

/** get_po_ledger_data drops rows before this day; the Vendors balancing fields are the balance as on BASE_AS_ON. */
export const LEDGER_START = "2025-04-01";
export const BASE_AS_ON = "2025-03-31";

/** Inclusive day range, 'yyyy-MM-dd'. A missing end is open. */
export interface DayRange {
  from?: string;
  to?: string;
}

export interface LedgerRowInput {
  date: string; // 'YYYY-MM-DD HH:MM:SS'
  project: string;
  amount: number;
  payment: number;
}

export interface LedgerOpening {
  asOn: string;
  invoice: number;
  payment: number;
  balance: number;
  /** True when the opening row IS the editable Vendors balancing figure. */
  isBase: boolean;
}

export interface LedgerStatement<T> {
  opening: LedgerOpening;
  rows: (T & { balance: number })[];
  totals: { amount: number; payment: number };
  closing: number;
}

const day = (value: string | undefined) => (value ?? "").slice(0, 10);
const fmt = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * The Ledger date filter as a day range. Same days as `dateFilterFn`
 * (utils/tableFilters.ts) selects, including its Timespan windows.
 */
export function dateFilterToRange(filter: DateFilterValue | undefined, now: Date = new Date()): DayRange {
  if (!filter || filter.value === null || filter.value === undefined) return {};
  const { operator, value } = filter;

  if (operator === "Is" && typeof value === "string") return { from: value, to: value };
  if (operator === "Between" && Array.isArray(value) && value.length === 2) return { from: value[0], to: value[1] };
  if (operator === "<=" && typeof value === "string") return { to: value };
  if (operator === ">=" && typeof value === "string") return { from: value };
  if (operator !== "Timespan" || typeof value !== "string") return {};

  const today = now;
  let start: Date;
  let end: Date = today;
  switch (value) {
    case "today": start = today; break;
    case "yesterday": start = subDays(today, 1); end = start; break;
    case "last 7 days": start = subDays(today, 6); break;
    case "last 14 days": start = subDays(today, 13); break;
    case "last 30 days": start = subDays(today, 29); break;
    case "last 90 days": start = subDays(today, 89); break;
    case "this week": start = startOfWeek(today); end = endOfWeek(today); break;
    case "last week": start = startOfWeek(subWeeks(today, 1)); end = endOfWeek(subWeeks(today, 1)); break;
    case "this month": start = startOfMonth(today); end = endOfMonth(today); break;
    case "last month": start = startOfMonth(subMonths(today, 1)); end = endOfMonth(subMonths(today, 1)); break;
    case "this quarter": start = startOfQuarter(today); end = endOfQuarter(today); break;
    case "last quarter": start = startOfQuarter(subQuarters(today, 1)); end = endOfQuarter(subQuarters(today, 1)); break;
    case "last 6 months": start = subMonths(today, 6); break;
    case "this year": start = startOfYear(today); end = endOfYear(today); break;
    case "last year": start = startOfYear(subYears(today, 1)); end = endOfYear(subYears(today, 1)); break;
    default: return {}; // Unknown timespan: dateFilterFn does not filter either
  }
  return { from: fmt(start), to: fmt(end) };
}

/**
 * Project filter first, then the date range. Rows dated before `range.from` are
 * folded into the opening balance, so a period opens at the real balance on the
 * day before it. `rows` must be sorted by date (the API returns them so).
 */
export function buildLedgerStatement<T extends LedgerRowInput>(
  rows: T[],
  base: { invoice: number; payment: number },
  range: DayRange,
  projects?: ReadonlySet<string>,
): LedgerStatement<T> {
  const scoped = projects && projects.size > 0 ? rows.filter((r) => projects.has(r.project)) : rows;
  const from = day(range.from);
  const to = day(range.to);

  let openingInvoice = Number(base.invoice) || 0;
  let openingPayment = Number(base.payment) || 0;
  const shown: T[] = [];
  for (const r of scoped) {
    const d = day(r.date);
    if (from && d < from) {
      openingInvoice += r.amount;
      openingPayment += r.payment;
    } else if (!to || d <= to) {
      shown.push(r);
    }
  }

  const asOn = from > LEDGER_START ? fmt(subDays(parseISO(from), 1)) : BASE_AS_ON;
  const opening: LedgerOpening = {
    asOn,
    invoice: openingInvoice,
    payment: openingPayment,
    balance: openingInvoice - openingPayment,
    isBase: asOn === BASE_AS_ON,
  };

  let balance = opening.balance;
  const totals = { amount: 0, payment: 0 };
  const out = shown.map((r) => {
    balance += r.amount - r.payment;
    totals.amount += r.amount;
    totals.payment += r.payment;
    return { ...r, balance };
  });

  return { opening, rows: out, totals, closing: balance };
}
