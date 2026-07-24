import { describe, it, expect } from "vitest";
import {
  summarizeRevisionCarry,
  type RevisionCarryBySheet,
} from "./revisionCarryReport";

/**
 * W5 reporting copy. The properties worth protecting:
 *   - "say nothing" (null) is reserved for a NON-revision payload -- a revision that carried
 *     nothing must still be visible, or the user cannot tell the two apart;
 *   - the numbers in the sentence must always be internally consistent (copied <= total, the
 *     needs-review figure derived rather than trusted); and
 *   - sheet names stay VERBATIM as keys (#152) while only the label is trimmed.
 */

function counts(copied: number, total: number) {
  return { copied, needs_review: total - copied, total };
}

describe("summarizeRevisionCarry", () => {
  it("says nothing for a non-revision parse (key absent)", () => {
    expect(summarizeRevisionCarry(undefined)).toBeNull();
    expect(summarizeRevisionCarry(null)).toBeNull();
    expect(summarizeRevisionCarry({})).toBeNull();
  });

  it("says nothing when no sheet matched anything (declared-New / unmapped)", () => {
    const carry: RevisionCarryBySheet = { "Sheet1": counts(0, 0) };
    expect(summarizeRevisionCarry(carry)).toBeNull();
  });

  it("reports a single sheet without a per-sheet breakdown", () => {
    const report = summarizeRevisionCarry({ "Electrical": counts(12, 15) });
    expect(report).not.toBeNull();
    expect(report!.headline).toBe(
      "Carried from the original: 12 of 15 rows copied; 3 rows need review."
    );
    expect(report!.perSheet).toEqual([]);
  });

  it("drops the needs-review clause when everything copied", () => {
    const report = summarizeRevisionCarry({ "Electrical": counts(15, 15) });
    expect(report!.headline).toBe("Carried from the original: 15 of 15 rows copied.");
  });

  it("singularises one row and one needing review", () => {
    expect(summarizeRevisionCarry({ "S": counts(1, 1) })!.headline).toBe(
      "Carried from the original: 1 of 1 row copied."
    );
    expect(summarizeRevisionCarry({ "S": counts(1, 2) })!.headline).toBe(
      "Carried from the original: 1 of 2 rows copied; 1 row needs review."
    );
  });

  it("aggregates across sheets and names them when more than one carried", () => {
    const report = summarizeRevisionCarry({
      "Electrical": counts(12, 15),
      "HVAC": counts(8, 8),
    });
    expect(report!.headline).toBe(
      "Carried from the original: 20 of 23 rows copied across 2 sheets; 3 rows need review."
    );
    expect(report!.perSheet).toEqual([
      { sheetName: "Electrical", label: "Electrical", text: "12 of 15 rows copied" },
      { sheetName: "HVAC", label: "HVAC", text: "8 of 8 rows copied" },
    ]);
  });

  it("excludes zero-total sheets from the aggregate, the count and the breakdown", () => {
    const report = summarizeRevisionCarry({
      "Electrical": counts(12, 15),
      "New Sheet": counts(0, 0),
      "HVAC": counts(8, 8),
    });
    // "across 2 sheets", not 3 -- the unmapped sheet never entered the match.
    expect(report!.headline).toContain("across 2 sheets");
    expect(report!.perSheet.map((s) => s.sheetName)).toEqual(["Electrical", "HVAC"]);
  });

  it("keeps the sheet name VERBATIM as the key and trims only the label (#152)", () => {
    const report = summarizeRevisionCarry({
      "  Padded  ": counts(1, 2),
      "Other": counts(1, 2),
    });
    const line = report!.perSheet[0];
    expect(line.sheetName).toBe("  Padded  ");
    expect(line.label).toBe("Padded");
  });

  it("falls back to the raw name when trimming would empty the label", () => {
    const report = summarizeRevisionCarry({ "   ": counts(1, 2), "Other": counts(1, 2) });
    expect(report!.perSheet[0].label).toBe("   ");
  });

  it("reports an honest zero-copied revision rather than staying silent", () => {
    const report = summarizeRevisionCarry({ "Electrical": counts(0, 40) });
    expect(report!.headline).toBe(
      "Carried from the original: 0 of 40 rows copied; 40 rows need review."
    );
  });
});
