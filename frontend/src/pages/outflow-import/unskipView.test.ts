// The Skipped popup's Unskip column and the notice after an Unskip (#1274, parent #1270).
//
// ⚠️ THE SENTENCE MARKERS ARE READ AGAINST THE REAL `status.py`. The popup tells an exclusion from a
// repeat by the words the software wrote; a sentence reworded on the server would otherwise silently
// fall through to "already recorded" and nothing else would fail.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
    BANK_SUCCESS_STATUS,
    UNSKIP_BLOCK_ALREADY_RECORDED,
    UNSKIP_BLOCK_BANK_REFUSED,
    UNSKIP_BLOCK_CASHBOOK,
    UNSKIP_BLOCK_EARLIER_STATEMENT,
    UNSKIP_BLOCK_EXCLUDED,
    UNSKIP_BLOCK_NOT_SKIPPED,
    UNSKIP_SENTENCE_MARKERS,
    unskipBlockReason,
    unskipNotice,
} from "./unskipView";

const pyFile = (relative: string) =>
    readFileSync(
        fileURLToPath(new URL(`../../../../nirmaan_stack/services/outflow_import/${relative}`, import.meta.url)),
        "utf8",
    );
const statusSource = pyFile("status.py");
const parserSource = pyFile("parser.py");
const skipOriginSource = pyFile("skip_origin.py");

type Line = Parameters<typeof unskipBlockReason>[0];

const skipped = (over: Partial<Line> = {}): Line => ({
    row_status: "Skipped",
    skip_origin: "System",
    source: "Cashfree",
    status_raw: "SUCCESS",
    outcome_note: "",
    skip_reason: "",
    ...over,
});

describe("unskipBlockReason -- who gets a live Unskip, and why the rest do not", () => {
    it("★ a hand skip is unskippable", () => {
        expect(unskipBlockReason(skipped({ skip_origin: "Manual", skip_reason: "not ours" }))).toBeNull();
    });

    it("a hand skip on an ICICI statement is unskippable too", () => {
        expect(
            unskipBlockReason(skipped({ skip_origin: "Manual", source: "ICICI Bank Statement" })),
        ).toBeNull();
    });

    it("★ money already recorded", () => {
        expect(
            unskipBlockReason(
                skipped({ outcome_note: "Already recorded as Paid on Project Payment PAY-1." }),
            ),
        ).toBe(UNSKIP_BLOCK_ALREADY_RECORDED);
        expect(UNSKIP_BLOCK_ALREADY_RECORDED).toBe("This money is already recorded.");
    });

    it("★ the bank never moved it -- whatever the note says", () => {
        for (const status_raw of ["FAILED", "rejected", "", undefined]) {
            expect(
                unskipBlockReason(
                    skipped({ status_raw, skip_reason: "Transfer did not succeed at the bank (FAILED)." }),
                ),
            ).toBe(UNSKIP_BLOCK_BANK_REFUSED);
        }
        expect(UNSKIP_BLOCK_BANK_REFUSED).toBe("The bank never moved this money.");
    });

    it("★ a bank rule excluded it", () => {
        expect(
            unskipBlockReason(
                skipped({
                    source: "ICICI Bank Statement",
                    skip_reason:
                        "Not spending -- this line is money moving inside the bank or between our own accounts. Excluded by bank-statement rule 'platform_porter'.",
                }),
            ),
        ).toBe(UNSKIP_BLOCK_EXCLUDED);
        expect(UNSKIP_BLOCK_EXCLUDED).toBe("A bank rule excluded it.");
    });

    it("★ the same transfer is in an earlier statement -- and a repeat in the same file says so too", () => {
        for (const skip_reason of [
            "Already imported in batch OIB-26-00118.",
            "This transfer appears earlier in the same statement.",
        ]) {
            expect(unskipBlockReason(skipped({ skip_reason }))).toBe(UNSKIP_BLOCK_EARLIER_STATEMENT);
        }
        expect(UNSKIP_BLOCK_EARLIER_STATEMENT).toBe("The same transfer is in an earlier statement.");
    });

    it("★ a Cashbook row is refused, even when it reads as a hand skip", () => {
        for (const skip_origin of ["Manual", "System"] as const) {
            expect(unskipBlockReason(skipped({ source: " Cashbook ", skip_origin }))).toBe(
                UNSKIP_BLOCK_CASHBOOK,
            );
        }
        expect(UNSKIP_BLOCK_CASHBOOK).toBe("Cashbook rows can't be unskipped.");
    });

    it("a blank origin is treated as a system skip, never as a hand skip", () => {
        for (const skip_origin of ["", null, undefined]) {
            expect(unskipBlockReason(skipped({ skip_origin }))).not.toBeNull();
        }
    });

    it("the note wins over nothing: an unknown system sentence reads as already recorded", () => {
        expect(unskipBlockReason(skipped({ outcome_note: "Something new." }))).toBe(
            UNSKIP_BLOCK_ALREADY_RECORDED,
        );
    });

    it("a line that is not skipped has nothing to unskip", () => {
        expect(unskipBlockReason(skipped({ row_status: "Mismatched", skip_origin: null }))).toBe(
            UNSKIP_BLOCK_NOT_SKIPPED,
        );
    });

    it("★ the bank's success word is the server's", () => {
        expect(parserSource).toContain(`BANK_SUCCESS_STATUS = "${BANK_SUCCESS_STATUS}"`);
    });

    it("★ the server's unskip rule gates on the same three facts: Skipped, Cashbook, Manual", () => {
        const rule = skipOriginSource.slice(skipOriginSource.indexOf("def unskip_refusal"));
        expect(rule).toContain("!= ROW_SKIPPED");
        expect(rule).toContain("source_runs_the_matcher(");
        expect(rule).toContain("!= SKIP_ORIGIN_MANUAL");
        expect(skipOriginSource).toContain(`UNSKIP_REFUSED_CASHBOOK = "${UNSKIP_BLOCK_CASHBOOK}"`);
    });

    it("★ the sentence markers exist, verbatim, in status.py", () => {
        expect(statusSource).toContain("SKIP_REASON_ALREADY_IMPORTED =");
        for (const marker of UNSKIP_SENTENCE_MARKERS.excluded) expect(statusSource).toContain(marker);
        for (const marker of UNSKIP_SENTENCE_MARKERS.earlierStatement)
            expect(statusSource).toContain(marker);
    });
});

describe("unskipNotice -- the one of three notices an Unskip ends in", () => {
    it("★ nothing recorded: it needs a record", () => {
        expect(
            unskipNotice({
                status: "Mismatched",
                outcome_note: "No approved payment or expense matches this transfer.",
                suggested_name: "",
            }),
        ).toEqual({ tone: "ok", title: "Unskipped.", body: "It now needs a record." });
    });

    it("★ one approved record: it matched that record", () => {
        expect(
            unskipNotice({ status: "Matched", outcome_note: "…", suggested_name: "PAY-01399-002" }),
        ).toEqual({ tone: "ok", title: "Unskipped.", body: "It matched PAY-01399-002." });
    });

    it("a match with no single pick needs a record chosen, like no match at all", () => {
        expect(unskipNotice({ status: "Matched", outcome_note: "Several…", suggested_name: "" })).toEqual({
            tone: "ok",
            title: "Unskipped.",
            body: "It now needs a record.",
        });
    });

    it("★ money recorded since: skipped again, naming the record from the server's note", () => {
        expect(
            unskipNotice({
                status: "Skipped",
                outcome_note: "Already recorded as Paid on Project Payment PAY-01399-002.",
                suggested_name: "",
            }),
        ).toEqual({
            tone: "warn",
            title: "Unskipped, then skipped again.",
            body: "Its money is already recorded as Paid on Project Payment PAY-01399-002. It can't be unskipped now.",
        });
    });

    it("a received inflow reads its own verb", () => {
        expect(
            unskipNotice({
                status: "Skipped",
                outcome_note: "Already recorded as received on Project Inflow PINF-1.",
                suggested_name: "",
            }).body,
        ).toBe("Its money is already recorded as received on Project Inflow PINF-1. It can't be unskipped now.");
    });

    it("a skip note in other words is shown as the server wrote it", () => {
        expect(
            unskipNotice({ status: "Skipped", outcome_note: "Some other reason.", suggested_name: "" }).body,
        ).toBe("Some other reason. It can't be unskipped now.");
    });
});
