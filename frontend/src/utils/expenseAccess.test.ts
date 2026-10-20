import { describe, expect, it } from "vitest";

import { expenseRouteState, offersNewExpense, showsExpenses } from "./expenseAccess";

describe("expenseRouteState: what /expense shows", () => {
    it("opens the page once the server says the viewer raises or reviews", () => {
        expect(expenseRouteState({ opens_expenses: true, can_raise: true }, false)).toBe("allow");
    });

    it("waits while the server has not answered, rather than flashing Access Denied", () => {
        expect(expenseRouteState(undefined, false)).toBe("loading");
    });

    it("denies a viewer who can raise nothing and reviews nothing, and a failed read", () => {
        expect(expenseRouteState({ opens_expenses: false, can_raise: false }, false)).toBe("deny");
        expect(expenseRouteState(undefined, true)).toBe("deny");
    });
});

describe("showsExpenses: the sidebar item", () => {
    it("shows only on a yes, and stays hidden while loading", () => {
        expect(showsExpenses({ opens_expenses: true, can_raise: true })).toBe(true);
        expect(showsExpenses({ opens_expenses: false, can_raise: false })).toBe(false);
        expect(showsExpenses(undefined)).toBe(false);
    });
});

describe("offersNewExpense: the New Expense button", () => {
    it("shows for a viewer who can raise a type", () => {
        expect(offersNewExpense({ opens_expenses: true, can_raise: true })).toBe(true);
    });

    it("hides for a reviewer who raises nothing, though the page opens for them", () => {
        const reviewerOnly = { opens_expenses: true, can_raise: false };
        expect(showsExpenses(reviewerOnly)).toBe(true);
        expect(offersNewExpense(reviewerOnly)).toBe(false);
    });

    it("stays hidden while the server has not answered", () => {
        expect(offersNewExpense(undefined)).toBe(false);
    });
});
