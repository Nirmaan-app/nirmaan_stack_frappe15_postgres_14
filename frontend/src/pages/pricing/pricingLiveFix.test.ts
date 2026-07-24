// Unit checks for pricingLiveFix.ts (PW-2b-ii) -- the ELIGIBILITY rule.
//
// COVERAGE SUMMARY:
//   fixable  -- IFS, LET, XLOOKUP, and a direct single-cond INDEX/MATCH all rewrite
//               with ZERO helper requests, so all are fixable in place; the rewritten
//               string is returned for the live setCellValue.
//   deferred -- multi-cond INDEX/MATCH and a result-left-of-lookup single-cond both
//               request a helper pair -> not fixable, reason "needs helper columns".
//   no fix   -- an unknown function and a bare INDEX (no MATCH) parse fine but have no
//               sanctioned rewrite -> reason "no sanctioned rewrite".
//   freeze   -- a dead-Google cell is fixable via the freeze path (drop f, keep value).
//   abstain  -- an inline array literal is declined with the transform's own reason.
//
// assessFix is PURE (no engine); applyLiveFix is engine-bound and is exercised in the
// live Tier-3 run, not here.

import { describe, it, expect } from "vitest";
import {
	REASON_NEEDS_HELPER,
	REASON_NO_REWRITE,
	applyHelperFixesOffline,
	applyLiveFix,
	assessFix,
	planHelperFixes,
} from "./pricingLiveFix";
import { materializeHelpers, sheetHasHelpers } from "./pricingHelpers";
import type { HelperRecord } from "./pricingTransforms";
import {
	FIXTURE_ARRAY_LITERAL,
	FIXTURE_DUMMY_IMPORTRANGE,
	FIXTURE_INDEX_MATCH_SINGLE,
	FIXTURE_XLOOKUP,
} from "./__fixtures__/corpusFormulas";

describe("assessFix -- FIXABLE in place (zero helper requests)", () => {
	it("an IFS is fixable and returns the nested-IF rewrite", () => {
		const a = assessFix("=IFS(1=1,42,TRUE,0)");
		expect(a.fixable).toBe(true);
		if (a.fixable && a.kind === "rewrite") {
			expect(a.rewritten).toBe("=IF(1=1,42,0)");
		} else {
			throw new Error("expected a rewrite");
		}
	});

	it("a LET is fixable and inlines its binding", () => {
		const a = assessFix("=LET(x,A1*2,x+1)");
		expect(a.fixable).toBe(true);
		if (a.fixable && a.kind === "rewrite") expect(a.rewritten).toBe("=A1*2+1");
	});

	it("a direct single-cond INDEX/MATCH is fixable (no helper needed)", () => {
		const a = assessFix(FIXTURE_INDEX_MATCH_SINGLE, "ALL ITEM WISE RATE");
		expect(a.fixable).toBe(true);
		if (a.fixable && a.kind === "rewrite") {
			expect(a.rewritten).toContain("VLOOKUP(");
			expect(a.rewritten).toContain(",2,0)");
		}
	});

	it("an XLOOKUP is fixable by geometry", () => {
		const a = assessFix(FIXTURE_XLOOKUP, "ADP");
		expect(a.fixable).toBe(true);
		if (a.fixable && a.kind === "rewrite") expect(a.rewritten).toContain("VLOOKUP(B165,Ducting!C7:F12,4,0)");
	});
});

describe("assessFix -- DEFERRED to Replace (needs helper columns)", () => {
	it("a multi-cond array INDEX/MATCH is NOT fixable in place", () => {
		const a = assessFix(
			"=INDEX(R!C2:C9, MATCH(1,(R!A2:A9=X1)*(R!B2:B9=X2),0))",
			"Calc"
		);
		expect(a.fixable).toBe(false);
		if (!a.fixable) expect(a.reason).toBe(REASON_NEEDS_HELPER);
	});

	it("a single-cond INDEX/MATCH with result LEFT of lookup needs a helper", () => {
		const a = assessFix("=INDEX(Ducting!C7:C12, MATCH(B165, Ducting!F7:F12, 0))", "X");
		expect(a.fixable).toBe(false);
		if (!a.fixable) expect(a.reason).toBe(REASON_NEEDS_HELPER);
	});
});

describe("assessFix -- NO automatic fix", () => {
	it("an unknown function has no sanctioned rewrite", () => {
		const a = assessFix('=TEXTJOIN(",",TRUE,A1:A5)');
		expect(a.fixable).toBe(false);
		if (!a.fixable) expect(a.reason).toBe(REASON_NO_REWRITE);
	});

	it("a bare INDEX with no MATCH has no sanctioned rewrite", () => {
		const a = assessFix("=INDEX(A1:A5,2)*2");
		expect(a.fixable).toBe(false);
		if (!a.fixable) expect(a.reason).toBe(REASON_NO_REWRITE);
	});

	it("an inline array literal is declined with the transform's reason", () => {
		const a = assessFix(FIXTURE_ARRAY_LITERAL, "FA_System with  Markup");
		expect(a.fixable).toBe(false);
		if (!a.fixable) expect(a.reason).toMatch(/array literal/);
	});
});

describe("assessFix -- dead-Google freeze", () => {
	it("a DUMMYFUNCTION cell is fixable via the freeze path", () => {
		const a = assessFix(FIXTURE_DUMMY_IMPORTRANGE, "Sprinkler with Markup");
		expect(a.fixable).toBe(true);
		if (a.fixable) expect(a.kind).toBe("freeze");
	});
});

// ---------------------------------------------------------------------------
// PW-2d: save-time helper-class fix
// ---------------------------------------------------------------------------
//
// planHelperFixes + applyHelperFixesOffline are PURE (celldata only, no engine); the guarded
// live writes (applyLiveFix / reenterHelperRewrites) are exercised here via a luckysheet mock
// that records call ORDER, and end-to-end in the live matrix.

/** A sheet carrying a source table on Termination-like columns A..D (crit) + F (result). */
function sheetWithSource(name: string, extra: any[] = []): any {
	const celldata: any[] = [];
	// 3 data rows (2..4) of A=COPPER.., B=ARMOURED.., C=1.., D=4.., F=<value>
	for (let row = 2; row <= 4; row++) {
		const r0 = row - 1;
		celldata.push({ r: r0, c: 0, v: { v: "COPPER", ct: { t: "s" } } });
		celldata.push({ r: r0, c: 1, v: { v: "ARMOURED", ct: { t: "s" } } });
		celldata.push({ r: r0, c: 2, v: { v: row - 1, ct: { t: "n" } } });
		celldata.push({ r: r0, c: 3, v: { v: (row - 1) * 4, ct: { t: "n" } } });
		celldata.push({ r: r0, c: 5, v: { v: (row - 1) * 100, ct: { t: "n" } } });
	}
	return { name, order: 0, celldata: [...celldata, ...extra], config: {}, column: 10, row: 20 };
}

const MULTI_HIT = {
	sheet: "T",
	cell: "Z10",
	row: 9,
	col: 25,
	formula:
		"=INDEX(T!F2:F4, MATCH(1,(T!A2:A4=X1)*(T!B2:B4=X2)*(T!C2:C4=X3)*(T!D2:D4=X4),0))",
	reasons: ["INDEX() returns 0..."],
};

describe("planHelperFixes -- the save-time helper plan (pure)", () => {
	it("rewrites the hit to a VLOOKUP against the freshly-allocated columns", () => {
		const sheets = [sheetWithSource("T")];
		const plan = planHelperFixes(sheets, [MULTI_HIT as any]);
		expect(plan.rewrites).toHaveLength(1);
		// maxCol on T is 5 (F); allocator seeds at 5+2=7 -> H(7)/I(8)
		expect(plan.rewrites[0].newF).toBe(
			'=VLOOKUP(X1&"|"&X2&"|"&X3&"|"&X4,T!$H$2:$I$4,2,0)'
		);
		expect(plan.ledger).toHaveLength(1);
		expect(plan.ledger[0].keyCol).toBe("H");
		expect(plan.ledger[0].valCol).toBe("I");
	});

	it("emits the helper cells with _mk markers + key/value FORMULAS (engine computes v)", () => {
		const plan = planHelperFixes([sheetWithSource("T")], [MULTI_HIT as any]);
		// marker row is rowStart(2)-2 = 0; key/value formulas over rows 2..4
		const markerKey = plan.helperCells.find((c) => c.row === 0 && c.col === 7);
		const key2 = plan.helperCells.find((c) => c.row === 1 && c.col === 7);
		const val2 = plan.helperCells.find((c) => c.row === 1 && c.col === 8);
		expect(markerKey?.f).toBe("_mk");
		expect(key2?.f).toBe('=A2&"|"&B2&"|"&C2&"|"&D2');
		expect(val2?.f).toBe("=F2");
		// 2 markers + 3 rows * 2 cols = 8 helper cells
		expect(plan.helperCells).toHaveLength(8);
		// hide the H/I pair
		expect(plan.hides).toEqual([{ sheet: "T", keyIdx: 7, valIdx: 8 }]);
	});

	it("STRAND-GUARD: writes a NEW pair on a sheet that ALREADY carries _mk helpers", () => {
		// Simulate a prior import: the sheet already has an _mk marker + helpers at H/I
		// (cols 7/8), so its maxCol is 8. A save-time fix must allocate BEYOND them (K/L)
		// and STILL emit their cells -- the recon Q4 cross-run strand case.
		const prior = [
			{ r: 0, c: 7, v: { v: "_mk", ct: { t: "s" } } },
			{ r: 1, c: 7, v: { f: '=A2&"|"&B2', v: "COPPER|ARMOURED" } },
			{ r: 1, c: 8, v: { f: "=F2", v: 100 } },
		];
		const sheets = [sheetWithSource("T", prior)];
		expect(sheetHasHelpers(sheets[0])).toBe(true); // it DOES already have _mk
		const plan = planHelperFixes(sheets, [MULTI_HIT as any]);
		// new pair lands beyond col 8 -> 8+2 = 10 (K) / 11 (L)
		expect(plan.ledger[0].keyCol).toBe("K");
		expect(plan.hides).toEqual([{ sheet: "T", keyIdx: 10, valIdx: 11 }]);
		// and the new pair's cells ARE emitted (never skipped)
		expect(plan.helperCells.some((c) => c.col === 10 && c.f === "_mk")).toBe(true);
		expect(plan.helperCells.some((c) => c.col === 10 && c.f.startsWith("=A2"))).toBe(true);
	});

	it("carries origin: save-fix on the report", () => {
		const plan = planHelperFixes([sheetWithSource("T")], [MULTI_HIT as any]);
		expect(plan.report.origin).toBe("save-fix");
		expect(plan.report.transforms).toHaveLength(1);
		expect(plan.report.transforms[0].cell).toBe("Z10");
		expect(plan.report.helpers.map((h) => `${h.keyCol}:${h.valCol}`)).toEqual(["H:I"]);
	});

	it("IDEMPOTENT: no helper-class hits -> empty plan, empty report", () => {
		const plan = planHelperFixes([sheetWithSource("T")], []);
		expect(plan.rewrites).toEqual([]);
		expect(plan.helperCells).toEqual([]);
		expect(plan.hides).toEqual([]);
		expect(plan.report.transforms).toEqual([]);
		expect(plan.report.helpers).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// PW-2d v2: the CAUTION #6 guard + the Option-3 offline path
// ---------------------------------------------------------------------------

/** A minimal luckysheet mock that records the ORDER of setSheetActive / setCellValue calls. */
function mockLuckysheet(activeName: string, sheets: any[]) {
	const ops: any[][] = [];
	let active = activeName;
	return {
		ops,
		getAllSheets: () => sheets,
		getSheet: () => sheets.find((s) => s.name === active),
		setSheetActive: (order: any) => {
			ops.push(["setSheetActive", order]);
			const s = sheets.find((x) => x.order === order);
			if (s) active = s.name;
		},
		setCellValue: (r: number, c: number, v: any, opt: any) => {
			ops.push(["setCellValue", r, c, v, opt?.order]);
		},
		getcellvalue: () => 42,
	};
}

describe("applyLiveFix -- FIX A guard (CAUTION #6: never write a non-active sheet)", () => {
	const HELPER_FREE = { sheet: "B", cell: "C1", row: 0, col: 2, formula: "=IFS(1=1,42,TRUE,0)", reasons: [] };

	it("a hit on a NON-active sheet activates it, writes, then restores the prior sheet", () => {
		const sheets = [
			{ name: "A", order: 0, data: [] },
			{ name: "B", order: 1, data: [] },
		];
		const ls = mockLuckysheet("A", sheets); // A active, hit is on B
		const res = applyLiveFix(ls as any, HELPER_FREE as any);
		expect(res.applied).toBe(true);
		// order: activate B (1) FIRST, then the write, then restore A (0)
		expect(ls.ops[0]).toEqual(["setSheetActive", 1]);
		const wi = ls.ops.findIndex((o) => o[0] === "setCellValue");
		expect(ls.ops[wi]).toEqual(["setCellValue", 0, 2, "=IF(1=1,42,0)", 1]);
		const restored = ls.ops.slice(wi + 1).some((o) => o[0] === "setSheetActive" && o[1] === 0);
		expect(restored).toBe(true);
	});

	it("FAST PATH: a hit on the ALREADY-active sheet never switches sheets", () => {
		const sheets = [
			{ name: "A", order: 0, data: [] },
			{ name: "B", order: 1, data: [] },
		];
		const ls = mockLuckysheet("B", sheets); // B already active
		applyLiveFix(ls as any, HELPER_FREE as any);
		expect(ls.ops.some((o) => o[0] === "setSheetActive")).toBe(false);
		expect(ls.ops.some((o) => o[0] === "setCellValue")).toBe(true);
	});
});

describe("applyHelperFixesOffline -- Option 3 offline transform", () => {
	it("STORES the EXACT value when the rewritten VLOOKUP resolves against the helpers", () => {
		const sheets = [sheetWithSource("T")];
		// A hit whose criteria (A3,B3,C3,D3 = COPPER,ARMOURED,2,8) are PRESENT -> matches source
		// row 3 -> F3 = 200. The rewrite resolves exactly, so the value is stored + displays at once.
		const HIT = {
			sheet: "T", cell: "G1", row: 0, col: 6,
			formula: "=INDEX(F2:F4, MATCH(1,(A2:A4=A3)*(B2:B4=B3)*(C2:C4=C3)*(D2:D4=D3),0))",
			reasons: [],
		};
		const out = applyHelperFixesOffline(sheets, [HIT as any]);
		expect(out.rewrites).toHaveLength(1);
		const hit = sheets[0].celldata.find((x: any) => x.r === 0 && x.c === 6)?.v;
		expect(hit.f).toContain("VLOOKUP(");
		expect(hit.v).toBe(200); // exact value stored
		expect(hit.m).toBe("200");
		expect(out.rewrites[0].valueComputed).toBe(true);
		expect(out.report.transforms[0].valueComputed).toBe(true);

		// helpers still carry f + a computed v
		const key = sheets[0].celldata.find((x: any) => x.r === 1 && x.v?.f === '=A2&"|"&B2&"|"&C2&"|"&D2')?.v;
		expect(key.v).toBe("COPPER|ARMOURED|1|4");
	});

	it("leaves the hit BLANK + valueComputed=false when the value cannot be computed exactly", () => {
		const sheets = [sheetWithSource("T")];
		// MULTI_HIT's criteria (X1..X4) are ABSENT from the payload -> abstain -> blank (the honest
		// fallback). The formula is still rewritten correctly and the helpers still materialized.
		sheets[0].celldata.push({ r: 9, c: 25, v: { f: MULTI_HIT.formula, v: "#VALUE!", m: "#VALUE!" } });
		const out = applyHelperFixesOffline(sheets, [MULTI_HIT as any]);
		expect(out.rewrites).toHaveLength(1);
		expect(out.helperPairs).toBe(1);
		const hit = sheets[0].celldata.find((x: any) => x.r === 9 && x.c === 25)?.v;
		expect(hit.f).toContain("VLOOKUP(");
		expect(hit.v).toBeUndefined();
		expect(hit.m).toBeUndefined();
		expect(out.rewrites[0].valueComputed).toBe(false);
		// helpers materialized with f + computed key value regardless
		const key = sheets[0].celldata.find((x: any) => x.r === 1 && x.v?.f === '=A2&"|"&B2&"|"&C2&"|"&D2')?.v;
		expect(key.v).toBe("COPPER|ARMOURED|1|4");
	});

	it("no helper-class hits -> no rewrites, no helpers (idempotent)", () => {
		const sheets = [sheetWithSource("T")];
		const before = sheets[0].celldata.length;
		const out = applyHelperFixesOffline(sheets, []);
		expect(out.rewrites).toEqual([]);
		expect(out.helperPairs).toBe(0);
		expect(sheets[0].celldata.length).toBe(before);
	});
});

describe("materializeHelpers force option (celldata path -- pins the write-past-_mk rule)", () => {
	const REC = (): HelperRecord => ({
		sheet: "S",
		keyCol: "K",
		valCol: "L",
		rowStart: 2,
		rowEnd: 3,
		criteriaCols: ["A", "B"],
		resultCol: "C",
		keyFormulaSample: '=A2&"|"&B2',
		reused: false,
	});
	const sheetWithMk = () => ({
		name: "S",
		celldata: [
			{ r: 0, c: 7, v: { v: "_mk" } }, // pre-existing helper marker
			{ r: 1, c: 0, v: { v: "COPPER", ct: { t: "s" } } },
			{ r: 1, c: 1, v: { v: "1.0" } }, // UNTYPED numeric string (as LuckyExcel emits)
			{ r: 1, c: 2, v: { v: 100 } },
			{ r: 2, c: 0, v: { v: "COPPER", ct: { t: "s" } } },
			{ r: 2, c: 1, v: { v: 2 } }, // number-typed (as the engine normalizes)
			{ r: 2, c: 2, v: { v: 200 } },
		],
		config: {},
		column: 10,
	});

	it("force:true WRITES a pair on a sheet that already carries _mk (strand fix)", () => {
		const sheets: any[] = [sheetWithMk()];
		expect(sheetHasHelpers(sheets[0])).toBe(true);
		const written = materializeHelpers(sheets, [REC()], { force: true });
		expect(written[0].reused).toBe(false); // NOT skipped
		const at = (r: number, c: number) => sheets[0].celldata.find((x: any) => x.r === r && x.c === c)?.v;
		expect(at(1, 10)?.f).toBe('=A2&"|"&B2'); // K2 key formula written
		expect(at(1, 11)?.f).toBe("=C2"); // L2 value formula written
		expect(sheets[0].config.colhidden).toHaveProperty("10");
	});

	it("WITHOUT force, the _mk skip still applies (import behaviour pinned)", () => {
		const sheets: any[] = [sheetWithMk()];
		const written = materializeHelpers(sheets, [REC()]); // default: skip
		expect(written[0].reused).toBe(true); // skipped -- import must not duplicate
		expect(sheets[0].celldata.find((x: any) => x.r === 1 && x.c === 10)).toBeUndefined();
	});

	it("number-typed and \"1.0\"-string criteria canonicalize to the SAME key", () => {
		// The two data rows use "1.0" (row 2) and 2 (row 3); the key must read 1 and 2,
		// never "1.0" -- this is the recon Q1 symmetry for the celldata path.
		const sheets: any[] = [sheetWithMk()];
		materializeHelpers(sheets, [REC()], { force: true });
		const key2 = sheets[0].celldata.find((x: any) => x.r === 1 && x.c === 10)?.v;
		const key3 = sheets[0].celldata.find((x: any) => x.r === 2 && x.c === 10)?.v;
		expect(key2?.v).toBe("COPPER|1"); // "1.0" -> "1"
		expect(key3?.v).toBe("COPPER|2"); // 2 -> "2"
	});
});
