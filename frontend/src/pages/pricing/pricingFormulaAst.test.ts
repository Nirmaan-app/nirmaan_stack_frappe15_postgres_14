// Unit checks for pricingFormulaAst.ts (PW-2b-i).
//
// COVERAGE SUMMARY:
//   tokenizer     -- strings with "" escapes, error literals, dotted function names
//                    (__xludf.DUMMYFUNCTION), $ anchors, quoted sheet names carrying
//                    "&" and TRAILING SPACES, whole-column refs.
//   parser        -- Excel precedence + associativity, unary/postfix, array literals,
//                    and the four real corpus shapes the transforms depend on.
//   printer       -- normalized output (no whitespace outside literals, which also
//                    kills the ENGINE CAUTION #2 operator-space-paren pattern) and the
//                    round-trip property parse(print(ast)) deep-equals ast.
//   abstain       -- malformed input returns { ok:false }, NEVER throws.
//
// Every FIXTURE_* string below is REAL text from the PW-2b recon census.

import { describe, it, expect } from "vitest";
import {
	colToIndex,
	indexToCol,
	parseFormula,
	printFormula,
	printNode,
	sameSheetAndRows,
	singleColumnOf,
	unwrap,
	type Node,
} from "./pricingFormulaAst";
import {
	ALL_FIXTURES,
	FIXTURE_ARRAY_LITERAL,
	FIXTURE_DUMMY_IMPORTRANGE,
	FIXTURE_ELV_MULTI,
	FIXTURE_INDEX_MATCH_SINGLE,
} from "./__fixtures__/corpusFormulas";

const ok = (src: string): Node => {
	const r = parseFormula(src);
	if (!r.ok) throw new Error(`expected parse to succeed: ${r.reason}`);
	return r.ast;
};

describe("column helpers", () => {
	it("round-trips column letters and indexes", () => {
		expect(colToIndex("A")).toBe(0);
		expect(colToIndex("Z")).toBe(25);
		expect(colToIndex("AA")).toBe(26);
		expect(indexToCol(0)).toBe("A");
		expect(indexToCol(26)).toBe("AA");
		expect(indexToCol(colToIndex("XFD"))).toBe("XFD");
	});
});

describe("tokenizer / parser -- literals and references", () => {
	it("parses a doubled-quote escape inside a string literal", () => {
		const ast = ok('="say ""hi"" now"');
		expect(ast).toEqual({ kind: "str", value: 'say "hi" now' });
		expect(printNode(ast)).toBe('"say ""hi"" now"');
	});

	it("keeps $ anchors on both parts of a range", () => {
		const ast = ok("='Switches & Sockets'!$N$3:$O$32");
		expect(printNode(ast)).toBe("'Switches & Sockets'!$N$3:$O$32");
	});

	it("preserves a sheet name with a TRAILING SPACE", () => {
		const ast = ok("='Point Wiring '!L25:L32");
		expect(ast).toMatchObject({ kind: "ref", sheet: "Point Wiring ", sheetQuoted: true });
		expect(printNode(ast)).toBe("'Point Wiring '!L25:L32");
	});

	it("preserves a sheet name containing &", () => {
		expect(printNode(ok("='DB & Switchgear'!O5"))).toBe("'DB & Switchgear'!O5");
	});

	it("parses an unquoted sheet-qualified ref", () => {
		expect(printNode(ok("=Ducting!C7:C12"))).toBe("Ducting!C7:C12");
	});

	it("parses whole-column refs", () => {
		expect(printNode(ok("='FA System Purchase price'!C:D"))).toBe("'FA System Purchase price'!C:D");
	});

	it("lexes a dotted function name as ONE call", () => {
		const ast = ok('=__xludf.DUMMYFUNCTION("x")');
		expect(ast).toMatchObject({ kind: "call", name: "__xludf.DUMMYFUNCTION" });
	});

	it("treats LOG10( as a function, not a cell reference", () => {
		const ast = ok("=LOG10(100)");
		expect(ast).toMatchObject({ kind: "call", name: "LOG10" });
	});

	it("parses TRUE/FALSE as booleans and error literals", () => {
		expect(ok("=FALSE")).toEqual({ kind: "bool", value: false });
		expect(ok("=#N/A")).toEqual({ kind: "err", value: "#N/A" });
	});
});

describe("parser -- precedence and associativity", () => {
	it("binds * tighter than +", () => {
		expect(printNode(ok("=1+2*3"))).toBe("1+2*3");
		expect(ok("=1+2*3")).toMatchObject({ kind: "binary", op: "+" });
	});

	it("binds ^ tighter than * and is right-associative", () => {
		expect(ok("=2^3^2")).toMatchObject({
			kind: "binary", op: "^", right: { kind: "binary", op: "^" },
		});
	});

	it("puts comparison loosest and & between", () => {
		expect(ok('=A1&"x"=B1')).toMatchObject({ kind: "binary", op: "=" });
	});

	it("handles unary minus and postfix %", () => {
		expect(printNode(ok("=-A1"))).toBe("-A1");
		expect(printNode(ok("=50%*2"))).toBe("50%*2");
	});

	it("keeps explicit parens (never changes grouping)", () => {
		expect(printNode(ok("=(1+2)*3"))).toBe("(1+2)*3");
	});
});

describe("printer -- normalization", () => {
	it("strips ALL whitespace outside string literals", () => {
		// NOTE: spaces are NOT allowed inside a range reference ("A1 : A5") -- in Excel a
		// space is the intersection operator, and no such form appears in the corpus.
		// Realistic whitespace is around operators and after argument commas.
		const out = printFormula(ok("=SUM( A1:A5 ) * 2"));
		expect(out).toBe("=SUM(A1:A5)*2");
		expect(printFormula(ok("=VLOOKUP(I9, 'DB & Switchgear'!A23:B30, 2, FALSE)")))
			.toBe("=VLOOKUP(I9,'DB & Switchgear'!A23:B30,2,FALSE)");
	});

	it("removes the operator-space-paren pattern (ENGINE CAUTION #2) for free", () => {
		expect(printFormula(ok("=2 * (1+2)"))).toBe("=2*(1+2)");
	});

	it("collapses embedded newlines", () => {
		expect(printFormula(ok("=1+\n  2"))).toBe("=1+2");
	});

	it("does not touch spaces INSIDE a literal", () => {
		expect(printFormula(ok('=A1&" With Base "'))).toBe('=A1&" With Base "');
	});
});

describe("round-trip: parse(print(ast)) deep-equals ast", () => {
	for (const [name, src] of Object.entries(ALL_FIXTURES)) {
		it(`round-trips ${name}`, () => {
			const first = ok(src);
			const printed = printFormula(first);
			const second = parseFormula(printed);
			expect(second.ok).toBe(true);
			if (!second.ok) return;
			expect(second.ast).toEqual(first);
			// and printing is idempotent
			expect(printFormula(second.ast)).toBe(printed);
		});
	}
});

describe("real corpus shapes the transforms rely on", () => {
	it("IMPORTRANGE payload stays INSIDE a string literal (never parsed as code)", () => {
		const ast = ok(FIXTURE_DUMMY_IMPORTRANGE) as any;
		expect(ast.kind).toBe("call");
		expect(ast.name.toUpperCase()).toBe("IFERROR");
		const dummy = ast.args[0];
		expect(dummy.name).toBe("__xludf.DUMMYFUNCTION");
		expect(dummy.args[0].kind).toBe("str");
		expect(dummy.args[0].value).toContain("IMPORTRANGE(");
		// the URL's ?gid=...#gid=... survived verbatim inside the literal
		expect(dummy.args[0].value).toContain("#gid=1879627304");
	});

	it("array literal parses as one row of two columns", () => {
		const ast = ok(FIXTURE_ARRAY_LITERAL);
		let arr: any = null;
		const find = (n: any) => {
			if (!n || typeof n !== "object") return;
			if (n.kind === "array") arr = n;
			for (const k of Object.keys(n)) find((n as any)[k]);
		};
		find(ast);
		expect(arr).not.toBeNull();
		expect(arr.rows).toHaveLength(1);
		expect(arr.rows[0]).toHaveLength(2);
	});

	it("multi-condition MATCH keeps its (range=criterion) products", () => {
		const ast = ok(FIXTURE_ELV_MULTI) as any;
		const idx = ast.args[0].left ?? ast.args[0];
		expect(printNode(ast)).toContain("MATCH(1,");
		expect(printNode(ast)).toContain("(Extinguishers!F3:F1000=B7)*(Extinguishers!G3:G1000=B8)");
		expect(idx).toBeTruthy();
	});

	it("single-condition INDEX/MATCH exposes its ranges for geometry checks", () => {
		const ast = ok(FIXTURE_INDEX_MATCH_SINGLE) as any;
		const index = unwrap(ast.left) as any;
		expect(index.name.toUpperCase()).toBe("INDEX");
		const result = index.args[0];
		const match = index.args[1];
		const lookupRange = match.args[1];
		expect(singleColumnOf(result)).toBe("C");
		expect(singleColumnOf(lookupRange)).toBe("B");
		expect(sameSheetAndRows(result, lookupRange)).toBe(true);
	});
});

describe("ABSTAIN -- never throws", () => {
	for (const bad of [
		"=SUM(",              // unbalanced
		'="unterminated',     // open string
		"=1+",                // dangling operator
		"=)A1(",              // garbage
		"=",                  // empty body
		"=@#$%",              // unknown chars
		"=A1 A1",             // trailing tokens (intersection unsupported)
	]) {
		it(`returns ok:false for ${JSON.stringify(bad)}`, () => {
			const r = parseFormula(bad);
			expect(r.ok).toBe(false);
			if (!r.ok) expect(typeof r.reason).toBe("string");
		});
	}

	it("returns ok:false for non-string input rather than throwing", () => {
		expect(parseFormula(undefined as any).ok).toBe(false);
	});
});
