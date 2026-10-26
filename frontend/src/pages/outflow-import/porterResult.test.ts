// The Porter import's result (#1561, spec #1554 stories 47-52): each order Create could not create, named
// with its reason and its fix, and the two links.
import { describe, expect, it } from "vitest";

import { createdExpenseLinks } from "@/utils/porterExpense";

import { type PorterFailedLine, porterResult } from "./porterResult";

const line = (over: Partial<PorterFailedLine> = {}): PorterFailedLine => ({
    name: "OIR-0001",
    crn: "CRN88412",
    note: "Baner Residency (PROJ-1) is Tendering, not Won. Choose a Won project for this order, then try again.",
    fix: "re-place",
    project: "PROJ-1",
    project_name: "Baner Residency",
    ...over,
});

const status = (over: Partial<NonNullable<Parameters<typeof porterResult>[0]>> = {}) => ({
    batch: "OFI-1",
    state: "Creating",
    created: 158,
    create_running: false,
    failed_lines: [line(), line({ name: "OIR-0002", crn: "CRN88530", note: "Could not create this expense. Run Create again.", fix: "retry", project: null, project_name: null })],
    created_expenses: { "Project Expenses": ["CRN1", "CRN2"] },
    ...over,
});

/** An Accountant Lead (or Admin): may move an order. */
const LEAD = { canMove: true };

describe("porterResult", () => {
    it("names each order that couldn't be created, with its reason and its fix", () => {
        expect(porterResult(status(), LEAD)).toEqual({
            heading: "2 orders couldn't be created",
            failed: [
                {
                    name: "OIR-0001",
                    crn: "CRN88412",
                    why: "Baner Residency (PROJ-1) is Tendering, not Won. Choose a Won project for this order, then try again.",
                    fix: "re-place",
                    action: "Choose project",
                },
                {
                    name: "OIR-0002",
                    crn: "CRN88530",
                    why: "Could not create this expense. Run Create again.",
                    fix: "retry",
                    action: "Try again",
                },
            ],
            expenseLinks: createdExpenseLinks({ "Project Expenses": ["CRN1", "CRN2"] }),
            moveLabel: "Move an order to another project",
        });
        expect(porterResult(status({ failed_lines: [line()], created: 159 }), LEAD)?.heading).toBe(
            "1 order couldn't be created",
        );
    });

    it("says all were created once every order is", () => {
        expect(porterResult(status({ state: "Created", created: 160, failed_lines: [] }), LEAD)).toEqual({
            heading: "All 160 expenses created.",
            failed: [],
            expenseLinks: createdExpenseLinks({ "Project Expenses": ["CRN1", "CRN2"] }),
            moveLabel: "Move an order to another project",
        });
        expect(porterResult(status({ state: "Created", created: 1, failed_lines: [] }), LEAD)?.heading).toBe(
            "All 1 expense created.",
        );
    });

    it("shows nothing before Create has started, or while its job runs", () => {
        expect(porterResult(status({ state: "Validated", created: 0, failed_lines: [] }), LEAD)).toBeNull();
        expect(porterResult(status({ create_running: true }), LEAD)).toBeNull();
        expect(porterResult(null, LEAD)).toBeNull();
    });

    it("a partly created import with nothing failed (a line reopened by Unreconcile) has no failures to name", () => {
        expect(porterResult(status({ created: 159, failed_lines: [] }), LEAD)).toEqual({
            heading: null,
            failed: [],
            expenseLinks: createdExpenseLinks({ "Project Expenses": ["CRN1", "CRN2"] }),
            moveLabel: "Move an order to another project",
        });
    });

    it("offers neither link before any expense exists", () => {
        const result = porterResult(status({ created: 0, created_expenses: {} }), LEAD);
        expect([result?.expenseLinks, result?.moveLabel]).toEqual([[], null]);
    });

    it("offers Move only to someone who may move an order", () => {
        const result = porterResult(status(), { canMove: false });
        expect(result?.expenseLinks.map((link) => link.label)).toEqual(["View the 2 expenses"]);
        expect(result?.moveLabel).toBeNull();
    });

    it("opens the created Expenses, one link per expense list they are on (#1561)", () => {
        const both = porterResult(
            status({ created_expenses: { "Project Expenses": ["CRN1"], "Non Project Expenses": ["CRN2", "CRN3"] } }),
            LEAD,
        );
        expect(both?.expenseLinks.map((link) => [link.label, link.to.split("?")[0]])).toEqual([
            ["View the 1 project expense", "/expense/project"],
            ["View the 2 non-project expenses", "/expense/non-project"],
        ]);
    });
});
