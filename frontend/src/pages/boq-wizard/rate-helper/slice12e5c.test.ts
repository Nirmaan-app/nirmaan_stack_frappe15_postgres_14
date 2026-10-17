/**
 * SLICE 12e-5c AC1 (owner R2, 2026-10-15: "ok and fix also") -- THE UNIT-WORD REGEX IN `axisOf`.
 *
 * `axisOf` (itemListPricing.ts) names the axis a size part labels: it strips the number and the unit words, then looks
 * for W / H / D. Its unit strip was written with two literal BACKSPACE characters (0x08) where the word boundary `\b`
 * was meant, so it never matched a unit word at all. Measured before the fix: both replay harnesses over the 13,752
 * stored rows gave the same result with and without it -- no unit word it names (mm, cm, m, mtr, mtrs, metre, meter,
 * no, nos) contains an axis label, so the strip changes no axis. The fix is therefore pinned on the PATTERN ITSELF,
 * read from the source (it is a local of an unexported function), and through `splitSizePhrase`, its one caller.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { splitSizePhrase } from "./itemListPricing";

const SRC = readFileSync(new URL("./itemListPricing.ts", import.meta.url), "utf8");
/** The unit strip as written in `axisOf`: the second `.replace(` of its `tail` line. */
function unitStrip(): RegExp {
  const line = SRC.split("\n").find((l) => l.includes("const tail = part.replace(/[\\d.]+/g"));
  if (!line) throw new Error("axisOf's tail line not found");
  const second = line.split(".replace(/")[2];
  const body = second?.slice(0, second.indexOf("/gi"));
  if (!body) throw new Error("axisOf's unit strip not found");
  return new RegExp(body, "gi");
}
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

describe("AC1 axisOf's unit strip matches the unit words it names", () => {
  it("each named unit, alone and beside a number's gap, is stripped", () => {
    for (const u of ["mm", "cm", "m", "mtr", "mtrs", "metre", "meter", "no", "nos", "MM", "Mtr"]) {
      expect(` ${u} `.replace(unitStrip(), "#")).toBe(" # ");
      expect(`450 ${u} high`.replace(/[\d.]+/g, " ").replace(unitStrip(), "#")).toBe(`  # high`);
    }
  });
  it("NEGATIVE a unit inside a longer word is NOT stripped (the word boundary is real)", () => {
    for (const w of ["comm", "mmx", "summit", "nose", "notes", "deep", "meters2", "smart"]) {
      expect(` ${w} `.replace(unitStrip(), "#")).toBe(` ${w} `);
    }
  });
  it("the source holds no control character anywhere (the old 0x08 pair is gone)", () => {
    expect(CONTROL.test(SRC)).toBe(false);
  });
  it("NEGATIVE the axis read is unchanged: a unit never names an axis; a label still does", () => {
    expect(splitSizePhrase("250 mm high")).toEqual(["", "250 mm high"]);
    expect(splitSizePhrase("400 mm deep")).toEqual(["", "", "400 mm deep"]);
    expect(splitSizePhrase("450 mm")).toBeNull();
    expect(splitSizePhrase("600 mm x 600 mm")).toEqual(["600 mm", "600 mm"]);
    expect(splitSizePhrase("1100(W) X 250(D) X 400(H)")).toEqual(["1100(W)", "400(H)", "250(D)"]);
  });
});
