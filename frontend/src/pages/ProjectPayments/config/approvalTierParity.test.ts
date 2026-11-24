// The Tier values a queue row carries, spelled in two languages (#1710, spec #1711). The server sends
// `services/approval_tiers.TIER_*` as the row's `tier`; `TIER_LABEL` keys the chip and the CSV export on the same
// strings. A value renamed on one side only would show a blank chip and write a blank CSV cell -- and nothing else
// would fail. Neither side can import the other, so this reads the Python file as text (ADR-0010 F1, the
// `tdsBorneByParity.test.ts` shape). The first case guards against a moved file reading as "".
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { TIER_LABEL } from "./approvalsTable.config";

const source = readFileSync(
    fileURLToPath(new URL("../../../../../nirmaan_stack/services/approval_tiers.py", import.meta.url)),
    "utf8",
);

describe("Tier parity -- the frontend tiers match approval_tiers.py", () => {
    it("reads the real approval_tiers.py, not an empty string standing in for it", () => {
        expect(source).toContain("def shown_tier");
    });

    it('"system" is TIER_SYSTEM', () => {
        expect(source).toContain('TIER_SYSTEM = "system"');
        expect(TIER_LABEL.system).toBe("SYSTEM");
    });

    it("every tier the screen labels is one the server sends, and the reverse", () => {
        const served = [...source.matchAll(/^TIER_(?:AUTO|L1|L1_L2|SYSTEM) = "([a-z0-9_]+)"$/gm)].map((m) => m[1]);
        expect([...served].sort()).toEqual(Object.keys(TIER_LABEL).sort());
    });
});
