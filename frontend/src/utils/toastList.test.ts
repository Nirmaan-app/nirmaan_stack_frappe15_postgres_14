import { describe, expect, it } from "vitest";

import { toastList } from "./toastList";

describe("toastList", () => {
    it("joins up to three items", () => {
        expect(toastList(["PO/001: a", "PO/002: b", "PO/003: c"])).toBe("PO/001: a · PO/002: b · PO/003: c");
        expect(toastList(["PO/001: a"])).toBe("PO/001: a");
        expect(toastList([])).toBe("");
    });

    it("names the first three and counts the rest", () => {
        expect(toastList(["a", "b", "c", "d", "e"])).toBe("a · b · c · +2 more");
    });

    it("takes another limit", () => {
        expect(toastList(["a", "b", "c"], 1)).toBe("a · +2 more");
    });
});
