// Formula transform suite (PW-2b-i) -- the six rewrites that turn a RAW workbook
// into one the vendored engine can actually evaluate, plus the dead-Google freeze.
//
// EVERY rewrite is AST -> AST via pricingFormulaAst. Regex rewriting is not viable
// here because transforms COMPOSE inside one cell: the corpus has an IFS whose two
// branches are each a multi-condition array INDEX/MATCH, and a LET whose binding
// wraps another one. A single bottom-up `mapNode` pass handles that for free -- inner
// nodes are rewritten before their parents, which is also what stops LET inlining
// from duplicating an expensive INDEX/MATCH (by the time the LET is inlined, its
// binding is already a cheap VLOOKUP).
//
// ABSTAIN IS A FIRST-CLASS OUTCOME. Anything not understood is left untouched and
// reported. A rewriter that guesses is far worse than one that declines.
//
// freezeDeadGoogle lives HERE rather than in its own module (a deliberate call): it
// is detection-over-the-same-AST, it shares the walker, and splitting it would mean
// parsing every formula twice.

import {
	colToIndex,
	indexToCol,
	isCall,
	mapNode,
	parseFormula,
	printFormula,
	printNode,
	printRef,
	sameSheetAndRows,
	sheetNeedsQuotes,
	singleColumnOf,
	unwrap,
	walk,
	type Node,
} from "./pricingFormulaAst";
import { materializeHelpers } from "./pricingHelpers";

// ---------------------------------------------------------------------------
// Report contract -- ALSO the data contract for the PW-2b-ii dialog
// ---------------------------------------------------------------------------

export type TransformClass =
	| "index-match-multi"
	| "index-match-single"
	| "ifs"
	| "let"
	| "xlookup"
	| "array-literal"
	| "harmonized"
	| "frozen";

export interface TransformRecord {
	sheet: string;
	cell: string; // A1
	row: number; // 0-indexed, durable address for a future "jump to cell"
	col: number;
	classes: TransformClass[]; // a cell can hit several (IFS + index-match-multi)
	oldF: string;
	newF: string | null; // null when frozen (formula removed, cached value kept)
	note?: string;
	helpers?: string[]; // e.g. ["Switches & Sockets!N:O"]
}

export interface AbstainRecord {
	sheet: string;
	cell: string;
	row: number;
	col: number;
	formula: string;
	reason: string;
}

export interface HelperRecord {
	sheet: string;
	keyCol: string;
	valCol: string;
	rowStart: number;
	rowEnd: number;
	criteriaCols: string[];
	resultCol: string;
	keyFormulaSample: string;
	reused: boolean;
}

export interface ClampRecord {
	sheet: string;
	fromRow: number;
	toRow: number;
	cellsDropped: number;
}

export interface ImportReport {
	transforms: TransformRecord[];
	helpers: HelperRecord[];
	frozen: TransformRecord[];
	abstained: AbstainRecord[];
	clamp: ClampRecord[];
	counts: Record<string, number>;
	perSheet: Record<string, { transforms: number; frozen: number; abstained: number }>;
}

export function emptyReport(): ImportReport {
	return { transforms: [], helpers: [], frozen: [], abstained: [], clamp: [], counts: {}, perSheet: {} };
}

/** A1-style label from a 0-indexed cell position. */
export function cellRef(row: number, col: number): string {
	return `${indexToCol(col)}${row + 1}`;
}

// ---------------------------------------------------------------------------
// Helper-column allocation (the ledger the materializer later writes out)
// ---------------------------------------------------------------------------

/**
 * How far an outlier criterion-range END may sit from the consensus and still be
 * treated as a typo. Deliberately tiny: 2 rows fixes the real off-by-one/two errors
 * in the corpus without ever silently re-scoping a lookup.
 */
export const MAX_HARMONIZE_ROWS = 2;

/** Functions treated as dead Google artifacts -- frozen to their cached value. */
const DEAD_GOOGLE = ["IMPORTRANGE", "ARRAYFORMULA", "REGEXMATCH", "GOOGLEFINANCE", "QUERY"];

export interface HelperHandle {
	keyCol: string;
	valCol: string;
	sheet: string;
	rowStart: number;
	rowEnd: number;
}

export class HelperAllocator {
	/** signature -> handle */
	private readonly bySig = new Map<string, HelperHandle>();
	private readonly records: HelperRecord[] = [];
	/** sheet -> next free column index */
	private readonly nextCol = new Map<string, number>();

	constructor(private readonly startCols: Record<string, number>) {}

	private static sig(sheet: string, rowStart: number, rowEnd: number, crit: string[], result: string) {
		return `${sheet}|${rowStart}-${rowEnd}|${crit.join(",")}|${result}`;
	}

	/**
	 * Reserve (or reuse) a key/value column pair. Reuse is keyed on the exact
	 * signature, so two cells looking up the same table share one helper pair --
	 * which is also what makes a second pipeline run add nothing.
	 */
	request(
		sheet: string,
		rowStart: number,
		rowEnd: number,
		criteriaCols: string[],
		resultCol: string
	): HelperHandle {
		const sig = HelperAllocator.sig(sheet, rowStart, rowEnd, criteriaCols, resultCol);
		const hit = this.bySig.get(sig);
		if (hit) return hit;

		const start = this.nextCol.get(sheet) ?? (this.startCols[sheet] ?? 0) + 2;
		const handle: HelperHandle = {
			sheet,
			keyCol: indexToCol(start),
			valCol: indexToCol(start + 1),
			rowStart,
			rowEnd,
		};
		this.nextCol.set(sheet, start + 2);
		this.bySig.set(sig, handle);
		this.records.push({
			sheet,
			keyCol: handle.keyCol,
			valCol: handle.valCol,
			rowStart,
			rowEnd,
			criteriaCols,
			resultCol,
			keyFormulaSample: `=${criteriaCols.map((c) => `${c}${rowStart}`).join('&"|"&')}`,
			reused: false,
		});
		return handle;
	}

	ledger(): HelperRecord[] {
		return this.records;
	}
}

// ---------------------------------------------------------------------------
// Shared builders
// ---------------------------------------------------------------------------

function num(raw: string | number): Node {
	return { kind: "num", raw: String(raw) };
}
function str(value: string): Node {
	return { kind: "str", value };
}
function call(name: string, args: Node[]): Node {
	return { kind: "call", name, args };
}
// Quote a generated sheet reference ONLY when the name requires it, so a bare name
// like `Ducting` stays bare and the rewritten formula reads like the source.
function absRange(sheet: string | null, c1: string, r1: number, c2: string, r2: number): Node {
	return {
		kind: "ref",
		sheet,
		sheetQuoted: sheet !== null && sheetNeedsQuotes(sheet),
		a: { col: c1, colAbs: true, row: r1, rowAbs: true },
		b: { col: c2, colAbs: true, row: r2, rowAbs: true },
	};
}
function plainRange(sheet: string | null, c1: string, r1: number, c2: string, r2: number): Node {
	return {
		kind: "ref",
		sheet,
		sheetQuoted: sheet !== null && sheetNeedsQuotes(sheet),
		a: { col: c1, colAbs: false, row: r1, rowAbs: false },
		b: { col: c2, colAbs: false, row: r2, rowAbs: false },
	};
}
/**
 * VLOOKUP's range_lookup argument for an EXACT match.
 *
 * MUST be the number 0, never the boolean FALSE. The vendored engine returns #NAME?
 * for the whole cell when it meets a TRUE/FALSE literal -- proven live during the
 * PW-2b-i Tier-3 run (`...,2,FALSE)` -> #NAME? while `...,2,0)` parses). The FIXED
 * workbooks use `,2,0)` throughout, so this also matches the corpus convention.
 */
const EXACT_MATCH: Node = { kind: "num", raw: "0" };

/** crit1 & "|" & crit2 & ... -- the composite key the FIXED workbooks already use. */
function joinKey(parts: Node[]): Node {
	return parts.reduce((acc, p, i) =>
		i === 0 ? p : { kind: "binary", op: "&", left: { kind: "binary", op: "&", left: acc, right: str("|") }, right: p }
	);
}

class Abstain extends Error {}
function abstain(reason: string): never {
	throw new Abstain(reason);
}

/**
 * Fallback for a lookup that sits inside an IF branch. A TEXT string, deliberately.
 *
 * ENGINE CAUTION A (PW-2b-i, defect 5): **the engine evaluates ALL branches of an IF
 * and propagates any branch's error.** It does not short-circuit. So an untaken branch
 * whose VLOOKUP simply finds no match returns #N/A and poisons the whole cell --
 * proven live with a FRESH cell containing `IF(4<=25, <matching VLOOKUP>, <non-matching
 * VLOOKUP>)`, which yields #N/A even though the condition is trivially true.
 *
 * ENGINE CAUTION B (the sting in the tail): **the fallback must NOT be error-spelled.**
 * The engine coerces the literal string `"#N/A"` back into the #N/A ERROR value --
 * `ISTEXT("#N/A")` is `false` -- so using it as the fallback re-poisons the very IF the
 * wrap exists to protect. Measured live, same formula, only the token differing:
 *     "#N/A" -> #N/A      "MISS" -> 82.55      "n/a" -> 82.55
 * `"n/a"` is the chosen token: `ISTEXT("n/a")` is true, it survives concatenation
 * (`"n/a|end"`), and it still reads as a miss to a human. Never use an error spelling.
 *
 * Net effect: an untaken branch resolves to harmless text, while a genuine miss in the
 * TAKEN branch still shows the user "n/a" -- fail-visibly, never a silent blank.
 */
const BRANCH_MISS_FALLBACK = "n/a";

/**
 * Wrap generated lookups that sit inside an IF branch (see BRANCH_MISS_FALLBACK).
 *
 * Only lookups THIS suite generated are wrapped, and only inside branches --
 * a standalone rewrite stays bare and honest, and the user's own formulas are never
 * touched. An existing else-value (Z10's `""`) is preserved verbatim because we only
 * ever wrap the lookup node itself, never the branch.
 */
function wrapBranchLookups(node: Node, generated: Set<Node>, inBranch: boolean): Node {
	if (inBranch && generated.has(node) && !isCall(node, "IFERROR")) {
		return call("IFERROR", [node, str(BRANCH_MISS_FALLBACK)]);
	}
	switch (node.kind) {
		case "call": {
			// For IF, args[1] and args[2] are the branches. Once inside a branch, stay
			// inside it, so a lookup nested in an inner IF's condition is covered too.
			const isIf = node.name.toUpperCase() === "IF";
			return {
				kind: "call",
				name: node.name,
				args: node.args.map((a, i) =>
					wrapBranchLookups(a, generated, isIf ? inBranch || i >= 1 : inBranch)
				),
			};
		}
		case "unary":
			return { kind: "unary", op: node.op, operand: wrapBranchLookups(node.operand, generated, inBranch) };
		case "postfix":
			return { kind: "postfix", op: node.op, operand: wrapBranchLookups(node.operand, generated, inBranch) };
		case "binary":
			return {
				kind: "binary",
				op: node.op,
				left: wrapBranchLookups(node.left, generated, inBranch),
				right: wrapBranchLookups(node.right, generated, inBranch),
			};
		case "paren":
			return { kind: "paren", inner: wrapBranchLookups(node.inner, generated, inBranch) };
		case "array":
			return { kind: "array", rows: node.rows.map((r) => r.map((c) => wrapBranchLookups(c, generated, inBranch))) };
		default:
			return node;
	}
}

// ---------------------------------------------------------------------------
// (a)+(b) INDEX / MATCH
// ---------------------------------------------------------------------------

interface Ctx {
	alloc: HelperAllocator;
	classes: Set<TransformClass>;
	helpers: Set<string>;
	/**
	 * The sheet the formula LIVES on. An unqualified range (`E2:E293`) means "this
	 * sheet", and the corpus uses that form for same-sheet lookups -- 4 of the 6
	 * Electrical cells that first abstained were exactly this. Helper columns must be
	 * allocated against this name, while the emitted range stays unqualified so the
	 * rewritten formula reads like its neighbours.
	 */
	sheetName: string;
	/** Human-readable `old -> new` notes for any range pulled onto the consensus. */
	harmonized: string[];
	/** Lookup nodes THIS suite generated -- the only ones eligible for IFERROR wrapping. */
	generated: Set<Node>;
}

/** Split a `*` chain into its factors, in source order. */
function productFactors(node: Node): Node[] {
	const n = unwrap(node);
	if (n.kind === "binary" && n.op === "*") return [...productFactors(n.left), ...productFactors(n.right)];
	return [n];
}

/** From `(range = criterion)` (either order) pull the range and the criterion. */
function equalityPair(node: Node): { range: Extract<Node, { kind: "ref" }>; crit: Node } | null {
	const n = unwrap(node);
	if (n.kind !== "binary" || n.op !== "=") return null;
	const l = unwrap(n.left);
	const r = unwrap(n.right);
	if (l.kind === "ref" && l.b) return { range: l, crit: n.right };
	if (r.kind === "ref" && r.b) return { range: r, crit: n.left };
	return null;
}

function rewriteIndexMatch(node: Extract<Node, { kind: "call" }>, ctx: Ctx): Node | null {
	if (node.args.length !== 2) return null;
	const result = unwrap(node.args[0]);
	const match = unwrap(node.args[1]);
	if (result.kind !== "ref") return null;
	if (!isCall(match, "MATCH")) return null;
	if (match.args.length < 2) return null;

	const resultCol = singleColumnOf(result);
	// An unqualified range refers to the sheet the formula lives on.
	const sheet = result.sheet ?? ctx.sheetName;
	const emitSheet = result.sheet; // null -> keep the rewritten range unqualified too
	const r1 = result.a.row;
	const r2 = result.b?.row ?? result.a.row;
	if (!resultCol || !sheet || r1 === null || r2 === null) {
		abstain("INDEX result range is not a single-column, row-bounded range");
	}

	const first = unwrap(match.args[0]);
	const isMultiShape = first.kind === "num" && first.raw === "1";

	// ---- (a) multi-condition array form: MATCH(1,(r=c)*(r=c)...,0)
	if (isMultiShape) {
		const factors = productFactors(match.args[1]);
		const pairs = factors.map(equalityPair);
		if (pairs.some((p) => p === null)) abstain("MATCH(1,...) product is not all (range=criterion) factors");
		const good = pairs as { range: Extract<Node, { kind: "ref" }>; crit: Node }[];
		for (const p of good) {
			if (!singleColumnOf(p.range)) abstain("a criterion range is not a single column");
			if ((p.range.sheet ?? ctx.sheetName) !== sheet) {
				abstain("a criterion range is on a different sheet from the result range");
			}
		}

		// CRITERION-RANGE HARMONIZATION (owner-directed, data-adjudicated).
		//
		// Real workbooks contain off-by-one typos in one arm of an array product --
		// Electrical's Z10 multiplies Termination!A2:A96 * B2:B97 * C2:C96 * D2:D96.
		// Owner adjudication on record: Termination row 96 ends the <=25 sub-table and
		// row 97 opens the ARMOURED/35 table that the SAME formula's other branch reads
		// as 97:297, so :97 is the typo and :96 is correct.
		//
		// Rule: take the row span held by a strict MAJORITY of the ranges (criteria +
		// result) as the consensus, and pull an outlier onto it when it shares the start
		// row and its end is within MAX_HARMONIZE_ROWS. Anything else -- a tie, a
		// different start row, a bigger gap -- still abstains. Those bounds are what keep
		// this a typo-fixer rather than a guesser.
		const ranges = [...good.map((p) => p.range), result];
		const spans = ranges.map((r) => ({ s: r.a.row, e: r.b?.row ?? r.a.row }));
		if (spans.some((sp) => sp.s === null || sp.e === null)) abstain("a range is not row-bounded");

		const freq = new Map<string, number>();
		for (const sp of spans) {
			const k = `${sp.s}-${sp.e}`;
			freq.set(k, (freq.get(k) || 0) + 1);
		}
		const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1]);
		if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) {
			abstain("criterion ranges disagree with no majority row span");
		}
		const [consensusStart, consensusEnd] = ranked[0][0].split("-").map(Number);

		for (let i = 0; i < ranges.length; i++) {
			const sp = spans[i];
			if (sp.s === consensusStart && sp.e === consensusEnd) continue;
			if (sp.s !== consensusStart || Math.abs((sp.e as number) - consensusEnd) > MAX_HARMONIZE_ROWS) {
				abstain("a criterion range differs from the consensus span by more than an off-by-N end");
			}
			const rng = ranges[i];
			const before = printRef(rng);
			if (!rng.b) rng.b = { ...rng.a };
			rng.b.row = consensusEnd;
			const delta = Math.abs((sp.e as number) - consensusEnd);
			ctx.classes.add("harmonized");
			ctx.harmonized.push(
				`${before} -> ${printRef(rng)} (off-by-${delta} harmonized to consensus)`
			);
		}

		const criteriaCols = good.map((p) => singleColumnOf(p.range)!);
		const h = ctx.alloc.request(sheet, consensusStart, consensusEnd, criteriaCols, resultCol);
		ctx.classes.add("index-match-multi");
		ctx.helpers.add(`${sheet}!${h.keyCol}:${h.valCol}`);
		const generatedMulti = call("VLOOKUP", [
			joinKey(good.map((p) => p.crit)),
			absRange(emitSheet, h.keyCol, consensusStart, h.valCol, consensusEnd),
			num(2),
			EXACT_MATCH,
		]);
		ctx.generated.add(generatedMulti);
		return generatedMulti;
	}

	// ---- (b) single-condition form: MATCH(value, range, 0)
	const lookupRange = unwrap(match.args[1]);
	if (lookupRange.kind !== "ref") abstain("MATCH lookup range is not a reference");
	const lookupCol = singleColumnOf(lookupRange);
	if (!lookupCol) abstain("MATCH lookup range is not a single column");
	if (!sameSheetAndRows(lookupRange, result)) {
		abstain("MATCH lookup range does not share the result range's sheet and rows");
	}
	const li = colToIndex(lookupCol);
	const ri = colToIndex(resultCol);
	ctx.classes.add("index-match-single");
	if (li < ri) {
		// Direct VLOOKUP -- lookup column is left of the result column.
		const direct = call("VLOOKUP", [
			match.args[0],
			plainRange(emitSheet, lookupCol, r1, resultCol, r2),
			num(ri - li + 1),
			EXACT_MATCH,
		]);
		ctx.generated.add(direct);
		return direct;
	}
	// Result is left of the lookup column -> VLOOKUP cannot look leftwards; use a helper.
	const h = ctx.alloc.request(sheet, r1, r2, [lookupCol], resultCol);
	ctx.helpers.add(`${sheet}!${h.keyCol}:${h.valCol}`);
	const viaHelper = call("VLOOKUP", [
		match.args[0],
		absRange(emitSheet, h.keyCol, r1, h.valCol, r2),
		num(2),
		EXACT_MATCH,
	]);
	ctx.generated.add(viaHelper);
	return viaHelper;
}

// ---------------------------------------------------------------------------
// (c) IFS -> nested IF
// ---------------------------------------------------------------------------

function rewriteIfs(node: Extract<Node, { kind: "call" }>, ctx: Ctx): Node {
	const args = node.args;
	if (args.length < 2 || args.length % 2 !== 0) abstain("IFS needs an even number of condition/value arguments");
	const pairs: [Node, Node][] = [];
	for (let i = 0; i < args.length; i += 2) pairs.push([args[i], args[i + 1]]);

	// A trailing TRUE condition is the author's default; otherwise IFS returns #N/A.
	let fallback: Node = call("NA", []);
	const last = pairs[pairs.length - 1];
	if (unwrap(last[0]).kind === "bool" && (unwrap(last[0]) as any).value === true) {
		fallback = last[1];
		pairs.pop();
	}
	ctx.classes.add("ifs");
	let out = fallback;
	for (let i = pairs.length - 1; i >= 0; i--) out = call("IF", [pairs[i][0], pairs[i][1], out]);
	return out;
}

// ---------------------------------------------------------------------------
// (d) LET -> inline
// ---------------------------------------------------------------------------

function substitute(node: Node, name: string, value: Node): Node {
	const target = name.toUpperCase();
	return mapNode(node, (n) => (n.kind === "name" && n.name.toUpperCase() === target ? value : n));
}

function rewriteLet(node: Extract<Node, { kind: "call" }>, ctx: Ctx): Node {
	const args = node.args;
	if (args.length < 3 || args.length % 2 === 0) abstain("LET needs name/value pairs followed by a body");
	const bindings: [string, Node][] = [];
	for (let i = 0; i + 1 < args.length - 1; i += 2) {
		const nameNode = unwrap(args[i]);
		if (nameNode.kind !== "name") abstain("LET binding name is not a plain name");
		bindings.push([nameNode.name, args[i + 1]]);
	}
	let body = args[args.length - 1];
	// LET semantics: a later value may reference an earlier name, so substitute
	// forwards through the remaining values as well as the body.
	for (let i = 0; i < bindings.length; i++) {
		const [name, value] = bindings[i];
		for (let j = i + 1; j < bindings.length; j++) {
			bindings[j][1] = substitute(bindings[j][1], name, value);
		}
		body = substitute(body, name, value);
	}
	ctx.classes.add("let");
	return body;
}

// ---------------------------------------------------------------------------
// (e) XLOOKUP -> VLOOKUP
// ---------------------------------------------------------------------------

function rewriteXlookup(node: Extract<Node, { kind: "call" }>, ctx: Ctx): Node {
	const args = node.args;
	if (args.length < 3) abstain("XLOOKUP needs at least lookup value, lookup range and result range");
	if (args.length > 4) abstain("XLOOKUP with match-mode / search-mode arguments is not mapped");
	const lookupRange = unwrap(args[1]);
	const resultRange = unwrap(args[2]);
	if (lookupRange.kind !== "ref" || resultRange.kind !== "ref") abstain("XLOOKUP ranges are not references");
	const lc = singleColumnOf(lookupRange);
	const rc = singleColumnOf(resultRange);
	const sheet = resultRange.sheet ?? ctx.sheetName;
	const emitSheet = resultRange.sheet;
	const r1 = resultRange.a.row;
	const r2 = resultRange.b?.row ?? resultRange.a.row;
	if (!lc || !rc || !sheet || r1 === null || r2 === null) abstain("XLOOKUP ranges are not single-column row-bounded ranges");
	if (!sameSheetAndRows(lookupRange, resultRange)) abstain("XLOOKUP lookup and result ranges differ in sheet or rows");

	ctx.classes.add("xlookup");
	const li = colToIndex(lc);
	const ri = colToIndex(rc);
	let core: Node;
	if (li < ri) {
		core = call("VLOOKUP", [args[0], plainRange(emitSheet, lc, r1, rc, r2), num(ri - li + 1), EXACT_MATCH]);
	} else {
		const h = ctx.alloc.request(sheet, r1, r2, [lc], rc);
		ctx.helpers.add(`${sheet}!${h.keyCol}:${h.valCol}`);
		core = call("VLOOKUP", [args[0], absRange(emitSheet, h.keyCol, r1, h.valCol, r2), num(2), EXACT_MATCH]);
	}
	ctx.generated.add(core);
	// A 4th argument is XLOOKUP's if-not-found -> IFERROR wrap.
	if (args.length === 4) {
		const wrapped = call("IFERROR", [core, args[3]]);
		ctx.generated.add(wrapped);
		return wrapped;
	}
	return core;
}

// ---------------------------------------------------------------------------
// Dead-Google detection (freeze to cached value)
// ---------------------------------------------------------------------------

export interface FreezeVerdict {
	freeze: boolean;
	note?: string;
}

/** Detect Google-only constructs as CODE. String payloads are invisible to this. */
export function detectDeadGoogle(ast: Node): FreezeVerdict {
	let freeze = false;
	let importrange = false;
	walk(ast, (n) => {
		if (n.kind !== "call") return;
		const up = n.name.toUpperCase();
		if (up.includes("DUMMYFUNCTION") || up.startsWith("__XLUDF")) freeze = true;
		if (DEAD_GOOGLE.includes(up)) {
			freeze = true;
			if (up === "IMPORTRANGE") importrange = true;
		}
	});
	if (!freeze) return { freeze: false };
	return {
		freeze: true,
		note: importrange ? "IMPORTRANGE fallback literal -- review" : undefined,
	};
}

/**
 * A DUMMYFUNCTION payload can still MENTION IMPORTRANGE inside its string argument.
 * That is the common case in this corpus, and it deserves the same review flag, so
 * check string literals too -- for the NOTE only, never for detection.
 */
export function noteForFrozen(ast: Node): string | undefined {
	let importrange = false;
	walk(ast, (n) => {
		if (n.kind === "call" && n.name.toUpperCase() === "IMPORTRANGE") importrange = true;
		if (n.kind === "str" && /\bIMPORTRANGE\s*\(/i.test(n.value)) importrange = true;
	});
	return importrange ? "IMPORTRANGE fallback literal -- review" : undefined;
}

// ---------------------------------------------------------------------------
// Per-formula driver
// ---------------------------------------------------------------------------

export type FormulaOutcome =
	| { status: "unchanged" }
	| { status: "rewritten"; formula: string; classes: TransformClass[]; helpers: string[]; note?: string }
	| { status: "freeze"; classes: TransformClass[]; note?: string }
	| { status: "abstain"; reason: string };

/**
 * Transform ONE formula. Pure apart from the allocator ledger it may extend.
 * `alloc` is shared across the workbook so identical lookups share helper columns.
 */
export function transformFormula(src: string, alloc: HelperAllocator, sheetName = ""): FormulaOutcome {
	const parsed = parseFormula(src);
	if (!parsed.ok) return { status: "abstain", reason: parsed.reason };

	const dead = detectDeadGoogle(parsed.ast);
	if (dead.freeze) {
		return { status: "freeze", classes: ["frozen"], note: noteForFrozen(parsed.ast) };
	}

	const ctx: Ctx = { alloc, classes: new Set(), helpers: new Set(), sheetName, harmonized: [], generated: new Set() };
	let out: Node;
	try {
		out = mapNode(parsed.ast, (n) => {
			if (n.kind === "array") {
				// The FIXED workbooks prove no mapping for an inline array literal, and
				// the two corpus cells also spill over a range -- decline, do not guess.
				ctx.classes.add("array-literal");
				abstain("inline array literal { } has no proven rewrite");
			}
			if (n.kind !== "call") return n;
			const up = n.name.toUpperCase();
			if (up === "INDEX") {
				const r = rewriteIndexMatch(n, ctx);
				return r ?? n;
			}
			if (up === "IFS") return rewriteIfs(n, ctx);
			if (up === "LET") return rewriteLet(n, ctx);
			if (up === "XLOOKUP") return rewriteXlookup(n, ctx);
			return n;
		});
	} catch (e: any) {
		if (e instanceof Abstain) return { status: "abstain", reason: e.message };
		return { status: "abstain", reason: e?.message || "transform error" };
	}

	if (!ctx.classes.size) return { status: "unchanged" };

	// Defect 5: the engine evaluates BOTH IF branches and propagates any branch error,
	// so a generated lookup sitting in a branch must not be able to yield one.
	out = wrapBranchLookups(out, ctx.generated, false);
	return {
		status: "rewritten",
		formula: printFormula(out),
		classes: [...ctx.classes],
		helpers: [...ctx.helpers],
		note: ctx.harmonized.length ? ctx.harmonized.join("; ") : undefined,
	};
}

// ---------------------------------------------------------------------------
// Sheet-level driver
// ---------------------------------------------------------------------------

/** Largest used column index per sheet, from celldata (call AFTER the clamp). */
export function maxColsBySheet(sheets: any[]): Record<string, number> {
	const out: Record<string, number> = {};
	for (const s of sheets || []) {
		let max = -1;
		for (const c of s?.celldata || []) if (typeof c?.c === "number" && c.c > max) max = c.c;
		out[s?.name] = max;
	}
	return out;
}

/**
 * Walk every formula cell, rewriting in place. Returns the report fragments; helper
 * COLUMNS are not written here -- `materializeHelpers` (pricingHelpers.ts) consumes
 * the allocator ledger, keeping this stage a pure formula pass.
 */
export function transformSheets(
	sheets: any[],
	alloc: HelperAllocator
): { transforms: TransformRecord[]; frozen: TransformRecord[]; abstained: AbstainRecord[] } {
	const transforms: TransformRecord[] = [];
	const frozen: TransformRecord[] = [];
	const abstained: AbstainRecord[] = [];

	for (const sheet of sheets || []) {
		const name = sheet?.name ?? "";
		for (const cell of sheet?.celldata || []) {
			const v = cell?.v;
			const f = v?.f;
			if (typeof f !== "string" || !f) continue;
			const outcome = transformFormula(f, alloc, name);
			const base = { sheet: name, cell: cellRef(cell.r, cell.c), row: cell.r, col: cell.c };

			if (outcome.status === "abstain") {
				abstained.push({ ...base, formula: f, reason: outcome.reason });
				continue;
			}
			if (outcome.status === "unchanged") continue;
			if (outcome.status === "freeze") {
				// Drop the formula, keep whatever the sheet already displays.
				delete v.f;
				frozen.push({ ...base, classes: ["frozen"], oldF: f, newF: null, note: outcome.note });
				continue;
			}
			v.f = outcome.formula;
			// The cached value is now stale relative to the rewritten formula; the engine
			// recomputes on entry, and PM-5's serializeSheets drops stale v/m for any
			// formula it still has to fix. Keep v so the sheet renders until recalc.
			transforms.push({
				...base,
				classes: outcome.classes,
				oldF: f,
				newF: outcome.formula,
				note: outcome.note,
				helpers: outcome.helpers.length ? outcome.helpers : undefined,
			});
		}
	}
	return { transforms, frozen, abstained };
}

/**
 * Stages 4-6 of the import pipeline: freezeDeadGoogle -> transformFormulas ->
 * materializeHelpers.
 *
 * These three are ONE function on purpose: freeze and transform are decisions over
 * the same parse, so splitting them into separate passes would parse every formula
 * twice for no benefit. The clamp (stage 2) and normalize (stage 3) stay separate
 * because they must run BEFORE this and are owned by other modules.
 */
export function runFormulaStage(sheets: any[]): {
	transforms: TransformRecord[];
	frozen: TransformRecord[];
	abstained: AbstainRecord[];
	helpers: HelperRecord[];
} {
	const alloc = new HelperAllocator(maxColsBySheet(sheets));
	const { transforms, frozen, abstained } = transformSheets(sheets, alloc);
	const helpers = materializeHelpers(sheets, alloc.ledger());
	return { transforms, frozen, abstained, helpers };
}

/** Fill `counts` + `perSheet` from the collected records. */
export function finalizeReport(report: ImportReport): ImportReport {
	const counts: Record<string, number> = {};
	const perSheet: ImportReport["perSheet"] = {};
	const bump = (sheet: string, key: "transforms" | "frozen" | "abstained") => {
		perSheet[sheet] = perSheet[sheet] || { transforms: 0, frozen: 0, abstained: 0 };
		perSheet[sheet][key] += 1;
	};
	for (const t of report.transforms) {
		for (const c of t.classes) counts[c] = (counts[c] || 0) + 1;
		bump(t.sheet, "transforms");
	}
	for (const f of report.frozen) {
		counts.frozen = (counts.frozen || 0) + 1;
		bump(f.sheet, "frozen");
	}
	for (const a of report.abstained) {
		counts.abstained = (counts.abstained || 0) + 1;
		bump(a.sheet, "abstained");
	}
	if (report.helpers.length) counts.helpersAdded = report.helpers.filter((h) => !h.reused).length;
	const droppedCells = report.clamp.reduce((n, c) => n + c.cellsDropped, 0);
	if (droppedCells) counts.cellsDropped = droppedCells;
	report.counts = counts;
	report.perSheet = perSheet;
	return report;
}

/** Print helper for reports/tests. */
export function summarize(report: ImportReport): string {
	const c = report.counts;
	return Object.keys(c).length
		? Object.entries(c).map(([k, v]) => `${k}=${v}`).join(" ")
		: "(no changes)";
}

export { printNode };
