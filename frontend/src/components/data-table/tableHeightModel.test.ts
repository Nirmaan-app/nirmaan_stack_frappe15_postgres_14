import { describe, expect, it } from "vitest";

import { MIN_TABLE_HEIGHT, tableMaxHeight } from "./tableHeightModel";

// A 1366x768 laptop: <main> is 768 - 56 (top bar) = 712px tall with 16px padding top and bottom;
// the pagination bar and its gap take 52px.
const LAPTOP = { viewportHeight: 712, reserveBelow: 52 + 16, topGap: 16 };

describe("tableMaxHeight", () => {
    it("fills the space left when the table starts near the top", () => {
        // Vendors: the box starts 176px into <main>.
        expect(tableMaxHeight({ ...LAPTOP, boxTop: 176 })).toBe(712 - 176 - 68);
    });

    it("takes one full screen when the table starts low on the page", () => {
        // Financials > All Payments: the box starts 848px into <main>, below the screen.
        expect(tableMaxHeight({ ...LAPTOP, boxTop: 848 })).toBe(712 - 16 - 68);
    });

    it("switches to a full screen once the space left drops under 60% of one", () => {
        const fullScreen = 712 - 16 - 68; // 628
        const atThreshold = 712 - 68 - Math.ceil(fullScreen * 0.6); // space left = 377 >= 376.8
        expect(tableMaxHeight({ ...LAPTOP, boxTop: atThreshold })).toBe(377);
        expect(tableMaxHeight({ ...LAPTOP, boxTop: atThreshold + 1 })).toBe(fullScreen);
    });

    it("never goes below the minimum on a very short screen", () => {
        expect(tableMaxHeight({ viewportHeight: 300, boxTop: 120, reserveBelow: 68, topGap: 16 })).toBe(MIN_TABLE_HEIGHT);
    });

    it("rounds down to whole pixels", () => {
        expect(tableMaxHeight({ ...LAPTOP, boxTop: 176.6 })).toBe(467);
    });
});
