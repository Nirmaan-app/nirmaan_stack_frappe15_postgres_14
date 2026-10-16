// #1403: the ways out for a waiting Vendor Refund, the "No bank proof" mark, and the 15-day warning.
import { describe, it, expect } from "vitest";

import {
    canCancelRefund,
    canDeleteRefund,
    canMarkReceivedWithoutBankLine,
    hasNoBankProof,
    hasNoProofAtAll,
    isOverdueWaitingRefund,
    overdueWaitingFilters,
    refundEditAccess,
    refundEditChanges,
} from "./waitingRefundExits";

const NOW = new Date(2026, 9, 20, 12, 0, 0); // 20 Oct 2026, 12:00 local

const refund = (over: Record<string, unknown> = {}) => ({
    status: "Reconciliation Pending" as const,
    waiting_created_by: "buyer@nirmaan.app",
    creation: "2026-10-01 09:00:00.000000",
    no_bank_line: 0,
    ...over,
});

describe("isOverdueWaitingRefund", () => {
    it("is overdue once it has waited more than 15 days since it was recorded", () => {
        expect(isOverdueWaitingRefund(refund({ creation: "2026-10-05 11:59:00" }), NOW)).toBe(true);
    });

    it("is not overdue at 15 days or less", () => {
        expect(isOverdueWaitingRefund(refund({ creation: "2026-10-05 12:00:01" }), NOW)).toBe(false);
        expect(isOverdueWaitingRefund(refund({ creation: "2026-10-19 09:00:00" }), NOW)).toBe(false);
    });

    it("only a waiting refund can be overdue", () => {
        for (const status of ["Received", "Cancelled"] as const) {
            expect(isOverdueWaitingRefund(refund({ status }), NOW)).toBe(false);
        }
    });
});

describe("overdueWaitingFilters", () => {
    it("asks for waiting refunds recorded before the 15-day cutoff", () => {
        expect(overdueWaitingFilters(NOW)).toEqual([
            ["status", "=", "Reconciliation Pending"],
            ["creation", "<", "2026-10-05 12:00:00"],
        ]);
    });
});

describe("hasNoBankProof", () => {
    it("is a Received refund an Admin marked with no bank line", () => {
        expect(hasNoBankProof(refund({ status: "Received", no_bank_line: 1 }))).toBe(true);
    });

    it("is gone once a bank line is matched to it", () => {
        expect(hasNoBankProof(refund({ status: "Received", no_bank_line: 0 }))).toBe(false);
    });
});

// #1404: a refund migrated from Adjust Payments with no proof is flagged so accounts attach one.
describe("hasNoProofAtAll", () => {
    it("is a Received refund with no bank line and no attachment", () => {
        expect(hasNoProofAtAll(refund({ status: "Received", no_bank_line: 1, refund_attachment: null }))).toBe(true);
        expect(hasNoProofAtAll(refund({ status: "Received", no_bank_line: 1, refund_attachment: "" }))).toBe(true);
    });

    it("is gone once proof is attached or a bank line is matched", () => {
        expect(hasNoProofAtAll(refund({ status: "Received", no_bank_line: 1, refund_attachment: "/files/p.png" }))).toBe(false);
        expect(hasNoProofAtAll(refund({ status: "Received", no_bank_line: 0, refund_attachment: null }))).toBe(false);
    });

    it("does not flag a waiting refund, whose bank line is still to come", () => {
        expect(hasNoProofAtAll(refund({ refund_attachment: null }))).toBe(false);
    });
});

describe("canCancelRefund", () => {
    it("lets its creator or an Accountant cancel a waiting refund", () => {
        expect(canCancelRefund(refund(), "buyer@nirmaan.app", "Nirmaan Procurement Executive Profile")).toBe(true);
        expect(canCancelRefund(refund(), "acc@nirmaan.app", "Nirmaan Accountant Profile")).toBe(true);
        expect(canCancelRefund(refund(), "lead@nirmaan.app", "Nirmaan Accountant Lead Profile")).toBe(true);
        expect(canCancelRefund(refund(), "Administrator", "Loading")).toBe(true);
    });

    it("refuses anyone else, and any refund no longer waiting", () => {
        expect(canCancelRefund(refund(), "other@nirmaan.app", "Nirmaan Procurement Executive Profile")).toBe(false);
        expect(canCancelRefund(refund(), "admin@nirmaan.app", "Nirmaan Admin Profile")).toBe(false);
        expect(canCancelRefund(refund({ status: "Received" }), "buyer@nirmaan.app", "x")).toBe(false);
    });
});

describe("canDeleteRefund", () => {
    const cancelled = refund({ status: "Cancelled" });

    it("lets an Admin or material Procurement delete a Cancelled refund", () => {
        expect(canDeleteRefund(cancelled, "admin@nirmaan.app", "Nirmaan Admin Profile")).toBe(true);
        expect(canDeleteRefund(cancelled, "Administrator", "Loading")).toBe(true);
        expect(canDeleteRefund(cancelled, "buyer@nirmaan.app", "Nirmaan Procurement Executive Profile")).toBe(true);
        expect(canDeleteRefund(cancelled, "mp@nirmaan.app", "Nirmaan Material Procurement Executive Profile")).toBe(true);
    });

    it("refuses PMO and Accountants, and any refund not Cancelled", () => {
        expect(canDeleteRefund(cancelled, "pmo@nirmaan.app", "Nirmaan PMO Executive Profile")).toBe(false);
        expect(canDeleteRefund(cancelled, "acc@nirmaan.app", "Nirmaan Accountant Profile")).toBe(false);
        expect(canDeleteRefund(refund(), "admin@nirmaan.app", "Nirmaan Admin Profile")).toBe(false);
        expect(canDeleteRefund(refund({ status: "Received" }), "admin@nirmaan.app", "Nirmaan Admin Profile")).toBe(false);
    });
});

describe("canMarkReceivedWithoutBankLine", () => {
    it("lets only an Admin mark a waiting refund", () => {
        expect(canMarkReceivedWithoutBankLine(refund(), "admin@nirmaan.app", "Nirmaan Admin Profile")).toBe(true);
        expect(canMarkReceivedWithoutBankLine(refund(), "Administrator", "Loading")).toBe(true);
        expect(canMarkReceivedWithoutBankLine(refund(), "buyer@nirmaan.app", "Nirmaan Accountant Profile")).toBe(false);
        expect(
            canMarkReceivedWithoutBankLine(refund({ status: "Cancelled" }), "admin@nirmaan.app", "Nirmaan Admin Profile")
        ).toBe(false);
    });
});

// #1396 stories 8 and 10: who may change what on a refund, mirroring `waiting_refunds.update_waiting_refund`.
describe("refundEditAccess", () => {
    const PROCUREMENT = "Nirmaan Procurement Executive Profile";

    it("lets its creator or an Accountant change the amount and PO while it waits", () => {
        expect(refundEditAccess(refund(), "buyer@nirmaan.app", PROCUREMENT).money).toBe(true);
        expect(refundEditAccess(refund(), "acc@nirmaan.app", "Nirmaan Accountant Profile").money).toBe(true);
        expect(refundEditAccess(refund(), "Administrator", "Loading").money).toBe(true);
    });

    it("fixes the amount and PO for anyone else, and for everyone once it is no longer waiting", () => {
        expect(refundEditAccess(refund(), "other@nirmaan.app", PROCUREMENT).money).toBe(false);
        expect(refundEditAccess(refund({ status: "Received" }), "buyer@nirmaan.app", PROCUREMENT).money).toBe(false);
        expect(refundEditAccess(refund({ status: "Cancelled" }), "Administrator", "Loading").money).toBe(false);
    });

    it("lets anyone who works the PO's payments complete its paperwork at any status", () => {
        for (const role of [PROCUREMENT, "Nirmaan PMO Executive Profile", "Nirmaan Admin Profile", "Nirmaan Accountant Lead Profile"]) {
            expect(refundEditAccess(refund({ status: "Received" }), "someone@nirmaan.app", role).paperwork).toBe(true);
        }
        expect(refundEditAccess(refund(), "someone@nirmaan.app", "Nirmaan Project Manager Profile").paperwork).toBe(false);
        expect(refundEditAccess(refund(), "buyer@nirmaan.app", "Nirmaan Project Manager Profile").paperwork).toBe(true);
    });

    it("keeps the UTR fixed while a bank line is matched to it", () => {
        expect(refundEditAccess(refund({ bank_matched: true }), "Administrator", "Loading").utrLocked).toBe(true);
        expect(refundEditAccess(refund({ bank_matched: false }), "Administrator", "Loading").utrLocked).toBe(false);
    });
});

describe("refundEditChanges", () => {
    const saved = { amount: 500, document_name: "PO/1", utr: "UTR-1", description: null };
    const form = (over: Record<string, string> = {}) => ({
        amount: "500",
        poId: "PO/1",
        utr: "UTR-1",
        description: "",
        ...over,
    });
    const all = { money: true, paperwork: true, utrLocked: false };

    it("sends only what changed", () => {
        expect(refundEditChanges(saved, form(), all)).toEqual({});
        expect(refundEditChanges(saved, form({ amount: "450", description: " slip came " }), all)).toEqual({
            amount: 450,
            description: "slip came",
        });
        expect(refundEditChanges(saved, form({ poId: "PO/2", utr: "" }), all)).toEqual({ po_id: "PO/2", utr: null });
    });

    it("never sends the amount or PO without money access, nor the UTR while it is fixed", () => {
        expect(
            refundEditChanges(saved, form({ amount: "1", poId: "PO/2", utr: "OTHER" }), {
                money: false,
                paperwork: true,
                utrLocked: true,
            })
        ).toEqual({});
    });
});
