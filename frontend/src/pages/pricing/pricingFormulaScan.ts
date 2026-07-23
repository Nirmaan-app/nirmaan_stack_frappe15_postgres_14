// Save-time formula advisory for the Pricing Module (PW-2a, spec item 5).
//
// WARN-ONLY. This module never rewrites a formula and never blocks a save -- it
// reports what the user is about to persist so they can decide. Consent-based
// FIXING is PW-2b; keep this module pure and side-effect free so that upgrade is
// a caller change, not a rewrite here.
//
// WHY IT EXISTS: the vendored engine silently mis-evaluates or refuses a small set
// of constructs, and because the engine never evaluates formulas at load (it renders
// the cached value), a bad formula persists a wrong NUMBER that looks authoritative
// forever. The three rules below are the ones we have evidence for:
//
//   1. INDEX -- ENGINE CAUTION #1 (owner-locked). `=INDEX(r,2)` is fine, but
//      `=INDEX(r,2)*2` returns 0. Detecting "in composition" needs a real
//      expression parse; we flag INDEX ANYWHERE instead. That is the honest cheap
//      rule: advisory, so a false positive on a bare `=INDEX(r,2)` costs one
//      dismissible line, while the silent-zero case is never missed.
//   2. XLOOKUP / IFS / LET -- verified absent from the vendored bundle (a grep for
//      all three returns zero hits while SUMPRODUCT returns five, so the grep is
//      discriminating). Excel-authored workbooks carry them; the engine cannot.
//   3. Any function name outside the engine's own registry. The set is supplied by
//      the CALLER (see supportedFunctionsFromEngine) rather than hardcoded here, so
//      it tracks the engine instead of drifting from it.
//
// DELIBERATELY NOT A RULE: `<operator><space>(` (ENGINE CAUTION #2). It is already
// repaired by normalizeFormulaText + the FR-6 re-entry pass before a scan ever runs,
// so warning about it would be noise about a solved problem.

/** One flagged formula cell. */
export interface FormulaScanHit {
	/** Sheet name, as stored (already decoded by decodeSheetNames). */
	sheet: string;
	/** A1-style address, for display. */
	cell: string;
	/** 0-indexed grid position, kept so a future PW-2b fixer can address the cell. */
	row: number;
	col: number;
	/** The formula text exactly as it will be persisted. */
	formula: string;
	/** One human-readable line per distinct problem found in this cell. */
	reasons: string[];
}

/**
 * Functions the engine PARSES but mis-evaluates in composition. Flagged wherever
 * they appear. See rule 1 above.
 */
export const COMPOSITION_UNSAFE: readonly string[] = ["INDEX"];

/**
 * Functions known to be absent from the vendored engine. These would also be caught
 * by the unknown-name rule when a supported set is available -- they are listed
 * explicitly so the check still fires when it is NOT (see scanFormula's `supported`
 * = null path).
 */
export const KNOWN_UNSUPPORTED: readonly string[] = ["XLOOKUP", "IFS", "LET"];

/**
 * Below this many entries the engine registry is assumed half-initialised and is
 * NOT trusted as a supported-function set. The live registry carries 371 names
 * (measured on the loaded pricing page, 2026-07-23); a real regression would drop
 * far below 50 rather than shave a few off.
 */
const MIN_PLAUSIBLE_REGISTRY_SIZE = 50;

/**
 * Build the supported-function set from the engine's own registry
 * (`window.luckysheet_function`), which is a plain object keyed by UPPERCASE
 * function name.
 *
 * Returns null when the global is missing or implausibly small -- callers then skip
 * the unknown-name rule entirely (fail-OPEN, because this is advisory: a missing
 * registry must never manufacture warnings on every formula in the workbook). The
 * explicit COMPOSITION_UNSAFE / KNOWN_UNSUPPORTED rules still apply in that case.
 */
export function supportedFunctionsFromEngine(registry: unknown): Set<string> | null {
	if (!registry || typeof registry !== "object") return null;
	const keys = Object.keys(registry as Record<string, unknown>);
	if (keys.length < MIN_PLAUSIBLE_REGISTRY_SIZE) return null;
	return new Set(keys.map((k) => k.toUpperCase()));
}

/** 0-indexed column number -> Excel column letters (0 -> A, 26 -> AA). */
export function columnLabel(col: number): string {
	let n = col;
	let out = "";
	while (n >= 0) {
		out = String.fromCharCode((n % 26) + 65) + out;
		n = Math.floor(n / 26) - 1;
	}
	return out;
}

/** 0-indexed (row, col) -> A1 address. */
export function cellLabel(row: number, col: number): string {
	return `${columnLabel(col)}${row + 1}`;
}

// Quoted spans in an Excel formula, BOTH kinds:
//   "..."  string literals   (a literal quote is doubled: "")
//   '...'  sheet-name references ('My Sheet'!A1; a literal apostrophe is doubled)
// Both must be excluded before looking for function calls. Missing the SINGLE-quoted
// case would flag a sheet named `'Sheet (old)'` as a call to a function "SHEET".
const QUOTED_SPAN = /("(?:[^"]|"")*"|'(?:[^']|'')*')/;

/**
 * Remove every quoted span from a formula, leaving only the code. Used so text
 * content can never be mistaken for a function call -- a cell holding
 * `="INDEX of items"` is NOT an INDEX call and must not be flagged.
 */
export function stripQuotedSpans(formula: string): string {
	// split() keeps the captured delimiters: even indexes are code, odd are quoted.
	const parts = formula.split(QUOTED_SPAN);
	let out = "";
	for (let i = 0; i < parts.length; i += 2) out += parts[i];
	return out;
}

// An identifier immediately followed by `(` is a function call. Anchoring on the
// paren is what keeps cell references (A1), range names and sheet qualifiers out:
// none of them is followed by an open paren.
const FUNCTION_CALL = /([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g;

/**
 * Every function name called in a formula, UPPERCASED and de-duplicated, in first-
 * appearance order. Quoted spans are ignored.
 */
export function extractFunctionNames(formula: string): string[] {
	const code = stripQuotedSpans(formula || "");
	const seen = new Set<string>();
	const out: string[] = [];
	FUNCTION_CALL.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = FUNCTION_CALL.exec(code)) !== null) {
		const name = m[1].toUpperCase();
		if (seen.has(name)) continue;
		seen.add(name);
		out.push(name);
	}
	return out;
}

/**
 * Scan ONE formula. Returns a reason line per distinct problem; an empty array means
 * nothing to warn about.
 *
 * `supported` = the engine's function set, or null to skip the unknown-name rule
 * (see supportedFunctionsFromEngine).
 */
export function scanFormula(formula: string, supported: ReadonlySet<string> | null): string[] {
	if (typeof formula !== "string" || !formula) return [];
	const reasons: string[] = [];
	for (const name of extractFunctionNames(formula)) {
		if (COMPOSITION_UNSAFE.includes(name)) {
			reasons.push(
				`${name}() returns 0 when combined with another operator (engine limitation) - use VLOOKUP against a key-first helper pair.`
			);
			continue;
		}
		if (KNOWN_UNSUPPORTED.includes(name)) {
			reasons.push(`${name}() is not supported by the pricing engine.`);
			continue;
		}
		if (supported && !supported.has(name)) {
			reasons.push(`${name}() is not a function the pricing engine recognises.`);
		}
	}
	return reasons;
}

/**
 * Scan a serialized workbook (the output of serializeSheets) and return every
 * flagged cell. Pure: reads `sheets[].celldata[].v.f` and mutates nothing.
 *
 * Call it AFTER serializeSheets so the scan sees exactly the text that will be
 * persisted -- serializeSheets' final normalization guard can still rewrite `f`.
 */
export function scanWorkbookFormulas(
	sheets: any[],
	supported: ReadonlySet<string> | null
): FormulaScanHit[] {
	const hits: FormulaScanHit[] = [];
	for (const sheet of sheets || []) {
		for (const cell of sheet?.celldata || []) {
			const f = cell?.v?.f;
			if (typeof f !== "string" || !f) continue;
			const reasons = scanFormula(f, supported);
			if (!reasons.length) continue;
			hits.push({
				sheet: sheet?.name ?? "",
				cell: cellLabel(cell.r, cell.c),
				row: cell.r,
				col: cell.c,
				formula: f,
				reasons,
			});
		}
	}
	return hits;
}
