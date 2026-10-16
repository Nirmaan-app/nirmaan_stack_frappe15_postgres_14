// What the "Create a new expense" form opens with (#1314, owner Q6).
import { describe, expect, it } from "vitest";

import { newExpenseSeed, statementSpender } from "./newExpenseSeed";

// ⚠️ THE REMARK IS PRESENT ON PURPOSE: a row that HAS one must still open with an empty description.
const row = (over: Record<string, unknown> = {}) => ({
    remarks: "Transport charges alpha project",
    source: "Cashfree",
    suggested_doctype: null as string | null,
    ...over,
});

describe("newExpenseSeed", () => {
    it("★ with no plan: a project expense with an EMPTY description -- the narration is its Payment reference", () => {
        expect(newExpenseSeed(row())).toEqual({
            doctype: "Project Expenses",
            description: "",
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
            description: "",
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
            description: "",
        });
    });

    it("a matcher's suggested record is not a plan: no expense type means no pre-fill", () => {
        expect(
            newExpenseSeed(row({ suggested_doctype: "Non Project Expenses", suggested_name: "NPE-1" })),
        ).toEqual({ doctype: "Project Expenses", description: "" });
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
