// The Split-mode LABEL is spelled in TWO LANGUAGES, and only one of them can be imported.
//
// `allocationView.SETTLE_MODE_LABEL.split` is the copy the radio renders. `settle.py`'s payment
// amount-mismatch refusal QUOTES that same string, to tell a reviewer which control to reach for
// (#1242). Nothing holds them together -- the Python side cannot import a TypeScript module, and
// the original change said so only in a comment: *"if that label is ever reworded, reword it here
// in the same change."*
//
// ★ WHY THIS IS PINNED RATHER THAN LEFT TO CARE. A rename reaching only the TypeScript side leaves
// the server naming a control that no longer exists on the screen -- which is the SAME defect as
// naming the wrong screen, the very thing #1242 fixed. Nothing else would fail: both sides stay
// internally consistent, just not with each other. The repo's convention for a rule with two homes
// is a parity test (ADR-0010 F1, as `reconcile.ts` / `priceability.ts` are pinned to the backend,
// and as `rateFieldParity.test.ts` pins the two `RATE_VALUE_FIELDS` copies). This is that test.
//
// ⚠️ IT READS THE PYTHON FILE AS TEXT, WHICH IS WHAT MAKES IT VACUOUS-BY-DEFAULT IF THE PATH ROTS
// -- a moved `settle.py` would make every `toContain` below assert over an empty string and pass.
// The first case exists solely to stop that, on the repo's standing rule that a test on each side
// of a boundary is not a test of the boundary.
//
// ⚠️ HONEST LIMIT: `vitest` is a LOCAL gate here, not run by CI (`frontend/CLAUDE.md`), which runs
// the Python bench suite only. A bench-side twin (the `TestInflowDoctypeSpelling` shape) would run
// in CI but would have to read the TypeScript file as text in the other direction -- one pin, not
// two, is the rule, and this is the side that can be run and proven at the moment it is written.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SETTLE_MODE_LABEL } from "./allocationView";

const SETTLE_PY = fileURLToPath(
    new URL("../../../../nirmaan_stack/services/outflow_import/settle.py", import.meta.url)
);

const settleSource = readFileSync(SETTLE_PY, "utf8");

/**
 * The same file with whole-line `#` comments dropped.
 *
 * ⚠️ THE ABSENCE CHECK MUST SCAN THE COPY, NOT THE RECORD OF IT. `settle.py` deliberately QUOTES the
 * retired TDS sentence in the comment explaining why it went -- this repo's convention is to record
 * what a line used to say -- and a naive `not.toContain` over the raw file cannot tell that comment
 * from live copy, so it went red on the very change it was written to protect. Stripping comments
 * keeps the historical quote allowed and a resurrected THROW forbidden, which is the real rule.
 */
const settleCopy = settleSource
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

describe("Split-mode label parity — settle.py names the control the screen actually renders", () => {
    // ⚠️ FIRST, AND LOAD-BEARING. Everything below is a substring assertion, so a wrong path (or an
    // empty read) would make them all trivially true. Anchor on two things the file has held for
    // the whole life of this feature.
    it("★ reads the real settle.py — not an empty string standing in for it", () => {
        expect(settleSource.length).toBeGreaterThan(1000);
        expect(settleSource).toContain("AmountMismatchError");
        expect(settleSource).toContain("left the bank, a difference of");
    });

    it("★ quotes the exact label the mode radio renders", () => {
        expect(settleSource).toContain(SETTLE_MODE_LABEL.split);
    });

    it("the label is the one the ban applies to — not the inverse feature's 'part payment'", () => {
        // ADR-0020 B3: the same dialog already renders a radio labelled "A part payment", belonging
        // to the INVERSE feature. The server must never quote that one by mistake.
        expect(SETTLE_MODE_LABEL.split.toLowerCase()).not.toContain("partial");
        expect(SETTLE_MODE_LABEL.split.toLowerCase()).not.toContain("part payment");
    });

    // ⚠️ RETIRED BY INVERSION, not deletion. The refusal used to end "A deduction such as TDS looks
    // like this; settle it in the payments screen." — a sentence that sent a reviewer off the
    // screen for a problem most of them do not have (#1242). Asserting its ABSENCE is what keeps a
    // revert from quietly restoring it.
    it("★ no longer cites TDS on a row that has nothing to do with TDS", () => {
        expect(settleCopy).not.toContain("A deduction such as TDS looks like this");
        // ...and the comment that records the retirement is still allowed to quote it.
        expect(settleSource).toContain("A deduction such as TDS looks like this");
    });

    // The other direction has a DIFFERENT answer, and the refusal fires on both: a record LARGER
    // than the transfer is not a Split-mode case, and the bulk "confirm all matched" path reaches
    // that throw with no dialog in front of it.
    it("★ still answers the record-larger direction, which Split mode would over-allocate", () => {
        expect(settleSource).toContain("This record is larger than the transfer.");
    });
});
