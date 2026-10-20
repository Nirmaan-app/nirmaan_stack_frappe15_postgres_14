import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  canMarkExpensePaid,
  EXPENSE_ACTIONS,
  MARK_PAID_PROFILES,
  mayEditExpenseField,
  NO_EDIT_ACCESS,
  splitMarkPaid,
} from "./expenseDecision";

// The Python modules are the authority; these read them so the mirrors cannot drift (rule F1).
const read = (path: string) => readFileSync(resolve(__dirname, "../../../../nirmaan_stack", path), "utf-8");
const DECISION_PY = read("services/expense_decision.py");
const ROLE_PROFILES_PY = read("services/role_profiles.py");

/** `NAME = "value"` constants of a Python module. */
const pyStrings = (source: string): Record<string, string> =>
  Object.fromEntries([...source.matchAll(/^([A-Z0-9_]+)\s*=\s*"([^"]+)"/gm)].map((m) => [m[1], m[2]]));

/** The items of `NAME = (A, "b", ...)`: a name resolved through `pyStrings`, a literal unquoted. */
const pyTuple = (source: string, name: string): string[] => {
  const m = source.match(new RegExp(`^${name}\\s*=\\s*\\(([^)]*)\\)`, "m"));
  expect(m, `${name} not found`).toBeTruthy();
  const strings = pyStrings(source);
  return m![1].split(",").map((s) => s.trim()).filter(Boolean)
    .map((item) => (/^"[^"]*"$/.test(item) ? item.slice(1, -1) : strings[item] ?? item));
};

describe("parity with the server", () => {
  it("the actions are expense_decision.ACTIONS, in order", () => {
    expect([...EXPENSE_ACTIONS]).toEqual(pyTuple(DECISION_PY, "ACTIONS"));
  });

  it("Mark as Paid is offered to role_profiles.PAYMENT_SETTLE_PROFILES, which can_mark_paid checks", () => {
    expect(DECISION_PY).toMatch(/has_role_profile\(user, PAYMENT_SETTLE_PROFILES\)/);
    expect([...MARK_PAID_PROFILES].sort()).toEqual(pyTuple(ROLE_PROFILES_PY, "PAYMENT_SETTLE_PROFILES").sort());
  });

  it("the invoice fields Mark as Paid saves are expense_decision.INVOICE_FIELDS", () => {
    const { invoice } = splitMarkPaid({ invoice_date: "d", invoice_ref: "r", invoice_attachment: "a" });
    expect(Object.keys(invoice).sort()).toEqual(pyTuple(DECISION_PY, "INVOICE_FIELDS").sort());
  });
});

describe("canMarkExpensePaid", () => {
  it("is Admin and Accounts, never HR or a PM", () => {
    expect(canMarkExpensePaid("Nirmaan Admin Profile")).toBe(true);
    expect(canMarkExpensePaid("Nirmaan Accountant Lead Profile")).toBe(true);
    expect(canMarkExpensePaid("Nirmaan HR Executive Profile")).toBe(false);
    expect(canMarkExpensePaid("Nirmaan Project Manager Profile")).toBe(false);
    expect(canMarkExpensePaid(undefined)).toBe(false);
  });
});

describe("splitMarkPaid", () => {
  it("sends the payment and the invoice details to the one decision call", () => {
    const { payment, invoice } = splitMarkPaid({
      payment_date: "2026-10-19",
      payment_ref: "UTR-1",
      payment_attachment: "/private/files/r.pdf",
      invoice_date: "2026-10-01",
      invoice_ref: "INV-9",
    });
    expect(payment).toEqual({
      payment_date: "2026-10-19",
      payment_ref: "UTR-1",
      payment_attachment: "/private/files/r.pdf",
    });
    expect(invoice).toEqual({ invoice_date: "2026-10-01", invoice_ref: "INV-9" });
  });

  it("leaves out a receipt the dialog kept, so the stored one stands, and clears a blanked invoice field", () => {
    const { payment, invoice } = splitMarkPaid({ payment_date: "2026-10-19", payment_ref: "UTR-1", invoice_ref: null });
    expect(payment).toEqual({ payment_date: "2026-10-19", payment_ref: "UTR-1" });
    expect(invoice).toEqual({ invoice_ref: null });
  });

  it("never carries a status or who paid", () => {
    const { payment, invoice } = splitMarkPaid({ payment_date: "2026-10-19", status: "Paid", payment_by: "x" });
    expect(payment).toEqual({ payment_date: "2026-10-19" });
    expect(invoice).toEqual({});
  });
});

describe("mayEditExpenseField — the server's edit answer, read per field (story 50)", () => {
  // An Accountant Lead's answer, as `get_expense_edit_access` serves it.
  const lead = {
    editable_statuses: ["Requested", "Approved", "Paid"],
    field_limits: { Paid: ["description", "invoice_ref"] },
  };

  it("allows every field of a status the answer leaves unlimited", () => {
    expect(mayEditExpenseField(lead, "Approved", "amount")).toBe(true);
    expect(mayEditExpenseField(lead, "Approved", "description")).toBe(true);
  });

  it("allows on a limited status only the fields listed", () => {
    expect(mayEditExpenseField(lead, "Paid", "description")).toBe(true);
    expect(mayEditExpenseField(lead, " Paid ", "invoice_ref")).toBe(true);
    expect(mayEditExpenseField(lead, "Paid", "amount")).toBe(false);
    expect(mayEditExpenseField(lead, "Paid", "payment_attachment")).toBe(false);
  });

  it("allows nothing on a status the answer does not list", () => {
    expect(mayEditExpenseField(lead, "Rejected", "description")).toBe(false);
    expect(mayEditExpenseField(NO_EDIT_ACCESS, "Approved", "description")).toBe(false);
    expect(mayEditExpenseField(lead, undefined, "description")).toBe(false);
  });
});
