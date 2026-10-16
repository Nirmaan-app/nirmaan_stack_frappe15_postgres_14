import { describe, expect, it } from "vitest";

import { canAddExpense } from "./addExpenseGate";

// Role Profile names written out as literals (not read from constants) so a renamed profile fails here.
const viewer = (role: string, userId = "someone@nirmaan.app") => ({ role, userId });

describe("canAddExpense: who gets the Add Expense button on Project Payment & Expense", () => {
    const shown: [string, { role: string; userId: string }][] = [
        ["the Administrator user", viewer("Nirmaan Admin Profile", "Administrator")],
        ["the Administrator user with no profile yet", viewer("Loading", "Administrator")],
        ["Admin", viewer("Nirmaan Admin Profile")],
        ["Accountant", viewer("Nirmaan Accountant Profile")],
        ["Accountant Lead", viewer("Nirmaan Accountant Lead Profile")],
        ["Procurement Executive", viewer("Nirmaan Procurement Executive Profile")],
        ["Procurement Lead", viewer("Nirmaan Procurement Lead Profile")],
        ["Material Procurement Executive", viewer("Nirmaan Material Procurement Executive Profile")],
        ["Service Procurement Executive", viewer("Nirmaan Service Procurement Executive Profile")],
        ["HR Executive", viewer("Nirmaan HR Executive Profile")],
        ["PMO Executive (#1475)", viewer("Nirmaan PMO Executive Profile")],
    ];
    for (const [who, v] of shown) {
        it(`shows it to ${who}`, () => expect(canAddExpense(v)).toBe(true));
    }

    const hidden: [string, { role: string; userId: string }][] = [
        // Holds read only on both expense doctypes and no System Manager: a save would fail.
        ["HR Lead", viewer("Nirmaan HR Lead Profile")],
        ["Project Lead", viewer("Nirmaan Project Lead Profile")],
        ["Project Manager", viewer("Nirmaan Project Manager Profile")],
        ["a role still loading", viewer("Loading")],
    ];
    for (const [who, v] of hidden) {
        it(`hides it from ${who}`, () => expect(canAddExpense(v)).toBe(false));
    }
});
