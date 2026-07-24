// Import-time extraction of Excel data validations -> Luckysheet dropdowns (DV-2).
//
// WHY THIS EXISTS: LuckyExcel silently drops every <dataValidation> in the source
// workbook, so imported sheets lose all their dropdowns (DV-1 Q2 confirmed: zero
// on all three stored workbooks). The engine itself supports them fine -- it just
// needs the records handed to it. So we re-read the SAME uploaded .xlsx with the
// JSZip we already vendor, translate the validations, and attach them.
//
// ENGINE SCHEMA (DV-1 Q1, read from the vendored source):
//   sheet.dataVerification = { "<row>_<col>": record }   -- 0-indexed, PER CELL.
//   There is no range-spanning record, so an Excel sqref of C6:C8 becomes three
//   identical records. `value1` is polymorphic: if it parses as a cell range the
//   engine reads that range (cross-sheet included, quoted names with spaces and
//   `&` work -- verified live); otherwise it is split on commas as a literal list.

// JSZip is VENDORED and script-injected as a global (pricingLibs LUCKYSHEET_SCRIPTS),
// NOT an npm dependency -- importing it would pull ~100 KB into the app bundle and
// break the keep-the-engine-unbundled rule. Read it off window at call time.
declare global {
	interface Window {
		JSZip: any;
	}
}

/** One dropdown record, exactly the engine's `defaultItem` shape. */
export interface DropdownRecord {
	type: "dropdown";
	type2: null;
	value1: string;
	value2: string;
	checked: boolean;
	remote: boolean;
	prohibitInput: boolean;
	hintShow: boolean;
	hintText: string;
}

/**
 * ADVISORY MODE (decision on record, owner-vetoable): prohibitInput is FALSE
 * everywhere. The engine then still flags an off-list value with a red corner
 * triangle, but does not block the edit. Setting it true would hard-reject typed
 * values -- deliberately not done without an explicit call, because a hard block
 * on estimation data is a workflow decision, not a technical one.
 *
 * NOTE (DV-1 Q3.4): either way, validation only guards TYPING. Programmatic
 * writes (our import, the FR-6 re-entry pass, any bulk write) bypass it entirely.
 */
const PROHIBIT_INPUT = false;

function colLetterToIndex(letters: string): number {
	let n = 0;
	for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
	return n - 1; // 0-indexed
}

/** Split an A1-style token into its letters + row number, ignoring `$`. */
function parseA1(token: string): { col: number; row: number } | null {
	const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(token.trim());
	if (!m) return null;
	return { col: colLetterToIndex(m[1]), row: parseInt(m[2], 10) - 1 };
}

/**
 * Expand an Excel `sqref` into 0-indexed [row, col] pairs.
 * sqref is space-separated and each part may be a single cell or a range:
 * `"C23 C26"`, `"I10:I14"`, `"B166:B168"`.
 */
export function expandSqref(sqref: string): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	for (const part of sqref.split(/\s+/).filter(Boolean)) {
		const [a, b] = part.split(":");
		const start = parseA1(a);
		if (!start) continue;
		const end = b ? parseA1(b) : start;
		if (!end) continue;
		for (let r = Math.min(start.row, end.row); r <= Math.max(start.row, end.row); r++) {
			for (let c = Math.min(start.col, end.col); c <= Math.max(start.col, end.col); c++) {
				out.push([r, c]);
			}
		}
	}
	return out;
}

/**
 * Clamp a range-source `value1` to the source sheet's REAL data extent (+5).
 *
 * WHY: several sources are authored as `'FA System Purchase price'!$A$2:$A50498`.
 * The engine walks the whole range and de-dupes on every dropdown open, so a
 * 50,000-row range costs 50,000 iterations per click for a handful of options.
 * Clamping keeps behaviour identical (the tail is empty) and the interaction cheap.
 *
 * Sheet qualifier and quoting are preserved byte-for-byte; only the trailing row
 * number is rewritten. A literal comma list is returned untouched.
 */
export function clampRangeSource(
	value1: string,
	extentBySheet: Record<string, number>,
	ownSheetName: string
): string {
	const v = value1.trim();
	if (v.startsWith('"')) return value1; // literal list -- not a range
	// [sheetQualifier!]start:end  -- capture the end token's letters + row
	const m = /^(.*!)?(\$?[A-Za-z]+\$?\d+):(\$?[A-Za-z]+\$?)(\d+)$/.exec(v);
	if (!m) return value1;
	const [, qualifier, startTok, endCol, endRowStr] = m;
	let sheetName = ownSheetName;
	if (qualifier) {
		sheetName = qualifier.slice(0, -1); // drop the '!'
		if (sheetName.startsWith("'") && sheetName.endsWith("'")) {
			sheetName = sheetName.slice(1, -1).replace(/''/g, "'");
		}
	}
	const extent = extentBySheet[sheetName];
	if (extent === undefined) return value1; // unknown sheet -- leave as authored
	const endRow = parseInt(endRowStr, 10);
	const capped = Math.min(endRow, extent + 5);
	if (capped >= endRow) return value1; // already tighter than the extent
	return `${qualifier || ""}${startTok}:${endCol}${capped}`;
}

/** Last 1-indexed row carrying any value, per DECODED sheet name. */
function dataExtents(sheets: any[]): Record<string, number> {
	const out: Record<string, number> = {};
	for (const sheet of sheets || []) {
		let max = 0;
		for (const cell of sheet?.celldata || []) {
			const v = cell?.v;
			const has = v && (v.v !== undefined && v.v !== null && v.v !== "" || v.f);
			if (has && cell.r + 1 > max) max = cell.r + 1;
		}
		out[sheet.name] = max;
	}
	return out;
}

function decodeEntities(s: string): string {
	return s
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#39;/g, "'")
		.replace(/&#10;/g, "\n")
		.replace(/&amp;/g, "&"); // LAST, so "&amp;lt;" -> "&lt;"
}

/**
 * Parse every list-type data validation out of an .xlsx and attach the engine's
 * dropdown records to the matching converted sheets (mutates + returns `sheets`).
 *
 * Handles BOTH the plain `<dataValidation>` elements and the `<x14:dataValidation>`
 * extLst variant (several of our sources use the latter). Sheet matching walks
 * workbook.xml order, which is the same order LuckyExcel emits.
 */
export async function attachDataValidations(file: File, sheets: any[]): Promise<number> {
	let attached = 0;
	try {
		if (!window.JSZip) return 0; // engine scripts not loaded -- import still proceeds
		const zip = await window.JSZip.loadAsync(file);
		// Sheet order from workbook.xml -> matches the converted sheet order.
		const wbXml: string | undefined = await zip.file("xl/workbook.xml")?.async("string");
		if (!wbXml) return 0;
		const names = [...wbXml.matchAll(/<sheet[^>]*\sname="([^"]*)"/g)].map((m) =>
			decodeEntities(m[1])
		);
		const extents = dataExtents(sheets);

		const sheetFiles = Object.keys(zip.files)
			.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
			.sort((a, b) => {
				const na = parseInt(a.replace(/\D/g, ""), 10);
				const nb = parseInt(b.replace(/\D/g, ""), 10);
				return na - nb;
			});

		for (let i = 0; i < sheetFiles.length; i++) {
			const xml: string = await zip.file(sheetFiles[i]).async("string");
			const sheetName = names[i];
			const target = (sheets || []).find((s) => s.name === sheetName);
			if (!target) continue;

			const records: Record<string, DropdownRecord> = target.dataVerification || {};
			const blocks = xml.match(
				/<(?:x14:)?dataValidation\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:x14:)?dataValidation>)/g
			);
			for (const block of blocks || []) {
				if (!/type="list"/.test(block)) continue;
				const f1 = /<(?:x14:)?formula1>([\s\S]*?)<\/(?:x14:)?formula1>/.exec(block);
				if (!f1) continue;
				const raw = decodeEntities(f1[1].replace(/<\/?xm:f>/g, "").trim());
				if (!raw) continue;
				// A literal list arrives quoted ("A,B,C") -- the engine wants it bare.
				const isLiteral = raw.startsWith('"') && raw.endsWith('"');
				const value1 = isLiteral
					? raw.slice(1, -1)
					: clampRangeSource(raw, extents, sheetName);

				const sqAttr = /sqref="([^"]*)"/.exec(block);
				const sqTag = /<xm:sqref>([\s\S]*?)<\/xm:sqref>/.exec(block);
				const sqref = decodeEntities((sqAttr?.[1] ?? sqTag?.[1] ?? "").trim());
				if (!sqref) continue;

				for (const [r, c] of expandSqref(sqref)) {
					records[`${r}_${c}`] = {
						type: "dropdown",
						type2: null,
						value1,
						value2: "",
						checked: false,
						remote: false,
						prohibitInput: PROHIBIT_INPUT,
						hintShow: false,
						hintText: "",
					};
					attached++;
				}
			}
			if (Object.keys(records).length) target.dataVerification = records;
		}
	} catch {
		// Never block an import on validation parsing -- the workbook itself is the
		// payload; dropdowns are an enhancement.
		return attached;
	}
	return attached;
}
