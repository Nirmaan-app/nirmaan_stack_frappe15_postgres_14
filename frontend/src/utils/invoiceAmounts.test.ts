import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  INVOICE_SPLIT_TOLERANCE,
  gstOnGstOffWorkOrder,
  missingSplitLabels,
  parseFigure,
  parseReadFigure,
  signedFigure,
  splitForEditForm,
  splitMismatch,
} from "./invoiceAmounts";

/** Shared with the server's suite (`services/test_invoice_amounts.py`): one set of cases, two twins. */
const SHARED = JSON.parse(
  readFileSync(resolve(__dirname, "../../../nirmaan_stack/services/invoice_amounts_cases.json"), "utf-8")
) as {
  tolerance: number;
  cases: {
    name: string; amount: string; base: string; gst: string; is_credit_note: boolean;
    stored_base: number | null; stored_gst: number | null; missing: string[]; split_warns: boolean;
  }[];
  gst_off_cases: { name: string; gst: string; gst_off_work_order: boolean; gst_off_warns: boolean }[];
};

describe("parity with services/invoice_amounts.py (shared cases)", () => {
  it("uses the server's tolerance", () => {
    expect(INVOICE_SPLIT_TOLERANCE).toBe(SHARED.tolerance);
  });

  it.each(SHARED.cases)("$name", (c) => {
    expect(signedFigure(c.base, c.is_credit_note)).toBe(c.stored_base);
    expect(signedFigure(c.gst, c.is_credit_note)).toBe(c.stored_gst);
    expect(missingSplitLabels(c.base, c.gst)).toEqual(c.missing);
    expect(splitMismatch(c.amount, c.base, c.gst, c.is_credit_note) !== null).toBe(c.split_warns);
  });

  it.each(SHARED.gst_off_cases)("$name", (c) => {
    expect(gstOnGstOffWorkOrder(c.gst, c.gst_off_work_order)).toBe(c.gst_off_warns);
  });
});

describe("parseReadFigure", () => {
  it("reads an AI / OCR figure with its currency symbol", () => {
    expect(parseReadFigure("₹ 3,257.50")).toBe(3257.5);
    expect(parseReadFigure(540)).toBe(540);
    expect(parseReadFigure("n/a")).toBeNull();
    expect(parseReadFigure(undefined)).toBeNull();
  });
});

describe("parseFigure", () => {
  it("reads blanks and junk as null, and 0 as a figure", () => {
    for (const v of [null, undefined, "", "  ", "-", ".", "abc"]) expect(parseFigure(v)).toBeNull();
    expect(parseFigure("0")).toBe(0);
    expect(parseFigure("1,18,000.5")).toBe(118000.5);
  });
});

describe("missingSplitLabels", () => {
  it("names each blank figure in form order", () => {
    expect(missingSplitLabels("", "")).toEqual(["Invoice Base Amount", "Invoice GST Amount"]);
    expect(missingSplitLabels("100", "")).toEqual(["Invoice GST Amount"]);
    expect(missingSplitLabels("100", "0")).toEqual([]);
  });
});

describe("signedFigure", () => {
  it("makes a credit note negative and leaves an invoice as typed", () => {
    expect(signedFigure("180", true)).toBe(-180);
    expect(signedFigure("-180", false)).toBe(-180);
    expect(signedFigure("", true)).toBeNull();
  });
});

describe("splitMismatch", () => {
  it("matches the server's ₹5 tolerance", () => {
    expect(INVOICE_SPLIT_TOLERANCE).toBe(5);
    expect(splitMismatch("1185", "1000", "180")).toBeNull();
    expect(splitMismatch("1185.01", "1000", "180")).toEqual({ splitTotal: 1180, gap: expect.closeTo(5.01) });
  });

  it("treats a credit note's positive entries as the negative figures stored", () => {
    expect(splitMismatch("1180", "1000", "180", true)).toBeNull();
    expect(splitMismatch("-1180", "1000", "180", true)).toBeNull();
  });

  it("does not warn on a split never entered", () => {
    expect(splitMismatch("1180", "", "")).toBeNull();
    expect(splitMismatch("1180", "0", "0")).toBeNull();
  });
});

describe("gstOnGstOffWorkOrder", () => {
  it("warns only when a GST-off Work Order's bill shows GST", () => {
    expect(gstOnGstOffWorkOrder("180", true)).toBe(true);
    expect(gstOnGstOffWorkOrder("0", true)).toBe(false);
    expect(gstOnGstOffWorkOrder("180", false)).toBe(false);
  });
});

describe("splitForEditForm", () => {
  it("shows a never-entered split (0 / 0) as blank, and a real one as stored", () => {
    expect(splitForEditForm(0, 0)).toEqual({ base: "", gst: "" });
    expect(splitForEditForm(undefined, undefined)).toEqual({ base: "", gst: "" });
    expect(splitForEditForm(1000, 0)).toEqual({ base: "1000", gst: "0" });
    expect(splitForEditForm(-1000, -180)).toEqual({ base: "-1000", gst: "-180" });
  });
});
