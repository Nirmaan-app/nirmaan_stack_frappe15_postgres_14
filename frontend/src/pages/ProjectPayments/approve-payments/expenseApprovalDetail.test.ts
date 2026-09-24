import { describe, expect, it } from "vitest";

import {
  ExpenseApprovalDetail,
  expenseApprovalOutcome,
  requestAttachments,
  showsDescription,
} from "./expenseApprovalDetail";

const base = (over: Partial<ExpenseApprovalDetail> = {}): ExpenseApprovalDetail => ({
  doctype: "Project Expenses",
  name: "PEX-1",
  status: "Requested",
  type: "Site Travel",
  amount: 30000,
  project: null,
  project_name: null,
  vendor: null,
  vendor_name: null,
  description: "",
  comment: "",
  invoice_ref: "",
  invoice_date: null,
  invoice_attachment: "",
  payment_by: "",
  raised_by: null,
  raised_on: null,
  request: null,
  similar: [],
  user_names: {},
  ...over,
});

const request = (source_data: string | null, detail: { label: string; value: string }[] = []) => ({
  name: "EXR-1",
  creation: "2026-09-20",
  reviewed_by: null,
  reviewed_on: null,
  source_data,
  detail,
});

describe("expenseApprovalOutcome", () => {
  it("L1 finishes up to the expense line and forwards above it", () => {
    expect(expenseApprovalOutcome("lead", 50000).finishes).toBe(true);
    expect(expenseApprovalOutcome("lead", 50001).finishes).toBe(false);
    expect(expenseApprovalOutcome("lead", "60000").text).toContain("forwards it to the CEO");
  });

  it("the CEO's approval always finishes it", () => {
    expect(expenseApprovalOutcome("ceo", 90000).finishes).toBe(true);
  });
});

describe("requestAttachments", () => {
  it("is empty without a request", () => {
    expect(requestAttachments(base())).toEqual([]);
  });

  it("drops the bill already shown on the Invoice line, and duplicates", () => {
    const sd = JSON.stringify({ attachments: { bill: ["/private/files/a.pdf"], extra: ["/private/files/b.pdf", "/private/files/b.pdf"] } });
    const d = base({ invoice_attachment: "/private/files/a.pdf", request: request(sd) });
    expect(requestAttachments(d)).toEqual(["/private/files/b.pdf"]);
  });

  it("survives broken source data", () => {
    expect(requestAttachments(base({ request: request("{not json") }))).toEqual([]);
  });
});

describe("showsDescription", () => {
  it("shows a direct row's description", () => {
    expect(showsDescription(base({ description: "Diesel for site" }))).toBe(true);
  });

  it("hides it when the request's labelled answers already say it", () => {
    const d = base({ description: "Diesel · [EXR-1]", request: request(null, [{ label: "Item", value: "Diesel" }]) });
    expect(showsDescription(d)).toBe(false);
  });

  it("keeps it when the request has no answers to show", () => {
    expect(showsDescription(base({ description: "Diesel · [EXR-1]", request: request(null) }))).toBe(true);
  });
});
