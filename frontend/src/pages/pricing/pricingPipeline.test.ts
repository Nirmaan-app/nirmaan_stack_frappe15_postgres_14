// Tier-2 pipeline census checks (PW-2b-i) -- the whole stage chain over the REAL
// converted corpus, asserting on the CENSUS rather than on formula text.
//
// WHY CENSUS, NOT TEXT: helper columns land at `maxCol + 2`, which depends on each
// sheet's extent, so our rewritten VLOOKUPs cite different column letters than the
// human-authored FIXED workbooks ($W$2:$X$293 vs $N$3:$O$32). Text equality would
// fail on ~100% of interesting cells for a reason that does not matter. What matters
// is: nothing the engine cannot evaluate survives, helpers exist and are well-formed,
// the bloat is gone, and re-running changes nothing.
//
// FIXTURE: __fixtures__/convertedCorpus.json (423 KB) is a FORMULA-ONLY PROJECTION of
// the LuckyExcel output for the three raw workbooks plus FIXED Electrical -- every
// cell carrying `v.f`, plus per-sheet geometry (cellCount / maxRow / lastContentRow).
// The style-only filler is NOT shipped (ELV alone would be 1.8M cells); the clamp
// test RECONSTITUTES it from the recorded geometry, so the clamp assertion still runs
// against the real 1,819,874-cell shape.
//
// COVERAGE SUMMARY:
//   kill-list == 0   -- no INDEX/MATCH, IFS, LET, XLOOKUP or __xludf survives.
//   helpers          -- created, well-formed key formulas, _mk marker, hidden.
//   clamp            -- ELV 1,819,874 -> < 30,000 cells.
//   idempotency      -- a second full run transforms nothing and adds no helpers.
//   FIXED is a no-op -- backwards-compat: replacing an already-fixed workbook behaves
//                       exactly as it does today.
//   abstain          -- the decline list stays tiny and is enumerated, not hidden.

import { describe, it, expect } from "vitest";
import corpus from "./__fixtures__/convertedCorpus.json";
import { decodeSheetNames, normalizeFormulas } from "./pricingLibs";
import { clampRowBloat, countCells } from "./pricingClamp";
import { runFormulaStage, type AbstainRecord } from "./pricingTransforms";
import { HELPER_MARKER } from "./pricingHelpers";
import { parseFormula, walk } from "./pricingFormulaAst";

interface SheetProjection {
	name: string;
	maxRow: number;
	maxCol: number;
	cellCount: number;
	lastContentRow: number;
	formulas: [number, number, string, any][];
}
interface WorkbookProjection {
	workbook: string;
	sheetCount: number;
	totalCells: number;
	totalFormulas: number;
	sheets: SheetProjection[];
}

const BOOK = (name: string): WorkbookProjection => {
	const wb = (corpus as any).workbooks.find((w: any) => w.workbook === name);
	if (!wb) throw new Error(`fixture missing workbook ${name}`);
	return wb;
};

/** Style-only filler, byte-shaped like what LuckyExcel actually emits. */
const FILLER = { ct: { fa: "General" }, fc: "#000000", ff: "Calibri", fs: 10, ht: 0, tb: 2, vt: 0 };

/**
 * Rebuild runnable sheets from the projection.
 * `withFiller` reconstitutes the dropped style-only cells so the clamp sees the real
 * 1.8M-cell shape; the transform tests do not need them.
 */
function hydrate(wb: WorkbookProjection, withFiller = false): any[] {
	return wb.sheets.map((s) => {
		const celldata: any[] = s.formulas.map(([r, c, f, v]) => ({
			r,
			c,
			v: v === null ? { f } : { f, v },
		}));
		if (withFiller) {
			const want = s.cellCount - celldata.length;
			const cols = Math.max(1, s.maxCol + 1);
			let made = 0;
			for (let r = s.lastContentRow + 1; r <= s.maxRow && made < want; r++) {
				for (let c = 0; c < cols && made < want; c++) {
					celldata.push({ r, c, v: { ...FILLER } });
					made++;
				}
			}
		}
		return { name: s.name, celldata, config: {}, row: s.maxRow + 1, column: s.maxCol + 1 };
	});
}

/** The full import pipeline, in the authoritative stage order. */
function runPipeline(sheets: any[]) {
	decodeSheetNames(sheets); // 1
	const clamp = clampRowBloat(sheets); // 2
	normalizeFormulas(sheets); // 3
	const stage = runFormulaStage(sheets); // 4-6 (freeze -> transform -> helpers)
	return { ...stage, clamp };
}

/**
 * Count surviving constructs the engine cannot evaluate.
 *
 * ABSTAINED cells are excluded by address: declining to rewrite them is the whole
 * point, so their original INDEX/MATCH text is expected to survive. Counting it would
 * make "we correctly refused to guess" look like a failure.
 */
function killListCensus(sheets: any[], skip: Set<string> = new Set()): Record<string, number> {
	const counts: Record<string, number> = {};
	const bump = (k: string) => (counts[k] = (counts[k] || 0) + 1);
	for (const s of sheets) {
		for (const cell of s.celldata || []) {
			const f = cell?.v?.f;
			if (typeof f !== "string" || !f) continue;
			if (skip.has(`${s.name}!${cellKey(cell)}`)) continue;
			const parsed = parseFormula(f);
			if (!parsed.ok) {
				bump("unparseable");
				continue;
			}
			walk(parsed.ast, (n) => {
				if (n.kind !== "call") return;
				const up = n.name.toUpperCase();
				if (up === "INDEX") bump("INDEX");
				if (up === "MATCH") bump("MATCH");
				if (up === "IFS") bump("IFS");
				if (up === "LET") bump("LET");
				if (up === "XLOOKUP") bump("XLOOKUP");
				if (up.includes("DUMMYFUNCTION") || up.startsWith("__XLUDF")) bump("__xludf");
				if (up === "IMPORTRANGE") bump("IMPORTRANGE");
			});
			if (n_hasArray(parsed.ast)) bump("arrayLiteral");
		}
	}
	return counts;
}
function n_hasArray(ast: any): boolean {
	let found = false;
	walk(ast, (n) => {
		if (n.kind === "array") found = true;
	});
	return found;
}

/** A1 label matching TransformRecord.cell, for the skip set. */
function cellKey(cell: any): string {
	let n = cell.c, out = "";
	while (n >= 0) { out = String.fromCharCode((n % 26) + 65) + out; n = Math.floor(n / 26) - 1; }
	return `${out}${cell.r + 1}`;
}

const skipSet = (list: AbstainRecord[]) => new Set(list.map((a) => `${a.sheet}!${a.cell}`));

const describeAbstains = (list: AbstainRecord[]) =>
	list.map((a) => `${a.sheet}!${a.cell}: ${a.reason}`);

// ---------------------------------------------------------------------------

describe("fixture integrity", () => {
	it("carries the four workbooks recorded by the PW-2b recon", () => {
		const names = (corpus as any).workbooks.map((w: any) => w.workbook);
		expect(names).toEqual(["RAW_Electrical", "RAW_ELV", "RAW_HVAC", "FIXED_Electrical"]);
		expect(BOOK("RAW_Electrical").totalCells).toBe(148801);
		expect(BOOK("RAW_ELV").totalCells).toBe(1819874);
		expect(BOOK("RAW_HVAC").totalCells).toBe(143798);
		expect(BOOK("RAW_Electrical").totalFormulas).toBe(2860);
	});
});

describe("RAW Electrical -- full pipeline", () => {
	const sheets = hydrate(BOOK("RAW_Electrical"));
	const res = runPipeline(sheets);

	it("leaves NO construct the engine cannot evaluate (outside the declined cell)", () => {
		const census = killListCensus(sheets, skipSet(res.abstained));
		expect(census.INDEX ?? 0).toBe(0);
		expect(census.MATCH ?? 0).toBe(0);
		expect(census.IFS ?? 0).toBe(0);
		expect(census.LET ?? 0).toBe(0);
		expect(census.XLOOKUP ?? 0).toBe(0);
		expect(census.__xludf ?? 0).toBe(0);
	});

	it("rewrote the expected classes -- matching the recon census exactly", () => {
		const classes = res.transforms.flatMap((t) => t.classes);
		// The recon counted 27 multi-condition cells in Electrical. With Z10 now
		// harmonized rather than declined, all 27 are rewritten.
		expect(classes.filter((c) => c === "index-match-multi").length).toBe(27);
		expect(classes.filter((c) => c === "harmonized").length).toBe(1);
		expect(classes.filter((c) => c === "ifs").length).toBe(9);
		expect(classes.filter((c) => c === "let").length).toBe(2);
		// 4, not the recon's 1: three cells (T21/U21/T23) carry BOTH a multi-condition
		// and a single-condition INDEX/MATCH. The recon's regex bucketed one class per
		// cell; the AST classifies per construct, so it sees both. Distinct INDEX cells
		// still reconcile to the recon's 28 = 26 multi + L40 single-only + Z10 declined.
		expect(classes.filter((c) => c === "index-match-single").length).toBe(4);
	});

	it("created helper pairs with well-formed key formulas and _mk markers", () => {
		expect(res.helpers.length).toBeGreaterThan(0);
		const KEY_RE = /^=(?:[A-Z]+\d+&"\|"&)+[A-Z]+\d+$|^=[A-Z]+\d+$/;
		for (const h of res.helpers) {
			expect(h.keyFormulaSample).toMatch(KEY_RE);
			expect(h.criteriaCols.length).toBeGreaterThan(0);
		}
		const marked = sheets.filter((s) =>
			(s.celldata || []).some((c: any) => c.v?.v === HELPER_MARKER)
		);
		expect(marked.length).toBeGreaterThan(0);
		for (const s of marked) expect(Object.keys(s.config.colhidden || {}).length).toBeGreaterThan(0);
	});

	it("abstains on NOTHING -- Z10 is now harmonized, not declined", () => {
		expect(describeAbstains(res.abstained)).toEqual([]);
	});

	it("harmonizes Z10's off-by-one criterion range and records it", () => {
		// Owner-adjudicated: Termination!B2:B97 is a typo for B2:B96 (row 96 ends the
		// <=25 sub-table; row 97 opens the table this formula's OWN second branch reads
		// as 97:297). The suite pulls it onto the consensus span and says so.
		const z10 = res.transforms.find((t) => t.sheet === "ALL ITEM WISE RATE" && t.cell === "Z10");
		expect(z10).toBeTruthy();
		expect(z10!.classes).toContain("harmonized");
		expect(z10!.note).toContain("Termination!B2:B97 -> Termination!B2:B96");
		expect(z10!.newF).not.toContain("INDEX(");
	});

	it("emits ,0) and never ,FALSE) in any generated VLOOKUP", () => {
		for (const t of res.transforms) {
			// only inspect the ranges WE generated (absolute helper ranges)
			const generated = (t.newF || "").match(/VLOOKUP\([^)]*\$[A-Z]+\$\d+:\$[A-Z]+\$\d+,\d+,[^)]*\)/g) || [];
			for (const g of generated) expect(g).toMatch(/,0\)$/);
		}
	});

	it("IDEMPOTENT: a second full run changes nothing", () => {
		const second = runFormulaStage(sheets);
		expect(second.transforms).toHaveLength(0);
		expect(second.frozen).toHaveLength(0);
		expect(second.helpers.filter((h) => !h.reused)).toHaveLength(0);
	});
});

describe("RAW HVAC -- full pipeline", () => {
	const sheets = hydrate(BOOK("RAW_HVAC"));
	const res = runPipeline(sheets);

	it("rewrites the single XLOOKUP and leaves the kill-list empty", () => {
		expect(res.transforms.flatMap((t) => t.classes).filter((c) => c === "xlookup")).toHaveLength(1);
		const census = killListCensus(sheets, skipSet(res.abstained));
		expect(census.XLOOKUP ?? 0).toBe(0);
		expect(census.INDEX ?? 0).toBe(0);
	});

	it("needs no helper columns for HVAC (direct VLOOKUP by geometry)", () => {
		expect(res.helpers.filter((h) => !h.reused)).toHaveLength(0);
	});
});

describe("RAW ELV -- freeze + clamp", () => {
	const sheets = hydrate(BOOK("RAW_ELV"), true); // WITH reconstituted filler
	const before = countCells(sheets);
	const res = runPipeline(sheets);
	const after = countCells(sheets);

	it("reconstitutes a faithful bloat shape from the recorded geometry", () => {
		// The fixture ships formulas + geometry, not the 1.8M style-only cells, so the
		// reconstruction cannot place value-only cells it never recorded. It lands
		// within ~1.2% of the real 1,819,874 -- enough for the clamp to be exercised at
		// true scale. The REAL number is asserted from the recorded metadata above.
		expect(before).toBeGreaterThan(1_700_000);
		expect(BOOK("RAW_ELV").totalCells).toBe(1819874);
	});

	it("clamps the Google row bloat below 30,000 cells", () => {
		expect(after).toBeLessThan(30000);
		expect(res.clamp.length).toBeGreaterThanOrEqual(2);
		const fa = res.clamp.find((c) => c.sheet.startsWith("FA_System"));
		expect(fa).toBeTruthy();
		expect(fa!.cellsDropped).toBeGreaterThan(800000);
	});

	it("freezes every dead-Google cell and flags the IMPORTRANGE one", () => {
		expect(res.frozen).toHaveLength(296);
		const flagged = res.frozen.filter((f) => f.note === "IMPORTRANGE fallback literal -- review");
		expect(flagged.length).toBeGreaterThanOrEqual(1);
		const census = killListCensus(sheets, skipSet(res.abstained));
		expect(census.__xludf ?? 0).toBe(0);
	});

	it("declines the two inline array literals rather than guessing", () => {
		const arrayAbstains = res.abstained.filter((a) => /array literal/.test(a.reason));
		expect(arrayAbstains).toHaveLength(2);
	});
});

describe("FIXED Electrical -- pipeline is a NO-OP (backwards-compat)", () => {
	const sheets = hydrate(BOOK("FIXED_Electrical"));
	const res = runPipeline(sheets);

	it("transforms nothing, freezes nothing, adds no helpers", () => {
		expect(res.transforms).toHaveLength(0);
		expect(res.frozen).toHaveLength(0);
		expect(res.helpers.filter((h) => !h.reused)).toHaveLength(0);
	});

	it("drops no cells (already compact)", () => {
		expect(res.clamp).toHaveLength(0);
	});

	it("abstains on nothing", () => {
		expect(describeAbstains(res.abstained)).toEqual([]);
	});
});
