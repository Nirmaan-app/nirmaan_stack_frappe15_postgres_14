// Unit checks for pricingDropdownSearch.ts -- the PW-DS type-to-search augmentation.
//
// COVERAGE SUMMARY (each block -> the behavior it protects):
//   filterOptions -- the filter is a case-insensitive substring on the TRIMMED query,
//     returns a mask PARALLEL to the input (same length + order, so the popup only ever
//     hides/shows rows and never re-sorts), empty query = all-true, no-match = all-false,
//     and the negative test pins that it NEVER reorders (mask index i <-> texts index i).
//   nextVisibleIndex -- highlight movement over a sparse visible mask: down/up steps
//     within the visible subset, clamps at both ends, seeds from -1, and returns -1 when
//     nothing is visible (the empty-list guard).
//
// The DOM installer (installDropdownSearch) is covered by the live matrix, not here --
// its behavior is entirely in the vendored engine's live DOM (focus retention, the
// mousedown-cancel dismissal exemption, delegated-click write-through, the open-detecting
// MutationObserver), none of which a jsdom stub can faithfully reproduce.

import { describe, it, expect } from "vitest";
import { filterOptions, nextVisibleIndex } from "./pricingDropdownSearch";

const OPTS = ["40A FP MCCB", "63A FP MCCB", "25A RCCB 30mA (FP)", "Wire", "wire mesh"];

describe("filterOptions", () => {
	it("is case-insensitive", () => {
		expect(filterOptions(OPTS, "mccb")).toEqual([true, true, false, false, false]);
		expect(filterOptions(OPTS, "MCCB")).toEqual([true, true, false, false, false]);
		expect(filterOptions(OPTS, "McCb")).toEqual([true, true, false, false, false]);
	});

	it("matches on substring anywhere, not just prefix", () => {
		// "rccb" is mid-string in only the 3rd option.
		expect(filterOptions(OPTS, "rccb")).toEqual([false, false, true, false, false]);
		// "wire" appears as a prefix AND mid-string.
		expect(filterOptions(OPTS, "wire")).toEqual([false, false, false, true, true]);
	});

	it("empty query matches everything", () => {
		expect(filterOptions(OPTS, "")).toEqual([true, true, true, true, true]);
	});

	it("trims whitespace (a blank/whitespace query is treated as empty)", () => {
		expect(filterOptions(OPTS, "   ")).toEqual([true, true, true, true, true]);
		// Leading/trailing spaces around a real token are trimmed, so it still matches.
		expect(filterOptions(OPTS, "  mccb  ")).toEqual([true, true, false, false, false]);
	});

	it("no match yields all-false", () => {
		expect(filterOptions(OPTS, "zzzz")).toEqual([false, false, false, false, false]);
	});

	it("preserves order and length: the mask is parallel to the input, never reordered", () => {
		const mask = filterOptions(OPTS, "wire");
		expect(mask).toHaveLength(OPTS.length);
		// The two matches stay at their ORIGINAL indices (3 and 4) -- a reorder would
		// move them to the front.
		expect(mask.map((m, i) => (m ? i : -1)).filter((i) => i >= 0)).toEqual([3, 4]);
	});

	it("negative: does not sort or dedupe -- identical inputs keep identical mask positions", () => {
		const dupes = ["b", "a", "b", "a"];
		expect(filterOptions(dupes, "a")).toEqual([false, true, false, true]);
	});

	it("handles an empty option list", () => {
		expect(filterOptions([], "x")).toEqual([]);
		expect(filterOptions([], "")).toEqual([]);
	});
});

describe("nextVisibleIndex", () => {
	// Sparse mask: visible indices are 1, 3, 4.
	const mask = [false, true, false, true, true];

	it("moves down over the visible subset", () => {
		expect(nextVisibleIndex(1, 1, mask)).toBe(3); // 1 -> next visible 3
		expect(nextVisibleIndex(3, 1, mask)).toBe(4); // 3 -> next visible 4
	});

	it("moves up over the visible subset", () => {
		expect(nextVisibleIndex(4, -1, mask)).toBe(3);
		expect(nextVisibleIndex(3, -1, mask)).toBe(1);
	});

	it("clamps at the bottom end", () => {
		expect(nextVisibleIndex(4, 1, mask)).toBe(4); // already last visible
	});

	it("clamps at the top end", () => {
		expect(nextVisibleIndex(1, -1, mask)).toBe(1); // already first visible
	});

	it("seeds from -1: down goes to the first visible, up to the last", () => {
		expect(nextVisibleIndex(-1, 1, mask)).toBe(1);
		expect(nextVisibleIndex(-1, -1, mask)).toBe(4);
	});

	it("seeds when current is a now-hidden index", () => {
		// current=2 is not visible; down seeds first visible, up seeds last visible.
		expect(nextVisibleIndex(2, 1, mask)).toBe(1);
		expect(nextVisibleIndex(2, -1, mask)).toBe(4);
	});

	it("returns -1 when nothing is visible", () => {
		expect(nextVisibleIndex(0, 1, [false, false, false])).toBe(-1);
		expect(nextVisibleIndex(-1, -1, [false, false, false])).toBe(-1);
		expect(nextVisibleIndex(2, 1, [])).toBe(-1);
	});

	it("single visible item: both directions clamp to it", () => {
		const one = [false, false, true, false];
		expect(nextVisibleIndex(2, 1, one)).toBe(2);
		expect(nextVisibleIndex(2, -1, one)).toBe(2);
		expect(nextVisibleIndex(-1, 1, one)).toBe(2);
	});
});
