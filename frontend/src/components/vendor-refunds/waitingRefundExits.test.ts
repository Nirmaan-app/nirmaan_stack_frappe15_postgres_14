// #1403: the ways out for a waiting Vendor Refund, the "No bank proof" mark, and the 15-day warning.
import { describe, it, expect } from "vitest";

import {
    canCancelRefund,
    canMarkReceivedWithoutBankLine,
    hasNoBankProof,
    hasNoProofAtAll,
    isOverdueWaitingRefund,
    overdueWaitingFilters,
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
