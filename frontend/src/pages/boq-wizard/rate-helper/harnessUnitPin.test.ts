/**
 * ADP-4a (owner D11, 2026-10-21: "A small test so the tool can't drift from the screen again" - "Yes"; AC6).
 *
 * The tracked replay harnesses (`scripts/_instruments/ac7_harness.ts`, `ac7v2_harness.ts`) price every stored row the way
 * the BoQ page does. UNIT-R0 found them passing the stored unit raw (null) where the page passes `row.unit ?? ""` -- the
 * pricer reads null as "not given" and "" as "no unit", so 37 rows priced in the replay that the page refused. ADP-R4
 * fixed the two lines (30b6e5b24). This pins all three source lines, so the replay cannot drift from the page again:
 * changing the page's unit handling, or either harness's, fails here and names the file.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const HARNESSES = ["scripts/_instruments/ac7_harness.ts", "scripts/_instruments/ac7v2_harness.ts"];
const PAGE = "frontend/src/pages/boq-wizard/SheetPricingPage.tsx";

describe("AC6 -- the replay passes the unit exactly as the page does", () => {
  it("POSITIVE: the page passes `unit: row.unit ?? \"\"` to the panel", () => {
    expect(read(PAGE)).toContain('unit: row.unit ?? "" };');
  });
  for (const h of HARNESSES) {
    it(`POSITIVE: ${h} passes \`unit: r.unit ?? ""\` to compute -- once`, () => {
      const src = read(h);
      expect(src.match(/unit: r\.unit \?\? ""/g)?.length).toBe(1);
    });
    it(`NEGATIVE: ${h} never passes the stored unit raw (\`unit: r.unit }\`)`, () => {
      expect(read(h)).not.toMatch(/unit: r\.unit\s*\}/);
    });
  }
});
