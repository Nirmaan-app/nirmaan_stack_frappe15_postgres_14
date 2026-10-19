import { describe, expect, it } from "vitest";

import { expenseRouteState, showsExpenses } from "./expenseAccess";

describe("expenseRouteState: what /expense shows", () => {
    it("opens the page once the server says the viewer raises or reviews", () => {
        expect(expenseRouteState({ opens_expenses: true }, false)).toBe("allow");
    });

    it("waits while the server has not answered, rather than flashing Access Denied", () => {
        expect(expenseRouteState(undefined, false)).toBe("loading");
    });

    it("denies a viewer who can raise nothing and reviews nothing, and a failed read", () => {
        expect(expenseRouteState({ opens_expenses: false }, false)).toBe("deny");
        expect(expenseRouteState(undefined, true)).toBe("deny");
    });
});

describe("showsExpenses: the sidebar item", () => {
    it("shows only on a yes, and stays hidden while loading", () => {
        expect(showsExpenses({ opens_expenses: true })).toBe(true);
        expect(showsExpenses({ opens_expenses: false })).toBe(false);
        expect(showsExpenses(undefined)).toBe(false);
    });
});
