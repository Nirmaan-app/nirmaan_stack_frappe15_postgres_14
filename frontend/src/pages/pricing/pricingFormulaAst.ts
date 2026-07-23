// Excel-formula tokenizer + recursive-descent parser + printer (PW-2b-i).
//
// THE reason this exists rather than a pile of regexes: transforms COMPOSE inside a
// single cell. The corpus has an IFS whose two branches are each a multi-condition
// array INDEX/MATCH, and a LET whose binding wraps another one. Independent regex
// passes over a string would have to re-find their own boundaries after every edit
// and would corrupt each other. Parse once -> rewrite nodes -> print once makes
// composition free.
//
// SCOPE is deliberately the corpus subset (PW-2b recon Q4), not all of Excel:
// numbers, strings (with "" escapes), booleans, error literals, cell/range refs with
// $ anchors and sheet qualifiers (quoted names carrying & and TRAILING SPACES),
// function calls (including dotted names like __xludf.DUMMYFUNCTION), infix operators
// at Excel precedence, unary +/-, postfix %, and array literals { } (parse-only, for
// detection).
//
// ABSTAIN, NEVER THROW. `parseFormula` returns a typed result; anything it cannot
// understand comes back as { ok: false } and the pipeline passes that formula through
// UNTOUCHED and reports it. This mirrors the boq_parser's documented stance
// ("if the formula cannot be parsed unambiguously, return the conservative answer") --
// a rewriter that guesses is far worse than one that declines.

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

/** One end of a reference: a column and/or a row, each optionally $-anchored. */
export interface RefPart {
	col: string | null; // "A".."XFD"; null for a whole-row ref (1:5)
	colAbs: boolean;
	row: number | null; // 1-based; null for a whole-column ref (C:D)
	rowAbs: boolean;
}

export type Node =
	| { kind: "num"; raw: string }
	| { kind: "str"; value: string }
	| { kind: "bool"; value: boolean }
	| { kind: "err"; value: string }
	| { kind: "name"; name: string }
	| { kind: "ref"; sheet: string | null; sheetQuoted: boolean; a: RefPart; b: RefPart | null }
	| { kind: "call"; name: string; args: Node[] }
	| { kind: "unary"; op: "-" | "+"; operand: Node }
	| { kind: "postfix"; op: "%"; operand: Node }
	| { kind: "binary"; op: BinaryOp; left: Node; right: Node }
	| { kind: "paren"; inner: Node }
	| { kind: "array"; rows: Node[][] }
	// An OMITTED argument: Excel allows `IF(a,b,)` and `IF(a,,b)`, and the corpus
	// contains `=IF(M11="Single",1,IF(M11="Dual",2,))` in BOTH the raw and the FIXED
	// Electrical workbook. Printing it emits nothing, so round-trip is exact.
	| { kind: "missing" };

export type BinaryOp = "=" | "<>" | "<" | ">" | "<=" | ">=" | "&" | "+" | "-" | "*" | "/" | "^";

export type ParseResult =
	| { ok: true; ast: Node }
	| { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Tok =
	| { t: "num"; v: string }
	| { t: "str"; v: string }
	| { t: "err"; v: string }
	| { t: "ref"; v: Extract<Node, { kind: "ref" }> }
	| { t: "ident"; v: string }
	| { t: "op"; v: string }
	| { t: "punct"; v: string };

const ERRORS = ["#REF!", "#N/A", "#VALUE!", "#DIV/0!", "#NAME?", "#NUM!", "#NULL!", "#SPILL!", "#CALC!"];

// A single reference endpoint: optional $, 1-3 letters, optional $, digits.
const CELL = String.raw`\$?[A-Za-z]{1,3}\$?\d+`;
const COLONLY = String.raw`\$?[A-Za-z]{1,3}`;
const ROWONLY = String.raw`\$?\d+`;
// Sheet qualifier: 'quoted name'! (with '' escapes) or BareName!
const SHEET = String.raw`(?:'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_.]*))!`;
const REF_RE = new RegExp(
	String.raw`^(?:${SHEET})?(${CELL}|${COLONLY}|${ROWONLY})(?::(${CELL}|${COLONLY}|${ROWONLY}))?`
);

function splitPart(text: string): RefPart | null {
	// $A$1 | $A | $1
	let m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(text);
	if (m) return { col: m[2].toUpperCase(), colAbs: m[1] === "$", row: parseInt(m[4], 10), rowAbs: m[3] === "$" };
	m = /^(\$?)([A-Za-z]{1,3})$/.exec(text);
	if (m) return { col: m[2].toUpperCase(), colAbs: m[1] === "$", row: null, rowAbs: false };
	m = /^(\$?)(\d+)$/.exec(text);
	if (m) return { col: null, colAbs: false, row: parseInt(m[2], 10), rowAbs: m[1] === "$" };
	return null;
}

class LexError extends Error {}

function tokenize(src: string): Tok[] {
	const out: Tok[] = [];
	let i = 0;
	const n = src.length;
	while (i < n) {
		const ch = src[i];
		if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
			i++;
			continue;
		}
		// string literal, "" is an escaped quote
		if (ch === '"') {
			let j = i + 1;
			let val = "";
			for (;;) {
				if (j >= n) throw new LexError("unterminated string literal");
				if (src[j] === '"') {
					if (src[j + 1] === '"') {
						val += '"';
						j += 2;
						continue;
					}
					j++;
					break;
				}
				val += src[j++];
			}
			out.push({ t: "str", v: val });
			i = j;
			continue;
		}
		// error literal
		if (ch === "#") {
			const hit = ERRORS.find((e) => src.startsWith(e, i));
			if (!hit) throw new LexError(`unknown error literal at ${i}`);
			out.push({ t: "err", v: hit });
			i += hit.length;
			continue;
		}
		// number (leading digit or .digit); sign is handled as unary
		if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
			const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i))!;
			// A bare number could be the start of a row-only ref (1:5) -- only when a
			// colon follows immediately.
			if (src[i + m[0].length] === ":" && /^\$?\d+$/.test(m[0])) {
				const rm = REF_RE.exec(src.slice(i));
				if (rm) {
					out.push({ t: "ref", v: buildRef(rm) });
					i += rm[0].length;
					continue;
				}
			}
			out.push({ t: "num", v: m[0] });
			i += m[0].length;
			continue;
		}
		// reference (possibly sheet-qualified) or identifier / function name
		if (ch === "'" || /[A-Za-z_$]/.test(ch)) {
			const rm = REF_RE.exec(src.slice(i));
			if (rm) {
				const consumed = rm[0].length;
				const isQualified = rm[1] !== undefined || rm[2] !== undefined;
				const hasSecond = rm[4] !== undefined;
				const rest = src.slice(i + consumed);
				// Three guards, all load-bearing:
				//  1. BOUNDARY -- the match must not be the prefix of a longer word.
				//     Without this, COLONLY eats the first 3 letters of every function:
				//     "INDEX" lexes as ref "IND" + ident "EX", and "IFERROR" as "IFE" +
				//     "RROR". This was a real bug caught by the corpus fixtures.
				const boundaryOk = !/^[A-Za-z0-9_.]/.test(rest);
				//  2. SHAPE -- a BARE (unqualified, no ":") token is only a reference
				//     when it is letters-then-digits (A1, $A$1). A bare "AND"/"rate"
				//     is a name, not a column.
				const firstIsCell = /^\$?[A-Za-z]{1,3}\$?\d+$/.test(rm[3]);
				const looksLikeRef = isQualified || hasSecond || firstIsCell;
				//  3. CALLABLE -- an unqualified token immediately followed by "(" is a
				//     FUNCTION NAME (LOG10( would otherwise lex as a cell ref).
				const isFnCall = !isQualified && !hasSecond && /^\s*\(/.test(rest);
				if (boundaryOk && looksLikeRef && !isFnCall) {
					out.push({ t: "ref", v: buildRef(rm) });
					i += consumed;
					continue;
				}
			}
			if (ch === "'") throw new LexError("quoted sheet name not followed by a reference");
			// identifier: allows dots so __xludf.DUMMYFUNCTION lexes as ONE name
			const im = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i));
			if (!im) throw new LexError(`unexpected character '${ch}' at ${i}`);
			out.push({ t: "ident", v: im[0] });
			i += im[0].length;
			continue;
		}
		// operators (two-char first)
		const two = src.slice(i, i + 2);
		if (two === "<=" || two === ">=" || two === "<>") {
			out.push({ t: "op", v: two });
			i += 2;
			continue;
		}
		if ("=<>&+-*/^%".includes(ch)) {
			out.push({ t: "op", v: ch });
			i++;
			continue;
		}
		if ("(),{};".includes(ch)) {
			out.push({ t: "punct", v: ch });
			i++;
			continue;
		}
		throw new LexError(`unexpected character '${ch}' at ${i}`);
	}
	return out;
}

function buildRef(m: RegExpExecArray): Extract<Node, { kind: "ref" }> {
	const quoted = m[1] !== undefined;
	const sheet = quoted ? m[1].replace(/''/g, "'") : m[2] !== undefined ? m[2] : null;
	const a = splitPart(m[3]);
	if (!a) throw new LexError(`bad reference '${m[0]}'`);
	const b = m[4] ? splitPart(m[4]) : null;
	if (m[4] && !b) throw new LexError(`bad reference '${m[0]}'`);
	return { kind: "ref", sheet, sheetQuoted: quoted, a, b };
}

// ---------------------------------------------------------------------------
// Parser (precedence climbing)
// ---------------------------------------------------------------------------

// Excel precedence, loosest first. Comparison < concat < additive < multiplicative < power.
const PREC: Record<string, number> = {
	"=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1,
	"&": 2,
	"+": 3, "-": 3,
	"*": 4, "/": 4,
	"^": 5,
};

class ParseError extends Error {}

class Parser {
	private i = 0;
	constructor(private readonly toks: Tok[]) {}

	private peek(): Tok | undefined {
		return this.toks[this.i];
	}
	private next(): Tok {
		const t = this.toks[this.i++];
		if (!t) throw new ParseError("unexpected end of formula");
		return t;
	}
	private eat(t: string): void {
		const tok = this.peek();
		if (!tok || (tok.t !== "punct" && tok.t !== "op") || tok.v !== t) {
			throw new ParseError(`expected '${t}'`);
		}
		this.i++;
	}
	atEnd(): boolean {
		return this.i >= this.toks.length;
	}

	parseExpr(minPrec = 0): Node {
		let left = this.parseUnary();
		for (;;) {
			const tok = this.peek();
			if (!tok || tok.t !== "op") break;
			const prec = PREC[tok.v];
			if (prec === undefined || prec < minPrec) break;
			this.i++;
			// ^ is right-associative in Excel; the rest are left-associative.
			const right = this.parseExpr(tok.v === "^" ? prec : prec + 1);
			left = { kind: "binary", op: tok.v as BinaryOp, left, right };
		}
		return left;
	}

	private parseUnary(): Node {
		const tok = this.peek();
		if (tok && tok.t === "op" && (tok.v === "-" || tok.v === "+")) {
			this.i++;
			return { kind: "unary", op: tok.v, operand: this.parseUnary() };
		}
		return this.parsePostfix();
	}

	private parsePostfix(): Node {
		let node = this.parsePrimary();
		for (;;) {
			const tok = this.peek();
			if (tok && tok.t === "op" && tok.v === "%") {
				this.i++;
				node = { kind: "postfix", op: "%", operand: node };
				continue;
			}
			break;
		}
		return node;
	}

	private parsePrimary(): Node {
		const tok = this.next();
		if (tok.t === "num") return { kind: "num", raw: tok.v };
		if (tok.t === "str") return { kind: "str", value: tok.v };
		if (tok.t === "err") return { kind: "err", value: tok.v };
		if (tok.t === "ref") return tok.v;
		if (tok.t === "punct" && tok.v === "(") {
			const inner = this.parseExpr();
			this.eat(")");
			return { kind: "paren", inner };
		}
		if (tok.t === "punct" && tok.v === "{") return this.parseArray();
		if (tok.t === "ident") {
			const up = tok.v.toUpperCase();
			const nxt = this.peek();
			if (nxt && nxt.t === "punct" && nxt.v === "(") {
				this.i++;
				const args: Node[] = [];
				const first = this.peek();
				if (first && first.t === "punct" && first.v === ")") {
					this.i++;
					return { kind: "call", name: tok.v, args };
				}
				for (;;) {
					// An omitted argument -- the next token is the separator itself.
					const here = this.peek();
					if (here && here.t === "punct" && (here.v === "," || here.v === ")")) {
						args.push({ kind: "missing" });
					} else {
						args.push(this.parseExpr());
					}
					const sep = this.next();
					if (sep.t === "punct" && sep.v === ",") continue;
					if (sep.t === "punct" && sep.v === ")") break;
					throw new ParseError("expected ',' or ')' in argument list");
				}
				return { kind: "call", name: tok.v, args };
			}
			if (up === "TRUE") return { kind: "bool", value: true };
			if (up === "FALSE") return { kind: "bool", value: false };
			return { kind: "name", name: tok.v };
		}
		throw new ParseError(`unexpected token '${(tok as any).v}'`);
	}

	private parseArray(): Node {
		const rows: Node[][] = [];
		let row: Node[] = [];
		const closing = this.peek();
		if (closing && closing.t === "punct" && closing.v === "}") {
			this.i++;
			return { kind: "array", rows: [] };
		}
		for (;;) {
			row.push(this.parseExpr());
			const sep = this.next();
			if (sep.t === "punct" && sep.v === ",") continue;
			if (sep.t === "punct" && sep.v === ";") {
				rows.push(row);
				row = [];
				continue;
			}
			if (sep.t === "punct" && sep.v === "}") {
				rows.push(row);
				break;
			}
			throw new ParseError("expected ',', ';' or '}' in array literal");
		}
		return { kind: "array", rows };
	}
}

/**
 * Parse a formula. `src` may include the leading "=" (it is stripped).
 * NEVER throws -- unparseable input returns { ok: false, reason }.
 */
export function parseFormula(src: string): ParseResult {
	if (typeof src !== "string") return { ok: false, reason: "not a string" };
	let body = src.trim();
	if (body.startsWith("=")) body = body.slice(1);
	// Excel tolerates a leading "+" on pasted formulas (=+A1); treat it as unary.
	if (!body.trim()) return { ok: false, reason: "empty formula" };
	try {
		const toks = tokenize(body);
		const p = new Parser(toks);
		const ast = p.parseExpr();
		if (!p.atEnd()) return { ok: false, reason: "trailing tokens after expression" };
		return { ok: true, ast };
	} catch (e: any) {
		return { ok: false, reason: e?.message || "parse error" };
	}
}

// ---------------------------------------------------------------------------
// Printer
// ---------------------------------------------------------------------------

export function colToIndex(col: string): number {
	let n = 0;
	for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
	return n - 1; // 0-indexed
}

export function indexToCol(index: number): string {
	let n = index;
	let out = "";
	while (n >= 0) {
		out = String.fromCharCode((n % 26) + 65) + out;
		n = Math.floor(n / 26) - 1;
	}
	return out;
}

function printPart(p: RefPart): string {
	const c = p.col === null ? "" : `${p.colAbs ? "$" : ""}${p.col}`;
	const r = p.row === null ? "" : `${p.rowAbs ? "$" : ""}${p.row}`;
	return c + r;
}

/** A sheet name needs quoting when it is not a bare identifier (spaces, &, etc.). */
export function sheetNeedsQuotes(name: string): boolean {
	return !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name);
}

export function printRef(node: Extract<Node, { kind: "ref" }>): string {
	let prefix = "";
	if (node.sheet !== null) {
		const quote = node.sheetQuoted || sheetNeedsQuotes(node.sheet);
		prefix = quote ? `'${node.sheet.replace(/'/g, "''")}'!` : `${node.sheet}!`;
	}
	return prefix + printPart(node.a) + (node.b ? `:${printPart(node.b)}` : "");
}

/**
 * Print an AST back to formula text WITHOUT a leading "=", normalized: no
 * whitespace outside string literals. That normalization is deliberate -- it also
 * removes the `<operator><space>(` pattern the engine cannot parse (ENGINE CAUTION
 * #2), so printing is inherently safe.
 */
export function printNode(node: Node): string {
	switch (node.kind) {
		case "num":
			return node.raw;
		case "str":
			return `"${node.value.replace(/"/g, '""')}"`;
		case "bool":
			return node.value ? "TRUE" : "FALSE";
		case "err":
			return node.value;
		case "name":
			return node.name;
		case "ref":
			return printRef(node);
		case "call":
			return `${node.name}(${node.args.map(printNode).join(",")})`;
		case "unary":
			return `${node.op}${printNode(node.operand)}`;
		case "postfix":
			return `${printNode(node.operand)}%`;
		case "binary":
			return `${printNode(node.left)}${node.op}${printNode(node.right)}`;
		case "paren":
			return `(${printNode(node.inner)})`;
		case "array":
			return `{${node.rows.map((r) => r.map(printNode).join(",")).join(";")}}`;
		case "missing":
			return "";
	}
}

/** Print with the leading "=" restored -- what goes back into a cell's `f`. */
export function printFormula(node: Node): string {
	return `=${printNode(node)}`;
}

// ---------------------------------------------------------------------------
// Small AST helpers used by the transforms
// ---------------------------------------------------------------------------

/** Case-insensitive function-name test. */
export function isCall(node: Node, name: string): node is Extract<Node, { kind: "call" }> {
	return node.kind === "call" && node.name.toUpperCase() === name.toUpperCase();
}

/** Strip redundant paren wrappers -- useful when inspecting an operand's shape. */
export function unwrap(node: Node): Node {
	let n = node;
	while (n.kind === "paren") n = n.inner;
	return n;
}

/** Depth-first walk; `fn` sees every node. */
export function walk(node: Node, fn: (n: Node) => void): void {
	fn(node);
	switch (node.kind) {
		case "call":
			node.args.forEach((a) => walk(a, fn));
			break;
		case "unary":
		case "postfix":
			walk(node.operand, fn);
			break;
		case "binary":
			walk(node.left, fn);
			walk(node.right, fn);
			break;
		case "paren":
			walk(node.inner, fn);
			break;
		case "array":
			node.rows.forEach((r) => r.forEach((c) => walk(c, fn)));
			break;
		default:
			break;
	}
}

/**
 * Rebuild a node with `fn` applied bottom-up. Returns a NEW tree; the input is never
 * mutated, which is what lets a transform be tried and discarded.
 */
export function mapNode(node: Node, fn: (n: Node) => Node): Node {
	let out: Node;
	switch (node.kind) {
		case "call":
			out = { kind: "call", name: node.name, args: node.args.map((a) => mapNode(a, fn)) };
			break;
		case "unary":
			out = { kind: "unary", op: node.op, operand: mapNode(node.operand, fn) };
			break;
		case "postfix":
			out = { kind: "postfix", op: node.op, operand: mapNode(node.operand, fn) };
			break;
		case "binary":
			out = { kind: "binary", op: node.op, left: mapNode(node.left, fn), right: mapNode(node.right, fn) };
			break;
		case "paren":
			out = { kind: "paren", inner: mapNode(node.inner, fn) };
			break;
		case "array":
			out = { kind: "array", rows: node.rows.map((r) => r.map((c) => mapNode(c, fn))) };
			break;
		default:
			out = node;
	}
	return fn(out);
}

/** True when the two refs sit on the same sheet and cover the same row span. */
export function sameSheetAndRows(
	x: Extract<Node, { kind: "ref" }>,
	y: Extract<Node, { kind: "ref" }>
): boolean {
	const sx = (x.sheet ?? "").trim();
	const sy = (y.sheet ?? "").trim();
	if (sx !== sy) return false;
	return x.a.row === y.a.row && (x.b?.row ?? null) === (y.b?.row ?? null);
}

/** A single-column range like Sheet!C7:C12 -> its column, else null. */
export function singleColumnOf(ref: Extract<Node, { kind: "ref" }>): string | null {
	if (!ref.b) return ref.a.col;
	if (ref.a.col && ref.b.col && ref.a.col === ref.b.col) return ref.a.col;
	return null;
}
