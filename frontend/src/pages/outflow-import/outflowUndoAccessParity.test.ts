// Who may Unreconcile / Reverse (#1273, parent #1270 Q1) -- spelled in two languages. Skip and Unskip
// left the undo set at ADR-0022 Amendment E (owner, 2026-09-24): every module user may do them.
//
// `permissions.OUTFLOW_UNDO_PROFILES` is the boundary; `outflowImportStatus.OUTFLOW_UNDO_PROFILES` only
// hides buttons. Neither side can import the other, so this reads the Python files as text (the
// `settleModeLabelParity.test.ts` shape, ADR-0010 F1). A profile added on one side only would show a
// button the server refuses, or hide one a Lead is allowed to press -- and nothing else would fail.
//
// ⚠️ THE FIRST CASE GUARDS THE PATH. Everything below parses a file read from disk; a moved file would
// parse to an empty set, and an empty set on both sides "matches".
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
    CASHBOOK_PENDING_LINE_REFUSAL,
    cashbookPendingLineRefusal,
    NEVER_MATCHED_SOURCES,
    OUTFLOW_UNDO_PROFILES,
    SPENDER_NAMED_SOURCES,
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_PARTIALLY_ALLOCATED,
    ROW_PENDING_MATCH,
    ROW_SETTLED,
    ROW_SKIPPED,
    ROW_ERROR,
    COLLECT_PAYMENT_CHOICES_REFUSAL,
    COLLECT_PAYMENT_SKIP_REFUSAL,
    COLLECT_ROW_KIND,
    canSkipByHand,
    canUndoOutflow,
    isCollectPaymentLine,
} from "./outflowImportStatus";

const pyFile = (relative: string) =>
    readFileSync(
        fileURLToPath(new URL(`../../../../nirmaan_stack/${relative}`, import.meta.url)),
        "utf8",
    );

const permissionsSource = pyFile("api/outflow_import/permissions.py");
const sourcesSource = pyFile("services/outflow_import/sources.py");

/** The strings inside `NAME = frozenset({ ... })`, quoted or named by a `CONSTANT = "..."` of the same file
 * (`CARD_STATEMENT_SOURCE`), or `null` when the assignment is absent. A name with no such constant throws. */
const frozensetStrings = (source: string, name: string): Set<string> | null => {
    const match = source.match(new RegExp(`^${name} = frozenset\\(\\s*\\{([^}]*)\\}`, "m"));
    if (!match) return null;
    const constant = (id: string) => {
        const found = source.match(new RegExp(`^${id} = "([^"]+)"`, "m"));
        if (!found) throw new Error(`${name} names ${id}, which is not a string constant of this file`);
        return found[1];
    };
    return new Set(
        [...match[1].matchAll(/"([^"]+)"|\b([A-Z][A-Z0-9_]*)\b/g)].map((m) => m[1] ?? constant(m[2])),
    );
};

describe("undo access parity -- the screen hides exactly what the server refuses", () => {
    it("★ reads the real permissions.py and sources.py", () => {
        expect(permissionsSource).toContain("def require_outflow_undo_access");
        expect(sourcesSource).toContain("def source_runs_the_matcher");
    });

    it("★ OUTFLOW_UNDO_PROFILES is the same set on both sides", () => {
        const python = frozensetStrings(permissionsSource, "OUTFLOW_UNDO_PROFILES");
        expect(python).not.toBeNull();
        expect(python!.size).toBeGreaterThan(0);
        expect(python).toEqual(new Set(OUTFLOW_UNDO_PROFILES));
    });

    it("★ NEVER_MATCHED_SOURCES (Cashbook: its own Skip rule) is the same set on both sides", () => {
        const python = frozensetStrings(sourcesSource, "NEVER_MATCHED_SOURCES");
        expect(python).not.toBeNull();
        expect(python).toEqual(new Set(NEVER_MATCHED_SOURCES));
    });

    it("★ SPENDER_NAMED_SOURCES (Paid by comes from the statement) is the same set on both sides", () => {
        const python = frozensetStrings(sourcesSource, "SPENDER_NAMED_SOURCES");
        expect(python).not.toBeNull();
        expect(python).toEqual(new Set(SPENDER_NAMED_SOURCES));
    });

    it("★ the Skip rule refuses a Cashbook line only while its job has not written it", () => {
        // #1587: the rule moved into `own_import_refusal`, which every main-table write asks, Skip included.
        const skipOrigin = pyFile("services/outflow_import/skip_origin.py");
        const body = (name: string) => {
            const from = skipOrigin.indexOf(`def ${name}`);
            return skipOrigin.slice(from, skipOrigin.indexOf("\ndef ", from + 1));
        };
        expect(body("manual_skip_refusal")).toContain("return own_import_refusal(");
        expect(body("own_import_refusal")).toContain(
            "source == CASHBOOK_SOURCE and (row_status or \"\").strip() == ROW_PENDING_MATCH"
        );
        // The Confirm blocker shows the server's own refusal, word for word.
        expect(skipOrigin).toContain(`"${CASHBOOK_PENDING_LINE_REFUSAL}"`);
    });

    it("the Cashbook pending-line sentence names the line's import (spec #1585 B)", () => {
        expect(cashbookPendingLineRefusal("OFI-26-00042")).toBe(
            "The Cashbook import OFI-26-00042 is still creating this line's expense, so it can't be worked by hand yet."
        );
    });

    it("the undo set is inside the module set -- a plain Accountant is in one and not the other", () => {
        const module = frozensetStrings(permissionsSource, "OUTFLOW_IMPORT_PROFILES")!;
        for (const profile of OUTFLOW_UNDO_PROFILES) expect(module.has(profile)).toBe(true);
        expect(module.has("Nirmaan Accountant Profile")).toBe(true);
        expect(OUTFLOW_UNDO_PROFILES.has("Nirmaan Accountant Profile")).toBe(false);
    });
});

describe("a Collect payment is told apart, and refused, as the server does (spec #1585)", () => {
    const refundsSource = pyFile("services/outflow_import/cashbook_refunds.py");
    const collectSource = pyFile("services/outflow_import/cashbook_collect.py");

    it("★ the statement Type is the server's", () => {
        expect(refundsSource).toContain(`COLLECT_ROW_KIND = "${COLLECT_ROW_KIND}"`);
    });

    it("★ the two refusals are the server's, word for word", () => {
        expect(collectSource).toContain(`"${COLLECT_PAYMENT_SKIP_REFUSAL}"`);
        expect(collectSource).toContain(`"${COLLECT_PAYMENT_CHOICES_REFUSAL}"`);
    });

    it("is a Cashbook line whose stored Type is Collect Payment, trimmed", () => {
        expect(isCollectPaymentLine({ source: " Cashbook ", row_kind: " Collect Payment " })).toBe(true);
        expect(isCollectPaymentLine({ source: "Cashbook", row_kind: "Wallet Spend" })).toBe(false);
        expect(isCollectPaymentLine({ source: "Cashbook", row_kind: null })).toBe(false);
        expect(isCollectPaymentLine({ source: "Cashfree", row_kind: "Collect Payment" })).toBe(false);
    });
});

describe("canUndoOutflow", () => {
    it("admits Admin, Accountant Lead and the Administrator user", () => {
        expect(canUndoOutflow("Nirmaan Admin Profile", "a@x.com")).toBe(true);
        expect(canUndoOutflow("Nirmaan Accountant Lead Profile", "a@x.com")).toBe(true);
        expect(canUndoOutflow("anything", "Administrator")).toBe(true);
    });

    it("refuses a plain Accountant, other profiles, and a role still loading", () => {
        expect(canUndoOutflow("Nirmaan Accountant Profile", "a@x.com")).toBe(false);
        expect(canUndoOutflow("Nirmaan Project Manager Profile", "a@x.com")).toBe(false);
        expect(canUndoOutflow("Loading", "a@x.com")).toBe(false);
        expect(canUndoOutflow(undefined, undefined)).toBe(false);
    });
});

describe("canSkipByHand -- the Skip box shows on open lines, for every module user", () => {
    it("shows on every open status", () => {
        for (const row_status of [ROW_PENDING_MATCH, ROW_MATCHED, ROW_MISMATCHED, ROW_ERROR]) {
            expect(canSkipByHand({ row_status, source: "Cashfree" }, false)).toBe(true);
        }
    });

    it("hides on a line with money written, or already skipped", () => {
        for (const row_status of [ROW_SETTLED, ROW_PARTIALLY_ALLOCATED, ROW_SKIPPED]) {
            expect(canSkipByHand({ row_status, source: "Cashfree" }, false)).toBe(false);
        }
    });

    it("★ shows on an open Cashbook line (#1314 -- INVERTS \"hides on Cashbook, even while open\")", () => {
        for (const row_status of [ROW_MATCHED, ROW_MISMATCHED, ROW_ERROR]) {
            expect(canSkipByHand({ row_status, source: " Cashbook " }, false)).toBe(true);
        }
    });

    it("hides on a Cashbook line its own job has not written yet", () => {
        expect(canSkipByHand({ row_status: ROW_PENDING_MATCH, source: " Cashbook " }, true)).toBe(false);
    });

    it("★ a plain Accountant may skip every line but a Collect payment (ADR-0022 Amendment E)", () => {
        // The second argument is `canUndoOutflow`'s answer. It hides the box on a Collect payment only.
        for (const row of [
            { row_status: ROW_MISMATCHED, source: "Cashfree" },
            { row_status: ROW_MISMATCHED, source: "Cashbook", row_kind: "Wallet Credit" },
            { row_status: ROW_MISMATCHED, source: "Cashbook", row_kind: null },
        ]) {
            expect(canSkipByHand(row, false)).toBe(true);
        }
    });

    it("★ an open Collect payment's box shows only to an Admin or an Accountant Lead (spec #1585 story 39)", () => {
        const collect = { row_status: ROW_MISMATCHED, source: "Cashbook", row_kind: "Collect Payment" };
        expect(canSkipByHand(collect, false)).toBe(false);
        expect(canSkipByHand(collect, true)).toBe(true);
    });

    it("hides with no line", () => {
        expect(canSkipByHand(null, true)).toBe(false);
    });
});
