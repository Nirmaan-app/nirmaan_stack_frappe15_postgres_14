import { describe, expect, it } from "vitest";
import {
  INVOICE_SPLIT_TOLERANCE,
  gstOnGstOffWorkOrder,
  missingSplitLabels,
  parseFigure,
  signedFigure,
  splitForEditForm,
  splitMismatch,
} from "./invoiceAmounts";

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
