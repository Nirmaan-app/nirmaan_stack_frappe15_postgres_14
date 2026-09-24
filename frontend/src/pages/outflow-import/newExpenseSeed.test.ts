// What the "Create a new expense" form opens with (#1314, owner Q6).
import { describe, expect, it } from "vitest";

import { newExpenseSeed, statementSpender } from "./newExpenseSeed";

const row = (over: Record<string, unknown> = {}) => ({
    remarks: "Transport charges alpha project",
    source: "Cashfree",
    ...over,
});

describe("newExpenseSeed", () => {
    it("with no plan: a project expense, described by the statement's remark", () => {
        expect(newExpenseSeed(row())).toEqual({
            doctype: "Project Expenses",
            description: "Transport charges alpha project",
        });
    });

    it("★ a reopened Cashbook line pre-fills from its stored plan", () => {
        expect(
            newExpenseSeed(
                row({
                    source: "Cashbook",
                    suggested_doctype: "Project Expenses",
                    suggested_expense_type: "Travel",
                    resolved_project: "PROJ-1",
                }),
            ),
        ).toEqual({
            doctype: "Project Expenses",
            expenseType: "Travel",
            project: "PROJ-1",
            description: "Transport charges alpha project",
        });
    });

    it("★ a non-project plan carries no project", () => {
        expect(
            newExpenseSeed(
                row({
                    suggested_doctype: "Non Project Expenses",
                    suggested_expense_type: "Petty Cash",
                    resolved_project: "PROJ-1",
                }),
            ),
        ).toEqual({
            doctype: "Non Project Expenses",
            expenseType: "Petty Cash",
            project: null,
            description: "Transport charges alpha project",
        });
    });

    it("a matcher's suggested record is not a plan: no expense type means no pre-fill", () => {
        expect(
            newExpenseSeed(row({ suggested_doctype: "Non Project Expenses", suggested_name: "NPE-1" })),
        ).toEqual({ doctype: "Project Expenses", description: "Transport charges alpha project" });
    });

    it("a ledger that is not an expense is ignored", () => {
        expect(
            newExpenseSeed(row({ suggested_doctype: "Project Payments", suggested_expense_type: "X" })).doctype,
        ).toBe("Project Expenses");
    });
});

describe("statementSpender -- the read-only Paid by the server will write", () => {
    it("★ a Cashbook line names the statement's From", () => {
        expect(statementSpender(row({ source: " Cashbook ", added_by_raw: " Asha Menon " }))).toBe("Asha Menon");
    });

    it("every other source, or a blank From, names nobody", () => {
        expect(statementSpender(row({ added_by_raw: "ops@x.com" }))).toBeNull();
        expect(statementSpender(row({ source: "Cashbook", added_by_raw: "  " }))).toBeNull();
    });
});
