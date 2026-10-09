import { describe, expect, it } from "vitest";
import { aiReadFigure, GstRelease, gstReleaseLine } from "./invoiceApprovalAmounts";

const release = (over: Partial<GstRelease>): GstRelease => ({
    applies: true,
    invoice_gst: 5000,
    gst_invoiced: 0,
    work_order_gst: 18000,
    opens_up: 5000,
    ...over,
});

describe("aiReadFigure", () => {
    it("prefers the dedicated column", () => {
        expect(aiReadFigure(900, "1,000.00")).toBe(900);
    });

    it("falls back to the raw entity, parsing OCR formatting", () => {
        expect(aiReadFigure(undefined, "₹ 3,257.50")).toBe(3257.5);
    });

    it("a column that reads 0 (never written) defers to the entity", () => {
        expect(aiReadFigure(0, "540")).toBe(540);
    });

    it("a 0 the AI actually read survives through the entity", () => {
        expect(aiReadFigure(0, "0")).toBe(0);
    });

    it("nothing read is null, not 0", () => {
        expect(aiReadFigure(0, undefined)).toBeNull();
        expect(aiReadFigure(null, "")).toBeNull();
    });
});

describe("gstReleaseLine", () => {
    it("says nothing when it does not apply (PO, GST-off WO, no data yet)", () => {
        expect(gstReleaseLine(release({ applies: false }))).toBeNull();
        expect(gstReleaseLine(undefined)).toBeNull();
    });

    it("names the GST this approval opens up", () => {
        expect(gstReleaseLine(release({ opens_up: 3000 }))).toBe(
            "This approval opens up ₹3,000.00 of GST.",
        );
    });

    it("explains a 0 when the Work Order's own GST is already fully invoiced", () => {
        expect(gstReleaseLine(release({ opens_up: 0, gst_invoiced: 18000 }))).toBe(
            "This approval opens up ₹0.00 of GST: the Work Order's own GST of ₹18,000.00 is already fully invoiced.",
        );
    });

    it("explains a 0 when the invoice carries no GST", () => {
        expect(gstReleaseLine(release({ opens_up: 0, invoice_gst: 0 }))).toBe(
            "This approval opens up ₹0.00 of GST (no GST entered on this invoice).",
        );
    });

    it("a credit note takes GST back", () => {
        expect(gstReleaseLine(release({ opens_up: -180, invoice_gst: -180 }))).toBe(
            "This approval takes back ₹180.00 of GST that could be paid.",
        );
    });
});
