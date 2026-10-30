import { describe, expect, it } from "vitest";
import { dateFilterFn } from "@/utils/tableFilters";
import { formatDate } from "@/utils/FormatDate";
import {
    getPaymentTdsColumns,
    PAYMENT_TDS_DATE_COLUMNS,
    PAYMENT_TDS_FIELDS_TO_FETCH,
    PaymentTDSDeductionRow,
} from "./paymentTdsDeductions.config";

/**
 * The TDS register's two date columns (owner 2026-10-29): Approved On (`payment_approved_on`) and
 * Paid On (`payment_date`, "Payment Paid On"). What is rendered on screen is checked in the browser
 * (docs/browser-walk-tds-payment-paid-on.md); this pins what the CSV and the server query read.
 */
type ExportMeta = { exportHeaderName: string; exportValue: (row: PaymentTDSDeductionRow) => string };

const columns = getPaymentTdsColumns({
    getProjectName: () => "",
    getVendorName: () => "",
    getOrderValue: () => undefined,
});
const keys = columns.map((c) => (c as { accessorKey?: string }).accessorKey);
const column = (key: string) => columns[keys.indexOf(key)];
const meta = (key: string) => column(key).meta as ExportMeta;
const row = (fields: Partial<PaymentTDSDeductionRow>) => fields as PaymentTDSDeductionRow;

describe("the TDS register's Paid On column", () => {
    it("is fetched, so the column is never blank for want of the field", () => {
        expect(PAYMENT_TDS_FIELDS_TO_FETCH).toContain("payment_date");
    });

    it("sits right after Approved On", () => {
        expect(keys.indexOf("payment_date")).toBe(keys.indexOf("payment_approved_on") + 1);
    });

    it("exports under the field's own label", () => {
        expect(meta("payment_date").exportHeaderName).toBe("Payment Paid On");
    });

    it("exports the date as shown, and -- while the payment is not Paid", () => {
        expect(meta("payment_date").exportValue(row({ payment_date: "2026-10-28" }))).toBe(formatDate("2026-10-28"));
        expect(meta("payment_date").exportValue(row({}))).toBe("--");
    });

    it("takes the date filter, and is offered in the date-range picker", () => {
        expect(column("payment_date").filterFn).toBe(dateFilterFn);
        expect(PAYMENT_TDS_DATE_COLUMNS).toContain("payment_date");
    });
});

describe("Approved On, after both date columns moved onto one helper", () => {
    it("keeps its export header and value", () => {
        expect(meta("payment_approved_on").exportHeaderName).toBe("Payment Approved On");
        expect(meta("payment_approved_on").exportValue(row({ payment_approved_on: "2026-10-29" }))).toBe(
            formatDate("2026-10-29"),
        );
        expect(meta("payment_approved_on").exportValue(row({}))).toBe("--");
    });

    it("keeps its date filter", () => {
        expect(column("payment_approved_on").filterFn).toBe(dateFilterFn);
        expect(PAYMENT_TDS_DATE_COLUMNS).toContain("payment_approved_on");
    });

    it("reads its own field, not Paid On's", () => {
        const both = row({ payment_approved_on: "2026-10-29", payment_date: "2026-10-28" });
        expect(meta("payment_approved_on").exportValue(both)).toBe(formatDate("2026-10-29"));
        expect(meta("payment_date").exportValue(both)).toBe(formatDate("2026-10-28"));
    });
});
