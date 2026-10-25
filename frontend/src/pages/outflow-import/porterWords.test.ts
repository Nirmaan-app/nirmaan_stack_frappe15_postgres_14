// The Porter screens' counting words (#1554 review): one copy, imported by every Porter helper.
import { describe, expect, it } from "vitest";

import { orders, plural } from "./porterWords";

describe("counting in words", () => {
    it("uses the singular for exactly one, the plural otherwise", () => {
        expect(plural(1, "invoice", "invoices")).toBe("1 invoice");
        expect(plural(0, "invoice", "invoices")).toBe("0 invoices");
        expect(plural(12, "order needs", "orders need")).toBe("12 orders need");
    });

    it("counts orders", () => {
        expect(orders(1)).toBe("1 order");
        expect(orders(160)).toBe("160 orders");
    });
});
