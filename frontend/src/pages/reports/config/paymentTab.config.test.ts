import { describe, expect, it } from "vitest";

import { paymentTabReports } from "./paymentTab.config";

describe("paymentTabReports", () => {
    it("gives accounts both reports, the TDS ledger first", () => {
        for (const role of ["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan Accountant Lead Profile"]) {
            expect(paymentTabReports(role)).toEqual(["TDS Deduction", "Cheque Payment"]);
        }
    });

    it("gives every Procurement profile the Cheque Payment report only", () => {
        for (const role of [
            "Nirmaan Procurement Executive Profile",
            "Nirmaan Procurement Lead Profile",
            "Nirmaan Material Procurement Executive Profile",
            "Nirmaan Service Procurement Executive Profile",
        ]) {
            expect(paymentTabReports(role)).toEqual(["Cheque Payment"]);
        }
    });

    it("gives a Project Manager neither, so the tab is hidden", () => {
        expect(paymentTabReports("Nirmaan Project Manager Profile")).toEqual([]);
        expect(paymentTabReports("Loading")).toEqual([]);
        expect(paymentTabReports(undefined)).toEqual([]);
    });
});
