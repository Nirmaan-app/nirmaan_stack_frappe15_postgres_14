// Helper-column materialization (PW-2b-i).
//
// The transform suite rewrites a multi-condition array INDEX/MATCH into a VLOOKUP
// against a composite key. This module writes the columns that VLOOKUP reads.
//
// THE CONVENTION IS NOT INVENTED -- it is read out of the verified FIXED workbooks
// (PW-2b recon Q5). In FIXED Electrical, sheet 'Switches & Sockets':
//     N2='_mk' O2='_mk' P2='_mk' ...
//     N3='10A 1 WAY SWITCH |White'  [f: =B3&"|"&D3]      O3=142  [f: =C3]
// i.e. a KEY column whose formula concatenates the criterion columns with "|", an
// adjacent VALUE column mirroring the result column, and a literal `_mk` marker in
// the header row above the data. Consumers then read
//     VLOOKUP(C9&"|"&C15,'Switches & Sockets'!$N$3:$O$32,2,0)
//
// Two properties matter more than elegance here:
//  * Helpers are FORMULAS, not frozen literals -- so they stay correct if someone
//    edits the source table.
//  * `_mk` is the IDEMPOTENCY MARKER. A sheet that already carries it already has
//    helpers, so a second pipeline run adds none. Combined with the transform suite
//    being naturally idempotent (a FIXED workbook contains no INDEX/MATCH, IFS, LET
//    or XLOOKUP, so nothing is requested), pipeline(pipeline(RAW)) is a no-op.

import { colToIndex, indexToCol } from "./pricingFormulaAst";
import type { HelperRecord } from "./pricingTransforms";

/** The literal that marks a generated helper column. Load-bearing -- see above. */
export const HELPER_MARKER = "_mk";

/** Rows above the first data row that are scanned for the marker. */
const MARKER_SCAN_ROWS = 6;

function putCell(sheet: any, r: number, c: number, v: Record<string, any>): void {
	const cd = (sheet.celldata = sheet.celldata || []);
	const existing = cd.find((x: any) => x.r === r && x.c === c);
	if (existing) existing.v = { ...(existing.v || {}), ...v };
	else cd.push({ r, c, v });
}

/** `${row}:${col}` -> cell, built once per sheet so materialization stays linear. */
function indexCells(sheet: any): Map<string, any> {
	const map = new Map<string, any>();
	for (const c of sheet?.celldata || []) map.set(`${c.r}:${c.c}`, c);
	return map;
}

/** The displayable value of a source cell, or undefined when it has none. */
function sourceValue(index: Map<string, any>, r0: number, colIdx: number): any {
	const v = index.get(`${r0}:${colIdx}`)?.v;
	if (!v) return undefined;
	if (v.v !== undefined && v.v !== null && v.v !== "") return v.v;
	return undefined;
}

/**
 * A plain decimal number, written canonically: optional sign, no leading zeros beyond
 * a bare "0", optional fractional part. Deliberately strict so identifier-ish text
 * survives: "007", "1-2", "1,5" and "1e3" all FAIL this test and pass through verbatim.
 */
const NUMERIC_LIKE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * Canonicalize a raw cell value the way the ENGINE will once the workbook is loaded --
 * returning the NORMALIZED value (a number for numeric-shaped input, else the string),
 * or undefined when the cell is empty.
 *
 * ⚠️ CORPUS FACT, load-bearing: **LuckyExcel emits numeric cell values as UNTYPED
 * STRINGS** -- a cell holding 1 arrives as `{ v: "1.0" }` with no `ct.t === "n"`.
 * The engine normalizes it to the number 1 when it loads the workbook, so at runtime
 * its `A2&"|"&B2` key reads `...|1|...` while a key built verbatim from the converted
 * JSON reads `...|1.0|...`. They never match and every helper-backed lookup returns #N/A.
 * Proven live twice in the PW-2b-i Tier-3 runs.
 *
 * **NEVER TRUST `ct.t` ON CONVERTED (PRE-LOAD) CELLDATA.** Only the post-load cell carries
 * the numeric type, which is exactly what makes this trap convincing: inspect the workbook
 * in the browser and the type looks right. Canonicalize on the value's SHAPE (NUMERIC_LIKE).
 *
 * This is the SINGLE SOURCE for the criterion/helper-key canonicalization: `criterionText`
 * (helper-key builder) and the PW-2d exact hit-value evaluator (`pricingHitEval`) both use it,
 * so an offline-computed VLOOKUP key matches the materialized helper key by construction.
 */
export function canonicalizeCellValue(raw: any): number | string | undefined {
	if (raw === undefined || raw === null || raw === "") return undefined;
	if (typeof raw === "number") return raw;
	if (typeof raw === "string" && NUMERIC_LIKE.test(raw.trim())) return Number(raw.trim()); // "1.0" -> 1
	return String(raw); // "007", "COPPER", "1-2" -- untouched
}

/** The criterion as the ENGINE's `&` renders it: the canonical value stringified. */
function criterionText(index: Map<string, any>, r0: number, colIdx: number): string | undefined {
	const v = canonicalizeCellValue(index.get(`${r0}:${colIdx}`)?.v?.v);
	return v === undefined ? undefined : String(v);
}

/**
 * True when this sheet already carries generated helper columns.
 *
 * Detection is the `_mk` marker in the first few rows -- the same signal the FIXED
 * workbooks carry. Preferred over formula-shape detection because it survives a user
 * editing a helper formula, and it is O(few cells).
 */
export function sheetHasHelpers(sheet: any): boolean {
	for (const c of sheet?.celldata || []) {
		if (typeof c?.r !== "number" || c.r >= MARKER_SCAN_ROWS) continue;
		const val = c?.v?.v;
		if (typeof val === "string" && val.trim() === HELPER_MARKER) return true;
	}
	return false;
}

/**
 * Write the allocator's ledger into the sheets: a `_mk` marker row, a key column
 * (`=B3&"|"&D3`) and a value column (`=C3`) per record, for every data row.
 *
 * `config.colhidden` is set for the generated columns (DV-2 precedent: `config`
 * survives serializeSheets, and the engine reads `config.colhidden[n]` with a null
 * check at render). NOTE the divergence from the FIXED workbooks, which left their
 * helpers VISIBLE -- hiding is the PW-2b-i spec's call, and it keeps a re-imported
 * sheet looking like the original.
 *
/** Options for materializeHelpers. */
export interface MaterializeOptions {
	/**
	 * Write EVERY ledgered pair unconditionally, bypassing the per-sheet `_mk`
	 * pre-existing skip (default false).
	 *
	 * ⚠️ ONLY the SAVE-TIME helper fix (PW-2d `applyHelperFixes`) passes `force: true`,
	 * and only because its pairs are NEW BY CONSTRUCTION: the allocator was seeded from
	 * `maxColsBySheet`, so every column it minted lands strictly BEYOND the sheet's
	 * existing content (recon Q4). Without `force`, a save-time fix on a sheet that
	 * already carries import-generated `_mk` helpers would be skipped as "pre-existing"
	 * while the rewritten VLOOKUP still pointed at the un-written columns -> #N/A (the
	 * cross-run strand hazard). The IMPORT path passes NOTHING here, keeping the skip
	 * that stops a re-import from duplicating helpers.
	 */
	force?: boolean;
}

/**
 * Returns the records actually written (skipped sheets are marked `reused: true`).
 */
export function materializeHelpers(
	sheets: any[],
	ledger: HelperRecord[],
	options: MaterializeOptions = {}
): HelperRecord[] {
	if (!ledger.length) return [];
	const byName = new Map<string, any>();
	for (const s of sheets || []) byName.set(s?.name, s);

	// SNAPSHOT which sheets already had helpers BEFORE writing anything.
	//
	// This must be a pre-pass, not a per-record check. A sheet commonly needs SEVERAL
	// helper pairs (the real Electrical import requests 6 on 'Point Wiring ' and 4 on
	// 'Switches & Sockets'); writing the first pair stamps `_mk`, so a per-record check
	// would then see the marker and skip every LATER pair on that sheet -- while the
	// rewritten formulas still pointed at those columns, leaving them empty. That bug
	// shipped into a live Tier-3 run and is what this snapshot prevents.
	//
	// `force` (save-time) bypasses the skip entirely -- see MaterializeOptions.
	const preExisting = new Set<string>();
	if (!options.force) {
		for (const s of sheets || []) if (sheetHasHelpers(s)) preExisting.add(s?.name);
	}

	const written: HelperRecord[] = [];
	for (const rec of ledger) {
		const sheet = byName.get(rec.sheet);
		if (!sheet) {
			written.push({ ...rec, reused: true });
			continue;
		}
		// Idempotency: a sheet that already had generated helpers BEFORE this run keeps
		// them (a re-import must not duplicate columns). Never true under `force`.
		if (preExisting.has(rec.sheet)) {
			written.push({ ...rec, reused: true });
			continue;
		}

		const keyIdx = colToIndex(rec.keyCol);
		const valIdx = colToIndex(rec.valCol);
		const markerRow = Math.max(0, rec.rowStart - 2); // 0-indexed row above the data
		const index = indexCells(sheet);
		const critIdx = rec.criteriaCols.map(colToIndex);
		const resultIdx = colToIndex(rec.resultCol);

		putCell(sheet, markerRow, keyIdx, { v: HELPER_MARKER, m: HELPER_MARKER, ct: { fa: "General", t: "s" } });
		putCell(sheet, markerRow, valIdx, { v: HELPER_MARKER, m: HELPER_MARKER, ct: { fa: "General", t: "s" } });

		for (let row = rec.rowStart; row <= rec.rowEnd; row++) {
			const r0 = row - 1; // celldata rows are 0-indexed
			const keyF = `=${rec.criteriaCols.map((c) => `${c}${row}`).join('&"|"&')}`;

			// BOTH the formula AND a pipeline-computed cached value. The formula alone is
			// NOT enough: this engine never evaluates formulas at load, it renders the
			// cached value (FR-6). Helpers shipped as bare formulas therefore read blank
			// at load and every VLOOKUP against them returns #N/A -- proven live in the
			// PW-2b-i Tier-3 run. The FIXED workbooks only work because Excel saved a
			// cached value beside each helper formula; this reproduces that shape.
			//
			// ACCEPTED EDGE: a source cell that is itself an unevaluated formula has no
			// value to read (10 such cells across the corpus). Rather than emit a
			// half-built key that could match the wrong row, the whole key is left EMPTY
			// for that row -- it simply never matches, which fails visibly (#N/A) instead
			// of silently returning a wrong price. The formula is still written, so the
			// row self-heals the moment the engine recalculates.
			const parts = critIdx.map((ci) => criterionText(index, r0, ci));
			const keyV = parts.some((p) => p === undefined) ? "" : parts.join("|");
			putCell(sheet, r0, keyIdx, {
				f: keyF,
				v: keyV,
				m: String(keyV),
				ct: { fa: "General", t: "s" },
			});

			const resV = sourceValue(index, r0, resultIdx);
			const valCell: Record<string, any> = { f: `=${rec.resultCol}${row}`, ct: { fa: "General" } };
			if (resV !== undefined) {
				valCell.v = resV;
				valCell.m = String(resV);
			}
			putCell(sheet, r0, valIdx, valCell);
		}

		// Hide the generated pair.
		sheet.config = sheet.config || {};
		sheet.config.colhidden = sheet.config.colhidden || {};
		sheet.config.colhidden[keyIdx] = 0;
		sheet.config.colhidden[valIdx] = 0;

		// Keep the declared width honest so the engine allocates the columns.
		const needed = valIdx + 1;
		if (typeof sheet.column === "number" && sheet.column < needed) sheet.column = needed;

		written.push({ ...rec, reused: false });
	}
	return written;
}

/** Column letter immediately after the last used column, for diagnostics/tests. */
export function firstFreeColumn(sheet: any): string {
	let max = -1;
	for (const c of sheet?.celldata || []) if (typeof c?.c === "number" && c.c > max) max = c.c;
	return indexToCol(max + 2);
}
