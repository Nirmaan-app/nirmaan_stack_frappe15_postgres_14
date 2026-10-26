import { describe, expect, it } from "vitest";

import { recordPagePath } from "./chequeRecordLink";

describe("recordPagePath", () => {
    it("opens a PO's page, its slashes carried as &=", () => {
        expect(recordPagePath("Procurement Orders", "PO/073/00187/26-27")).toBe("/purchase-orders/PO&=073&=00187&=26-27");
    });

    it("opens a WO's own page, never the Select Service Vendor screen a bare WO url lands on", () => {
        expect(recordPagePath("Service Requests", "SR-00260-001081")).toBe("/service-requests/SR-00260-001081?tab=approved-sr");
    });

    it("links nothing for another record type or a line without one", () => {
        expect(recordPagePath("Project Expenses", "PE-0001")).toBeNull();
        expect(recordPagePath("Procurement Orders", "")).toBeNull();
        expect(recordPagePath("Service Requests", null)).toBeNull();
        expect(recordPagePath(undefined, "PO/073/00187/26-27")).toBeNull();
    });
});
