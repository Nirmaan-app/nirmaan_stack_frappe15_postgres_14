// Two facts of the link dialog are answered in TWO LANGUAGES (#1298, ADR-0027): "which run do these
// lines belong to?" (Q10) and "how far may lines overshoot what is left?" (the ₹5 window).
//
// `expense_links.bulk_id_of` decides the reference a many-line expense is WRITTEN with; the link
// dialog's `bulkIdOf` tells the person that reference before they press Link. The two disagreeing is a
// dialog promising "gets the bulk id BULD…" over a save that writes a blank, or the reverse. The repo's
// convention for a rule with two homes is a parity test (ADR-0010 F1); this is that test.
//
// ⚠️ IT READS THE PYTHON FILE AS TEXT, SO THE FIRST CASE GUARDS AGAINST A ROTTED PATH -- otherwise every
// `toContain` below would assert over an empty string and pass.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { LINK_TOLERANCE, bulkIdOf } from "./linkLinesView";

const EXPENSE_LINKS_PY = fileURLToPath(
    new URL("../../../../nirmaan_stack/services/outflow_import/expense_links.py", import.meta.url)
);

const source = readFileSync(EXPENSE_LINKS_PY, "utf8");

const AMOUNTS_PY = fileURLToPath(
    new URL("../../../../nirmaan_stack/services/outflow_import/amounts.py", import.meta.url)
);
const amountsSource = readFileSync(AMOUNTS_PY, "utf8");

describe("bulk id parity with expense_links.py", () => {
    it("reads the real module", () => {
        expect(source).toContain("def bulk_id_of(");
    });

    it("uses the same pattern", () => {
        expect(source).toContain('_BULK_ID = re.compile(r"\\bBULD\\d+\\b")');
        expect(bulkIdOf(["x/BULD123/y"])).toBe("BULD123");
        expect(bulkIdOf(["xBULD123"])).toBeNull();
    });

    it("drops a truncated stub, and names none on disagreement or a missing id, on both sides", () => {
        expect(source).toContain("o.startswith(i)");
        expect(source).toContain("if len(ids) != 1:\n            return None");
        expect(bulkIdOf(["a/BULD67453750 /b/BULD67"])).toBe("BULD67453750");
        expect(bulkIdOf(["a/BULD1/b", "c"])).toBeNull();
    });
});

describe("the ₹5 window matches amounts.py", () => {
    // A dialog marking "fills it" over a link the server refuses, or "too big" over one it would take.
    it("reads the real module and the same figure", () => {
        expect(amountsSource).toContain("AMOUNT_TOLERANCE = Decimal(");
        expect(amountsSource).toContain(`AMOUNT_TOLERANCE = Decimal("${LINK_TOLERANCE}")`);
    });
});
