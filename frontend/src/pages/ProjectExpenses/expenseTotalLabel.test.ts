import { describe, expect, it } from "vitest";

import { expenseTotalLabel } from "./expenseTotalLabel";

// The Misc. Project Expenses card totals the expenses the list shows: on a project, the Paid ones
// only; on the standalone list, those of the status tab in view (#1528 outflow inventory, row 10).
describe("the expenses card names the expenses it totals", () => {
    it("says Paid expenses on the Paid tab, which is the only view inside a project", () => {
        expect(expenseTotalLabel("Paid")).toBe("Paid Expenses");
    });

    it("names the status of the other tabs", () => {
        expect(expenseTotalLabel("Requested")).toBe("Requested Expenses");
        expect(expenseTotalLabel("Approved")).toBe("Approved Expenses");
    });

    it("says all statuses on the All tab", () => {
        expect(expenseTotalLabel("All")).toBe("Expenses, All Statuses");
    });
});
