import { describe, expect, it } from "vitest";

import { payeeHref } from "./payeeRoutes";

describe("payeeHref", () => {
    it("opens the Payee's own page", () => {
        expect(payeeHref("PYE-0412")).toBe("/payees/PYE-0412");
    });

    it("keeps a name with unsafe characters inside one path segment", () => {
        expect(payeeHref("PYE/0412 a")).toBe("/payees/PYE%2F0412%20a");
    });
});
