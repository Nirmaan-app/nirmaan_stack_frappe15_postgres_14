// Matching a bank credit line to waiting Vendor Refunds in the decision dialog (#1401, ADR-0032).
//
// The server's rule (`services/vendor_refunds.waiting_match_problem`) is that the refunds chosen add up
// EXACTLY to the line (owner, 2026-10-13: no partial allocation for credit lines); this is the same rule
// in the reviewer's words, so Confirm is off, with the reason beside it, until it holds.
import { describe, expect, it } from "vitest";

import {
    decisionOrigin,
    isConfirmable,
    recordAnywayWording,
    seedDecisions,
    settlesAPickedRecord,
    type RowDecision,
} from "./outflowTableModel";
import {
    toggleWaitingRefund,
    waitingRefundNames,
    waitingRefundProblem,
    waitingRefundsHeadline,
    waitingRefundTotals,
    withWaitingRefundVendor,
    type WaitingRefund,
    type WaitingRefundForm,
} from "./waitingRefundMatch";

const refund = (name: string, amount: number): WaitingRefund => ({
    name,
    amount,
    document_type: "Procurement Orders",
    document_name: `PO/${name}`,
    project: "PROJ-1",
    project_name: "Project One",
    payment_date: "2026-10-01",
    utr: null,
    waiting_created_by: "buyer@nirmaan.app",
    creation: "2026-10-01 10:00:00",
});

const form = (...refunds: WaitingRefund[]): WaitingRefundForm => ({
    vendor: "VEN-1",
    picks: refunds.map((r) => ({ name: r.name, amount: r.amount, label: r.document_name ?? r.name })),
});

describe("the headline once a vendor is chosen", () => {
    it("counts the vendor's waiting refunds", () => {
        expect(waitingRefundsHeadline(1)).toBe("This vendor has 1 waiting refund");
        expect(waitingRefundsHeadline(3)).toBe("This vendor has 3 waiting refunds");
    });
});

describe("picking waiting refunds", () => {
    it("a tick adds the refund, a second tick takes it off", () => {
        const one = toggleWaitingRefund({ vendor: "VEN-1" }, refund("VRF-1", 600));
        expect(waitingRefundNames(one)).toEqual(["VRF-1"]);
        expect(waitingRefundNames(toggleWaitingRefund(one, refund("VRF-1", 600)))).toEqual([]);
    });

    it("a new vendor clears every tick: none of them is that vendor's", () => {
        const picked = form(refund("VRF-1", 600));
        expect(withWaitingRefundVendor(picked, "VEN-2")).toEqual({ vendor: "VEN-2", picks: [] });
        expect(withWaitingRefundVendor(picked, "VEN-1")).toEqual(picked);
    });

    it("the running balance is what the ticked refunds take and what of the line is left", () => {
        expect(waitingRefundTotals(form(refund("VRF-1", 600.4), refund("VRF-2", 300)), 1000)).toEqual({
            matched: 900.4,
            remaining: 99.6,
        });
    });
});

describe("waitingRefundProblem -- the refunds must add up to the line exactly", () => {
    it("one refund of the line's amount, or a split that adds up, is ready", () => {
        expect(waitingRefundProblem(form(refund("VRF-1", 1000)), 1000)).toBeNull();
        expect(waitingRefundProblem(form(refund("VRF-1", 600.4), refund("VRF-2", 399.6)), 1000)).toBeNull();
    });

    it("needs a vendor and at least one refund", () => {
        expect(waitingRefundProblem(undefined, 1000)).toBe("Choose the vendor.");
        expect(waitingRefundProblem({ vendor: "VEN-1" }, 1000)).toBe("Tick at least one waiting refund.");
    });

    it("refuses a split short of the line or over it, saying by how much", () => {
        expect(waitingRefundProblem(form(refund("VRF-1", 600)), 1000)).toBe(
            "₹400 of the line is not matched yet. The refunds must add up to the line exactly."
        );
        expect(waitingRefundProblem(form(refund("VRF-1", 600), refund("VRF-2", 500)), 1000)).toBe(
            "The refunds are ₹100 more than the line. They must add up to the line exactly."
        );
    });
});

describe("the decision", () => {
    const credit = { name: "ROW-1", amount: 1000, direction: "Credit", row_status: "Mismatched" } as any;
    const decision = (f: WaitingRefundForm): RowDecision => ({ target: "waitingRefund", waitingRefund: f });

    it("is confirmable on a credit line once the refunds add up", () => {
        expect(isConfirmable(credit, decision(form(refund("VRF-1", 1000))))).toBe(true);
        expect(isConfirmable(credit, decision(form(refund("VRF-1", 900))))).toBe(false);
    });

    it("is never confirmable on a debit line", () => {
        const debit = { ...credit, direction: "Debit" };
        expect(isConfirmable(debit, decision(form(refund("VRF-1", 1000))))).toBe(false);
    });

    it("is a match, not a create, and not a payable picked from the record list", () => {
        expect(recordAnywayWording({ target: "waitingRefund" })).toEqual({
            title: "Match anyway?",
            action: "Match anyway",
        });
        expect(settlesAPickedRecord("waitingRefund")).toBe(false);
        expect(settlesAPickedRecord("vendorRefund")).toBe(false);
        expect(settlesAPickedRecord("Project Payments")).toBe(true);
        expect(settlesAPickedRecord(undefined)).toBe(true);
    });
});

// #1402: the import run suggests the waiting refund(s) a credit line is (its bank reference is the UTR
// typed on them). The dialog opens on "Match a waiting Vendor Refund" with them ticked, ready to confirm;
// the accountant still clicks Match.
describe("the import run's suggestion", () => {
    const suggested = {
        name: "ROW-1",
        amount: 2000,
        direction: "Credit",
        row_status: "Mismatched",
        waiting_refund_suggestion: {
            vendor: "VEN-1",
            basis: "Bank reference",
            refunds: [
                { name: "VRF-1", amount: 1180, label: "PO/1" },
                { name: "VRF-2", amount: 820, label: "PO/2" },
            ],
        },
    } as any;

    it("opens the line on the match, the suggested refunds ticked and ready to confirm", () => {
        const decision = seedDecisions([suggested], new Map()).get("ROW-1")!;

        expect(decision).toEqual({
            target: "waitingRefund",
            waitingRefund: {
                vendor: "VEN-1",
                picks: [
                    { name: "VRF-1", amount: 1180, label: "PO/1" },
                    { name: "VRF-2", amount: 820, label: "PO/2" },
                ],
            },
        });
        expect(isConfirmable(suggested, decision)).toBe(true);
        expect(waitingRefundNames(decision.waitingRefund)).toEqual(["VRF-1", "VRF-2"]);
    });

    it("reads as the suggestion until a tick changes", () => {
        const decision = seedDecisions([suggested], new Map()).get("ROW-1")!;
        expect(decisionOrigin(suggested, decision)).toBe("suggested");

        const untick = toggleWaitingRefund(decision.waitingRefund!, refund("VRF-2", 820));
        expect(decisionOrigin(suggested, { ...decision, waitingRefund: untick })).toBe("chosen");
    });

    it("never overwrites what the reviewer already chose for the line", () => {
        const mine: RowDecision = { target: "vendorRefund" };
        const held = new Map([["ROW-1", mine]]);

        expect(seedDecisions([suggested], held).get("ROW-1")).toBe(mine);
    });

    it("is not seeded on a line that is no longer open, or carries none", () => {
        for (const row_status of ["Settled", "Skipped", "Partially Allocated", "Pending match run"]) {
            expect(seedDecisions([{ ...suggested, row_status }], new Map()).size).toBe(0);
        }
        expect(seedDecisions([{ ...suggested, waiting_refund_suggestion: null }], new Map()).size).toBe(0);
    });
});
