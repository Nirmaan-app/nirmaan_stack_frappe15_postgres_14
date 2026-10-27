import { describe, expect, it } from "vitest";

import {
    ADMIN_ONLY,
    NO_PACKAGE_FILTERS,
    filterExpenseTypes,
    hasActiveFilters,
    type FilterableType,
    type PackageFilters,
} from "./expensePackagesFilter";

const TYPES: FilterableType[] = [
    { name: "Hotel Expenses", project: true, non_project: true, payee_rule: "Optional", confirmed_as_request: 1 },
    { name: "Labour Charges", project: true, non_project: false, payee_rule: "Required", confirmed_as_request: 0 },
    { name: "Office Rent", project: false, non_project: true, payee_rule: "Not asked", confirmed_as_request: 0 },
    { name: "Bank Interest", project: false, non_project: false, payee_rule: null, confirmed_as_request: 0 },
];

const ROLES: Record<string, string[]> = {
    "Hotel Expenses": ["Nirmaan Project Manager Profile", "Nirmaan HR Executive Profile"],
    "Labour Charges": ["Nirmaan Project Manager Profile"],
    "Office Rent": ["Nirmaan Accountant Profile"],
    // Bank Interest lists no role: Admin only.
};

const names = (search: string, filters: Partial<PackageFilters>) =>
    filterExpenseTypes(TYPES, { search, filters: { ...NO_PACKAGE_FILTERS, ...filters }, allowedByType: ROLES })
        .map((t) => t.name);

describe("filterExpenseTypes", () => {
    it("shows every type with no search and no filter", () => {
        expect(names("", {})).toEqual(["Hotel Expenses", "Labour Charges", "Office Rent", "Bank Interest"]);
    });

    it("searches the name, ignoring case", () => {
        expect(names("  office ", {})).toEqual(["Office Rent"]);
    });

    it("narrows by scope, any of the picked scopes", () => {
        expect(names("", { scopes: new Set(["Both"]) })).toEqual(["Hotel Expenses"]);
        expect(names("", { scopes: new Set(["Project", "Unusable"]) })).toEqual(["Labour Charges", "Bank Interest"]);
        expect(names("", { scopes: new Set(["Non-Project"]) })).toEqual(["Office Rent"]);
    });

    it("narrows by who gets paid, a blank rule counting as Not asked", () => {
        expect(names("", { payeeRules: new Set(["Required"]) })).toEqual(["Labour Charges"]);
        expect(names("", { payeeRules: new Set(["Not asked"]) })).toEqual(["Office Rent", "Bank Interest"]);
    });

    it("narrows by role access: a type listing any picked profile", () => {
        expect(names("", { roles: new Set(["Nirmaan Project Manager Profile"]) }))
            .toEqual(["Hotel Expenses", "Labour Charges"]);
        expect(names("", { roles: new Set(["Nirmaan HR Executive Profile", "Nirmaan Accountant Profile"]) }))
            .toEqual(["Hotel Expenses", "Office Rent"]);
    });

    it("Admin only lists exactly the types with an empty list", () => {
        expect(names("", { roles: new Set([ADMIN_ONLY]) })).toEqual(["Bank Interest"]);
        expect(names("", { roles: new Set([ADMIN_ONLY, "Nirmaan Accountant Profile"]) }))
            .toEqual(["Office Rent", "Bank Interest"]);
    });

    it("narrows by the Confirmed mark", () => {
        expect(names("", { confirmed: new Set(["Yes"]) })).toEqual(["Hotel Expenses"]);
        expect(names("", { confirmed: new Set(["No"]) })).toEqual(["Labour Charges", "Office Rent", "Bank Interest"]);
        expect(names("", { confirmed: new Set(["Yes", "No"]) })).toHaveLength(4);
    });

    it("combines every filter and the search with AND", () => {
        const pm = new Set(["Nirmaan Project Manager Profile"]);
        expect(names("", { roles: pm, scopes: new Set(["Project"]) })).toEqual(["Labour Charges"]);
        expect(names("", { roles: pm, confirmed: new Set(["Yes"]) })).toEqual(["Hotel Expenses"]);
        expect(names("labour", { roles: pm, confirmed: new Set(["Yes"]) })).toEqual([]);
        expect(names("hotel", { payeeRules: new Set(["Optional"]), scopes: new Set(["Both"]) }))
            .toEqual(["Hotel Expenses"]);
    });
});

describe("hasActiveFilters", () => {
    it("is false with nothing picked and true once any filter has a pick", () => {
        expect(hasActiveFilters(NO_PACKAGE_FILTERS)).toBe(false);
        expect(hasActiveFilters({ ...NO_PACKAGE_FILTERS, confirmed: new Set(["No"]) })).toBe(true);
        expect(hasActiveFilters({ ...NO_PACKAGE_FILTERS, roles: new Set([ADMIN_ONLY]) })).toBe(true);
    });
});
