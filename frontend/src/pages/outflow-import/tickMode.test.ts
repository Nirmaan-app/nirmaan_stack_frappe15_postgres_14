import { describe, expect, it } from "vitest";

import {
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_PARTIALLY_ALLOCATED,
    ROW_PENDING_MATCH,
    ROW_SETTLED,
    ROW_SKIPPED,
} from "./outflowImportStatus";
import { LOCKED_OPEN_TITLE, LOCKED_SETTLED_TITLE, lockedTitle, SETTLED_MODE_NOTE, SELECT_SETTLED_HINT, selectionMode, tickKindOf, tickRules, type TickKind } from "./tickMode";

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

    it("open mode: only open lines; Settled lines are locked; no hint, since a greyed box cannot be ticked", () => {
        const r = rules({ mode: "open" });
        expect([...r.tickable]).toEqual(OPEN);
        expect(r.selectAll).toEqual(OPEN);
        expect([...r.locked]).toEqual(SETTLED);
        expect(r.selectAllHint).toBeNull();
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
            expect(r.selectAll).toEqual(OPEN);
            expect(r.locked.size).toBe(0);
            expect(r.selectAllHint).toBeNull();
        }
    });

    it("plain Accountant: select-all ticks the open lines in every mode, exactly as before #1319 (#1321)", () => {
        for (const tab of ["all", "matchedOutflow", "settledInflow", "notMatchedOutflow"] as const) {
            for (const mode of ["none", "open"] as const) {
                const r = rules({ canUndo: false, tab, mode });
                expect(r.selectAll).toEqual(OPEN);
                expect(r.selectAllHint).toBeNull();
                expect(r.note).toBeNull();
            }
        }
    });

    it("select-all follows the ticks: none -> open, a Settled tick -> Settled, cleared -> open again (#1321)", () => {
        for (const tab of ["matchedOutflow", "settledInflow"] as const) {
            const kinds = new Map<string, TickKind>();
            const modeOf = (ticked: string[]) => selectionMode(new Set(ticked), kinds);
            expect(rules({ tab, mode: modeOf([]) }).selectAll).toEqual(OPEN);
            kinds.set("settled1", "settled");
            expect(rules({ tab, mode: modeOf(["settled1"]) }).selectAll).toEqual(SETTLED);
            expect(rules({ tab, mode: modeOf([]) }).selectAll).toEqual(OPEN);
            kinds.set("open2", "open");
            expect(rules({ tab, mode: modeOf(["open2"]) }).selectAll).toEqual(OPEN);
        }
    });

    it("select-all in settled mode ticks the Settled lines in page order, skipping interleaved open ones (#1321)", () => {
        const page = [
            { name: "s1", row_status: ROW_SETTLED },
            { name: "o1", row_status: ROW_MATCHED },
            { name: "s2", row_status: ROW_SETTLED },
            { name: "o2", row_status: ROW_PENDING_MATCH },
            { name: "s3", row_status: ROW_SETTLED },
        ];
        const r = tickRules({ rows: page, mode: "settled", tab: "matchedOutflow", canUndo: true });
        expect(r.selectAll).toEqual(["s1", "s2", "s3"]);
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
