import { describe, expect, it } from "vitest";

import {
  canEditQueueRow,
  canRevertQueueRow,
  canWorkQueueRows,
  isPaidExpense,
  QUEUE_EDIT_PROFILES,
} from "./queueRowActions";

const STATUSES = ["Requested", "CEO Pending", "Approved", "Reconciliation Pending", "Paid", "Rejected"];
const LEDGERS = ["Project Payments", "Project Expenses", "Non Project Expenses"] as const;
const OTHER_ROLES = [
  "Nirmaan PMO Executive Profile",
  "Nirmaan HR Executive Profile",
  "Nirmaan Procurement Executive Profile",
  "Nirmaan Project Lead Profile",
  "Nirmaan Project Manager Profile",
  "Loading",
  "",
  undefined,
];

const row = (doctype: string, status: string) => ({ doctype, status }) as any;

describe("canEditQueueRow — the full status × ledger matrix for a queue worker", () => {
  const role = "Nirmaan Accountant Profile";
  const expected: Record<string, Record<string, boolean>> = {
    "Project Payments": Object.fromEntries(STATUSES.map((s) => [s, false])),
    "Project Expenses": { Requested: true, "CEO Pending": true, Approved: true, "Reconciliation Pending": true, Paid: true, Rejected: false },
    "Non Project Expenses": { Requested: true, "CEO Pending": true, Approved: true, "Reconciliation Pending": true, Paid: true, Rejected: false },
  };
  for (const ledger of LEDGERS) {
    for (const status of STATUSES) {
      it(`${ledger} · ${status}`, () => {
        expect(canEditQueueRow(row(ledger, status), role)).toBe(expected[ledger][status]);
      });
    }
  }
});

describe("roles", () => {
  it("Admin, Accountant and Accountant Lead work the queue", () => {
    for (const role of QUEUE_EDIT_PROFILES) {
      expect(canWorkQueueRows(role)).toBe(true);
      expect(canEditQueueRow(row("Project Expenses", "Paid"), role)).toBe(true);
      expect(canRevertQueueRow(row("Project Payments", "Reconciliation Pending"), role)).toBe(true);
    }
  });

  it("every other role gets neither the pencil nor the revert", () => {
    for (const role of OTHER_ROLES) {
      expect(canWorkQueueRows(role)).toBe(false);
      for (const ledger of LEDGERS) {
        for (const status of STATUSES) {
          expect(canEditQueueRow(row(ledger, status), role)).toBe(false);
          expect(canRevertQueueRow(row(ledger, status), role)).toBe(false);
        }
      }
    }
  });
});

describe("canRevertQueueRow", () => {
  it("only a Reconciliation Pending PAYMENT reverts — never an expense, never another status", () => {
    const role = "Nirmaan Admin Profile";
    for (const ledger of LEDGERS) {
      for (const status of STATUSES) {
        const want = ledger === "Project Payments" && status === "Reconciliation Pending";
        expect(canRevertQueueRow(row(ledger, status), role)).toBe(want);
      }
    }
  });
});

describe("isPaidExpense", () => {
  it("reads the status, tolerating stray whitespace", () => {
    expect(isPaidExpense("Paid")).toBe(true);
    expect(isPaidExpense(" Paid ")).toBe(true);
    expect(isPaidExpense("Reconciliation Pending")).toBe(false);
    expect(isPaidExpense(undefined)).toBe(false);
  });
});
