import { describe, expect, it } from "vitest";

import { payeeHref, payeesSidebarPlace } from "./payeeRoutes";

describe("payeeHref", () => {
    it("opens the Payee's own page", () => {
        expect(payeeHref("PYE-0412")).toBe("/payees/PYE-0412");
    });

    it("keeps a name with unsafe characters inside one path segment", () => {
        expect(payeeHref("PYE/0412 a")).toBe("/payees/PYE%2F0412%20a");
    });
});

describe("payeesSidebarPlace", () => {
    it("puts Payees inside Admin Options for the Admin profile and the Administrator", () => {
        expect(payeesSidebarPlace("Nirmaan Admin Profile", "admin@example.com")).toBe("admin-options");
        expect(payeesSidebarPlace(undefined, "Administrator")).toBe("admin-options");
    });

    it("keeps Payees at the top level for the Accountant and the Accountant Lead", () => {
        expect(payeesSidebarPlace("Nirmaan Accountant Profile", "acc@example.com")).toBe("top-level");
        expect(payeesSidebarPlace("Nirmaan Accountant Lead Profile", "lead@example.com")).toBe("top-level");
    });

    it("shows it nowhere to anyone else", () => {
        expect(payeesSidebarPlace("Nirmaan PMO Executive Profile", "pmo@example.com")).toBeNull();
        expect(payeesSidebarPlace("Nirmaan Project Manager Profile", "pm@example.com")).toBeNull();
    });
});
