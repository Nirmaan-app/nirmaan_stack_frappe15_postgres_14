import { describe, expect, it } from "vitest";

import {
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_PARTIALLY_ALLOCATED,
    ROW_PENDING_MATCH,
    ROW_SETTLED,
    ROW_SKIPPED,
} from "./outflowImportStatus";
import { LOCKED_OPEN_TITLE, LOCKED_SETTLED_TITLE, lockedTitle, SETTLED_MODE_NOTE, SELECT_SETTLED_HINT, selectionMode, tickKindOf, tickRules } from "./tickMode";

const rows = [
    { name: "open1", row_status: ROW_MATCHED },
    { name: "open2", row_status: ROW_MISMATCHED },
    { name: "open3", row_status: ROW_PENDING_MATCH },
    { name: "settled1", row_status: ROW_SETTLED },
    { name: "settled2", row_status: ROW_SETTLED },
    { name: "partly", row_status: ROW_PARTIALLY_ALLOCATED },
    { name: "skipped", row_status: ROW_SKIPPED },
];
const OPEN = ["open1", "open2", "open3"];
const SETTLED = ["settled1", "settled2"];

const rules = (over: Partial<Parameters<typeof tickRules>[0]> = {}) =>
    tickRules({ rows, mode: "none", tab: "matchedOutflow", canUndo: true, ...over });

describe("tickKindOf", () => {
    it("is open for an open line, settled for a Settled line where undo is allowed, else null", () => {
        expect(tickKindOf({ row_status: ROW_MATCHED }, true)).toBe("open");
        expect(tickKindOf({ row_status: ROW_SETTLED }, true)).toBe("settled");
        expect(tickKindOf({ row_status: ROW_SETTLED }, false)).toBeNull();
        expect(tickKindOf({ row_status: ROW_PARTIALLY_ALLOCATED }, true)).toBeNull();
        expect(tickKindOf({ row_status: ROW_SKIPPED }, true)).toBeNull();
    });
});

describe("selectionMode", () => {
    it("is none when nothing is ticked", () => {
        expect(selectionMode(new Set(), new Map())).toBe("none");
    });
    it("is the kind each ticked line was ticked as", () => {
        const kinds = new Map([
            ["a", "open" as const],
            ["b", "settled" as const],
        ]);
        expect(selectionMode(new Set(["a"]), kinds)).toBe("open");
        expect(selectionMode(new Set(["b"]), kinds)).toBe("settled");
    });
    it("reads a tick with no recorded kind as open, the pre-#1319 behaviour", () => {
        expect(selectionMode(new Set(["x"]), new Map())).toBe("open");
    });
});

describe("tickRules", () => {
    it("empty: open and Settled lines are tickable; select-all ticks the open ones", () => {
        const r = rules();
        expect([...r.tickable].sort()).toEqual([...OPEN, ...SETTLED].sort());
        expect(r.selectAll).toEqual(OPEN);
        expect(r.locked.size).toBe(0);
        expect(r.selectAllHint).toBe(SELECT_SETTLED_HINT);
        expect(r.note).toBeNull();
    });

    it("open mode: only open lines; Settled lines are locked", () => {
        const r = rules({ mode: "open" });
        expect([...r.tickable]).toEqual(OPEN);
        expect(r.selectAll).toEqual(OPEN);
        expect([...r.locked]).toEqual(SETTLED);
        expect(r.selectAllHint).toBe(SELECT_SETTLED_HINT);
        expect(r.note).toBeNull();
    });

    it("settled mode: only Settled lines; open lines are locked; select-all ticks the Settled ones", () => {
        const r = rules({ mode: "settled" });
        expect([...r.tickable]).toEqual(SETTLED);
        expect(r.selectAll).toEqual(SETTLED);
        expect([...r.locked]).toEqual(OPEN);
        expect(r.selectAllHint).toBeNull();
        expect(r.note).toBe(SETTLED_MODE_NOTE);
    });

    it("never offers a Partially Allocated or Skipped line", () => {
        for (const mode of ["none", "open", "settled"] as const) {
            const r = rules({ mode });
            for (const name of ["partly", "skipped"]) {
                expect(r.tickable.has(name)).toBe(false);
                expect(r.locked.has(name)).toBe(false);
            }
        }
    });

    it("role gate: a plain Accountant gets only open lines, and no hint", () => {
        const r = rules({ canUndo: false });
        expect([...r.tickable]).toEqual(OPEN);
        expect(r.locked.size).toBe(0);
        expect(r.selectAllHint).toBeNull();
    });

    it("tab gate: only the two Matched / Settled tabs offer Settled lines", () => {
        expect(rules({ tab: "settledInflow" }).tickable.has("settled1")).toBe(true);
        for (const tab of ["all", "notMatchedOutflow", "partlyAllocatedOutflow", "notMatchedInflow"] as const) {
            const r = rules({ tab });
            expect([...r.tickable]).toEqual(OPEN);
            expect(r.locked.size).toBe(0);
            expect(r.selectAllHint).toBeNull();
        }
    });

    it("no hint when the page holds no Settled line to select", () => {
        const r = tickRules({
            rows: rows.filter((row) => row.row_status !== ROW_SETTLED),
            mode: "none",
            tab: "matchedOutflow",
            canUndo: true,
        });
        expect(r.selectAllHint).toBeNull();
    });
});

describe("lockedTitle", () => {
    it("tells a greyed Settled box and a greyed open box apart", () => {
        expect(lockedTitle({ row_status: ROW_SETTLED })).toBe(LOCKED_SETTLED_TITLE);
        expect(lockedTitle({ row_status: ROW_MATCHED })).toBe(LOCKED_OPEN_TITLE);
    });
});
