// Unit checks for pricingHitEval.ts (PW-2d v2) -- the EXACT-OR-ABSENT contract.
//
// The evaluator computes a rewritten hit's value from the serialized payload (which already
// carries the materialized helper key/value columns) ONLY when the result is provably identical
// to what the engine would compute; otherwise it abstains (undefined) so the cell stays blank.

import { describe, it, expect } from "vitest";
import { computeHitValueExact } from "./pricingHitEval";

/**
 * A sheet mimicking a post-materialize payload: criteria inputs at J7:J10 (COPPER/ARMOURED/3/2.5),
 * and a helper KEY column W(22) + VALUE column X(23) over rows 2..5. The COPPER|ARMOURED|3|2.5 row
 * carries `matchValue` (default 82.55).
 */
function termLikeSheet(matchValue: number = 82.55) {
	const cd: any[] = [
		{ r: 6, c: 9, v: { v: "COPPER" } }, // J7
		{ r: 7, c: 9, v: { v: "ARMOURED" } }, // J8
		{ r: 8, c: 9, v: { v: 3 } }, // J9
		{ r: 9, c: 9, v: { v: 2.5 } }, // J10
	];
	const rows: [string, number][] = [
		["COPPER|ARMOURED|1|4", 7.956],
		["COPPER|ARMOURED|3|2.5", matchValue],
		["COPPER|ARMOURED|4|6", 11.46],
		["STEEL|XLPE|2|4", 5],
	];
	rows.forEach(([k, v], i) => {
		cd.push({ r: i + 1, c: 22, v: { f: "=key", v: k } }); // W (helper key)
		cd.push({ r: i + 1, c: 23, v: { f: "=val", v } }); // X (helper value)
	});
	return { name: "Term", order: 0, celldata: cd, config: {} };
}

const KEY = 'J7&"|"&J8&"|"&J9&"|"&J10';
const BARE = `=VLOOKUP(${KEY},$W$2:$X$5,2,0)`;

describe("computeHitValueExact -- exact resolutions", () => {
	it("resolves the Termination 82.55 case as a helper-dictionary lookup", () => {
		expect(computeHitValueExact([termLikeSheet()], "Term", BARE)).toBe(82.55);
	});

	it("canonicalizes an untyped '3.0' criterion to match the '3' helper key", () => {
		const s = termLikeSheet();
		s.celldata.find((c) => c.r === 8 && c.c === 9)!.v.v = "3.0" as any; // as LuckyExcel emits
		expect(computeHitValueExact([s], "Term", BARE)).toBe(82.55);
	});

	it("resolves a sheet-qualified helper range too", () => {
		const F = `=VLOOKUP(${KEY},Term!$W$2:$X$5,2,0)`;
		expect(computeHitValueExact([termLikeSheet()], "Term", F)).toBe(82.55);
	});

	it("multiplies the lookup by a resolvable factor exactly", () => {
		const F = `=VLOOKUP(${KEY},$W$2:$X$5,2,0)*2`;
		expect(computeHitValueExact([termLikeSheet(80)], "Term", F)).toBe(160);
	});

	it("applies a ROUNDUP wrapper with literal digits exactly", () => {
		const F = `=ROUNDUP(VLOOKUP(${KEY},$W$2:$X$5,2,0),1)`;
		expect(computeHitValueExact([termLikeSheet(80.04)], "Term", F)).toBe(80.1);
	});
});

describe("computeHitValueExact -- ABSTAINS (never approximates)", () => {
	it("abstains on an IFERROR wrapper (a branch construct)", () => {
		const F = `=IFERROR(VLOOKUP(${KEY},$W$2:$X$5,2,0),"n/a")`;
		expect(computeHitValueExact([termLikeSheet()], "Term", F)).toBeUndefined();
	});

	it("abstains on an unknown function", () => {
		expect(computeHitValueExact([termLikeSheet()], "Term", '=TEXTJOIN(",",1,A1)')).toBeUndefined();
	});

	it("abstains when a referenced criterion cell is missing", () => {
		const s = termLikeSheet();
		s.celldata = s.celldata.filter((c) => !(c.r === 8 && c.c === 9)); // drop J9
		expect(computeHitValueExact([s], "Term", BARE)).toBeUndefined();
	});

	it("abstains when the VLOOKUP key matches no helper row", () => {
		const s = termLikeSheet();
		s.celldata.find((c) => c.r === 8 && c.c === 9)!.v.v = 99 as any; // no ...|99|... key exists
		expect(computeHitValueExact([s], "Term", BARE)).toBeUndefined();
	});

	it("abstains on an approximate-match VLOOKUP (4th arg not 0)", () => {
		const F = `=VLOOKUP(${KEY},$W$2:$X$5,2,1)`;
		expect(computeHitValueExact([termLikeSheet()], "Term", F)).toBeUndefined();
	});

	it("abstains on a comparison operator", () => {
		expect(computeHitValueExact([termLikeSheet()], "Term", "=J7=J8")).toBeUndefined();
	});

	it("returns undefined on an unparseable formula", () => {
		expect(computeHitValueExact([termLikeSheet()], "Term", "=VLOOKUP(")).toBeUndefined();
	});
});
