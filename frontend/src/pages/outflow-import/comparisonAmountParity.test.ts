// "What may the record picker be measured against?" is answered in TWO LANGUAGES (issue #1243).
//
// `allocationView.pickerComparisonAmount` decides it on the client and puts the answer on the wire;
// `review._comparison_amount` decides it again on arrival, because a whitelisted endpoint may not
// trust a query parameter. Both must refuse a NON-POSITIVE figure and fall back to the transfer's
// own amount.
//
// ★ WHY THIS IS PINNED RATHER THAN LEFT TO CARE. The two rules disagreeing is not a crash and not a
// refusal -- it is a screen where the SERVER flags a record settleable and the CLIENT prints a large
// "off by" beside it, on the same row, at the same moment. That contradiction is the whole defect
// #1243 exists to remove, so a change that reopened it on one side only would be invisible to every
// test on the other. A review pass caught exactly that shape once already, after both sides' own
// suites were green. The repo's convention for a rule with two homes is a parity test (ADR-0010 F1,
// as `rateFieldParity.test.ts` pins the two `RATE_VALUE_FIELDS` copies and
// `settleModeLabelParity.test.ts` pins the Split label against `settle.py`). This is that test.
//
// ⚠️ IT READS THE PYTHON FILE AS TEXT, WHICH MAKES IT VACUOUS-BY-DEFAULT IF THE PATH ROTS -- a moved
// `review.py` would make every `toContain` below assert over an empty string and pass. The first
// case exists solely to stop that, on the repo's standing rule that a test on each side of a
// boundary is not a test of the boundary.
//
// ⚠️ HONEST LIMIT: `vitest` is a LOCAL gate here, not run by CI (`frontend/CLAUDE.md`), which runs
// the Python bench suite only. The SERVER's half of the behaviour is separately exercised for real
// by `test_review.TestSearchSettleableRecords`'s `#1243` block, which calls the endpoint with `-5`
// and asserts the payload is byte-identical to the fallback. What this file adds is the JOIN: that
// the sentence the client implements is the sentence the server still enforces.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { pickerComparisonAmount } from "./allocationView";

const REVIEW_PY = fileURLToPath(
    new URL("../../../../nirmaan_stack/api/outflow_import/review.py", import.meta.url)
);

const reviewSource = readFileSync(REVIEW_PY, "utf8");

const leg = (amount: number) => ({ target_amount: amount, match_kind: "Settled" });

describe("comparison-amount parity — both sides refuse a non-positive figure", () => {
    // ⚠️ FIRST, AND LOAD-BEARING. Everything below is a substring assertion, so a wrong path (or an
    // empty read) would make them all trivially true.
    it("★ reads the real review.py — not an empty string standing in for it", () => {
        expect(reviewSource.length).toBeGreaterThan(1000);
        expect(reviewSource).toContain("def search_settleable_records(");
        expect(reviewSource).toContain("def _comparison_amount(");
    });

    it("the endpoint still accepts the parameter the client sends", () => {
        // The wire name. A rename on either side silently reverts the whole feature to
        // whole-transfer ranking, with no error anywhere: Frappe ignores unknown kwargs at the
        // HTTP boundary, so the client would keep sending a figure nobody reads.
        expect(reviewSource).toContain("compare_amount");
        expect(reviewSource).toContain("_comparison_amount(normalize_amount(doc.get(\"amount\")), compare_amount)");
    });

    it("the server falls back on anything at or below zero", () => {
        // The rule itself, as the server spells it. Narrow on purpose: `< 0` would let a zero
        // through, and a zero comparison amount makes every record read "off by its own amount".
        expect(reviewSource).toContain("if wanted <= 0:");
        expect(reviewSource).toContain("return row_amount");
    });

    it("the client never puts a figure on the wire that the server would refuse", () => {
        // The other half of the same sentence. These are the shapes that produce a non-positive
        // remainder; each must come back `null`, which is what makes the caller send NO
        // `compare_amount` at all rather than one the server will discard.
        expect(pickerComparisonAmount(100, [leg(160)])).toBeNull(); // over-allocated
        expect(pickerComparisonAmount(100, [leg(100)])).toBeNull(); // exactly exhausted
        expect(pickerComparisonAmount(100, [leg(60), leg(40)])).toBeNull(); // exhausted across legs
    });

    it("and still sends the one it should", () => {
        // The positive case, so the test above cannot pass by refusing everything.
        expect(pickerComparisonAmount(100000, [leg(40000), leg(25000)])).toBe(35000);
    });
});
