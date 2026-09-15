// src/pages/outflow-import/unskipView.ts
//
// The Skipped popup's Unskip column and the notice an Unskip ends in (#1274, parent #1270, ADR-0022).
// Pure: no React, no fetch. `SkippedRowsDialog` renders these; `unskipView.test.ts` pins them.

import { NEVER_MATCHED_SOURCES, ROW_MATCHED, ROW_SKIPPED, SKIP_ORIGIN_MANUAL } from "./outflowImportStatus";

export const UNSKIP_BLOCK_NOT_SKIPPED = "This transfer is not skipped.";
export const UNSKIP_BLOCK_CASHBOOK = "Cashbook rows can't be unskipped.";
export const UNSKIP_BLOCK_BANK_REFUSED = "The bank never moved this money.";
export const UNSKIP_BLOCK_EXCLUDED = "A bank rule excluded it.";
export const UNSKIP_BLOCK_EARLIER_STATEMENT = "The same transfer is in an earlier statement.";
export const UNSKIP_BLOCK_ALREADY_RECORDED = "This money is already recorded.";

/**
 * Fragments of the sentences `status.py` writes when it skips a line at upload, which is how a system
 * skip's CAUSE is told apart on screen. `unskipView.test.ts` reads `status.py` and fails if one is
 * reworded there.
 */
export const UNSKIP_SENTENCE_MARKERS = {
    excluded: ["Excluded by bank-statement rule"],
    earlierStatement: ["Already imported in batch", "This transfer appears earlier in the same statement"],
} as const;

/** Mirrors `parser.BANK_SUCCESS_STATUS`; `unskipView.test.ts` pins it. */
export const BANK_SUCCESS_STATUS = "SUCCESS";

const mentions = (text: string, markers: readonly string[]) => markers.some((m) => text.includes(m));

/**
 * Why this Skipped line has NO live Unskip, as the sentence shown beside the disabled button -- or
 * `null` when it may be unskipped.
 *
 * ⚠️ CONVENIENCE ONLY. `skip_origin.unskip_refusal` is the boundary and re-checks Manual and Cashbook.
 * The finer causes below exist only so a disabled button explains itself in words (story 63); the
 * server never needs them, because it refuses every system skip the same way.
 *
 * ⚠️ PRECEDENCE: Cashbook, then a hand skip, then the bank's own verdict, then the words. A refused
 * transfer keeps its sentence only in `skip_reason`, which an old hand re-skip overwrote -- so
 * `status_raw` is read before any sentence. A blank `status_raw` counts as refused, as the Skipped
 * popup's Bank-refused filter counts it.
 */
export const unskipBlockReason = (row: {
    row_status: string;
    skip_origin?: string | null;
    source?: string | null;
    status_raw?: string | null;
    outcome_note?: string | null;
    skip_reason?: string | null;
}): string | null => {
    if (row.row_status !== ROW_SKIPPED) return UNSKIP_BLOCK_NOT_SKIPPED;
    if (NEVER_MATCHED_SOURCES.has((row.source ?? "").trim())) return UNSKIP_BLOCK_CASHBOOK;
    if (row.skip_origin === SKIP_ORIGIN_MANUAL) return null;
    if ((row.status_raw ?? "").trim().toUpperCase() !== BANK_SUCCESS_STATUS) return UNSKIP_BLOCK_BANK_REFUSED;
    const words = `${row.outcome_note ?? ""} ${row.skip_reason ?? ""}`;
    if (mentions(words, UNSKIP_SENTENCE_MARKERS.excluded)) return UNSKIP_BLOCK_EXCLUDED;
    if (mentions(words, UNSKIP_SENTENCE_MARKERS.earlierStatement)) return UNSKIP_BLOCK_EARLIER_STATEMENT;
    return UNSKIP_BLOCK_ALREADY_RECORDED;
};

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
            body: `${noteBody ? `${noteBody} ` : ""}It can't be unskipped now.`,
        };
    }
    if (result.status === ROW_MATCHED && result.suggested_name) {
        return { tone: "ok", title: "Unskipped.", body: `It matched ${result.suggested_name}.` };
    }
    return { tone: "ok", title: "Unskipped.", body: "It now needs a record." };
};
