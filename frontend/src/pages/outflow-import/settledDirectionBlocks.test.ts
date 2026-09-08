// src/pages/outflow-import/settledDirectionBlocks.test.ts

import { describe, expect, it } from "vitest";

import {
    SETTLED_BLOCK_PAID,
    SETTLED_BLOCK_RECEIVED,
    settledBlockLabel,
    settledBlockSubLine,
    settledDirectionBlocks,
    type SettledDirectionBlock,
} from "./settledDirectionBlocks";

const paid = (rows: number, value: number): SettledDirectionBlock => ({
    direction: SETTLED_BLOCK_PAID,
    rows,
    value,
    ledgers: [
        { ledger: "Project Payments", rows, value },
        { ledger: "Project Expenses", rows: 0, value: 0 },
        { ledger: "Non Project Expenses", rows: 0, value: 0 },
    ],
});

const received = (rows: number, value: number): SettledDirectionBlock => ({
    direction: SETTLED_BLOCK_RECEIVED,
    rows,
    value,
    ledgers: [
        { ledger: "Project Inflows", rows, value },
        { ledger: "Non Project Expenses", rows: 0, value: 0 },
    ],
});

describe("settledDirectionBlocks — the server's split, passed through", () => {
    it("passes the blocks through in the order given, unsorted and unaltered", () => {
        // ⚠️ THE ORDER IS THE SERVER'S. Paid never moves; received is appended when it exists. A
        // client that re-sorted (by value, say) would rearrange the panel between periods, so the
        // same figure sits somewhere different each time it is read.
        const blocks = [paid(114, 3748174), received(3, 180000000)];
        expect(settledDirectionBlocks(blocks).map((b) => b.direction)).toEqual([
            SETTLED_BLOCK_PAID,
            SETTLED_BLOCK_RECEIVED,
        ]);
        expect(settledDirectionBlocks(blocks)).toEqual(blocks);
    });

    it("renders NOTHING when the key is absent, never 'nothing was settled'", () => {
        // A client against a server predating the key would otherwise print a confident empty
        // breakdown over a table full of settled transfers.
        expect(settledDirectionBlocks(undefined)).toEqual([]);
        expect(settledDirectionBlocks()).toEqual([]);
    });

    it("survives a block whose ledger list is missing entirely", () => {
        // Same fallback one level down — `settledLedgerRows` owns it, and this reuses it rather
        // than keeping a second copy that could drift into rendering a row of zeroes.
        const odd = [{ direction: "Paid", rows: 0, value: 0 }] as SettledDirectionBlock[];
        expect(settledDirectionBlocks(odd)[0].ledgers).toEqual([]);
    });

    it("does not total, re-partition or net the blocks", () => {
        // ⚠️ NEVER NETTED (owner ruling Q14 option a). Two blocks in, two blocks out, each keeping
        // its own figure — 3,748,174 out and 180,000,000 in are not one number.
        const out = settledDirectionBlocks([paid(114, 3748174), received(3, 180000000)]);
        expect(out).toHaveLength(2);
        expect(out[0].value).toBe(3748174);
        expect(out[1].value).toBe(180000000);
    });

    it("keeps each block's own total exactly as the server sent it", () => {
        // The server sums each total FROM the lines it renders, so the panel must not recompute:
        // a second opinion here could only disagree with the figures printed beside it.
        const out = settledDirectionBlocks([paid(2, 500), received(1, 90)]);
        for (const block of out) {
            expect(block.value).toBe(
                block.ledgers.reduce((sum, line) => sum + line.value, 0)
            );
            expect(block.rows).toBe(block.ledgers.reduce((sum, line) => sum + line.rows, 0));
        }
    });
});

describe("settledBlockLabel — a heading that names the direction", () => {
    it("says which way the money went, on both blocks", () => {
        // ⚠️ A reviewer glancing at the panel must never have to work out the direction. The old
        // bare "Settled" was unambiguous only while every transfer moved one way.
        expect(settledBlockLabel(SETTLED_BLOCK_PAID)).toBe("Settled — paid out");
        expect(settledBlockLabel(SETTLED_BLOCK_RECEIVED)).toBe("Settled — received");
    });

    it("neither label can be mistaken for the other", () => {
        expect(settledBlockLabel(SETTLED_BLOCK_PAID)).not.toBe(
            settledBlockLabel(SETTLED_BLOCK_RECEIVED)
        );
        expect(settledBlockLabel(SETTLED_BLOCK_PAID)).toContain("paid");
        expect(settledBlockLabel(SETTLED_BLOCK_RECEIVED)).toContain("received");
    });

    it("renders an unknown direction verbatim rather than guessing at one of the two", () => {
        // Mapping an unknown word onto a known heading would put a figure under a claim about
        // direction that nothing sent.
        expect(settledBlockLabel("Reversal")).toBe("Settled — Reversal");
    });
});

describe("settledBlockSubLine — the auto-matched clause and when it may be quoted", () => {
    it("quotes the auto-matched count only when the block IS every settled row", () => {
        expect(
            settledBlockSubLine(paid(114, 3748174), {
                fromSuggestion: 113,
                describesEverySettledRow: true,
            })
        ).toBe("114 recorded · 113 auto-matched");
    });

    it("OMITS it on a mixed statement rather than quoting a foreign denominator", () => {
        // ⚠️ `settled_from_suggestion` is a WHOLE-SETTLED figure. On a statement with receipts it
        // is not drawn from the paid block's population, and "3 recorded · 4 auto-matched" is the
        // shape that would produce. A count that does not apply is left out, never printed anyway.
        expect(
            settledBlockSubLine(paid(3, 300), {
                fromSuggestion: 4,
                describesEverySettledRow: false,
            })
        ).toBe("3 recorded");
        expect(
            settledBlockSubLine(received(1, 90), {
                fromSuggestion: 4,
                describesEverySettledRow: false,
            })
        ).toBe("1 recorded");
    });

    it("is silent when nothing is settled", () => {
        expect(
            settledBlockSubLine(paid(0, 0), {
                fromSuggestion: 0,
                describesEverySettledRow: true,
            })
        ).toBe("0 recorded");
    });

    it("degrades to the pre-Q1 sub-line when the count is absent on an older payload", () => {
        // Reading "0 auto-matched" on data that simply predates the field would be worse than
        // saying nothing about it.
        expect(
            settledBlockSubLine(paid(5, 500), {
                fromSuggestion: null,
                describesEverySettledRow: true,
            })
        ).toBe("5 recorded");
        expect(
            settledBlockSubLine(paid(5, 500), { describesEverySettledRow: true })
        ).toBe("5 recorded");
    });
});
