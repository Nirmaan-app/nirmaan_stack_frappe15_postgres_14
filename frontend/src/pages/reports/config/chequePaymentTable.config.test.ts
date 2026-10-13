import { describe, expect, it } from "vitest";

import { payeeOf, statusChangeText } from "./chequePaymentTable.config";

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
