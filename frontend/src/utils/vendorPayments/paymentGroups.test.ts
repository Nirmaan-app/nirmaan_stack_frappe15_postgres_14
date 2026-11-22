import { describe, expect, it } from "vitest";

import {
    chequeIssuedOn,
    chequeWaitingText,
    groupCount,
    isChequeIssuedPayment,
    isVendorPaymentGroup,
    parseVendorPaymentGroup,
    paymentGroupOf,
    type PaymentListFilter,
    summarisePaymentGroups,
    VENDOR_PAYMENT_GROUP,
    VENDOR_PAYMENT_GROUPS,
    vendorPaymentGroupFilters,
} from "./paymentGroups";

const STATUSES = ["Requested", "CEO Pending", "Approved", "Reconciliation Pending", "Paid", "Rejected", "", null];
const MODES = ["Online", "Cheque", "", null];

/** Every status × mode a payment row can carry, each with a unique name and the vendor. */
const ALL_ROWS = STATUSES.flatMap((status, i) =>
    MODES.map((mode_of_payment, j) => ({ name: `PAY-${i}-${j}`, vendor: "VEN-1", status, mode_of_payment })),
);

type Row = (typeof ALL_ROWS)[number];

/** Reads the list filters the way the endpoint does, for the three operators the tabs send. */
const matches = (row: Row, filters: PaymentListFilter[]): boolean =>
    filters.every(([field, op, value]) => {
        const actual = (row as Record<string, unknown>)[field] ?? "";
        if (op === "=") return actual === value;
        if (op === "!=") return actual !== value;
        if (op === "not in") return !(value as string[]).includes(actual as string);
        throw new Error(`unexpected operator ${op}`);
    });

describe("paymentGroupOf", () => {
    it("puts every Paid payment under Paid, online or cheque", () => {
        expect(paymentGroupOf({ status: "Paid", mode_of_payment: "Online" })).toBe(VENDOR_PAYMENT_GROUP.PAID);
        expect(paymentGroupOf({ status: "Paid", mode_of_payment: "Cheque" })).toBe(VENDOR_PAYMENT_GROUP.PAID);
        expect(paymentGroupOf({ status: "Paid", mode_of_payment: null })).toBe(VENDOR_PAYMENT_GROUP.PAID);
    });

    it("puts only a cheque at Reconciliation Pending under Cheque Issued", () => {
        expect(paymentGroupOf({ status: "Reconciliation Pending", mode_of_payment: "Cheque" })).toBe(
            VENDOR_PAYMENT_GROUP.CHEQUE_ISSUED,
        );
    });

    it("keeps a cheque still at Approved out of Cheque Issued: its cheque is not issued yet", () => {
        expect(paymentGroupOf({ status: "Approved", mode_of_payment: "Cheque" })).toBe(VENDOR_PAYMENT_GROUP.OTHERS);
    });

    it("keeps an online payment at Reconciliation Pending in Other statuses", () => {
        expect(paymentGroupOf({ status: "Reconciliation Pending", mode_of_payment: "Online" })).toBe(
            VENDOR_PAYMENT_GROUP.OTHERS,
        );
        expect(paymentGroupOf({ status: "Reconciliation Pending", mode_of_payment: "" })).toBe(
            VENDOR_PAYMENT_GROUP.OTHERS,
        );
    });

    it("keeps a rejected cheque and a cheque awaiting approval in Other statuses", () => {
        for (const status of ["Requested", "CEO Pending", "Rejected"]) {
            expect(paymentGroupOf({ status, mode_of_payment: "Cheque" })).toBe(VENDOR_PAYMENT_GROUP.OTHERS);
        }
    });

    it("never drops a row: an unknown or blank status still lands in Other statuses", () => {
        expect(paymentGroupOf({ status: null, mode_of_payment: null })).toBe(VENDOR_PAYMENT_GROUP.OTHERS);
        expect(paymentGroupOf({ status: "Something New", mode_of_payment: "Cheque" })).toBe(VENDOR_PAYMENT_GROUP.OTHERS);
    });

    it("is case-sensitive like the stored values: 'paid' is not Paid", () => {
        expect(paymentGroupOf({ status: "paid", mode_of_payment: "Online" })).toBe(VENDOR_PAYMENT_GROUP.OTHERS);
        expect(isChequeIssuedPayment({ status: "Reconciliation Pending", mode_of_payment: "cheque" })).toBe(false);
    });
});

describe("vendorPaymentGroupFilters", () => {
    it("scopes every tab to the vendor first", () => {
        for (const group of VENDOR_PAYMENT_GROUPS) {
            expect(vendorPaymentGroupFilters(group, "VEN-9")[0]).toEqual(["vendor", "=", "VEN-9"]);
        }
    });

    it("sends no empty `not in` when the vendor has no issued cheques", () => {
        const filters = vendorPaymentGroupFilters(VENDOR_PAYMENT_GROUP.OTHERS, "VEN-1", []);
        expect(filters.some(([field]) => field === "name")).toBe(false);
    });

    it("does not hand out the caller's array, so a later change to it cannot alter the filter", () => {
        const names = ["PAY-A"];
        const filters = vendorPaymentGroupFilters(VENDOR_PAYMENT_GROUP.OTHERS, "VEN-1", names);
        names.push("PAY-B");
        expect(filters[filters.length - 1]).toEqual(["name", "not in", ["PAY-A"]]);
    });

    it("fetches exactly the rows the rule puts in each tab, for every status × mode", () => {
        const issuedNames = ALL_ROWS.filter((r) => isChequeIssuedPayment(r)).map((r) => r.name);
        for (const group of VENDOR_PAYMENT_GROUPS) {
            const filters = vendorPaymentGroupFilters(group, "VEN-1", issuedNames);
            for (const row of ALL_ROWS) {
                expect({ row: row.name, group, fetched: matches(row, filters) }).toEqual({
                    row: row.name,
                    group,
                    fetched: paymentGroupOf(row) === group,
                });
            }
        }
    });

    it("puts every row in exactly one tab", () => {
        const issuedNames = ALL_ROWS.filter((r) => isChequeIssuedPayment(r)).map((r) => r.name);
        for (const row of ALL_ROWS) {
            const tabs = VENDOR_PAYMENT_GROUPS.filter((g) => matches(row, vendorPaymentGroupFilters(g, "VEN-1", issuedNames)));
            expect(tabs).toHaveLength(1);
        }
    });

    it("never fetches another vendor's payments", () => {
        const other = { ...ALL_ROWS[0], vendor: "VEN-2", status: "Paid" };
        for (const group of VENDOR_PAYMENT_GROUPS) {
            expect(matches(other, vendorPaymentGroupFilters(group, "VEN-1"))).toBe(false);
        }
    });
});

describe("summarisePaymentGroups", () => {
    it("is all zeros for a vendor with no payments", () => {
        const s = summarisePaymentGroups([]);
        expect(s).toEqual({
            paid: { count: 0, amount: 0, onlineCount: 0, chequeCount: 0 },
            chequeIssued: { count: 0, amount: 0 },
            others: { count: 0, amount: 0, rejectedCount: 0, rejectedAmount: 0 },
        });
    });

    it("adds each status × mode row into its tab, and splits Paid into online and cheque", () => {
        const s = summarisePaymentGroups([
            { status: "Paid", mode_of_payment: "Online", count: 5, amount: 396351 },
            { status: "Paid", mode_of_payment: "Cheque", count: 1, amount: 75000 },
            { status: "Reconciliation Pending", mode_of_payment: "Cheque", count: 2, amount: 85000 },
            { status: "Reconciliation Pending", mode_of_payment: "Online", count: 1, amount: 9800 },
            { status: "Approved", mode_of_payment: "Cheque", count: 1, amount: 22500 },
            { status: "Requested", mode_of_payment: "Online", count: 2, amount: 92000 },
            { status: "Rejected", mode_of_payment: "Cheque", count: 1, amount: 30000 },
            { status: "Rejected", mode_of_payment: "Online", count: 1, amount: 12000 },
        ]);
        expect(s.paid).toEqual({ count: 6, amount: 471351, onlineCount: 5, chequeCount: 1 });
        expect(s.chequeIssued).toEqual({ count: 2, amount: 85000 });
        expect(s.others).toEqual({ count: 6, amount: 124300, rejectedCount: 2, rejectedAmount: 42000 });
    });

    it("counts a Rejected payment on the tab but never in its ₹ total", () => {
        const s = summarisePaymentGroups([{ status: "Rejected", mode_of_payment: "Online", count: 3, amount: 50000 }]);
        expect(s.others.count).toBe(3);
        expect(s.others.amount).toBe(0);
    });

    it("reads counts and sums that arrive as text or blank (Postgres numeric)", () => {
        const s = summarisePaymentGroups([
            { status: "Paid", mode_of_payment: "Online", count: "2", amount: "1500.50" },
            { status: "Paid", mode_of_payment: null, count: null, amount: null },
        ]);
        expect(s.paid).toEqual({ count: 2, amount: 1500.5, onlineCount: 2, chequeCount: 0 });
    });

    it("gives each tab the count its badge shows", () => {
        const s = summarisePaymentGroups([
            { status: "Paid", mode_of_payment: "Online", count: 4, amount: 1 },
            { status: "Reconciliation Pending", mode_of_payment: "Cheque", count: 2, amount: 1 },
            { status: "Rejected", mode_of_payment: "Online", count: 3, amount: 1 },
        ]);
        expect(VENDOR_PAYMENT_GROUPS.map((g) => groupCount(s, g))).toEqual([4, 2, 3]);
    });
});

describe("parseVendorPaymentGroup", () => {
    it("opens the tab the URL names", () => {
        for (const group of VENDOR_PAYMENT_GROUPS) expect(parseVendorPaymentGroup(group)).toBe(group);
    });

    it("opens Paid for a missing, blank or made-up value", () => {
        for (const value of [null, undefined, "", "Paid", "rejected", "others "]) {
            expect(parseVendorPaymentGroup(value)).toBe(VENDOR_PAYMENT_GROUP.PAID);
        }
    });
});

describe("isVendorPaymentGroup", () => {
    it("accepts only the three tab keys", () => {
        expect(VENDOR_PAYMENT_GROUPS.every(isVendorPaymentGroup)).toBe(true);
        for (const value of ["", "Paid", "rejected", "cheque issued"]) expect(isVendorPaymentGroup(value)).toBe(false);
    });
});

describe("chequeIssuedOn", () => {
    it("takes the later of the L1 and CEO approval dates", () => {
        expect(chequeIssuedOn({ approval_date: "2026-11-08", ceo_approval_date: "2026-11-10" })).toBe("2026-11-10");
        expect(chequeIssuedOn({ approval_date: "2026-11-12", ceo_approval_date: "2026-11-10" })).toBe("2026-11-12");
    });

    it("uses whichever one date there is", () => {
        expect(chequeIssuedOn({ approval_date: "2026-11-08" })).toBe("2026-11-08");
        expect(chequeIssuedOn({ approval_date: null, ceo_approval_date: "2026-11-09" })).toBe("2026-11-09");
    });

    it("cuts a date-time to its day", () => {
        expect(chequeIssuedOn({ approval_date: "2026-11-08 17:45:00" })).toBe("2026-11-08");
    });

    it("is blank when the payment carries no approval date", () => {
        expect(chequeIssuedOn({})).toBe("");
        expect(chequeIssuedOn({ approval_date: "", ceo_approval_date: null })).toBe("");
    });
});

describe("chequeWaitingText", () => {
    const today = new Date(2026, 10, 19, 15, 30);

    it("counts calendar days, whatever the time of day", () => {
        expect(chequeWaitingText("2026-11-08", today)).toBe("11 days, not cleared yet");
        expect(chequeWaitingText("2026-11-18", today)).toBe("1 day, not cleared yet");
        expect(chequeWaitingText("2026-11-19", today)).toBe("Issued today");
    });

    it("never shows a negative wait for a date after today", () => {
        expect(chequeWaitingText("2026-11-25", today)).toBe("Issued today");
    });

    it("is blank when the issue date is unknown", () => {
        expect(chequeWaitingText("", today)).toBe("");
    });
});
