// EXACT offline evaluation of a rewritten helper-class hit (PW-2d v2, FIXED-CELL DISPLAY).
//
// After `applyHelperFixesOffline` rewrites a multi-condition INDEX/MATCH to a
// `VLOOKUP(key, helperRange, 2, 0)` and MATERIALIZES the helper key/value columns into the
// serialized payload, the rewritten cell's value is knowable WITHOUT the engine: the VLOOKUP
// is a dictionary lookup in data the planner just built, and any surrounding wrapper is a
// handful of simple arithmetic. Computing it here lets us store the cell's cached `v` so it
// DISPLAYS immediately (live + on reload), instead of blank-until-recalc.
//
// ⚠️ EXACT-OR-ABSENT is the whole contract. We evaluate ONLY constructs whose result is
// provably identical to what the engine would compute:
//   * a cell/range reference whose value is PRESENT in the serialized payload,
//   * string concat `&`, unary +/-, and `+ - * /` over resolvable operands (same IEEE ops
//     the engine uses),
//   * `VLOOKUP(key, range, n, 0)` -- exact-match only -- resolved as a dictionary lookup in
//     the payload's own celldata,
//   * `ROUND` / `ROUNDUP` / `ROUNDDOWN` with an integer digits argument.
// ANYTHING ELSE -- an unknown function, ANY IF/IFS/IFERROR (or other branch) construct, a
// comparison, `^`, `%`, a MISSING reference, a VLOOKUP that does not match, a matched row with
// no value -- makes the whole evaluation ABSTAIN (`undefined`). We NEVER approximate: a blank
// cell that recomputes on the next edit is honest; a stored-but-wrong value is the exact
// failure mode this module exists to prevent. Because the engine renders cached values on load
// (FR-6), a wrong cached `v` would display wrong until a recalc -- unacceptable.

import { canonicalizeCellValue } from "./pricingHelpers";
import { colToIndex, parseFormula, unwrap, type Node } from "./pricingFormulaAst";

/** Thrown internally the moment any sub-expression is not exactly evaluable. */
class NotExact extends Error {}

interface EvalCtx {
	/** sheetName -> ("r:c" -> cell.v), lazily built from the serialized celldata. */
	indexFor: (sheetName: string) => Map<string, any>;
	/** The sheet a bare (unqualified) reference resolves to. */
	hitSheet: string;
}

function makeCtx(sheets: any[], hitSheet: string): EvalCtx {
	const byName = new Map<string, any>();
	for (const s of sheets || []) byName.set(s?.name, s);
	const cache = new Map<string, Map<string, any>>();
	return {
		hitSheet,
		indexFor(sheetName: string) {
			const hit = cache.get(sheetName);
			if (hit) return hit;
			const m = new Map<string, any>();
			for (const c of byName.get(sheetName)?.celldata || []) m.set(`${c.r}:${c.c}`, c.v);
			cache.set(sheetName, m);
			return m;
		},
	};
}

function asNumber(v: number | string): number {
	if (typeof v === "number") return v;
	throw new NotExact(); // a string in a numeric context -> abstain (never coerce)
}
function asText(v: number | string): string {
	return typeof v === "number" ? String(v) : v;
}

/** Resolve a SINGLE-cell reference to its canonical value, or abstain. */
function resolveRef(node: Extract<Node, { kind: "ref" }>, ctx: EvalCtx): number | string {
	if (node.b) throw new NotExact(); // a range in scalar position
	if (node.a.col == null || node.a.row == null) throw new NotExact();
	const sheetName = node.sheet ?? ctx.hitSheet;
	const cell = ctx.indexFor(sheetName).get(`${node.a.row - 1}:${colToIndex(node.a.col)}`);
	const v = canonicalizeCellValue(cell?.v); // the map stores the v-object; `.v` is the raw value
	if (v === undefined) throw new NotExact(); // missing ref
	return v;
}

/** VLOOKUP(key, range, colIndex, 0) resolved as an exact-match dictionary lookup. */
function evalVlookup(args: Node[], ctx: EvalCtx): number | string {
	if (args.length < 4) throw new NotExact(); // our rewrites ALWAYS emit the ,0) 4th arg
	const key = asText(evalNode(args[0], ctx));
	const range = unwrap(args[1]);
	if (range.kind !== "ref" || !range.b || range.a.col == null || range.a.row == null || range.b.row == null) {
		throw new NotExact();
	}
	const colIndex = asNumber(evalNode(args[2], ctx));
	if (!Number.isInteger(colIndex) || colIndex < 1) throw new NotExact();
	const exactArg = args[3];
	const exact = exactArg.kind === "num" ? Number(exactArg.raw) : exactArg.kind === "bool" ? (exactArg.value ? 1 : 0) : NaN;
	if (exact !== 0) throw new NotExact(); // only exact-match VLOOKUP is a safe dictionary lookup

	const sheetName = range.sheet ?? ctx.hitSheet;
	const idx = ctx.indexFor(sheetName);
	const keyCol = colToIndex(range.a.col);
	const retCol = keyCol + (colIndex - 1);
	for (let row = range.a.row; row <= range.b.row; row++) {
		const kv = canonicalizeCellValue(idx.get(`${row - 1}:${keyCol}`)?.v); // map stores the v-object
		if (kv === undefined) continue;
		if (String(kv) === key) {
			const rv = canonicalizeCellValue(idx.get(`${row - 1}:${retCol}`)?.v);
			if (rv === undefined) throw new NotExact(); // matched but the value cell is empty
			return rv;
		}
	}
	throw new NotExact(); // no match -> #N/A at runtime -> store nothing
}

function evalCall(node: Extract<Node, { kind: "call" }>, ctx: EvalCtx): number | string {
	const name = node.name.toUpperCase();
	if (name === "VLOOKUP") return evalVlookup(node.args, ctx);
	if (name === "ROUND" || name === "ROUNDUP" || name === "ROUNDDOWN") {
		if (node.args.length !== 2) throw new NotExact();
		const x = asNumber(evalNode(node.args[0], ctx));
		const d = asNumber(evalNode(node.args[1], ctx));
		if (!Number.isInteger(d)) throw new NotExact();
		const f = Math.pow(10, d);
		const sign = x < 0 ? -1 : 1;
		const ax = Math.abs(x);
		// Excel semantics: ROUND is half-away-from-zero; ROUNDUP/DOWN are away/toward zero.
		const mag = name === "ROUND" ? Math.round(ax * f) / f : name === "ROUNDUP" ? Math.ceil(ax * f) / f : Math.floor(ax * f) / f;
		return sign * mag;
	}
	throw new NotExact(); // IF / IFS / IFERROR / unknown function -> abstain
}

function evalNode(node: Node, ctx: EvalCtx): number | string {
	switch (node.kind) {
		case "num":
			return Number(node.raw);
		case "str":
			return node.value;
		case "paren":
			return evalNode(node.inner, ctx);
		case "ref":
			return resolveRef(node, ctx);
		case "call":
			return evalCall(node, ctx);
		case "unary": {
			const v = asNumber(evalNode(node.operand, ctx));
			return node.op === "-" ? -v : v;
		}
		case "binary": {
			if (node.op === "&") return asText(evalNode(node.left, ctx)) + asText(evalNode(node.right, ctx));
			const a = asNumber(evalNode(node.left, ctx));
			const b = asNumber(evalNode(node.right, ctx));
			switch (node.op) {
				case "+":
					return a + b;
				case "-":
					return a - b;
				case "*":
					return a * b;
				case "/":
					if (b === 0) throw new NotExact(); // #DIV/0! -> abstain
					return a / b;
				default:
					throw new NotExact(); // comparisons, ^ -> abstain
			}
		}
		default:
			// bool, err, name, array, postfix (%), missing -> abstain
			throw new NotExact();
	}
}

/**
 * Compute the EXACT value of a rewritten hit formula against the serialized payload
 * (which already carries the materialized helper columns), or `undefined` if it cannot be
 * evaluated exactly. Never throws.
 */
export function computeHitValueExact(
	sheets: any[],
	hitSheet: string,
	rewrittenFormula: string
): number | string | undefined {
	const parsed = parseFormula(rewrittenFormula);
	if (!parsed.ok) return undefined;
	try {
		return evalNode(parsed.ast, makeCtx(sheets, hitSheet));
	} catch {
		return undefined;
	}
}
