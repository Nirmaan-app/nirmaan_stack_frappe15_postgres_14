import { describe, expect, it } from "vitest";

import {
    chequeSummary,
    chequeTypeLabel,
    clearanceText,
    daysOutstanding,
    firstWithMore,
    hasNoPhoto,
    isStale,
    linesGap,
    payeeOf,
    statusChangeText,
    type ChequeRowLine,
} from "./chequePaymentTable.config";

describe("payeeOf", () => {
    it("shows the Vendor's name and links the Vendor", () => {
        expect(payeeOf({ vendor: "VEN-0042", vendor_name: "Acme Steel", payee_name: null })).toEqual({
            label: "Acme Steel",
            vendor: "VEN-0042",
        });
    });

    it("falls back to the Vendor id when its name is missing", () => {
        expect(payeeOf({ vendor: "VEN-0042", vendor_name: null })).toEqual({ label: "VEN-0042", vendor: "VEN-0042" });
    });

    it("shows a typed payee unlinked", () => {
        expect(payeeOf({ vendor: null, payee_name: "Tata Power" })).toEqual({ label: "Tata Power" });
    });
});

describe("statusChangeText", () => {
    it("names who made the last change and the day", () => {
        expect(
            statusChangeText({
                status_changed_by: "ravi@nirmaan.app",
                status_changed_by_name: "Ravi Kumar",
                status_changed_at: "2026-10-12 15:04:05",
            }),
        ).toBe("by Ravi Kumar · 12-Oct-2026");
    });

    it("falls back to the user id when the user has no name", () => {
        expect(
            statusChangeText({ status_changed_by: "Administrator", status_changed_at: "2026-10-12 09:00:00" }),
        ).toBe("by Administrator · 12-Oct-2026");
    });

    it("is empty when the Cheque has no history row", () => {
        expect(statusChangeText({ status_changed_by: null, status_changed_at: null })).toBe("");
    });
});

describe("chequeSummary", () => {
    it("shapes the endpoint's aggregates into the strip's five buckets, in order", () => {
        expect(
            chequeSummary({
                count: 6,
                total_amount: 98000,
                pending_count: 1,
                pending_amount: 8000,
                issued_count: 2,
                issued_amount: 50000,
                cleared_count: 2,
                cleared_amount: 35000,
                cancelled_count: 1,
                cancelled_amount: 5000,
            }),
        ).toEqual([
            { key: "all", label: "All", status: undefined, count: 6, amount: 98000 },
            { key: "pending", label: "Pending", status: "Pending", count: 1, amount: 8000 },
            { key: "issued", label: "Issued", status: "Issued", count: 2, amount: 50000 },
            { key: "cleared", label: "Cleared", status: "Cleared", count: 2, amount: 35000 },
            { key: "cancelled", label: "Cancelled", status: "Cancelled", count: 1, amount: 5000 },
        ]);
    });

    it("reads missing figures as zero while the first page loads", () => {
        expect(chequeSummary(null).map((b) => [b.count, b.amount])).toEqual([
            [0, 0],
            [0, 0],
            [0, 0],
            [0, 0],
            [0, 0],
        ]);
    });
});

const line = (over: Partial<ChequeRowLine>): ChequeRowLine => ({
    line_type: "PO/WO Payment",
    project: null,
    project_name: null,
    record_doctype: null,
    record_name: null,
    payment_doctype: null,
    payment_name: null,
    amount: 0,
    ...over,
});

describe("firstWithMore", () => {
    it("shows the first line's value and how many other values follow", () => {
        expect(firstWithMore(["PO-001", "WO-002", "PO-003"])).toEqual({ first: "PO-001", more: 2 });
    });

    it("counts a value once however many lines repeat it", () => {
        expect(firstWithMore(["Site A", "Site A", "Site B", "Site A"])).toEqual({ first: "Site A", more: 1 });
    });

    it("skips lines without the value (an expense line has no PO/WO)", () => {
        expect(firstWithMore([null, "WO-002", ""])).toEqual({ first: "WO-002", more: 0 });
        expect(firstWithMore([null, undefined])).toEqual({ first: undefined, more: 0 });
    });
});

describe("linesGap", () => {
    it("is the gap when the lines differ from the amount by more than ₹2", () => {
        expect(linesGap({ amount: 100000, lines: [line({ amount: 70000 })] })).toBe(30000);
        expect(linesGap({ amount: 100000, lines: [line({ amount: 70000 }), line({ amount: 30003 })] })).toBe(-3);
    });

    it("is null within ₹2, and for an Ad-hoc cheque with no lines", () => {
        expect(linesGap({ amount: 100000, lines: [line({ amount: 99998 })] })).toBeNull();
        expect(linesGap({ amount: 100000, lines: [line({ amount: 100002 })] })).toBeNull();
        expect(linesGap({ amount: 25000, lines: [] })).toBeNull();
    });
});

describe("daysOutstanding and isStale", () => {
    const today = new Date(2026, 9, 14); // 14 Oct 2026

    it("counts the days since the cheque date while the cheque is Issued", () => {
        expect(daysOutstanding({ status: "Issued", cheque_date: "2026-10-04" }, today)).toBe(10);
    });

    it("is nothing once the cheque is Cleared or Cancelled", () => {
        expect(daysOutstanding({ status: "Cleared", cheque_date: "2026-01-01" }, today)).toBeNull();
        expect(daysOutstanding({ status: "Cancelled", cheque_date: "2026-01-01" }, today)).toBeNull();
    });

    it("flags an Issued cheque older than 90 days as stale, and only that", () => {
        expect(isStale({ status: "Issued", cheque_date: "2026-07-16" }, today)).toBe(false); // 90 days
        expect(isStale({ status: "Issued", cheque_date: "2026-07-15" }, today)).toBe(true); // 91 days
        expect(isStale({ status: "Cleared", cheque_date: "2026-01-01" }, today)).toBe(false);
    });

    it("is negative for a post-dated cheque, which is never stale", () => {
        expect(daysOutstanding({ status: "Issued", cheque_date: "2026-10-20" }, today)).toBe(-6);
        expect(isStale({ status: "Issued", cheque_date: "2026-10-20" }, today)).toBe(false);
    });
});

describe("hasNoPhoto", () => {
    it("is true only for a Cheque without a photo (a backfilled one)", () => {
        expect(hasNoPhoto({ attachment: null })).toBe(true);
        expect(hasNoPhoto({ attachment: "" })).toBe(true);
        expect(hasNoPhoto({ attachment: "/private/files/cheque.jpg" })).toBe(false);
    });
});

describe("chequeTypeLabel", () => {
    it("names each cheque type as the tracker shows it", () => {
        expect(chequeTypeLabel("Payment")).toBe("Payment cheque");
        expect(chequeTypeLabel("Security Deposit")).toBe("Security Deposit");
    });
});

describe("clearanceText", () => {
    it("shows the clearance date and how the cheque was cleared", () => {
        expect(clearanceText({ clearance_date: "2026-09-10", cleared_by: "Bank import" })).toBe(
            "10-Sep-2026 (Bank import)",
        );
        expect(clearanceText({ clearance_date: "2026-09-10", cleared_by: null })).toBe("10-Sep-2026");
    });

    it("is blank while the bank has not paid it", () => {
        expect(clearanceText({ clearance_date: null, cleared_by: null })).toBe("");
    });
});
