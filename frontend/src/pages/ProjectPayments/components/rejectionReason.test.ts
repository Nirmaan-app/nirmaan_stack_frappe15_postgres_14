import { describe, expect, it } from "vitest";

import { rejectionReasonText } from "./rejectionReason";

describe("rejectionReasonText", () => {
    it("gives a Rejected payment's reason, trimmed", () => {
        expect(rejectionReasonText({ status: "Rejected", rejection_reason: "  Rate not agreed \n" })).toBe("Rate not agreed");
    });

    it("gives nothing for a Rejected payment with no reason saved (a reject from before the field)", () => {
        expect(rejectionReasonText({ status: "Rejected" })).toBeNull();
        expect(rejectionReasonText({ status: "Rejected", rejection_reason: "   " })).toBeNull();
        expect(rejectionReasonText({ status: "Rejected", rejection_reason: null })).toBeNull();
    });

    it("gives nothing for any other status, even if an old reason is still stored (brought back in Desk)", () => {
        for (const status of ["Requested", "CEO Pending", "Approved", "Reconciliation Pending", "Paid"]) {
            expect(rejectionReasonText({ status, rejection_reason: "old reason" })).toBeNull();
        }
    });

    it("gives nothing for no payment at all", () => {
        expect(rejectionReasonText(undefined)).toBeNull();
        expect(rejectionReasonText(null)).toBeNull();
    });
});
