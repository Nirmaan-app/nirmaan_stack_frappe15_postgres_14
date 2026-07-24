// Consent-based live formula fixing (PW-2b-ii; helper-class extension PW-2d).
//
// The PW-2a advisory dialog only WARNED. This turns each warned cell into an automatic
// fix. A HELPER-FREE rewrite goes straight into the live engine (`applyLiveFix`); a
// HELPER-CLASS rewrite (multi-condition INDEX/MATCH, which needs a key/value column pair)
// is fixed OFFLINE on the serialized save payload (`applyHelperFixesOffline`) and shown
// live after the save + re-init (`reenterHelperRewrites`) -- see the Option-3 block below.
//
// ELIGIBILITY IS NOT A HAND-KEPT CLASS LIST. It is derived by running the hit's formula
// through the SAME `transformFormula` entry point the import pipeline uses and asking:
// did it produce a rewrite that requested ZERO helper columns? That automatically
// covers IFS / LET / XLOOKUP / direct single-cond INDEX/MATCH / dead-Google freeze and
// automatically routes multi-cond INDEX/MATCH (which requests a helper pair) to the
// offline path -- if the transform suite ever changes which classes need helpers, this
// tracks it for free.
//
// ⚠️ ENGINE CAUTION #6 (owner-locked, minimal repro on record, PW-2d STEP-0 micro-probe):
// `luckysheet.setCellValue(r, c, f, {order})` targeting a NON-ACTIVE sheet CORRUPTS that
// sheet -- a bulk write rebuilds its cell store from an incomplete working grid and DROPS
// every unrendered row (proven: a 250-cell sheet collapsed to 52 cells; live, the
// Termination table went 154 rate rows -> 0 and the save persisted the gutted sheet).
// A SINGLE stray write can survive, but never rely on it. **NEVER setCellValue a
// non-active sheet.** The sanctioned form is `withSheetActive` (activate the target FIRST
// -- setSheetActive is synchronous, no render-await needed -- write, then restore the
// prior active sheet). Every live write in this module goes through it.

import { colToIndex } from "./pricingFormulaAst";
import type { FormulaScanHit } from "./pricingFormulaScan";
import {
	HelperAllocator,
	emptyReport,
	finalizeReport,
	maxColsBySheet,
	transformFormula,
	type HelperRecord,
	type ImportReport,
	type TransformClass,
	type TransformRecord,
} from "./pricingTransforms";
import { HELPER_MARKER, materializeHelpers } from "./pricingHelpers";
import { computeHitValueExact } from "./pricingHitEval";

/**
 * Run `write` with `sheetName` guaranteed to be the ACTIVE sheet, then restore whatever
 * was active before. THE guard for ENGINE CAUTION #6: a live `setCellValue` must never
 * land on a non-active sheet. `setSheetActive` is synchronous (STEP-0 probe: `getSheet()`
 * reflects the switch on the very next line and an immediate bulk write is intact), so no
 * render-await is required and the guard stays synchronous. A same-sheet write skips the
 * switch entirely (the fast path). Restore is best-effort/cosmetic.
 */
function withSheetActive<T>(luckysheet: any, sheetName: string, order: any, write: () => T): T {
	const activeName = luckysheet?.getSheet?.()?.name;
	const needSwitch = activeName != null && activeName !== sheetName;
	if (needSwitch) {
		try {
			luckysheet.setSheetActive(order);
		} catch {
			/* if the switch fails we still attempt the write via {order}; worst case it no-ops */
		}
	}
	try {
		return write();
	} finally {
		if (needSwitch) {
			const back = (luckysheet?.getAllSheets?.() || []).find((s: any) => s.name === activeName);
			if (back) {
				try {
					luckysheet.setSheetActive(back.order);
				} catch {
					/* cosmetic only */
				}
			}
		}
	}
}

export type FixAssessment =
	| { fixable: true; kind: "rewrite"; rewritten: string }
	| { fixable: true; kind: "freeze" }
	| { fixable: false; reason: string };

/** Reason strings are load-bearing -- the dialog maps them to a status label. */
export const REASON_NEEDS_HELPER = "needs helper columns";
export const REASON_NO_REWRITE = "no sanctioned rewrite";

/**
 * Can this formula be fixed IN PLACE (no helper columns)?
 *
 * Pure -- no engine, no DOM. `sheetName` lets an unqualified range (`E2:E9`) resolve to
 * the cell's own sheet, exactly as the pipeline does.
 */
export function assessFix(formula: string, sheetName = ""): FixAssessment {
	// A throwaway allocator: we never keep its ledger, we only read whether a rewrite
	// WOULD have requested helper columns.
	const outcome = transformFormula(formula, new HelperAllocator({}), sheetName);
	switch (outcome.status) {
		case "rewritten":
			return outcome.helpers.length === 0
				? { fixable: true, kind: "rewrite", rewritten: outcome.formula }
				: { fixable: false, reason: REASON_NEEDS_HELPER };
		case "freeze":
			// Dead-Google: drop the formula, keep whatever the cell already shows.
			return { fixable: true, kind: "freeze" };
		case "abstain":
			// A recognised construct the suite declined (e.g. an inline array literal).
			return { fixable: false, reason: outcome.reason };
		case "unchanged":
		default:
			// Parsed fine but nothing to rewrite -- an unknown function, or a bare INDEX
			// with no MATCH. Flagged by the scan, but the suite has no rewrite for it.
			return { fixable: false, reason: REASON_NO_REWRITE };
	}
}

/** Convenience wrapper over a scan hit. */
export function assessHit(hit: FormulaScanHit): FixAssessment {
	return assessFix(hit.formula, hit.sheet);
}

export interface LiveFixResult {
	applied: boolean;
	/** The cell's computed value after the fix, for display. */
	value?: any;
	reason?: string;
}

/**
 * Apply a helper-FREE fix to ONE cell in the live engine and return its recomputed value.
 *
 * Mirrors `reenterNormalizedFormulas` (FR-6): `setCellValue` MUST take the plain formula
 * STRING -- the object form `{f:"..."}` is accepted without error but leaves the cell
 * EMPTY. The write goes through `withSheetActive` (CAUTION #6): if the hit's sheet is not
 * the active one it is activated first (synchronously), written, and the prior active sheet
 * restored -- a non-active write would corrupt the target sheet. This is FIX A, and it also
 * hardens the shipped PW-2b-ii path (a helper-free hit on a non-active sheet was a latent
 * data-loss risk before the guard).
 */
export function applyLiveFix(luckysheet: any, hit: FormulaScanHit): LiveFixResult {
	const assessment = assessHit(hit);
	if (!assessment.fixable) return { applied: false, reason: assessment.reason };

	const sheets = luckysheet?.getAllSheets?.() || [];
	const target = sheets.find((s: any) => s.name === hit.sheet);
	const order = target?.order;

	try {
		withSheetActive(luckysheet, hit.sheet, order, () => {
			if (assessment.kind === "rewrite") {
				luckysheet.setCellValue(hit.row, hit.col, assessment.rewritten, { order });
			} else {
				// freeze: keep the current displayed value, drop the formula.
				const current = luckysheet?.getcellvalue
					? luckysheet.getcellvalue(hit.row, hit.col, target?.data)
					: undefined;
				luckysheet.setCellValue(hit.row, hit.col, current ?? "", { order });
			}
		});
	} catch (e: any) {
		return { applied: false, reason: e?.message || "the engine rejected the fix" };
	}

	let value: any;
	try {
		// re-fetch the sheet -- its `data` ref may differ after the guard restored the active sheet.
		const t2 = (luckysheet?.getAllSheets?.() || []).find((s: any) => s.name === hit.sheet);
		value = luckysheet?.getcellvalue
			? luckysheet.getcellvalue(hit.row, hit.col, t2?.data)
			: undefined;
	} catch {
		/* value read is best-effort, for display only */
	}
	return { applied: true, value };
}

// ---------------------------------------------------------------------------
// SAVE-TIME HELPER-CLASS FIX (PW-2d, Option 3 -- OFFLINE materialize + re-init)
// ---------------------------------------------------------------------------
//
// A multi-condition INDEX/MATCH needs a helper column pair, which `applyLiveFix` will not do.
//
// ⚠️ HISTORY: the first cut (Option B) wrote the helper columns straight into the LIVE ENGINE
// via `setCellValue({order})` on the hit's sheet. That sheet is almost always NON-active (the
// lookup TABLE lives on a dedicated sheet -- Termination, Cable Allocation, ...), so the bulk
// write hit ENGINE CAUTION #6 and DESTROYED the sheet (Termination: 154 rate rows -> 0; the
// save persisted the gutted sheet). Option B is abandoned.
//
// OPTION 3 keeps every helper write OFFLINE, on the SERIALIZED save payload, never touching
// the fragile live engine:
//   (1) `planHelperFixes` mints the rewrites + ledger (pure).
//   (2) `materializeHelpers({force:true})` writes the pairs into `celldata` WITH pipeline-
//       computed `v` -- the import-proven path (`luckysheet.create` renders cached values, so
//       the helpers load correct and PERSIST on one save).
//   (3) each hit cell gets the rewritten formula with its stale `v`/`m` CLEARED -- honest:
//       it loads BLANK, then a post-save re-init + a guarded live re-entry recomputes it on
//       screen (`reenterHelperRewrites`). The STORED `v` for the hit stays blank until the
//       user's NEXT normal save recomputes it -- BY DESIGN (stored `f` is correct, the screen
//       is correct, only the cached `v` lags one save).
// No `setCellValue` ever lands on a non-active sheet -> no corruption. Single version bump.

/** One cell the applier must setCellValue into the live engine. */
export interface HelperCellWrite {
	sheet: string;
	row: number; // 0-indexed
	col: number; // 0-indexed
	f: string; // a formula string; the engine computes its value on entry
}

/** A rewrite the offline fix applies to the serialized payload. */
export interface HitRewrite {
	sheet: string;
	row: number;
	col: number;
	oldF: string;
	newF: string;
	classes: TransformClass[];
	note?: string;
	helpers: string[];
	/** Set by `applyHelperFixesOffline`: whether an EXACT value was computed + stored. */
	valueComputed?: boolean;
}

/** A helper pair to hide (engine `hideColumn(keyIdx, valIdx, {order})`). */
export interface HideSpan {
	sheet: string;
	keyIdx: number;
	valIdx: number;
}

export interface HelperFixPlan {
	rewrites: HitRewrite[];
	/** Helper cells to write FIRST, so the rewrites compute against them. */
	helperCells: HelperCellWrite[];
	hides: HideSpan[];
	ledger: HelperRecord[];
	report: ImportReport;
}

/**
 * PURE planner: given the live sheets (name/order/celldata are all it reads) and the
 * helper-class hits, decide every rewrite, every helper cell to write, and every column
 * pair to hide -- WITHOUT touching the engine. Split from the applier so it is unit
 * testable with no `luckysheet`.
 *
 * The helper cells mirror the pricingHelpers convention EXACTLY: an `_mk` marker in the
 * row above the data, a key column `=A2&"|"&B2` (criteria joined by "|"), and a value
 * column `=C2` (mirror of the result column). Values are DELIBERATELY not pre-computed
 * here -- the engine computes them on `setCellValue`, and because the engine's `&` coerces
 * a numeric cell the SAME way for the helper key and for the consumer VLOOKUP key, the two
 * keys match by construction (the recon Q1 symmetry, guaranteed by the engine itself rather
 * than by NUMERIC_LIKE).
 *
 * Pairs are NEW BY CONSTRUCTION: the allocator is seeded from `maxColsBySheet`, so every
 * column it mints lands beyond existing content -- there is NO `_mk` skip here, which is
 * the recon Q4 strand fix for the live path (a save-time fix on a sheet that already carries
 * import helpers still writes its new pair).
 */
export function planHelperFixes(liveSheets: any[], hits: FormulaScanHit[]): HelperFixPlan {
	const alloc = new HelperAllocator(maxColsBySheet(liveSheets));

	// 1. Rewrite each hit (this mints the helper ledger via the allocator).
	const rewrites: HitRewrite[] = [];
	for (const hit of hits) {
		const outcome = transformFormula(hit.formula, alloc, hit.sheet);
		if (outcome.status !== "rewritten") continue; // helper-free / abstain / unchanged: not ours
		rewrites.push({
			sheet: hit.sheet,
			row: hit.row,
			col: hit.col,
			oldF: hit.formula,
			newF: outcome.formula,
			classes: outcome.classes,
			note: outcome.note,
			helpers: outcome.helpers,
		});
	}
	const ledger = alloc.ledger();

	// 2. Expand the ledger into the concrete helper cells + hide spans.
	const helperCells: HelperCellWrite[] = [];
	const hides: HideSpan[] = [];
	for (const rec of ledger) {
		const keyIdx = colToIndex(rec.keyCol);
		const valIdx = colToIndex(rec.valCol);
		const markerRow = Math.max(0, rec.rowStart - 2); // 0-indexed row above the data
		helperCells.push({ sheet: rec.sheet, row: markerRow, col: keyIdx, f: HELPER_MARKER });
		helperCells.push({ sheet: rec.sheet, row: markerRow, col: valIdx, f: HELPER_MARKER });
		for (let row = rec.rowStart; row <= rec.rowEnd; row++) {
			const keyF = `=${rec.criteriaCols.map((c) => `${c}${row}`).join('&"|"&')}`;
			helperCells.push({ sheet: rec.sheet, row: row - 1, col: keyIdx, f: keyF });
			helperCells.push({ sheet: rec.sheet, row: row - 1, col: valIdx, f: `=${rec.resultCol}${row}` });
		}
		hides.push({ sheet: rec.sheet, keyIdx, valIdx });
	}

	// 3. The save-fix report (labeling: origin "save-fix").
	const report = emptyReport();
	report.origin = "save-fix";
	report.transforms = rewrites.map<TransformRecord>((r) => ({
		sheet: r.sheet,
		cell: `${r.sheet}`, // filled below with a real A1 label
		row: r.row,
		col: r.col,
		classes: r.classes,
		oldF: r.oldF,
		newF: r.newF,
		note: r.note,
		helpers: r.helpers.length ? r.helpers : undefined,
	}));
	// A1 labels for the report rows.
	for (const t of report.transforms) t.cell = a1(t.row, t.col);
	report.helpers = ledger.map((r) => ({ ...r, reused: false }));
	finalizeReport(report);

	return { rewrites, helperCells, hides, ledger, report };
}

/** 0-indexed (row,col) -> A1. Local (pricingFormulaAst owns the reverse). */
function a1(row: number, col: number): string {
	let n = col;
	let s = "";
	while (n >= 0) {
		s = String.fromCharCode((n % 26) + 65) + s;
		n = Math.floor(n / 26) - 1;
	}
	return `${s}${row + 1}`;
}

export interface HelperFixOutcome {
	/** The SAME sheets array, now carrying materialized helpers + rewritten hit cells. */
	sheets: any[];
	report: ImportReport;
	/** The rewrites, for the caller's post-save re-entry step (`reenterHelperRewrites`). */
	rewrites: HitRewrite[];
	/** helper column pairs materialized. */
	helperPairs: number;
}

/**
 * Set a celldata cell's formula, and its cached `v`/`m` to `computed` when an EXACT value was
 * obtained -- else CLEAR them (blank until the next recalc trigger; the honest fallback).
 * Creates the cell if it is somehow absent (the hit cell normally already exists). Returns
 * whether a value was stored.
 */
function setCelldataFormula(
	sheet: any,
	row: number,
	col: number,
	formula: string,
	computed: number | string | undefined
): boolean {
	const cd = (sheet.celldata = sheet.celldata || []);
	let cell = cd.find((x: any) => x.r === row && x.c === col);
	if (!cell) {
		cell = { r: row, c: col, v: {} };
		cd.push(cell);
	}
	const v = (cell.v = cell.v || {});
	v.f = formula;
	if (computed !== undefined) {
		v.v = computed;
		v.m = String(computed);
		return true;
	}
	delete v.v;
	delete v.m;
	return false;
}

/**
 * OPTION 3: fix helper-class hits OFFLINE on a SERIALIZED payload -- NEVER via live
 * `setCellValue` on a (possibly non-active) sheet (ENGINE CAUTION #6). Mutates `sheets`
 * in place and returns it. `materializeHelpers` writes the pairs into `celldata` WITH
 * pipeline-computed values + hides them via `config.colhidden` (all captured by the save);
 * each hit cell gets its rewritten formula, and its EXACT value where that can be computed from
 * the just-materialized helpers (`computeHitValueExact`) -- else a cleared `v` (blank until the
 * next recalc). The caller saves ONCE, then `requestSheet(sheets, true)` re-inits and `create()`
 * renders the stored values (no recompute -- CAUTION #7).
 *
 * `force:true` bypasses `materializeHelpers`' `_mk` pre-existing skip -- the pairs are new by
 * construction (allocator seeded from `maxColsBySheet`, minted beyond existing content), so a
 * fix on a sheet that already carries IMPORT helpers still writes its new pair (the strand fix).
 */
export function applyHelperFixesOffline(sheets: any[], hits: FormulaScanHit[]): HelperFixOutcome {
	const plan = planHelperFixes(sheets, hits);
	materializeHelpers(sheets, plan.ledger, { force: true });
	const byName = new Map<string, any>();
	for (const s of sheets || []) byName.set(s?.name, s);
	for (const rw of plan.rewrites) {
		const sheet = byName.get(rw.sheet);
		if (!sheet) continue;
		// The helpers are now in the payload, so the VLOOKUP is a dictionary lookup: compute the
		// cell's value EXACTLY where we can (displays at once) -- else store nothing (blank until
		// recalc). NEVER an approximation; see pricingHitEval.
		const computed = computeHitValueExact(sheets, rw.sheet, rw.newF);
		rw.valueComputed = setCelldataFormula(sheet, rw.row, rw.col, rw.newF, computed);
	}
	// Mirror the per-hit outcome onto the report rows (same order as rewrites).
	plan.report.transforms.forEach((t, i) => {
		t.valueComputed = plan.rewrites[i]?.valueComputed;
	});
	return { sheets, report: plan.report, rewrites: plan.rewrites, helperPairs: plan.ledger.length };
}

// ⚠️ ENGINE CAUTION #7 (owner-locked, PW-2d v2 STEP-6 diagnosis) -- why there is NO live
// re-entry step after the save-fix re-init:
//   * setCellValue re-entry of the rewritten hit THROWS -- the engine raises
//     "Cannot read properties of undefined (reading 'data')" when a VLOOKUP whose first arg is a
//     `&`-concatenation key (`=VLOOKUP(J7&"|"&J8&...,W2:X297,2,0)`) is written through setCellValue.
//     A literal-key VLOOKUP is fine, so this bites EXACTLY the helper-class rewrites.
//   * `refreshFormula()` (a global recompute) CASCADES #NAME? -- it force-evaluates EVERY formula
//     in the workbook, and the engine cannot evaluate many of them (it renders Excel's cached
//     values on load, FR-6), so unrelated cells across the workbook flip to #NAME?. Proven live.
// The resolution is upstream: `applyHelperFixesOffline` stores the hit's EXACT value at save time
// (pricingHitEval), so the plain re-init DISPLAYS it (create renders cached values -- no recompute).
// Where a value cannot be computed exactly the cell is blank and recomputes on the next feeder edit.
