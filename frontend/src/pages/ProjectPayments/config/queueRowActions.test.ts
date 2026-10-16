import { describe, expect, it } from "vitest";

import type { PaidTo } from "@/utils/payees/paidTo";

import {
  canEditQueueRow,
  canHoldQueueRow,
  canPayQueueRow,
  canRevertQueueRow,
  canUploadInvoiceRow,
  canWorkQueueRows,
  isHeldQueueRow,
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

describe("canHoldQueueRow — an Approved PO / WO payment, for the three settle roles only", () => {
  for (const role of QUEUE_EDIT_PROFILES) {
    for (const ledger of LEDGERS) {
      for (const status of STATUSES) {
        const expected = ledger === "Project Payments" && status === "Approved";
        it(`${role} · ${ledger} · ${status}`, () => {
          expect(canHoldQueueRow(row(ledger, status), role)).toBe(expected);
        });
      }
    }
  }
  for (const role of OTHER_ROLES) {
    it(`never for ${String(role)}`, () => {
      expect(canHoldQueueRow(row("Project Payments", "Approved"), role)).toBe(false);
    });
  }
  it("reads a padded status", () => {
    expect(canHoldQueueRow(row("Project Payments", " Approved "), "Nirmaan Accountant Profile")).toBe(true);
  });
});

describe("canUploadInvoiceRow — a Paid expense (either ledger), for the three queue roles only", () => {
  for (const role of QUEUE_EDIT_PROFILES) {
    for (const ledger of LEDGERS) {
      for (const status of STATUSES) {
        // Both expense ledgers (owner, 2026-10-07), never a PO / WO payment.
        const expected = ledger !== "Project Payments" && status === "Paid";
        it(`${role} · ${ledger} · ${status}`, () => {
          expect(canUploadInvoiceRow(row(ledger, status), role)).toBe(expected);
        });
      }
    }
  }
  for (const role of OTHER_ROLES) {
    it(`never for ${String(role)}`, () => {
      for (const ledger of LEDGERS) {
        expect(canUploadInvoiceRow(row(ledger, "Paid"), role)).toBe(false);
      }
    });
  }
  it("reads a padded status", () => {
    expect(canUploadInvoiceRow(row("Non Project Expenses", " Paid "), "Nirmaan Admin Profile")).toBe(true);
  });
});

describe("isHeldQueueRow", () => {
  it("is 1 only", () => {
    expect(isHeldQueueRow({ on_hold: 1 })).toBe(true);
    expect(isHeldQueueRow({ on_hold: 0 })).toBe(false);
    expect(isHeldQueueRow({ on_hold: undefined as any })).toBe(false);
    expect(isHeldQueueRow({ on_hold: null as any })).toBe(false);
  });
});

describe("canPayQueueRow — which rows of Payment need to paid can be ticked and marked paid (#1464)", () => {
  const account = { account_name: "ACME TRADERS PVT LTD", account_number: "0050200012345", ifsc: "HDFC0001234" };
  const paidTo = (over: Partial<PaidTo>): PaidTo =>
    ({ account: null, missing: null, payee_rule: null, switch_to: null, by_cheque: false, vendor_has_no_account: false, ...over });

  it("lets a payable row and a row kept out of the bank file be paid", () => {
    expect(canPayQueueRow({ on_hold: 0, expense_type: "", paid_to: paidTo({ account }) })).toBe(true);
    expect(canPayQueueRow({ on_hold: 0, expense_type: "", paid_to: paidTo({ missing: "payment_has_no_account", by_cheque: true }) })).toBe(true);
    expect(canPayQueueRow({ on_hold: 0, expense_type: "Travel", paid_to: paidTo({ missing: "expense_has_no_account", payee_rule: "Optional" }) })).toBe(true);
  });

  it("refuses an Ineligible row and a held one", () => {
    expect(canPayQueueRow({ on_hold: 0, expense_type: "", paid_to: paidTo({ missing: "payment_has_no_account" }) })).toBe(false);
    expect(canPayQueueRow({ on_hold: 0, expense_type: "Rent", paid_to: paidTo({ missing: "expense_has_no_account", payee_rule: "Required" }) })).toBe(false);
    expect(canPayQueueRow({ on_hold: 1, expense_type: "", paid_to: paidTo({ account }) })).toBe(false);
  });
});
