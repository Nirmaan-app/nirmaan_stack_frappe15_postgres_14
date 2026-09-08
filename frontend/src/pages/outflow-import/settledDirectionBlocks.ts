// src/pages/outflow-import/settledDirectionBlocks.ts

/**
 * The settled-money panel's TWO blocks — Received and Paid (slice B8b, owner ruling Q14 option a).
 *
 * ⚠️ NEVER NETTED. A single figure hides both halves; adding money in to money out produces a
 * number that means nothing; and dropping receipts would make the money this screen ingested
 * invisible on the screen that ingested it. Each block carries its own total and its own ledger
 * lines, and the two are only ever read side by side.
 *
 * ⚠️ THIS FILE DECIDES NOTHING ABOUT THE FIGURES. The server owns the split, the order, the
 * zero-fill, which side a blank direction lands on, and whether an empty received block exists at
 * all (`status.derive_settled_direction_blocks`). A client that re-ordered, re-summed or
 * re-partitioned would be a second opinion about numbers printed beside the server's own — which
 * `ImportSummaryPanel`'s own docstring calls worse than printing nothing. The one honest job left
 * here is deciding what an ABSENT key means, exactly as `settledLedgerRows` does one level down.
 *
 * ⚠️ IT REUSES `settledLedgerRows` FOR EACH BLOCK'S LINES RATHER THAN RE-IMPLEMENTING IT. That
 * helper is the owner of "an absent ledger list renders nothing"; a second copy of the same
 * fallback is how one of them would come to render a confident row of zeroes.
 */

import { settledLedgerRows, type SettledLedgerSplit } from "./outflowTableModel";

/**
 * The server's word for a block, rendered verbatim — the same contract `ledger` already has.
 *
 * The panel maps these to its own headings; it never invents a third name for a side, and it never
 * derives the side from the ledger. It cannot: a non-project RECEIPT is stored as a NEGATIVE
 * `Non Project Expense` (B7), so `Non Project Expenses` legitimately appears in BOTH blocks and the
 * target doctype genuinely does not say which way the money went.
 */
export const SETTLED_BLOCK_RECEIVED = "Received";
export const SETTLED_BLOCK_PAID = "Paid";

/** One direction's share of what has been settled, exactly as `get_outflow_summary` sends it. */
export interface SettledDirectionBlock {
    /** `Received` or `Paid`. */
    direction: string;
    /** How many transfers this block holds, and what they moved. Its ledger lines add up to both. */
    rows: number;
    value: number;
    /** This block's own books, ordered and zero-filled by the server. */
    ledgers: SettledLedgerSplit[];
}

/**
 * The blocks, for the panel to render — PASSED THROUGH, NOT PROCESSED.
 *
 * ⚠️ ABSENT MEANS NOTHING RENDERS, NEVER "nothing was settled". A client running against a server
 * that predates the key would otherwise print a confident empty breakdown over a table full of
 * settled transfers, which is a worse lie than the silence it replaces. This is the same call
 * `settledLedgerRows` and `settled_from_suggestion` already make.
 */
export const settledDirectionBlocks = (
    blocks?: SettledDirectionBlock[]
): SettledDirectionBlock[] =>
    Array.isArray(blocks)
        ? blocks.map((block) => ({ ...block, ledgers: settledLedgerRows(block.ledgers) }))
        : [];

/**
 * The heading one block gets.
 *
 * ⚠️ IT NAMES THE DIRECTION, ALWAYS. The tile used to read `Settled`, which was unambiguous only
 * while every transfer on this screen moved one way. Now that a credit can become a `Project
 * Inflow` (B6) or a negative `Non Project Expense` (B7), a reviewer glancing at the panel must not
 * have to work out which way the money went — so the word for the direction is in the label, not
 * inferred from where the tile sits.
 *
 * ⚠️ AN UNRECOGNISED DIRECTION IS RENDERED VERBATIM RATHER THAN GUESSED AT. The server owns this
 * vocabulary; a client that mapped an unknown word onto one of the two known headings would put a
 * figure under a claim about direction that nothing sent.
 */
export const settledBlockLabel = (direction: string): string => {
    if (direction === SETTLED_BLOCK_RECEIVED) return "Settled — received";
    if (direction === SETTLED_BLOCK_PAID) return "Settled — paid out";
    return `Settled — ${direction}`;
};

/**
 * The sub-line under a block's figure.
 *
 * ⚠️ `settled_from_suggestion` IS A WHOLE-SETTLED FIGURE AND IS ONLY QUOTED WHERE IT PROVABLY
 * DESCRIBES THIS BLOCK'S OWN POPULATION — that is, on the paid block of a statement with no
 * received block, where the paid rows ARE every settled row. On a mixed statement the clause is
 * OMITTED rather than shown against a denominator it was not drawn from: a count that does not
 * apply is left out, never printed anyway. (Splitting the auto-matched count by direction would
 * mean cutting the status aggregate on a third axis, which this slice deliberately does not do.)
 *
 * It is also silent when nothing is settled, and when the count is absent on an older payload, so
 * the tile degrades to exactly what it said before rather than reading "0 auto-matched" on data
 * that simply predates the field.
 */
export const settledBlockSubLine = (
    block: SettledDirectionBlock,
    opts: { fromSuggestion?: number | null; describesEverySettledRow: boolean }
): string => {
    const recorded = `${block.rows} recorded`;
    if (!opts.describesEverySettledRow) return recorded;
    if (block.rows <= 0 || opts.fromSuggestion == null) return recorded;
    return `${recorded} · ${opts.fromSuggestion} auto-matched`;
};
