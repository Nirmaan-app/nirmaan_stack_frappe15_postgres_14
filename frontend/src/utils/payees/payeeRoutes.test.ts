import { describe, expect, it } from "vitest";

import { payeeHref } from "./payeeRoutes";

describe("payeeHref", () => {
    it("opens the Payees list searched by the Payee's ID, on the tab for its status", () => {
        const active = new URL(payeeHref("PYE-0412"), "http://x");
        expect(active.pathname).toBe("/payees");
        expect(Object.fromEntries(active.searchParams)).toEqual({
            payees_tab: "active",
            payees_searchBy: "name",
            payees_q: "PYE-0412",
        });
        expect(new URL(payeeHref("PYE-0212", "Inactive"), "http://x").searchParams.get("payees_tab")).toBe("inactive");
    });
});
