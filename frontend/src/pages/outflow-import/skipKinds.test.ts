// The Skip Type labels the screen reasons about must be the server's, word for word. A label that drifts
// on one side would silently unlock a locked line's button, or drop a warning, with nothing failing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as kinds from "./skipKinds";

const pyFile = (relative: string) =>
    readFileSync(
        fileURLToPath(new URL(`../../../../nirmaan_stack/services/outflow_import/${relative}`, import.meta.url)),
        "utf8",
    );
const skipKindsSource = pyFile("skip_kinds.py");
const skipOriginSource = pyFile("skip_origin.py");

describe("skipKinds -- mirrored from skip_kinds.py and skip_origin.py", () => {
    it("every label exists, verbatim, in skip_kinds.py", () => {
        for (const label of [
            kinds.SKIP_KIND_ALREADY_IMPORTED,
            kinds.SKIP_KIND_REPEATED_IN_FILE,
            kinds.SKIP_KIND_BANK_REFUSED,
            kinds.SKIP_KIND_NO_AMOUNT,
            kinds.SKIP_KIND_OUTFLOW_RECORDED,
            kinds.SKIP_KIND_INFLOW_RECORDED,
            kinds.SKIP_KIND_BY_HAND,
            ...kinds.BANK_RULE_SKIP_KINDS,
        ]) {
            expect(skipKindsSource).toContain(`= "${label}"`);
        }
    });

    it("the bank-rule kinds are exactly the values of SKIP_KIND_BY_EXCLUSION_CATEGORY", () => {
        const block = skipKindsSource.slice(
            skipKindsSource.indexOf("SKIP_KIND_BY_EXCLUSION_CATEGORY: dict[str, str] = {"),
        );
        const body = block.slice(0, block.indexOf("}"));
        const constants = new Set([...body.matchAll(/:\s*(SKIP_KIND_[A-Z_]+)/g)].map((m) => m[1]));
        const labels = new Set(
            [...constants].map((constant) => {
                const found = skipKindsSource.match(new RegExp(`^${constant} = "(.*)"$`, "m"));
                return found?.[1];
            }),
        );
        expect(labels).toEqual(new Set(kinds.BANK_RULE_SKIP_KINDS));
    });

    it("the locked kinds and their sentences are the server's", () => {
        const block = skipOriginSource.slice(skipOriginSource.indexOf("UNSKIP_LOCKED_KINDS: dict[str, str] = {"));
        const body = block.slice(0, block.indexOf("\n}"));
        const entries = [...body.matchAll(/(SKIP_KIND_[A-Z_]+): "(.*)",/g)];
        expect(entries).toHaveLength(Object.keys(kinds.UNSKIP_LOCKED_KINDS).length);
        for (const [, constant, sentence] of entries) {
            const label = skipKindsSource.match(new RegExp(`^${constant} = "(.*)"$`, "m"))?.[1] ?? "";
            expect(kinds.UNSKIP_LOCKED_KINDS[label]).toBe(sentence);
        }
    });
});
