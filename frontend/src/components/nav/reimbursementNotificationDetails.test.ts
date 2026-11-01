import { describe, expect, it } from "vitest";

import { isReimbursementNotification, reimbursementDetailLines } from "./reimbursementNotificationDetails";

describe("reimbursement notification lines", () => {
    it("is told apart by its doctype", () => {
        expect(isReimbursementNotification({ document: "Reimbursement" })).toBe(true);
        expect(isReimbursementNotification({ document: "Expense Request" })).toBe(false);
    });

    it("shows the claim and who decided it", () => {
        const lines = reimbursementDetailLines(
            { docname: "REIMB-26-00012", sender: "priya@example.com" },
            (id) => (id === "priya@example.com" ? "Priya Nair" : undefined),
        );
        expect(lines).toEqual([
            { label: "Claim", value: "REIMB-26-00012" },
            { label: "Decided By", value: "Priya Nair" },
        ]);
    });

    it("falls back to the id, and to Administrator when there is no sender", () => {
        expect(reimbursementDetailLines({ docname: "R1", sender: "x@example.com" }, () => undefined)[1].value).toBe("x@example.com");
        expect(reimbursementDetailLines({ docname: "R1", sender: null }, () => undefined)[1].value).toBe("Administrator");
    });
});
