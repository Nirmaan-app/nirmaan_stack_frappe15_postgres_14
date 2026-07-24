// Unit checks for pricingTransforms.ts + pricingHelpers.ts + pricingClamp.ts (PW-2b-i).
//
// COVERAGE SUMMARY (each block -> the behavior it protects):
//   multi-cond INDEX/MATCH -- the 33-cell class: becomes a composite-key VLOOKUP
//     against a requested helper pair, wrappers and multipliers preserved exactly.
//   single-cond INDEX/MATCH -- direct VLOOKUP when the lookup column is LEFT of the
//     result column (the corpus case), helper pair when it is not.
//   IFS  -- nested IF; trailing TRUE becomes the else, no default becomes NA().
//   LET  -- inline substitution, including a binding referenced twice and a later
//     binding that references an earlier one.
//   XLOOKUP -- direct VLOOKUP by geometry; 4th arg becomes IFERROR; >4 args abstain.
//   freeze -- DUMMYFUNCTION / IMPORTRANGE drop their formula and keep the cached
//     value, and the IMPORTRANGE review note is attached.
//   ABSTAIN -- array literals and unparseable text are declined, never guessed, and
//     the original formula is left untouched.
//   helpers -- _mk marker, key/value formulas, colhidden, and IDEMPOTENCY.
//   clamp -- ELV-shaped bloat collapses; a clamped sheet is unchanged by a re-run.
//
// Formula fixtures are REAL text from the PW-2b recon census.

import { describe, it, expect } from "vitest";
import {
	HelperAllocator,
	detectDeadGoogle,
	finalizeReport,
	emptyReport,
	maxColsBySheet,
	runFormulaStage,
	transformFormula,
	transformSheets,
} from "./pricingTransforms";
import { HELPER_MARKER, materializeHelpers, sheetHasHelpers } from "./pricingHelpers";
import { clampRowBloat, countCells, lastContentRow } from "./pricingClamp";
import { parseFormula } from "./pricingFormulaAst";
import {
	FIXTURE_ARRAY_LITERAL,
	FIXTURE_DUMMY_IMPORTRANGE,
	FIXTURE_ELV_MULTI,
	FIXTURE_IFS_NESTED_ARRAY,
	FIXTURE_INDEX_MATCH_SINGLE,
	FIXTURE_LET,
	FIXTURE_XLOOKUP,
	FIXTURE_Z10_OFF_BY_ONE,
} from "./__fixtures__/corpusFormulas";

const alloc = () => new HelperAllocator({ "Wiring & cabling": 20, Extinguishers: 12, "Point Wiring ": 28, Ducting: 13, "Industrial Sockets": 11 });

const rewrite = (src: string, a = alloc()) => {
	const out = transformFormula(src, a);
	if (out.status !== "rewritten") throw new Error(`expected rewrite, got ${out.status}`);
	return out;
};

const SRC_MULTI =
	"=INDEX('Wiring & cabling'!F2:F293, MATCH(1, ('Wiring & cabling'!A2:A293='ALL ITEM WISE RATE'!V9)*('Wiring & cabling'!B2:B293='ALL ITEM WISE RATE'!V10), 0))";

describe("(a) multi-condition array INDEX/MATCH", () => {
	it("becomes a composite-key VLOOKUP against a helper pair", () => {
		const out = rewrite(SRC_MULTI);
		expect(out.classes).toContain("index-match-multi");
		// last used column is index 20 (U); V is the spacer, so helpers land at W/X
		// (the maxCol + 2 rule).
		expect(out.formula).toBe(
			"=VLOOKUP('ALL ITEM WISE RATE'!V9&\"|\"&'ALL ITEM WISE RATE'!V10,'Wiring & cabling'!$W$2:$X$293,2,0)"
		);
		expect(out.helpers).toEqual(["Wiring & cabling!W:X"]);
	});

	it("preserves the surrounding wrapper and multiplier exactly", () => {
		const out = rewrite(`=CEILING(${SRC_MULTI.slice(1)} * (1 + 0.1), 5)`);
		expect(out.formula.startsWith("=CEILING(VLOOKUP(")).toBe(true);
		expect(out.formula.endsWith("*(1+0.1),5)")).toBe(true);
	});

	it("handles the real ELV three-condition cell", () => {
		const out = rewrite(FIXTURE_ELV_MULTI);
		expect(out.classes).toContain("index-match-multi");
		// three criteria -> two "|" separators in the key
		expect(out.formula.match(/&"\|"&/g)).toHaveLength(2);
		// the trailing VLOOKUP(B7,...) and CEILING wrapper survive untouched
		expect(out.formula).toContain("VLOOKUP(B7,Extinguishers!J3:K7,2,FALSE)");
		expect(out.formula.startsWith("=CEILING(")).toBe(true);
	});

	it("reuses ONE helper pair for two cells hitting the same table", () => {
		const a = alloc();
		const first = transformFormula(SRC_MULTI, a);
		const second = transformFormula(SRC_MULTI, a);
		expect(first.status).toBe("rewritten");
		expect(second.status).toBe("rewritten");
		expect(a.ledger()).toHaveLength(1);
	});

	it("ABSTAINS when a criterion range is on a different sheet", () => {
		const bad =
			"=INDEX('Wiring & cabling'!F2:F293, MATCH(1, (Other!A2:A293=V9)*('Wiring & cabling'!B2:B293=V10), 0))";
		const out = transformFormula(bad, alloc());
		expect(out.status).toBe("abstain");
	});
});

describe("(a2) criterion-range harmonization (owner-directed)", () => {
	it("emits ,0) and never ,FALSE) -- the engine returns #NAME? for boolean literals", () => {
		const out = rewrite(SRC_MULTI);
		expect(out.formula).toContain(",2,0)");
		expect(out.formula).not.toMatch(/FALSE/i);
		// the direct-VLOOKUP path too
		expect(rewrite(FIXTURE_INDEX_MATCH_SINGLE).formula).toContain(",2,0)");
		expect(rewrite(FIXTURE_XLOOKUP).formula).toContain(",4,0)");
	});

	it("pulls an off-by-one criterion range onto the consensus span and rewrites", () => {
		const out = rewrite(FIXTURE_Z10_OFF_BY_ONE, new HelperAllocator({ Termination: 20 }));
		expect(out.classes).toEqual(expect.arrayContaining(["harmonized", "index-match-multi"]));
		expect(out.note).toContain("Termination!B2:B97 -> Termination!B2:B96");
		expect(out.note).toContain("off-by-1 harmonized to consensus");
		// both branches rewritten; no INDEX/MATCH left anywhere in the cell
		expect(out.formula).not.toContain("INDEX(");
		expect(out.formula).not.toContain("MATCH(");
		expect(out.formula).toBe(
			// seeded maxCol 20 (U) -> V spacer -> first pair W/X, second pair Y/Z.
			// Both generated lookups sit in IF branches, so both are IFERROR-wrapped
			// (defect 5); the author's own `""` else is preserved verbatim.
			'=IF(V12<=25,IFERROR(VLOOKUP(V9&"|"&V10&"|"&V11&"|"&V12,Termination!$W$2:$X$96,2,0),"n/a"),' +
				'IF(V12>=35,IFERROR(VLOOKUP(V9&"|"&V10&"|"&V11&"|"&V12,Termination!$Y$97:$Z$297,2,0),"n/a"),""))'
		);
	});

	it("harmonizes a 2-row outlier but ABSTAINS at 3", () => {
		const mk = (end: number) =>
			`=INDEX(T!D2:D50, MATCH(1,(T!A2:A50=X1)*(T!B2:B${end}=X2)*(T!C2:C50=X3),0))`;
		expect(transformFormula(mk(52), alloc()).status).toBe("rewritten");
		expect(transformFormula(mk(53), alloc()).status).toBe("abstain");
	});

	it("ABSTAINS when the ranges have no majority (a tie)", () => {
		// one criterion + one result, each a different span -> 1 vs 1, no majority
		const tied = "=INDEX(T!C2:C50, MATCH(1,(T!A2:A51=X1),0))";
		const out = transformFormula(tied, alloc());
		expect(out.status).toBe("abstain");
		if (out.status === "abstain") expect(out.reason).toMatch(/no majority/);
	});

	it("ABSTAINS when an outlier differs in its START row, not just its end", () => {
		const bad = "=INDEX(T!D2:D50, MATCH(1,(T!A2:A50=X1)*(T!B3:B50=X2)*(T!C2:C50=X3),0))";
		expect(transformFormula(bad, alloc()).status).toBe("abstain");
	});
});

describe("(b) single-condition INDEX/MATCH", () => {
	it("becomes a DIRECT VLOOKUP when the lookup column is left of the result", () => {
		const out = rewrite(FIXTURE_INDEX_MATCH_SINGLE);
		expect(out.classes).toContain("index-match-single");
		// B -> C is offset 2; the "* J43" tail is preserved
		expect(out.formula).toBe(
			"=VLOOKUP(I41,'Industrial Sockets'!B26:C97,2,0)*J43"
		);
		expect(out.helpers).toEqual([]);
	});

	it("uses a helper pair when the result column is LEFT of the lookup column", () => {
		const out = rewrite("=INDEX(Ducting!C7:C12, MATCH(B165, Ducting!F7:F12, 0))");
		expect(out.helpers).toHaveLength(1);
		expect(out.formula).toContain(",2,0)");
	});
});

describe("(c) IFS -> nested IF", () => {
	it("nests conditions and defaults to NA() when there is no TRUE branch", () => {
		const out = rewrite('=IFS(A1=1,"one",A1=2,"two")');
		expect(out.classes).toContain("ifs");
		expect(out.formula).toBe('=IF(A1=1,"one",IF(A1=2,"two",NA()))');
	});

	it("uses a trailing TRUE branch as the else", () => {
		const out = rewrite('=IFS(A1=1,"one",TRUE,"other")');
		expect(out.formula).toBe('=IF(A1=1,"one","other")');
	});

	it("rewrites the real cell whose branches are each an array INDEX/MATCH", () => {
		const out = rewrite(FIXTURE_IFS_NESTED_ARRAY);
		expect(out.classes).toEqual(expect.arrayContaining(["ifs", "index-match-multi"]));
		expect(out.formula.startsWith('=IF(O39="Wire",IFERROR(VLOOKUP(')).toBe(true);
		expect(out.formula).toContain("NA()");
		expect(out.formula).toContain("*R49");
		expect(out.formula).not.toContain("INDEX(");
		expect(out.formula).not.toContain("MATCH(");
	});

	it("ABSTAINS on an odd argument count", () => {
		expect(transformFormula('=IFS(A1=1,"one",A1=2)', alloc()).status).toBe("abstain");
	});

	it("IFERROR-wraps generated lookups inside IF branches (defect 5), exact output", () => {
		// The engine evaluates ALL IF branches and propagates any branch error, so an
		// untaken branch whose lookup misses would poison the cell. A TEXT fallback
		// cannot -- and a miss in the TAKEN branch still shows the user "n/a".
		// The token must NOT be error-spelled: the engine coerces "#N/A" back into the
		// #N/A error (ISTEXT("#N/A") === false), which re-poisons the IF.
		const out = rewrite(
			'=IFS(A1=1,INDEX(R!C2:C9,MATCH(1,(R!A2:A9=X1)*(R!B2:B9=X2),0)),TRUE,0)',
			new HelperAllocator({ R: 2 })
		);
		expect(out.formula).toBe(
			'=IF(A1=1,IFERROR(VLOOKUP(X1&"|"&X2,R!$E$2:$F$9,2,0),"n/a"),0)'
		);
	});

	it("does NOT wrap a STANDALONE generated lookup (stays honest)", () => {
		const out = rewrite(FIXTURE_INDEX_MATCH_SINGLE);
		expect(out.formula).not.toContain("IFERROR");
		const multi = rewrite(SRC_MULTI);
		expect(multi.formula).not.toContain("IFERROR");
		const xl = rewrite(FIXTURE_XLOOKUP);
		expect(xl.formula).not.toContain("IFERROR");
	});
});

describe("(d) LET -> inline", () => {
	it("inlines a single binding", () => {
		const out = rewrite("=LET(x, A1*2, x+1)");
		expect(out.classes).toContain("let");
		expect(out.formula).toBe("=A1*2+1");
	});

	it("inlines a binding referenced TWICE", () => {
		const out = rewrite("=LET(r, A1, IF(r=0, 5, r))");
		expect(out.formula).toBe("=IF(A1=0,5,A1)");
	});

	it("lets a later binding reference an earlier one", () => {
		const out = rewrite("=LET(a, A1, b, a*2, b+1)");
		expect(out.formula).toBe("=A1*2+1");
	});

	it("rewrites the real LET cell, and its inner array lookup becomes a VLOOKUP FIRST", () => {
		const out = rewrite(FIXTURE_LET);
		expect(out.classes).toEqual(expect.arrayContaining(["let", "index-match-multi"]));
		expect(out.formula).not.toContain("LET(");
		expect(out.formula).not.toContain("INDEX(");
		// `rate` is used twice, so the (now cheap) VLOOKUP appears twice
		expect(out.formula.match(/VLOOKUP\(/g)).toHaveLength(2);
		expect(out.formula.startsWith("=ROUND(")).toBe(true);
	});

	it("ABSTAINS on an even argument count (no body)", () => {
		expect(transformFormula("=LET(x, 1)", alloc()).status).toBe("abstain");
	});
});

describe("(e) XLOOKUP -> VLOOKUP", () => {
	it("rewrites the real HVAC cell by geometry (C -> F is offset 4)", () => {
		const out = rewrite(FIXTURE_XLOOKUP);
		expect(out.classes).toContain("xlookup");
		expect(out.formula).toBe(
			"=(2*((B166/1000)+(B167/1000))*(B168/1000))*VLOOKUP(B165,Ducting!C7:F12,4,0)"
		);
		expect(out.helpers).toEqual([]);
	});

	it("wraps a 4th if-not-found argument in IFERROR", () => {
		const out = rewrite('=XLOOKUP(B165,Ducting!C7:C12,Ducting!F7:F12,"n/a")');
		expect(out.formula).toBe('=IFERROR(VLOOKUP(B165,Ducting!C7:F12,4,0),"n/a")');
	});

	it("ABSTAINS on match-mode / search-mode arguments", () => {
		const out = transformFormula("=XLOOKUP(B165,Ducting!C7:C12,Ducting!F7:F12,0,2)", alloc());
		expect(out.status).toBe("abstain");
	});
});

describe("dead-Google freeze", () => {
	it("detects DUMMYFUNCTION and attaches the IMPORTRANGE review note", () => {
		const out = transformFormula(FIXTURE_DUMMY_IMPORTRANGE, alloc());
		expect(out.status).toBe("freeze");
		if (out.status !== "freeze") return;
		expect(out.classes).toEqual(["frozen"]);
		expect(out.note).toBe("IMPORTRANGE fallback literal -- review");
	});

	it("detects a bare IMPORTRANGE as code", () => {
		const p = parseFormula('=IMPORTRANGE("url","A1:B2")');
		expect(p.ok).toBe(true);
		if (p.ok) expect(detectDeadGoogle(p.ast).freeze).toBe(true);
	});

	it("does NOT freeze an ordinary formula that merely MENTIONS the words", () => {
		const out = transformFormula('=A1&"see IMPORTRANGE docs"', alloc());
		expect(out.status).toBe("unchanged");
	});

	it("drops the formula but keeps the cached value on the cell", () => {
		const sheets = [
			{ name: "S", celldata: [{ r: 3, c: 1, v: { f: FIXTURE_DUMMY_IMPORTRANGE, v: "Sprinkler" } }] },
		];
		const res = transformSheets(sheets, alloc());
		expect(res.frozen).toHaveLength(1);
		expect(sheets[0].celldata[0].v.f).toBeUndefined();
		expect(sheets[0].celldata[0].v.v).toBe("Sprinkler");
	});
});

describe("ABSTAIN leaves the formula untouched", () => {
	it("declines an inline array literal (no proven rewrite)", () => {
		const out = transformFormula(FIXTURE_ARRAY_LITERAL, alloc());
		expect(out.status).toBe("abstain");
	});

	it("declines unparseable text instead of throwing", () => {
		expect(transformFormula("=SUM(", alloc()).status).toBe("abstain");
	});

	it("does not modify the cell when abstaining", () => {
		const original = FIXTURE_ARRAY_LITERAL;
		const sheets = [{ name: "S", celldata: [{ r: 3, c: 2, v: { f: original, v: 300 } }] }];
		const res = transformSheets(sheets, alloc());
		expect(res.abstained).toHaveLength(1);
		expect(sheets[0].celldata[0].v.f).toBe(original);
	});

	it("leaves an ordinary VLOOKUP formula alone", () => {
		expect(
			transformFormula("=VLOOKUP(I9,'DB & Switchgear'!A23:B30,2,FALSE)*1.5", alloc()).status
		).toBe("unchanged");
	});
});

describe("helper materialization", () => {
	const build = () => {
		const sheets: any[] = [
			{
				name: "Rates",
				celldata: [
					{ r: 0, c: 0, v: { v: "Item" } },
					{ r: 1, c: 0, v: { v: "A" } },
					{ r: 1, c: 1, v: { v: "White" } },
					{ r: 1, c: 2, v: { v: 100 } },
					{ r: 2, c: 0, v: { v: "B" } },
					{ r: 2, c: 1, v: { v: "Grey" } },
					{ r: 2, c: 2, v: { v: 200 } },
				],
				config: {},
			},
			{
				name: "Calc",
				celldata: [
					{ r: 0, c: 0, v: { f: "=INDEX(Rates!C2:C3, MATCH(1,(Rates!A2:A3=X1)*(Rates!B2:B3=X2),0))" } },
				],
				config: {},
			},
		];
		return sheets;
	};

	it("writes _mk markers, key/value formulas and hides the pair", () => {
		const sheets = build();
		const res = runFormulaStage(sheets);
		expect(res.helpers).toHaveLength(1);
		const rec = res.helpers[0];
		expect(rec.sheet).toBe("Rates");
		expect(rec.reused).toBe(false);

		const rates = sheets[0];
		const at = (r: number, c: number) => rates.celldata.find((x: any) => x.r === r && x.c === c)?.v;
		// data rows are 2..3 (1-based) -> marker sits on row 1 (0-indexed 0)
		expect(at(0, 4)?.v).toBe(HELPER_MARKER);
		expect(at(1, 4)?.f).toBe('=A2&"|"&B2');
		expect(at(1, 5)?.f).toBe("=C2");
		expect(at(2, 4)?.f).toBe('=A3&"|"&B3');
		expect(rates.config.colhidden).toHaveProperty("4");
		expect(rates.config.colhidden).toHaveProperty("5");
		expect(sheetHasHelpers(rates)).toBe(true);
	});

	it("allocates the pair beyond the last used column (maxCol + 2)", () => {
		const sheets = build();
		expect(maxColsBySheet(sheets).Rates).toBe(2); // C
		runFormulaStage(sheets);
		// C(2) + 2 = E(4), F(5)
		expect(sheets[0].config.colhidden).toEqual({ 4: 0, 5: 0 });
	});

	it("IDEMPOTENT: a second full run adds no helpers and no transforms", () => {
		const sheets = build();
		const first = runFormulaStage(sheets);
		expect(first.transforms).toHaveLength(1);
		expect(first.helpers.filter((h) => !h.reused)).toHaveLength(1);

		const second = runFormulaStage(sheets);
		expect(second.transforms).toHaveLength(0); // no INDEX/MATCH remains
		expect(second.helpers.filter((h) => !h.reused)).toHaveLength(0);
		expect(second.abstained).toHaveLength(0);
	});

	it("writes a cached VALUE beside every helper formula (defect 3)", () => {
		// The engine never evaluates formulas at LOAD -- it renders the cached value
		// (FR-6). A helper shipped as a bare formula reads blank and every VLOOKUP
		// against it returns #N/A. Both f AND v must be present.
		const sheets = build();
		runFormulaStage(sheets);
		const rates = sheets[0];
		const at = (r: number, c: number) => rates.celldata.find((x: any) => x.r === r && x.c === c)?.v;

		expect(at(1, 4)).toMatchObject({ f: '=A2&"|"&B2', v: "A|White", m: "A|White" });
		expect(at(2, 4)).toMatchObject({ f: '=A3&"|"&B3', v: "B|Grey" });
		expect(at(1, 5)).toMatchObject({ f: "=C2", v: 100 });
		expect(at(2, 5)).toMatchObject({ f: "=C3", v: 200 });
	});

	it("canonicalizes numeric criteria by SHAPE, never by ct.t (defect 4)", () => {
		// CORPUS FACT: LuckyExcel emits numeric cells as UNTYPED STRINGS -- {v:"1.0"}
		// with no ct.t === "n". The engine normalizes them to 1 on load, so a key built
		// verbatim ("...|1.0|...") never matches the engine's runtime key ("...|1|...").
		// Canonicalization must therefore key off the value's SHAPE. A ct.t-based guard
		// silently does nothing here -- that was the failed first attempt.
		const mk = (a: any, b: any) => [
			{
				name: "Rates",
				celldata: [
					{ r: 1, c: 0, v: { v: a } }, // NOTE: no ct at all, as converted
					{ r: 1, c: 1, v: { v: b } },
					{ r: 1, c: 2, v: { v: 82.55 } },
				],
				config: {},
			},
			{
				name: "Calc",
				celldata: [
					{ r: 0, c: 0, v: { f: "=INDEX(Rates!C2:C2, MATCH(1,(Rates!A2:A2=X1)*(Rates!B2:B2=X2),0))" } },
				],
				config: {},
			},
		];
		const keyOf = (a: any, b: any) => {
			const sheets: any[] = mk(a, b);
			runFormulaStage(sheets);
			return sheets[0].celldata.find((c: any) => c.r === 1 && c.c === 4)?.v?.v;
		};

		expect(keyOf("1.0", "COPPER")).toBe("1|COPPER"); // untyped "1.0" collapses
		expect(keyOf("1.50", "COPPER")).toBe("1.5|COPPER"); // trailing zero dropped
		expect(keyOf(4, "COPPER")).toBe("4|COPPER"); // real number
		expect(keyOf("82.55", "COPPER")).toBe("82.55|COPPER"); // decimals kept
		expect(keyOf("007", "COPPER")).toBe("007|COPPER"); // TEXT CODE preserved
		expect(keyOf("1-2", "COPPER")).toBe("1-2|COPPER"); // not numeric-shaped
		expect(keyOf("ARMOURED", "COPPER")).toBe("ARMOURED|COPPER"); // plain text
	});

	it("yields an EMPTY key (not a partial one) when a source cell has no value", () => {
		// The corpus has 10 formula-without-value cells. A half-built key could match the
		// WRONG row, so the whole key is left empty -- it fails visibly instead.
		const sheets = build();
		// B3 becomes an unevaluated formula: no value to read.
		const b3 = sheets[0].celldata.find((c: any) => c.r === 2 && c.c === 1);
		b3.v = { f: "=SOMETHING()" };
		expect(() => runFormulaStage(sheets)).not.toThrow();

		const rates = sheets[0];
		const at = (r: number, c: number) => rates.celldata.find((x: any) => x.r === r && x.c === c)?.v;
		expect(at(2, 4)).toMatchObject({ f: '=A3&"|"&B3', v: "" }); // empty, not "B|"
		expect(at(1, 4)?.v).toBe("A|White"); // the healthy row is unaffected
	});

	it("writes EVERY pair when one sheet needs several (regression)", () => {
		// The real Electrical import requests 4 pairs on 'Switches & Sockets' and 6 on
		// 'Point Wiring '. A per-record idempotency check wrote only the FIRST pair per
		// sheet -- the marker it had just stamped made every later pair look
		// pre-existing -- while the rewritten formulas still referenced the missing
		// columns. Caught in a live Tier-3 run; this pins the fix.
		const sheets: any[] = [
			{
				name: "Rates",
				celldata: [
					{ r: 1, c: 0, v: { v: "A" } }, { r: 1, c: 1, v: { v: "White" } }, { r: 1, c: 2, v: { v: 100 } },
					{ r: 1, c: 3, v: { v: "X" } }, { r: 1, c: 4, v: { v: "Grey" } }, { r: 1, c: 5, v: { v: 200 } },
				],
				config: {},
			},
			{
				name: "Calc",
				celldata: [
					{ r: 0, c: 0, v: { f: "=INDEX(Rates!C2:C3, MATCH(1,(Rates!A2:A3=X1)*(Rates!B2:B3=X2),0))" } },
					// a DIFFERENT table on the same sheet -> a second, distinct pair
					{ r: 1, c: 0, v: { f: "=INDEX(Rates!F2:F3, MATCH(1,(Rates!D2:D3=X1)*(Rates!E2:E3=X2),0))" } },
				],
				config: {},
			},
		];
		const res = runFormulaStage(sheets);
		expect(res.helpers).toHaveLength(2);
		expect(res.helpers.filter((h) => !h.reused)).toHaveLength(2);

		const rates = sheets[0];
		for (const rec of res.helpers) {
			const keyIdx = rec.keyCol.charCodeAt(0) - 65;
			const wrote = rates.celldata.filter((c: any) => c.c === keyIdx && c.v?.f);
			expect(wrote.length).toBeGreaterThan(0); // every pair got real formulas
		}
		// both pairs hidden, i.e. 4 columns
		expect(Object.keys(rates.config.colhidden)).toHaveLength(4);
	});

	it("skips a sheet that already carries the _mk marker", () => {
		const sheets = build();
		sheets[0].celldata.push({ r: 0, c: 9, v: { v: HELPER_MARKER } });
		const written = materializeHelpers(sheets, [
			{
				sheet: "Rates", keyCol: "E", valCol: "F", rowStart: 2, rowEnd: 3,
				criteriaCols: ["A", "B"], resultCol: "C", keyFormulaSample: "", reused: false,
			},
		]);
		expect(written[0].reused).toBe(true);
		expect(sheets[0].config.colhidden).toBeUndefined();
	});
});

describe("row clamp", () => {
	const bloated = () => {
		const celldata: any[] = [];
		for (let r = 0; r <= 25; r++) celldata.push({ r, c: 0, v: { v: `row${r}` } });
		// 3000 rows of style-only filler, exactly the shape LuckyExcel emits
		for (let r = 26; r <= 3025; r++) {
			for (let c = 0; c < 3; c++) {
				celldata.push({ r, c, v: { ct: { fa: "General" }, fc: "#000000", ff: "Calibri", fs: 10, ht: 0, tb: 2, vt: 0 } });
			}
		}
		return [{ name: "FA_System with  Markup", celldata, row: 3026, config: { rowlen: { 30: 20, 3000: 20 } } }];
	};

	it("collapses filler beyond the last content row (+5 buffer)", () => {
		const sheets = bloated();
		expect(countCells(sheets)).toBe(26 + 3000 * 3);
		expect(lastContentRow(sheets[0])).toBe(25);
		const recs = clampRowBloat(sheets);
		expect(recs).toHaveLength(1);
		// rows 0..30 survive (25 + 5 buffer)
		const maxRow = Math.max(...sheets[0].celldata.map((c: any) => c.r));
		expect(maxRow).toBe(30);
		expect(sheets[0].row).toBe(31);
		expect(recs[0].cellsDropped).toBeGreaterThan(8900);
	});

	it("prunes row-keyed config maps so the bloat cannot return on load", () => {
		const sheets = bloated();
		clampRowBloat(sheets);
		expect(sheets[0].config.rowlen).toHaveProperty("30");
		expect(sheets[0].config.rowlen).not.toHaveProperty("3000");
	});

	it("IDEMPOTENT: re-clamping an already-clamped sheet drops nothing", () => {
		const sheets = bloated();
		clampRowBloat(sheets);
		const again = clampRowBloat(sheets);
		expect(again).toHaveLength(0);
	});

	it("leaves a compact sheet completely untouched", () => {
		const sheets = [{ name: "S", celldata: [{ r: 0, c: 0, v: { v: 1 } }] }];
		expect(clampRowBloat(sheets)).toHaveLength(0);
		expect(sheets[0].celldata).toHaveLength(1);
	});
});

describe("report finalization", () => {
	it("rolls up counts and per-sheet tallies", () => {
		const sheets = [
			{ name: "Calc", celldata: [
				{ r: 0, c: 0, v: { f: '=IFS(A1=1,"a",A1=2,"b")' } },
				{ r: 1, c: 0, v: { f: FIXTURE_ARRAY_LITERAL } },
				{ r: 2, c: 0, v: { f: FIXTURE_DUMMY_IMPORTRANGE, v: "Sprinkler" } },
			] },
		];
		const report = emptyReport();
		const res = runFormulaStage(sheets);
		Object.assign(report, res);
		finalizeReport(report);
		expect(report.counts.ifs).toBe(1);
		expect(report.counts.frozen).toBe(1);
		expect(report.counts.abstained).toBe(1);
		expect(report.perSheet.Calc).toEqual({ transforms: 1, frozen: 1, abstained: 1 });
	});
});
