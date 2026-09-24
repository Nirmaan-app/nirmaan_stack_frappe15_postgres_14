// The Skipped popup's Unskip column and the notice after an Unskip (#1274; rule by skip KIND since
// 2026-09-17, ADR-0022 Amendment C).
//
// ⚠️ INVERTED, NOT DELETED. The column used to allow hand skips only and to tell system skips apart by
// the words of their sentence; those pins now assert the new truth -- every kind but the four locked
// ones comes back, and a Cashbook line only when it was skipped by hand (#1314 -- it used to be never).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { BANK_RULE_SKIP_KINDS, UNSKIP_LOCKED_KINDS } from "./skipKinds";
import {
    UNSKIP_BLOCK_CASHBOOK,
    UNSKIP_BLOCK_NO_KIND,
    UNSKIP_BLOCK_NOT_SKIPPED,
    unskipBlockReason,
    unskipNotice,
    unskipWarning,
} from "./unskipView";

const skipOriginSource = readFileSync(
    fileURLToPath(new URL("../../../../nirmaan_stack/services/outflow_import/skip_origin.py", import.meta.url)),
    "utf8",
);

type Line = Parameters<typeof unskipBlockReason>[0];

const skipped = (over: Partial<Line> = {}): Line => ({
    row_status: "Skipped",
    skip_kind: "Outflow Already Recorded",
    source: "Cashfree",
    ...over,
});

describe("unskipBlockReason -- keyed on Skip Type", () => {
    it("★ a hand skip, money already recorded and every bank-rule kind are unskippable", () => {
        for (const skip_kind of [
            "Skipped by hand",
            "Outflow Already Recorded",
            "Inflow Already Recorded",
            ...BANK_RULE_SKIP_KINDS,
        ]) {
            for (const source of ["Cashfree", "ICICI Bank Statement"]) {
                expect(unskipBlockReason(skipped({ skip_kind, source }))).toBeNull();
            }
        }
    });

    it("★ the four locked kinds stay skipped, each saying why", () => {
        expect(Object.keys(UNSKIP_LOCKED_KINDS).sort()).toEqual(
            ["Already imported", "Bank refused", "No amount", "Repeated in same file"].sort(),
        );
        for (const [skip_kind, sentence] of Object.entries(UNSKIP_LOCKED_KINDS)) {
            expect(unskipBlockReason(skipped({ skip_kind }))).toBe(sentence);
        }
    });

    it("★ a Cashbook hand skip may be unskipped (#1314)", () => {
        expect(unskipBlockReason(skipped({ source: " Cashbook ", skip_kind: "Skipped by hand" }))).toBeNull();
    });

    it("★ every other Cashbook kind stays locked, under one sentence", () => {
        for (const skip_kind of ["Cashbook internal movement", "Outflow Already Recorded", "No amount", "", null]) {
            expect(unskipBlockReason(skipped({ source: " Cashbook ", skip_kind }))).toBe(UNSKIP_BLOCK_CASHBOOK);
        }
        expect(UNSKIP_BLOCK_CASHBOOK).toBe("Only a Cashbook line skipped by hand can be unskipped.");
    });

    it("a line with no kind is refused", () => {
        for (const skip_kind of ["", null, undefined]) {
            expect(unskipBlockReason(skipped({ skip_kind }))).toBe(UNSKIP_BLOCK_NO_KIND);
        }
    });

    it("a line that is not skipped has nothing to unskip", () => {
        expect(unskipBlockReason(skipped({ row_status: "Mismatched" }))).toBe(UNSKIP_BLOCK_NOT_SKIPPED);
    });

    it("★ the server refuses on the same facts, in the same words", () => {
        const from = skipOriginSource.indexOf("def unskip_refusal");
        const rule = skipOriginSource.slice(from, skipOriginSource.indexOf("\ndef ", from + 1));
        expect(rule).toContain("!= ROW_SKIPPED");
        expect(rule).toContain("source_runs_the_matcher(");
        expect(rule).toContain("kind != SKIP_KIND_BY_HAND");
        expect(rule).toContain("UNSKIP_LOCKED_KINDS");
        expect(rule).not.toContain("SKIP_ORIGIN_MANUAL");
        expect(skipOriginSource).toContain(`UNSKIP_REFUSED_CASHBOOK = "${UNSKIP_BLOCK_CASHBOOK}"`);
        expect(skipOriginSource).toContain(`UNSKIP_REFUSED_NO_KIND = "${UNSKIP_BLOCK_NO_KIND}"`);
    });
});

describe("unskipWarning -- a bank-rule line warns before it goes back to work", () => {
    it("★ every bank-rule kind warns, naming the kind", () => {
        for (const skip_kind of BANK_RULE_SKIP_KINDS) {
            expect(unskipWarning({ skip_kind })).toContain(skip_kind);
        }
    });

    it("no other kind warns", () => {
        for (const skip_kind of ["Skipped by hand", "Outflow Already Recorded", "Inflow Already Recorded", "", null]) {
            expect(unskipWarning({ skip_kind })).toBeNull();
        }
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
            body: "Its money is already recorded as Paid on Project Payment PAY-01399-002.",
        });
    });

    it("a received inflow reads its own verb", () => {
        expect(
            unskipNotice({
                status: "Skipped",
                outcome_note: "Already recorded as received on Project Inflow PINF-1.",
                suggested_name: "",
            }).body,
        ).toBe("Its money is already recorded as received on Project Inflow PINF-1.");
    });

    it("a skip note in other words is shown as the server wrote it", () => {
        expect(
            unskipNotice({ status: "Skipped", outcome_note: "Some other reason.", suggested_name: "" }).body,
        ).toBe("Some other reason.");
    });
});
