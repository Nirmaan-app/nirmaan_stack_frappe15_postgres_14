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
  PAID_INVOICE_PROFILES,
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

const ACCOUNTS_EDITS = ["Requested", "CEO Pending", "Approved", "Reconciliation Pending"];

describe("canEditQueueRow — the expense pencil follows the server's editable statuses (story 50)", () => {
  for (const ledger of LEDGERS) {
    for (const status of STATUSES) {
      it(`${ledger} · ${status}`, () => {
        const want = ledger !== "Project Payments" && ACCOUNTS_EDITS.includes(status);
        expect(canEditQueueRow(row(ledger, status), ACCOUNTS_EDITS)).toBe(want);
      });
    }
  }

  it("shows nowhere for a viewer the server lets edit nothing, Admin included", () => {
    for (const ledger of LEDGERS) {
      for (const status of STATUSES) expect(canEditQueueRow(row(ledger, status), [])).toBe(false);
    }
  });
});

describe("roles", () => {
  it("Admin, Accountant and Accountant Lead work the queue", () => {
    for (const role of QUEUE_EDIT_PROFILES) {
      expect(canWorkQueueRows(role)).toBe(true);
      expect(canRevertQueueRow(row("Project Payments", "Reconciliation Pending"), role)).toBe(true);
    }
  });

  it("every other role gets no revert", () => {
    for (const role of OTHER_ROLES) {
      expect(canWorkQueueRows(role)).toBe(false);
      for (const ledger of LEDGERS) {
        for (const status of STATUSES) expect(canRevertQueueRow(row(ledger, status), role)).toBe(false);
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

describe("canUploadInvoiceRow — a Paid expense, for Admin, Accounts and HR (owner, 2026-10-31)", () => {
  const HR = ["Nirmaan HR Executive Profile", "Nirmaan HR Lead Profile"];

  it("the five roles, on a Paid expense of either ledger", () => {
    expect(PAID_INVOICE_PROFILES).toEqual([...QUEUE_EDIT_PROFILES, ...HR]);
    for (const role of PAID_INVOICE_PROFILES) {
      expect(canUploadInvoiceRow(row("Non Project Expenses", " Paid "), role)).toBe(true);
      expect(canUploadInvoiceRow(row("Project Expenses", "Paid"), role)).toBe(true);
    }
  });

  it("never a PO / WO payment, nor an expense not yet Paid", () => {
    for (const role of PAID_INVOICE_PROFILES) {
      for (const status of STATUSES) expect(canUploadInvoiceRow(row("Project Payments", status), role)).toBe(false);
      for (const status of STATUSES.filter((s) => s !== "Paid")) {
        expect(canUploadInvoiceRow(row("Project Expenses", status), role)).toBe(false);
      }
    }
  });

  it("nobody else", () => {
    for (const role of OTHER_ROLES.filter((r) => !HR.includes(r as string))) {
      expect(canUploadInvoiceRow(row("Project Expenses", "Paid"), role)).toBe(false);
    }
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
