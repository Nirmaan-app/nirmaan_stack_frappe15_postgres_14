// Unit checks for pricingFormulaScan.ts -- the PW-2a save-time advisory (warn-only).
//
// COVERAGE SUMMARY (each block -> the behavior it protects):
//   supportedFunctionsFromEngine -- the engine registry is trusted only when it is
//     a plausibly-sized object; a missing/small one yields null so the caller skips
//     the unknown-name rule (fail-OPEN, never warn-on-everything).
//   stripQuotedSpans / extractFunctionNames -- only real function CALLS are seen:
//     text inside "..." and sheet names inside '...' are excluded, and bare cell
//     references are never mistaken for calls.
//   scanFormula -- the three rules: INDEX anywhere, the known-absent trio, and any
//     name outside the engine set; plus the negatives that must stay silent.
//   scanWorkbookFormulas -- walks celldata, reports A1 addresses, skips value cells.

import { describe, it, expect } from "vitest";
import {
	cellLabel,
	columnLabel,
	extractFunctionNames,
	scanFormula,
	scanWorkbookFormulas,
	stripQuotedSpans,
	supportedFunctionsFromEngine,
} from "./pricingFormulaScan";

// A stand-in for the engine registry: the real one carries 371 UPPERCASE keys.
const SUPPORTED = supportedFunctionsFromEngine(
	Object.fromEntries(
		[
			"SUM", "VLOOKUP", "INDEX", "MATCH", "IF", "ROUND", "SUMPRODUCT", "AVERAGE",
			"MAX", "MIN", "COUNT", "COUNTA", "COUNTIF", "SUMIF", "ABS", "INT", "MOD",
			"CONCATENATE", "LEFT", "RIGHT", "MID", "LEN", "TRIM", "UPPER", "LOWER",
			"IFERROR", "AND", "OR", "NOT", "TODAY", "NOW", "DATE", "YEAR", "MONTH",
			"DAY", "TEXT", "VALUE", "ROUNDUP", "ROUNDDOWN", "CEILING", "FLOOR",
			"SUBTOTAL", "OFFSET", "INDIRECT", "ROW", "COLUMN", "ROWS", "COLUMNS",
			"HLOOKUP", "LOOKUP", "CHOOSE", "RANK",
		].map((k) => [k, {}])
	)
);

describe("supportedFunctionsFromEngine", () => {
	it("builds an uppercased set from a plausible registry", () => {
		expect(SUPPORTED).toBeInstanceOf(Set);
		expect(SUPPORTED!.has("VLOOKUP")).toBe(true);
		expect(SUPPORTED!.size).toBeGreaterThanOrEqual(50);
	});

	it("uppercases keys that arrive lowercase", () => {
		const many = Object.fromEntries(
			Array.from({ length: 60 }, (_, i) => [`fn${i}`, {}])
		);
		const set = supportedFunctionsFromEngine(many);
		expect(set!.has("FN7")).toBe(true);
	});

	it("returns null for a missing / non-object / implausibly small registry", () => {
		expect(supportedFunctionsFromEngine(undefined)).toBeNull();
		expect(supportedFunctionsFromEngine(null)).toBeNull();
		expect(supportedFunctionsFromEngine("nope")).toBeNull();
		expect(supportedFunctionsFromEngine({ SUM: {}, IF: {} })).toBeNull(); // half-initialised
	});
});

describe("columnLabel / cellLabel", () => {
	it("maps 0-indexed columns to Excel letters", () => {
		expect(columnLabel(0)).toBe("A");
		expect(columnLabel(25)).toBe("Z");
		expect(columnLabel(26)).toBe("AA");
		expect(columnLabel(27)).toBe("AB");
		expect(columnLabel(51)).toBe("AZ");
		expect(columnLabel(52)).toBe("BA");
	});

	it("builds A1 addresses from 0-indexed row/col", () => {
		expect(cellLabel(0, 0)).toBe("A1");
		expect(cellLabel(11, 2)).toBe("C12");
	});
});

describe("stripQuotedSpans", () => {
	it("removes double-quoted string literals", () => {
		expect(stripQuotedSpans('=A1&"INDEX(x)"&B1')).toBe("=A1&&B1");
	});

	it("removes single-quoted sheet-name references", () => {
		expect(stripQuotedSpans("='Sheet (old)'!A1+1")).toBe("=!A1+1");
	});

	it("handles a doubled quote inside a literal", () => {
		expect(stripQuotedSpans('=IF(A1="say ""hi""","y","n")')).toBe("=IF(A1=,,)");
	});

	it("leaves an unquoted formula untouched", () => {
		expect(stripQuotedSpans("=SUM(A1:A5)*2")).toBe("=SUM(A1:A5)*2");
	});
});

describe("extractFunctionNames", () => {
	it("finds calls and uppercases them", () => {
		expect(extractFunctionNames("=sum(A1:A5)+Round(B1,2)")).toEqual(["SUM", "ROUND"]);
	});

	it("de-duplicates, preserving first-appearance order", () => {
		expect(extractFunctionNames("=SUM(A1)+SUM(B1)+IF(C1,1,0)")).toEqual(["SUM", "IF"]);
	});

	it("tolerates a space between the name and the paren", () => {
		expect(extractFunctionNames("=SUM (A1:A5)")).toEqual(["SUM"]);
	});

	it("does NOT treat cell references or range names as calls", () => {
		expect(extractFunctionNames("=A1+B2*C3")).toEqual([]);
		expect(extractFunctionNames("=Rate_Table*2")).toEqual([]);
	});

	it("does NOT read inside quoted spans", () => {
		expect(extractFunctionNames('="INDEX(A1,2)"')).toEqual([]);
		expect(extractFunctionNames("='Sheet (old)'!A1")).toEqual([]);
	});
});

describe("scanFormula -- POSITIVE (must flag)", () => {
	it("flags a bare =INDEX (the honest cheap rule, ENGINE CAUTION #1)", () => {
		const r = scanFormula("=INDEX(A1:A5,2)", SUPPORTED);
		expect(r).toHaveLength(1);
		expect(r[0]).toContain("INDEX()");
		expect(r[0]).toContain("returns 0");
	});

	it("flags INDEX in composition -- the case that silently returns 0", () => {
		expect(scanFormula("=INDEX(A1:A5,2)*2", SUPPORTED)).toHaveLength(1);
	});

	it("flags the known-absent trio", () => {
		expect(scanFormula("=XLOOKUP(A1,B:B,C:C)", SUPPORTED)[0]).toContain("XLOOKUP()");
		expect(scanFormula("=IFS(A1>1,1,A1>0,0)", SUPPORTED)[0]).toContain("IFS()");
		expect(scanFormula("=LET(x,A1,x*2)", SUPPORTED)[0]).toContain("LET()");
	});

	it("flags the trio even with NO supported set (null) -- explicit list still fires", () => {
		expect(scanFormula("=XLOOKUP(A1,B:B,C:C)", null)).toHaveLength(1);
		expect(scanFormula("=INDEX(A1:A5,2)", null)).toHaveLength(1);
	});

	it("flags a function outside the engine set", () => {
		const r = scanFormula("=TEXTJOIN(\",\",TRUE,A1:A5)", SUPPORTED);
		expect(r).toHaveLength(1);
		expect(r[0]).toContain("TEXTJOIN()");
		expect(r[0]).toContain("is not a function the pricing engine recognises");
	});

	it("reports one reason per distinct problem in a compound formula", () => {
		const r = scanFormula("=INDEX(A1:A5,2)+XLOOKUP(B1,C:C,D:D)", SUPPORTED);
		expect(r).toHaveLength(2);
	});
});

describe("scanFormula -- NEGATIVE (must stay silent)", () => {
	it("does NOT flag VLOOKUP -- the sanctioned replacement for INDEX", () => {
		expect(scanFormula("=VLOOKUP(A1,Rates!A:B,2,FALSE)", SUPPORTED)).toEqual([]);
	});

	it("does NOT flag ordinary supported formulas", () => {
		expect(scanFormula("=SUM(A1:A5)*1.18", SUPPORTED)).toEqual([]);
		expect(scanFormula("=IF(A1>0,ROUND(B1*C1,2),0)", SUPPORTED)).toEqual([]);
	});

	it("does NOT flag the word INDEX inside a quoted string", () => {
		expect(scanFormula('="INDEX of items"', SUPPORTED)).toEqual([]);
		expect(scanFormula('=A1&" INDEX "&B1', SUPPORTED)).toEqual([]);
	});

	it("does NOT flag a sheet name that merely contains parentheses", () => {
		expect(scanFormula("='Sheet (old)'!A1*2", SUPPORTED)).toEqual([]);
	});

	it("does NOT flag a plain arithmetic formula with no calls", () => {
		expect(scanFormula("=A1*B1+C1", SUPPORTED)).toEqual([]);
	});

	it("skips the unknown-name rule entirely when no supported set is available", () => {
		// Fail-OPEN: a missing registry must not warn on every formula.
		expect(scanFormula("=TEXTJOIN(\",\",TRUE,A1:A5)", null)).toEqual([]);
	});

	it("ignores empty / non-string input", () => {
		expect(scanFormula("", SUPPORTED)).toEqual([]);
		expect(scanFormula(undefined as any, SUPPORTED)).toEqual([]);
	});
});

describe("scanWorkbookFormulas", () => {
	const sheets = [
		{
			name: "Estimate",
			celldata: [
				{ r: 0, c: 0, v: { v: 12, m: "12" } }, // value cell -- no formula
				{ r: 4, c: 2, v: { f: "=INDEX(A1:A5,2)*2", v: 0 } }, // flagged
				{ r: 5, c: 2, v: { f: "=SUM(A1:A5)", v: 15 } }, // clean
			],
		},
		{
			name: "Rates & Loads",
			celldata: [{ r: 1, c: 27, v: { f: "=XLOOKUP(A1,B:B,C:C)" } }], // flagged
		},
	];

	it("reports only the flagged cells, with A1 addresses and sheet names", () => {
		const hits = scanWorkbookFormulas(sheets, SUPPORTED);
		expect(hits).toHaveLength(2);
		expect(hits[0].sheet).toBe("Estimate");
		expect(hits[0].cell).toBe("C5");
		expect(hits[0].formula).toBe("=INDEX(A1:A5,2)*2");
		expect(hits[1].sheet).toBe("Rates & Loads");
		expect(hits[1].cell).toBe("AB2");
	});

	it("returns an empty array for a clean workbook", () => {
		const clean = [{ name: "S", celldata: [{ r: 0, c: 0, v: { f: "=SUM(A1:A5)" } }] }];
		expect(scanWorkbookFormulas(clean, SUPPORTED)).toEqual([]);
	});

	it("tolerates missing / empty sheets and celldata", () => {
		expect(scanWorkbookFormulas([], SUPPORTED)).toEqual([]);
		expect(scanWorkbookFormulas(undefined as any, SUPPORTED)).toEqual([]);
		expect(scanWorkbookFormulas([{ name: "X" }], SUPPORTED)).toEqual([]);
	});

	it("does not mutate the input workbook", () => {
		const snapshot = JSON.stringify(sheets);
		scanWorkbookFormulas(sheets, SUPPORTED);
		expect(JSON.stringify(sheets)).toBe(snapshot);
	});
});
