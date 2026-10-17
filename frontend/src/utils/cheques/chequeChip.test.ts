import { describe, expect, it } from "vitest";

import { chequeChipText, chequeChipTone, isChequeStruck, showsChequeChip, utrOrChequeText } from "./chequeChip";

describe("chequeChipText", () => {
    it("names the cheque number, leading zeros kept, and its status", () => {
        expect(chequeChipText("004521", "Issued")).toBe("Cheque 004521 · Issued");
        expect(chequeChipText("004521", "Cancelled")).toBe("Cheque 004521 · Cancelled");
    });

    it("leaves the status out for a cheque payment no Cheque records yet", () => {
        expect(chequeChipText("004521", "")).toBe("Cheque 004521");
        expect(chequeChipText("004521", null)).toBe("Cheque 004521");
    });
});

describe("isChequeStruck", () => {
    it("strikes through a Cancelled cheque only", () => {
        expect(isChequeStruck("Cancelled")).toBe(true);
        expect(isChequeStruck("Issued")).toBe(false);
        expect(isChequeStruck("Cleared")).toBe(false);
        expect(isChequeStruck(null)).toBe(false);
    });
});

describe("showsChequeChip", () => {
    it("shows a chip on a cheque payment that is not Rejected", () => {
        for (const status of ["Requested", "Approved", "Reconciliation Pending", "Paid"]) {
            expect(showsChequeChip({ cheque_no: "004521", status })).toBe(true);
        }
    });

    it("shows none on a Rejected payment that has dropped off its Cheque", () => {
        expect(showsChequeChip({ cheque_no: "004521", status: "Rejected" })).toBe(false);
        expect(showsChequeChip({ cheque_no: "004521", status: "Rejected", cheque_status: "Issued" })).toBe(false);
    });

    it("shows one on a Rejected payment whose Cheque is Cancelled: it stays on its cancelled cheque", () => {
        expect(showsChequeChip({ cheque_no: "004521", status: "Rejected", cheque_status: "Cancelled" })).toBe(true);
    });

    it("shows none on an Online payment", () => {
        expect(showsChequeChip({ cheque_no: "", status: "Approved" })).toBe(false);
        expect(showsChequeChip({ cheque_no: null, status: "Approved" })).toBe(false);
    });
});

describe("utrOrChequeText (the UTR / Ref export)", () => {
    it("gives an Online payment its UTR as today", () => {
        expect(utrOrChequeText({ utr_ref: "UTR998877", cheque_no: "", cheque_status: "", status: "Paid" })).toBe("UTR998877");
    });

    it("gives a payment on a Cheque the chip text", () => {
        expect(utrOrChequeText({ utr_ref: "", cheque_no: "004521", cheque_status: "Issued", status: "Approved" })).toBe(
            "Cheque 004521 · Issued",
        );
    });

    it("keeps a reconciled cheque payment's UTR after the chip", () => {
        expect(utrOrChequeText({ utr_ref: "UTR1", cheque_no: "004521", cheque_status: "Cleared", status: "Paid" })).toBe(
            "Cheque 004521 · Cleared / UTR1",
        );
    });

    it("is blank when there is neither", () => {
        expect(utrOrChequeText({ utr_ref: "", cheque_no: "", cheque_status: "", status: "Approved" })).toBe("");
    });

    it("names no cheque on a Rejected payment that has dropped off its Cheque", () => {
        expect(utrOrChequeText({ utr_ref: "", cheque_no: "004521", cheque_status: "Issued", status: "Rejected" })).toBe("");
    });

    it("names the cancelled cheque on a Rejected payment still on it", () => {
        expect(utrOrChequeText({ utr_ref: "", cheque_no: "004521", cheque_status: "Cancelled", status: "Rejected" })).toBe(
            "Cheque 004521 · Cancelled",
        );
    });
});

describe("chequeChipTone", () => {
    it("gives each cheque status its own colour, Pending included", () => {
        const tones = ["Pending", "Issued", "Cleared", "Cancelled"].map(chequeChipTone);
        expect(new Set(tones).size).toBe(4);
        expect(chequeChipTone("Pending")).toContain("indigo");
    });

    it("leaves a payment with no Cheque plain", () => {
        expect(chequeChipTone(null)).toBe(chequeChipTone("unknown"));
        expect(chequeChipTone(null)).not.toContain("indigo");
    });
});
