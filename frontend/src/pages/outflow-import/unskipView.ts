// src/pages/outflow-import/unskipView.ts
//
// The Skipped popup's Unskip column and the notice an Unskip ends in (#1274, parent #1270, ADR-0022).
// Pure: no React, no fetch. `SkippedRowsDialog` renders these; `unskipView.test.ts` pins them.

import { NEVER_MATCHED_SOURCES, ROW_MATCHED, ROW_SKIPPED } from "./outflowImportStatus";
import { BANK_RULE_SKIP_KINDS, SKIP_KIND_BY_HAND, UNSKIP_LOCKED_KINDS } from "./skipKinds";

export const UNSKIP_BLOCK_NOT_SKIPPED = "This transfer is not skipped.";
export const UNSKIP_BLOCK_CASHBOOK = "Only a Cashbook line skipped by hand can be unskipped.";
export const UNSKIP_BLOCK_NO_KIND = "This transfer has no skip type, so it can't be unskipped.";

/**
 * Why this Skipped line has NO live Unskip, as the sentence shown beside the disabled button -- or
 * `null` when it may be unskipped.
 *
 * ⚠️ KEYED ON SKIP KIND (owner, 2026-09-17, ADR-0022 Amendment C). It used to allow hand skips only and
 * tell system skips apart by the WORDS of their sentence. Now: every kind comes back except the four in
 * `UNSKIP_LOCKED_KINDS`. A Cashbook line comes back only when a person skipped it (#1314, narrowing
 * decision B1's "never"); its system kinds stay locked under one sentence.
 *
 * ⚠️ CONVENIENCE ONLY. `skip_origin.unskip_refusal` is the boundary and re-checks all of it; the
 * sentences are the server's, pinned by `skipKinds.test.ts`.
 */
export const unskipBlockReason = (row: {
    row_status: string;
    skip_kind?: string | null;
    source?: string | null;
}): string | null => {
    if (row.row_status !== ROW_SKIPPED) return UNSKIP_BLOCK_NOT_SKIPPED;
    const kind = (row.skip_kind ?? "").trim();
    if (NEVER_MATCHED_SOURCES.has((row.source ?? "").trim()) && kind !== SKIP_KIND_BY_HAND) {
        return UNSKIP_BLOCK_CASHBOOK;
    }
    if (!kind) return UNSKIP_BLOCK_NO_KIND;
    return UNSKIP_LOCKED_KINDS[kind] ?? null;
};

/**
 * The warning the Unskip box shows before a bank-rule line goes back to work, or `null` for any other.
 *
 * ⚠️ THE ONE KIND UNSKIP CAN GENUINELY RE-OPEN AS A DUPLICATE (owner decision B1). The re-check skips a
 * line whose money is still recorded again, but it does not re-apply bank rules -- so a Cashfree top-up
 * comes back as work, and booking it would count money the Cashfree statement already holds.
 */
export const unskipWarning = (row: { skip_kind?: string | null }): string | null =>
    BANK_RULE_SKIP_KINDS.has((row.skip_kind ?? "").trim())
        ? `A bank rule read this line as money moving between our own accounts (${row.skip_kind}), not a ` +
          "spend or a receipt. It comes back as open work -- check that its money is not already counted " +
          "somewhere else before you record it."
        : null;

/** What `review.unskip_row` returns, as far as the notice reads it. */
export interface UnskipResult {
    status: string;
    outcome_note?: string | null;
    suggested_name?: string | null;
}

export interface UnskipNotice {
    tone: "ok" | "warn";
    title: string;
    body: string;
}

const ALREADY_RECORDED_PREFIX = "Already recorded";

/**
 * The notice after an Unskip: "needs a record", "matched X" or "skipped again" (story 66).
 *
 * ⚠️ BUILT FROM THE SERVER'S RE-CHECK, NEVER GUESSED. The line went back through the matcher before
 * the endpoint returned, so its status, note and suggestion are the truth; the "skipped again" body is
 * the matcher's own "Already recorded …" sentence, which already names each record with its ledger.
 *
 * A Matched line with no single pick (a fan-out, several candidates) reads as "needs a record": a
 * person still has to choose, and there is no one record the notice could honestly name.
 */
export const unskipNotice = (result: UnskipResult): UnskipNotice => {
    if (result.status === ROW_SKIPPED) {
        const note = (result.outcome_note ?? "").trim();
        const noteBody = note.startsWith(ALREADY_RECORDED_PREFIX)
            ? `Its money is already recorded${note.slice(ALREADY_RECORDED_PREFIX.length)}`
            : note;
        return {
            tone: "warn",
            title: "Unskipped, then skipped again.",
            // ⚠️ NOT "it can't be unskipped now" (owner, 2026-09-17): a recorded skip may be unskipped
            // again -- the same re-check just skips it again while the money is still recorded.
            body: noteBody,
        };
    }
    if (result.status === ROW_MATCHED && result.suggested_name) {
        return { tone: "ok", title: "Unskipped.", body: `It matched ${result.suggested_name}.` };
    }
    return { tone: "ok", title: "Unskipped.", body: "It now needs a record." };
};
