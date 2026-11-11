// DEV2-B5 S4 (G14 (a)): the pricing route's `?row=<excel_row>` -- the "Open this row" link of the Previously priced
// card. The page reads it with rowParamOf, then (once the rows are loaded and the row exists) clears the view filters and
// scrolls there through the grid's own jump.
//   a whole number >= 1 -> that row        /  absent, empty, text, decimal, zero, negative -> null (nothing happens)
import { describe, expect, it } from "vitest";

import { rowParamOf } from "./SheetPricingPage";

describe("rowParamOf", () => {
  it("a whole number names the row", () => {
    expect(rowParamOf("352")).toBe(352);
    expect(rowParamOf(" 7 ")).toBe(7);
  });

  it("anything else is no row", () => {
    expect([null, "", "abc", "3.5", "0", "-4", "12x"].map((v) => rowParamOf(v))).toEqual([null, null, null, null, null, null, null]);
  });
});
