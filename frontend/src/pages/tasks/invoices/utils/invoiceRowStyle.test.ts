import { describe, expect, it } from "vitest";
import {
    INVOICE_AGED_ROW_CLASSES,
    INVOICE_AGING_RED_DAYS,
    invoiceAgeInDays,
    invoiceRowClassName,
    isAgedPendingInvoice,
} from "./invoiceRowStyle";
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";

const NOW = new Date(2026, 6, 27, 12, 0, 0); // 27-Jul-2026 midday

/** Frappe's `creation` wire format: "YYYY-MM-DD HH:mm:ss.ffffff". */
const daysAgo = (n: number, hour = 12): string => {
    const d = new Date(NOW.getTime());
    d.setDate(d.getDate() - n);
    d.setHours(hour, 0, 0, 0);
    const pad = (v: number) => String(v).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00:00.000000`;
};

const invoice = (
    status: VendorInvoice["status"],
    creation: string | undefined
): Pick<VendorInvoice, "status" | "creation"> =>
    ({ status, creation }) as Pick<VendorInvoice, "status" | "creation">;

describe("invoiceAgeInDays", () => {
    it("counts whole elapsed days", () => {
        expect(invoiceAgeInDays(daysAgo(0), NOW)).toBe(0);
        expect(invoiceAgeInDays(daysAgo(1), NOW)).toBe(1);
        expect(invoiceAgeInDays(daysAgo(10), NOW)).toBe(10);
    });

    it("parses Frappe's space-separated microsecond timestamp", () => {
        expect(invoiceAgeInDays("2026-07-20 11:06:14.126479", NOW)).toBe(7);
    });

    // An unknown age must not read as an old age.
    it.each([undefined, null, "", "not-a-timestamp"])(
        "returns null for unusable input %p",
        (input) => {
            expect(invoiceAgeInDays(input as string | undefined, NOW)).toBeNull();
        }
    );
});

describe("isAgedPendingInvoice", () => {
    it("is false at and below the threshold", () => {
        expect(isAgedPendingInvoice(invoice("Pending", daysAgo(0)), NOW)).toBe(false);
        expect(isAgedPendingInvoice(invoice("Pending", daysAgo(1)), NOW)).toBe(false);
        expect(
            isAgedPendingInvoice(invoice("Pending", daysAgo(INVOICE_AGING_RED_DAYS)), NOW)
        ).toBe(false);
    });

    it("is true past the threshold", () => {
        expect(
            isAgedPendingInvoice(invoice("Pending", daysAgo(INVOICE_AGING_RED_DAYS + 1)), NOW)
        ).toBe(true);
        expect(isAgedPendingInvoice(invoice("Pending", daysAgo(30)), NOW)).toBe(true);
    });

    // The history table lists all three statuses; age only means something
    // while the invoice is still awaiting a decision.
    it.each(["Approved", "Rejected"] as const)(
        "is false for a %s invoice however old",
        (status) => {
            expect(isAgedPendingInvoice(invoice(status, daysAgo(365)), NOW)).toBe(false);
        }
    );

    it("is false when creation is unusable, even while Pending", () => {
        expect(isAgedPendingInvoice(invoice("Pending", undefined), NOW)).toBe(false);
    });

    it("matches the real backlog — the oldest pending row is aged", () => {
        expect(
            isAgedPendingInvoice(invoice("Pending", "2026-04-04 11:06:14.126479"), NOW)
        ).toBe(true);
    });
});

describe("invoiceRowClassName", () => {
    it("returns the aged classes for an aged pending row", () => {
        expect(invoiceRowClassName(invoice("Pending", daysAgo(10)), NOW)).toBe(
            INVOICE_AGED_ROW_CLASSES
        );
    });

    // The DataTable contract expects undefined, not "", for an untinted row.
    it("returns undefined otherwise", () => {
        expect(invoiceRowClassName(invoice("Pending", daysAgo(1)), NOW)).toBeUndefined();
        expect(invoiceRowClassName(invoice("Approved", daysAgo(99)), NOW)).toBeUndefined();
    });
});
