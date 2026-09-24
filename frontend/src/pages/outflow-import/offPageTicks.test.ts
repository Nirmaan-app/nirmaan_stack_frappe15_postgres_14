import { describe, expect, it } from "vitest";

import { offPageTicks } from "./offPageTicks";

const rows = [{ name: "a" }, { name: "b" }];

describe("offPageTicks", () => {
    it("is null when every tick is on this page, or nothing is ticked", () => {
        expect(offPageTicks(rows, new Set(["a", "b"]), new Map(), 0, "Linking")).toBeNull();
        expect(offPageTicks(rows, new Set(), new Map(), 0, "Linking")).toBeNull();
    });

    it("words the note with the caller's verb", () => {
        expect(offPageTicks(rows, new Set(["a", "x"]), new Map([["x", 2]]), 0, "Unreconcile")).toEqual({
            note: "1 ticked line is on page 3. Unreconcile works on one page at a time: go back to page 3, or untick it.",
            offPage: "1 on page 3",
        });
    });

    it("names several pages, and says another page when it does not know which", () => {
        expect(
            offPageTicks(
                rows,
                new Set(["x", "y", "z"]),
                new Map([
                    ["x", 0],
                    ["y", 2],
                    ["z", 0],
                ]),
                1,
                "Linking"
            )
        ).toEqual({
            note: "3 ticked lines are on pages 1 and 3. Linking works on one page at a time: go back to those pages, or untick those 3.",
            offPage: "3 on pages 1 and 3",
        });
        expect(offPageTicks(rows, new Set(["x"]), new Map(), 0, "Linking")?.offPage).toBe("1 on another page");
    });
});
