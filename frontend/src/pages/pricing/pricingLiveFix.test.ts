// Unit checks for pricingLiveFix.ts (PW-2b-ii) -- the ELIGIBILITY rule.
//
// COVERAGE SUMMARY:
//   fixable  -- IFS, LET, XLOOKUP, and a direct single-cond INDEX/MATCH all rewrite
//               with ZERO helper requests, so all are fixable in place; the rewritten
//               string is returned for the live setCellValue.
//   deferred -- multi-cond INDEX/MATCH and a result-left-of-lookup single-cond both
//               request a helper pair -> not fixable, reason "needs helper columns".
//   no fix   -- an unknown function and a bare INDEX (no MATCH) parse fine but have no
//               sanctioned rewrite -> reason "no sanctioned rewrite".
//   freeze   -- a dead-Google cell is fixable via the freeze path (drop f, keep value).
//   abstain  -- an inline array literal is declined with the transform's own reason.
//
// assessFix is PURE (no engine); applyLiveFix is engine-bound and is exercised in the
// live Tier-3 run, not here.

import { describe, it, expect } from "vitest";
import {
	REASON_NEEDS_HELPER,
	REASON_NO_REWRITE,
	assessFix,
} from "./pricingLiveFix";
import {
	FIXTURE_ARRAY_LITERAL,
	FIXTURE_DUMMY_IMPORTRANGE,
	FIXTURE_INDEX_MATCH_SINGLE,
	FIXTURE_XLOOKUP,
} from "./__fixtures__/corpusFormulas";

describe("assessFix -- FIXABLE in place (zero helper requests)", () => {
	it("an IFS is fixable and returns the nested-IF rewrite", () => {
		const a = assessFix("=IFS(1=1,42,TRUE,0)");
		expect(a.fixable).toBe(true);
		if (a.fixable && a.kind === "rewrite") {
			expect(a.rewritten).toBe("=IF(1=1,42,0)");
		} else {
			throw new Error("expected a rewrite");
		}
	});

	it("a LET is fixable and inlines its binding", () => {
		const a = assessFix("=LET(x,A1*2,x+1)");
		expect(a.fixable).toBe(true);
		if (a.fixable && a.kind === "rewrite") expect(a.rewritten).toBe("=A1*2+1");
	});

	it("a direct single-cond INDEX/MATCH is fixable (no helper needed)", () => {
		const a = assessFix(FIXTURE_INDEX_MATCH_SINGLE, "ALL ITEM WISE RATE");
		expect(a.fixable).toBe(true);
		if (a.fixable && a.kind === "rewrite") {
			expect(a.rewritten).toContain("VLOOKUP(");
			expect(a.rewritten).toContain(",2,0)");
		}
	});

	it("an XLOOKUP is fixable by geometry", () => {
		const a = assessFix(FIXTURE_XLOOKUP, "ADP");
		expect(a.fixable).toBe(true);
		if (a.fixable && a.kind === "rewrite") expect(a.rewritten).toContain("VLOOKUP(B165,Ducting!C7:F12,4,0)");
	});
});

describe("assessFix -- DEFERRED to Replace (needs helper columns)", () => {
	it("a multi-cond array INDEX/MATCH is NOT fixable in place", () => {
		const a = assessFix(
			"=INDEX(R!C2:C9, MATCH(1,(R!A2:A9=X1)*(R!B2:B9=X2),0))",
			"Calc"
		);
		expect(a.fixable).toBe(false);
		if (!a.fixable) expect(a.reason).toBe(REASON_NEEDS_HELPER);
	});

	it("a single-cond INDEX/MATCH with result LEFT of lookup needs a helper", () => {
		const a = assessFix("=INDEX(Ducting!C7:C12, MATCH(B165, Ducting!F7:F12, 0))", "X");
		expect(a.fixable).toBe(false);
		if (!a.fixable) expect(a.reason).toBe(REASON_NEEDS_HELPER);
	});
});

describe("assessFix -- NO automatic fix", () => {
	it("an unknown function has no sanctioned rewrite", () => {
		const a = assessFix('=TEXTJOIN(",",TRUE,A1:A5)');
		expect(a.fixable).toBe(false);
		if (!a.fixable) expect(a.reason).toBe(REASON_NO_REWRITE);
	});

	it("a bare INDEX with no MATCH has no sanctioned rewrite", () => {
		const a = assessFix("=INDEX(A1:A5,2)*2");
		expect(a.fixable).toBe(false);
		if (!a.fixable) expect(a.reason).toBe(REASON_NO_REWRITE);
	});

	it("an inline array literal is declined with the transform's reason", () => {
		const a = assessFix(FIXTURE_ARRAY_LITERAL, "FA_System with  Markup");
		expect(a.fixable).toBe(false);
		if (!a.fixable) expect(a.reason).toMatch(/array literal/);
	});
});

describe("assessFix -- dead-Google freeze", () => {
	it("a DUMMYFUNCTION cell is fixable via the freeze path", () => {
		const a = assessFix(FIXTURE_DUMMY_IMPORTRANGE, "Sprinkler with Markup");
		expect(a.fixable).toBe(true);
		if (a.fixable) expect(a.kind).toBe("freeze");
	});
});
