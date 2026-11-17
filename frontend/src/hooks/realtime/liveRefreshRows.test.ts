// The rules for applying another user's change to an open table: row ids, "nothing changed", ticks, pages.
import { describe, expect, it } from "vitest";

import { keepTicksForRows, lastPageIndex, nameAsRowId, namesAsRowIds, sameReply } from "./liveRefreshRows";

describe("namesAsRowIds", () => {
    it("holds when every row has its own non-empty name", () => {
        expect(namesAsRowIds([{ name: "PO-1" }, { name: "PO-2" }])).toBe(true);
        expect(namesAsRowIds([])).toBe(true);
    });

    it("fails when a name is missing, empty, not text, or repeated", () => {
        expect(namesAsRowIds([{ name: "PO-1" }, {}])).toBe(false);
        expect(namesAsRowIds([{ name: "" }])).toBe(false);
        expect(namesAsRowIds([{ name: 7 }])).toBe(false);
        expect(namesAsRowIds([{ name: "PO-1" }, { name: "PO-1" }])).toBe(false);
    });

    it("nameAsRowId returns the document name", () => {
        expect(nameAsRowId({ name: "PO-9" })).toBe("PO-9");
    });
});

describe("sameReply", () => {
    const reply = { data: [{ name: "PO-1", status: "Approved" }], total_count: 1, aggregates: { total: 10 } };

    it("is true for a reply with the same rows, total and figures", () => {
        expect(sameReply(reply, JSON.parse(JSON.stringify(reply)))).toBe(true);
    });

    it("is false when a value, the total or a figure differs", () => {
        expect(sameReply(reply, { ...reply, data: [{ name: "PO-1", status: "Dispatched" }] })).toBe(false);
        expect(sameReply(reply, { ...reply, total_count: 2 })).toBe(false);
        expect(sameReply(reply, { ...reply, aggregates: { total: 11 } })).toBe(false);
    });

    it("is false when nothing was shown before", () => {
        expect(sameReply(null, reply)).toBe(false);
    });
});

describe("keepTicksForRows", () => {
    const rows = [{ name: "PAY-1" }, { name: "PAY-3" }];

    it("keeps the ticks of records still listed and drops the others", () => {
        expect(keepTicksForRows({ "PAY-1": true, "PAY-2": true, "PAY-3": true }, rows)).toEqual({ "PAY-1": true, "PAY-3": true });
    });

    it("returns the same object when every tick is still listed", () => {
        const selection = { "PAY-1": true };
        expect(keepTicksForRows(selection, rows)).toBe(selection);
    });

    it("never adds a tick for a new record", () => {
        expect(keepTicksForRows({ "PAY-1": true }, [{ name: "PAY-0" }, ...rows])).toEqual({ "PAY-1": true });
    });

    it("leaves an empty selection alone", () => {
        const none = {};
        expect(keepTicksForRows(none, rows)).toBe(none);
    });

    it("drops every tick when ids are row positions, since a position now holds another record", () => {
        expect(keepTicksForRows({ "0": true, "1": true }, [{}, {}])).toEqual({});
        expect(keepTicksForRows({ "0": true }, [{ name: "A" }, { name: "A" }])).toEqual({});
    });

    it("uses the page's own row id when it gives one", () => {
        const byCode = (row: { name?: unknown; code: string }) => row.code;
        expect(keepTicksForRows({ X: true, Y: true }, [{ code: "X" }], byCode)).toEqual({ X: true });
    });

    it("cleans out unticked leftovers", () => {
        expect(keepTicksForRows({ "PAY-1": true, "PAY-3": false }, rows)).toEqual({ "PAY-1": true });
    });
});

describe("lastPageIndex", () => {
    it("is the index of the last page with rows", () => {
        expect(lastPageIndex(101, 50)).toBe(2);
        expect(lastPageIndex(100, 50)).toBe(1);
        expect(lastPageIndex(1, 50)).toBe(0);
    });

    it("is 0 when there is nothing", () => {
        expect(lastPageIndex(0, 50)).toBe(0);
        expect(lastPageIndex(10, 0)).toBe(0);
    });
});
