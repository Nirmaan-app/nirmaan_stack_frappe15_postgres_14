import { describe, expect, it } from "vitest";

import { isReconPillKey, reconPillsFor } from "./reconPills";

const ACCOUNTANT = ["Nirmaan Accountant Profile", "test-accountant@example.com"] as const;

describe("Vendor Invoice Recon's pills", () => {
    it("on Pending Approval are PO, WO, Cashbook and Credit Card, in that order", () => {
        expect(reconPillsFor("pending", ...ACCOUNTANT).map((p) => p.label)).toEqual(["PO", "WO", "Cashbook", "Credit Card"]);
    });

    it("on All Invoices are PO / WO / Cashbook / Credit Card / Porter for an Accountant and the Administrator", () => {
        expect(reconPillsFor("all", ...ACCOUNTANT).map((p) => p.label)).toEqual(["PO", "WO", "Cashbook", "Credit Card", "Porter"]);
        expect(reconPillsFor("all", null, "Administrator").map((p) => p.key)).toEqual(["po", "wo", "cashbook", "card", "porter"]);
    });

    it("are PO / WO only for a profile that may not see expense or Porter bills", () => {
        expect(reconPillsFor("all", "Nirmaan Project Manager Profile", "test-pm@example.com").map((p) => p.label)).toEqual(["PO", "WO"]);
    });

    it("know their own keys from a stray URL value", () => {
        expect(isReconPillKey("porter")).toBe(true);
        expect(isReconPillKey("history")).toBe(false);
    });
});
