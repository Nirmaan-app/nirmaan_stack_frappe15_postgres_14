import { describe, expect, it } from "vitest";

import { paymentTabReports } from "./paymentTab.config";

describe("paymentTabReports", () => {
    it("gives accounts the TDS ledger; cheques moved to the Cheque Tracker", () => {
        for (const role of ["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan Accountant Lead Profile"]) {
            expect(paymentTabReports(role)).toEqual(["TDS Deduction"]);
        }
    });

    it("gives Procurement nothing, so the tab is hidden: its cheques are in the Cheque Tracker", () => {
        for (const role of [
            "Nirmaan Procurement Executive Profile",
            "Nirmaan Procurement Lead Profile",
            "Nirmaan Material Procurement Executive Profile",
            "Nirmaan Service Procurement Executive Profile",
        ]) {
            expect(paymentTabReports(role)).toEqual([]);
        }
    });

    it("gives a Project Manager nothing, so the tab is hidden", () => {
        expect(paymentTabReports("Nirmaan Project Manager Profile")).toEqual([]);
        expect(paymentTabReports("Loading")).toEqual([]);
        expect(paymentTabReports(undefined)).toEqual([]);
    });
});
