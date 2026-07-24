// Row-bloat clamp (PW-2b-i).
//
// WHY THIS RUNS SECOND, immediately after decodeSheetNames: it is a PERFORMANCE
// PRECONDITION for every later stage, not tidiness. The raw ELV Google export
// converts to 1,819,874 celldata entries of which 98.8% are STYLE-ONLY filler --
// two sheets alone carry 858,466 and 757,456 cells whose last row with real content
// is 25 and 14 respectively. Every later stage walks celldata; running five stages
// over 1.8M cells instead of ~22k is the difference between a responsive import and
// a multi-second renderer stall (measured: the raw ELV conversion alone blew a 45 s
// timeout during the PW-2b recon).
//
// A filler cell looks like:
//   { ct:{fa:"General"}, fc:"#000000", ff:"Calibri", fs:10, ht:0, tb:2, vt:0 }
// i.e. formatting with no `v` and no `f`. Dropping it changes nothing a user can see.
//
// NOTE on dropdowns: `attachDataValidations` runs LAST in the pipeline, so at clamp
// time no `dataVerification` exists yet and cannot be consulted. That is exactly why
// the clamp keeps a +5 row buffer -- it mirrors the `clampRangeSource` extent+5 rule
// in pricingValidations.ts, so a dropdown source range that reaches just past the
// last content row still lands inside kept data.

import type { ClampRecord } from "./pricingTransforms";

/** Rows kept beyond the last row carrying content (mirrors DV extent+5). */
export const CLAMP_BUFFER_ROWS = 5;

/** True when a converted cell carries anything a user could see or depend on. */
export function cellHasContent(cell: any): boolean {
	const v = cell?.v;
	if (!v) return false;
	if (typeof v.f === "string" && v.f) return true;
	if (v.v !== undefined && v.v !== null && v.v !== "") return true;
	return false;
}

/** Last 0-indexed row carrying content on a sheet, or -1 when the sheet is empty. */
export function lastContentRow(sheet: any): number {
	let last = -1;
	for (const c of sheet?.celldata || []) {
		if (typeof c?.r !== "number") continue;
		if (c.r > last && cellHasContent(c)) last = c.r;
	}
	return last;
}

/**
 * Drop celldata beyond `lastContentRow + CLAMP_BUFFER_ROWS` on every sheet and
 * correct the sheet's declared row count. Mutates in place (the pipeline owns this
 * tree) and returns one record per sheet that actually shrank.
 *
 * IDEMPOTENT by construction: a clamped sheet has nothing beyond the cut, so a
 * second run drops zero cells and records nothing.
 */
export function clampRowBloat(sheets: any[]): ClampRecord[] {
	const records: ClampRecord[] = [];
	for (const sheet of sheets || []) {
		const cd = sheet?.celldata;
		if (!Array.isArray(cd) || !cd.length) continue;

		let maxRow = -1;
		for (const c of cd) if (typeof c?.r === "number" && c.r > maxRow) maxRow = c.r;

		const last = lastContentRow(sheet);
		const cut = last + CLAMP_BUFFER_ROWS; // inclusive
		if (maxRow <= cut) continue; // nothing to do (also the idempotent path)

		const kept = cd.filter((c: any) => typeof c?.r === "number" && c.r <= cut);
		const dropped = cd.length - kept.length;
		if (!dropped) continue;
		sheet.celldata = kept;

		// Keep the declared grid size honest so the engine does not render 50k empty
		// rows. Only shrink -- never grow a sheet that declared fewer rows.
		const declaredRows = cut + 1;
		if (typeof sheet.row === "number" && sheet.row > declaredRows) sheet.row = declaredRows;

		// Row-level config maps are keyed by row index; prune the tail so they do not
		// resurrect the bloat on load.
		for (const key of ["rowlen", "customHeight", "rowhidden"]) {
			const map = sheet?.config?.[key];
			if (!map || typeof map !== "object") continue;
			for (const k of Object.keys(map)) {
				if (Number(k) > cut) delete map[k];
			}
		}

		records.push({ sheet: sheet?.name ?? "", fromRow: maxRow + 1, toRow: declaredRows, cellsDropped: dropped });
	}
	return records;
}

/** Total celldata entries across a workbook -- used by the census assertions. */
export function countCells(sheets: any[]): number {
	let n = 0;
	for (const s of sheets || []) n += (s?.celldata || []).length;
	return n;
}
