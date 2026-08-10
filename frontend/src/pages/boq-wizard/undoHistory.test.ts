// Unit tests for the PURE undo/redo history ops (BoQ Phase 5 Slice B). Mirrors clipboard.test.ts:
// the React wiring (capture at commitRate/the batch sites, replay via runBatch) is manual-cert; only
// these pure stack ops are unit-tested.
import { describe, it, expect } from "vitest";
import {
  emptyHistory,
  pushEntry,
  popUndo,
  popRedo,
  canUndo,
  canRedo,
  invert,
  HISTORY_MAX,
  type BcsDelta,
  type HistoryEntry,
  type RateDelta,
} from "./undoHistory";

// A tiny delta factory -- the cell args are opaque to the stack logic, so a stub is fine.
const delta = (oldRate: number, newRate: number, col = "D"): RateDelta => ({
  cell: { excelRow: 1, colLetter: col, rateKind: "combined_rate", description: "x" },
  draftKey: `1:${col}`,
  oldRate,
  newRate,
});
const entry = (...ds: RateDelta[]): HistoryEntry => ({ deltas: ds });

describe("emptyHistory / canUndo / canRedo", () => {
  it("starts empty -> nothing to undo or redo", () => {
    const h = emptyHistory();
    expect(h).toEqual({ undo: [], redo: [] });
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });
});

describe("pushEntry", () => {
  it("appends a gesture to undo and enables undo", () => {
    const h = pushEntry(emptyHistory(), entry(delta(0, 5)));
    expect(h.undo).toHaveLength(1);
    expect(canUndo(h)).toBe(true);
  });

  it("keeps a multi-delta gesture as ONE entry (one-gesture-one-entry)", () => {
    const h = pushEntry(emptyHistory(), entry(delta(0, 1), delta(0, 2), delta(0, 3)));
    expect(h.undo).toHaveLength(1);
    expect(h.undo[0].deltas).toHaveLength(3);
  });

  it("is a no-op for an empty-delta gesture (nothing landed)", () => {
    const h0 = emptyHistory();
    const h = pushEntry(h0, entry());
    expect(h).toBe(h0); // same reference -> truly unchanged
    expect(canUndo(h)).toBe(false);
  });

  it("CLEARS the redo stack on a new push", () => {
    // Build a state with something on redo (push -> undo step moves it to redo).
    let h = pushEntry(emptyHistory(), entry(delta(0, 5)));
    const popped = popUndo(h)!;
    h = { undo: popped.state.undo, redo: [...popped.state.redo, popped.entry] };
    expect(canRedo(h)).toBe(true);
    h = pushEntry(h, entry(delta(0, 9)));
    expect(canRedo(h)).toBe(false); // redo wiped by the fresh edit
    expect(h.undo).toHaveLength(1);
  });

  it("caps at HISTORY_MAX, dropping the OLDEST", () => {
    let h = emptyHistory();
    for (let i = 0; i < HISTORY_MAX + 10; i++) h = pushEntry(h, entry(delta(0, i)));
    expect(h.undo).toHaveLength(HISTORY_MAX);
    // oldest dropped -> the first surviving entry is #10, the last is #(MAX+9).
    expect(h.undo[0].deltas[0].newRate).toBe(10);
    expect(h.undo[HISTORY_MAX - 1].deltas[0].newRate).toBe(HISTORY_MAX + 9);
  });

  it("respects a custom max", () => {
    let h = emptyHistory();
    for (let i = 0; i < 5; i++) h = pushEntry(h, entry(delta(0, i)), 3);
    expect(h.undo).toHaveLength(3);
    expect(h.undo[0].deltas[0].newRate).toBe(2); // 0,1 dropped
  });
});

describe("popUndo / popRedo", () => {
  it("popUndo returns the top entry + the reduced undo stack (redo untouched)", () => {
    const h = pushEntry(pushEntry(emptyHistory(), entry(delta(0, 1))), entry(delta(0, 2)));
    const r = popUndo(h)!;
    expect(r.entry.deltas[0].newRate).toBe(2); // newest
    expect(r.state.undo).toHaveLength(1);
    expect(r.state.redo).toEqual([]);
  });

  it("popUndo returns null on an empty undo stack", () => {
    expect(popUndo(emptyHistory())).toBeNull();
  });

  it("popRedo returns the top redo entry + reduced redo (undo untouched)", () => {
    const state = { undo: [entry(delta(0, 1))], redo: [entry(delta(2, 7))] };
    const r = popRedo(state)!;
    expect(r.entry.deltas[0].newRate).toBe(7);
    expect(r.state.redo).toEqual([]);
    expect(r.state.undo).toHaveLength(1);
  });

  it("popRedo returns null on an empty redo stack", () => {
    expect(popRedo(emptyHistory())).toBeNull();
  });

  it("does not mutate the input state", () => {
    const h = pushEntry(emptyHistory(), entry(delta(0, 1)));
    const before = JSON.stringify(h);
    popUndo(h);
    expect(JSON.stringify(h)).toBe(before);
  });
});

describe("invert", () => {
  it("swaps old<->new on every delta", () => {
    const e = entry(delta(3, 9), delta(0, 5));
    const inv = invert(e);
    expect(inv.deltas[0]).toMatchObject({ oldRate: 9, newRate: 3 });
    expect(inv.deltas[1]).toMatchObject({ oldRate: 5, newRate: 0 });
  });

  it("returns a NEW entry, leaving the original untouched (redo can re-push it)", () => {
    const e = entry(delta(3, 9));
    const inv = invert(e);
    expect(inv).not.toBe(e);
    expect(e.deltas[0]).toMatchObject({ oldRate: 3, newRate: 9 }); // original intact
  });

  it("round-trips: invert(invert(e)) === e by value", () => {
    const e = entry(delta(3, 9), delta(1, 2));
    expect(invert(invert(e))).toEqual(e);
  });
});

describe("undo/redo composition (the grid's cross-push, modeled here)", () => {
  it("push -> undo (move to redo) -> redo (move back to undo)", () => {
    let h = pushEntry(emptyHistory(), entry(delta(0, 5)));
    // undo: pop undo, cross-push the ORIGINAL entry onto redo
    const u = popUndo(h)!;
    h = { undo: u.state.undo, redo: [...u.state.redo, u.entry] };
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(true);
    // redo: pop redo, cross-push back onto undo
    const r = popRedo(h)!;
    h = { undo: [...r.state.undo, r.entry], redo: r.state.redo };
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);
    expect(h.undo[0].deltas[0].newRate).toBe(5);
  });
});

// ── BCS-S3a: cost deltas ride the SAME stack ────────────────────────────────────
// Owner ruling 2026-08-02: paste AND undo both work on the cost boxes. "A cost box you cannot
// paste into or undo, one column from a rate box where both work, is the asymmetry people trip
// over." A gesture may touch rates and costs together, so ONE entry carries both lists.
describe("bcsDeltas", () => {
  const bcs = (oldValue: number, newValue: number, field: BcsDelta["field"] = "supply_rate"): BcsDelta => ({
    excelRow: 7,
    field,
    draftKey: `3:${field}`,
    oldValue,
    newValue,
  });

  it("makes an entry with ONLY cost deltas a real entry, not an empty one", () => {
    const h = pushEntry(emptyHistory(), { deltas: [], bcsDeltas: [bcs(0, 100)] });
    expect(h.undo).toHaveLength(1);
    expect(canUndo(h)).toBe(true);
  });

  it("still drops a gesture that wrote nothing at all", () => {
    const h0 = emptyHistory();
    expect(pushEntry(h0, { deltas: [], bcsDeltas: [] })).toBe(h0);
    expect(pushEntry(h0, { deltas: [] })).toBe(h0);
  });

  it("keeps a mixed rate+cost gesture as ONE entry", () => {
    const h = pushEntry(emptyHistory(), { deltas: [delta(0, 5)], bcsDeltas: [bcs(0, 100)] });
    expect(h.undo).toHaveLength(1);
    expect(h.undo[0].deltas).toHaveLength(1);
    expect(h.undo[0].bcsDeltas).toHaveLength(1);
  });

  it("inverts cost deltas alongside the rate ones, leaving the original untouched", () => {
    const e: HistoryEntry = { deltas: [delta(3, 9)], bcsDeltas: [bcs(10, 20), bcs(0, 5, "install_rate")] };
    const inv = invert(e);
    expect(inv.deltas[0]).toMatchObject({ oldRate: 9, newRate: 3 });
    expect(inv.bcsDeltas![0]).toMatchObject({ oldValue: 20, newValue: 10 });
    expect(inv.bcsDeltas![1]).toMatchObject({ oldValue: 5, newValue: 0, field: "install_rate" });
    expect(e.bcsDeltas![0]).toMatchObject({ oldValue: 10, newValue: 20 }); // original intact
  });

  it("round-trips a mixed entry: invert(invert(e)) === e by value", () => {
    const e: HistoryEntry = { deltas: [delta(3, 9)], bcsDeltas: [bcs(10, 20)] };
    expect(invert(invert(e))).toEqual(e);
  });

  it("leaves a rate-only entry's shape byte-identical -- no empty bcsDeltas array minted", () => {
    const e = entry(delta(3, 9));
    expect(invert(e).bcsDeltas).toBeUndefined();
  });
});
