import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, format } from "date-fns";
import { dateFilterFn } from "@/utils/tableFilters";
import {
  BASE_AS_ON,
  buildLedgerStatement,
  dateFilterToRange,
  type DayRange,
  type LedgerRowInput,
} from "./vendorLedgerStatement";

// Same fixture as nirmaan_stack/services/test_vendor_ledger.py — the two rules must agree.
const row = (date: string, amount = 0, payment = 0, project = "P1"): LedgerRowInput => ({ date, amount, payment, project });
const ROWS = [
  row("2025-04-05 10:00:00", 1000),
  row("2025-05-10 09:00:00", 0, 400),
  row("2025-06-01 00:00:00", 500, 0, "P2"),
  row("2025-06-15 23:59:59", -100),
  row("2025-07-01 12:00:00", 0, 300, "P2"),
  row("2025-07-20 08:00:00", 0, -50),
];
const BASE = { invoice: 200, payment: 50 };
const prev = (d: string) => format(addDays(new Date(`${d}T00:00:00`), -1), "yyyy-MM-dd");

describe("buildLedgerStatement", () => {
  it("opens at the base figure and runs the balance with no filter", () => {
    const st = buildLedgerStatement(ROWS, BASE, {});
    expect(st.opening).toEqual({ asOn: BASE_AS_ON, invoice: 200, payment: 50, balance: 150, isBase: true });
    expect(st.rows.map((r) => r.balance)).toEqual([1150, 750, 1250, 1150, 850, 900]);
    expect(st.totals).toEqual({ amount: 1400, payment: 650 });
    expect(st.closing).toBe(900);
  });

  it("folds rows before `from` into the opening", () => {
    const st = buildLedgerStatement(ROWS, BASE, { from: "2025-06-01" });
    expect(st.opening).toEqual({ asOn: "2025-05-31", invoice: 1200, payment: 450, balance: 750, isBase: false });
    expect(st.rows[0].date).toBe("2025-06-01 00:00:00");
    expect(st.closing).toBe(900);
  });

  it("includes the whole `to` day", () => {
    const st = buildLedgerStatement(ROWS, { invoice: 0, payment: 0 }, { to: "2025-06-15" });
    expect(st.rows.at(-1)?.date).toBe("2025-06-15 23:59:59");
    expect(st.rows).toHaveLength(4);
  });

  it("a period's closing = the full ledger's balance that day", () => {
    const full = buildLedgerStatement(ROWS, BASE, {});
    for (const split of ["2025-04-05", "2025-05-11", "2025-06-15", "2025-07-01", "2025-12-31"]) {
      const before = buildLedgerStatement(ROWS, BASE, { to: prev(split) });
      const after = buildLedgerStatement(ROWS, BASE, { from: split });
      expect(after.opening.balance).toBeCloseTo(before.closing);
      expect(after.closing).toBeCloseTo(full.closing);
    }
  });

  it("keeps the base opening when `from` is on or before the ledger start", () => {
    for (const from of ["2024-05-01", "2025-04-01"]) {
      const st = buildLedgerStatement(ROWS, BASE, { from });
      expect(st.opening).toMatchObject({ asOn: BASE_AS_ON, balance: 150, isBase: true });
      expect(st.rows).toHaveLength(ROWS.length);
    }
  });

  it("filters projects before the carry-forward", () => {
    const st = buildLedgerStatement(ROWS, BASE, { from: "2025-07-01" }, new Set(["P2"]));
    expect(st.opening.invoice).toBe(700);
    expect(st.opening.payment).toBe(50);
    expect(st.rows.map((r) => r.project)).toEqual(["P2"]);
    expect(st.closing).toBe(350);
  });

  it("closes at the opening for an empty range", () => {
    const st = buildLedgerStatement(ROWS, BASE, { from: "2025-07-01", to: "2025-06-01" });
    expect(st.rows).toEqual([]);
    expect(st.closing).toBe(st.opening.balance);
  });
});

describe("dateFilterToRange", () => {
  const NOW = new Date(2026, 9, 5, 15, 30); // 05-Oct-2026 15:30 local
  const inRange = (r: DayRange, d: string) => (!r.from || d >= r.from) && (!r.to || d <= r.to);
  const filters = [
    { operator: "Is", value: "2026-09-30" },
    { operator: "Between", value: ["2026-09-01", "2026-09-30"] },
    { operator: "<=", value: "2026-09-15" },
    { operator: ">=", value: "2026-09-15" },
    ...["today", "yesterday", "last 7 days", "last 14 days", "last 30 days", "last 90 days", "this week",
      "last week", "this month", "last month", "this quarter", "last quarter", "last 6 months",
      "this year", "last year", "no such span"].map((value) => ({ operator: "Timespan", value })),
  ];

  // Every day of 2025-2026, at the first and the last second of the day.
  const days: string[] = [];
  for (let d = new Date(2025, 0, 1); d <= new Date(2026, 11, 31); d = addDays(d, 1)) days.push(format(d, "yyyy-MM-dd"));

  // dateFilterFn reads the clock with `new Date()`.
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterAll(() => vi.useRealTimers());

  it.each(filters)("selects the same days as dateFilterFn: $operator $value", (filter) => {
    const range = dateFilterToRange(filter, NOW);
    for (const d of days) {
      for (const time of ["00:00:00", "23:59:59"]) {
        const stamp = `${d} ${time}`;
        const row = { getValue: () => stamp } as never;
        expect(inRange(range, d), `${filter.operator} ${filter.value} @ ${stamp}`).toBe(
          dateFilterFn(row, "date", filter, () => {}),
        );
      }
    }
  });

  it("is open with no filter", () => {
    expect(dateFilterToRange(undefined)).toEqual({});
  });
});
