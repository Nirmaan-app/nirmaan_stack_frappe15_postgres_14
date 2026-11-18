// SELROW -- unit pins for the suggest-run COMPLETION MESSAGE.
//
// Plain-English coverage. The message used to read `summary.results.length`, which is the whole
// DOCUMENT (carried + newly extracted) -- i.e. the POPULATION -- so a 4-row scoped run reported
// "94" and a partial run read as a full one. It also said "wiring rows" when the population spans
// seven categories. These tests pin what the message reports for each run shape, POSITIVELY (the
// right counts appear) and NEGATIVELY (the population number never appears on a scoped run, no
// zero-valued line is ever printed, and "wiring" is gone).
//
// V8: this is the unit pin the build brief prefers over a live run -- verifying the wording costs
// nothing and spends no AI credit.
import { describe, it, expect } from "vitest";
import {
  suggestOutcomeCounts,
  suggestCompletionLine,
  suggestAiStatusWarning,
  deriveSuggestModalPhase,
  suggestPercent,
  serverRefusalText,
  SUGGEST_BADGES_LINE,
  type SuggestModalSummary,
} from "./RateSuggestProgressModal";

/** A document of `n` rows -- what `results` carries (carried + newly extracted). */
const doc = (n: number) => Array.from({ length: n }, (_, i) => ({ excel_row: i + 1 }));

const wholeSheetComplete: SuggestModalSummary = {
  status: "success", run_status: "complete", results: doc(94),
  attempted_count: 94, population_count: 94, scoped_row_count: null,
};
const scopedComplete: SuggestModalSummary = {
  status: "success", run_status: "complete", results: doc(94),
  attempted_count: 94, population_count: 94, scoped_row_count: 4,
};
const wholeSheetHalted: SuggestModalSummary = {
  status: "partial", run_status: "partial", results: doc(12),
  attempted_count: 12, population_count: 94, scoped_row_count: null,
  halt_reason: "An AI request kept failing.",
};
const scopedHalted: SuggestModalSummary = {
  status: "partial", run_status: "partial", results: doc(94),
  attempted_count: 94, population_count: 94, scoped_row_count: 4,
  pass_attempted_count: 2,                 // this pass finished 2 of the 4 ticked rows
  halt_reason: "An AI request kept failing.",
};
/** The SAME halted scoped run as it arrives from a payload that predates the pass count. */
const scopedHaltedLegacy: SuggestModalSummary = { ...scopedHalted, pass_attempted_count: undefined };

describe("suggestOutcomeCounts (what actually RAN, never the population)", () => {
  it("WHOLE-SHEET COMPLETE: every row re-extracted, nothing carried, nothing missed", () => {
    expect(suggestOutcomeCounts(wholeSheetComplete)).toEqual({
      reExtracted: 94, carriedForward: null, notReached: null, splitUnavailable: false,
    });
  });

  it("SCOPED COMPLETE: re-extracted is the SCOPE, carried is the rest of the document", () => {
    expect(suggestOutcomeCounts(scopedComplete)).toEqual({
      reExtracted: 4, carriedForward: 90, notReached: null, splitUnavailable: false,
    });
  });

  it("WHOLE-SHEET HALTED: three-way split is exact from attempted vs population", () => {
    expect(suggestOutcomeCounts(wholeSheetHalted)).toEqual({
      reExtracted: 12, carriedForward: null, notReached: 82, splitUnavailable: false,
    });
  });

  it("SCOPED HALTED: all THREE counts, from the pass's own count", () => {
    // attempted_count is DOCUMENT-level here (carried rows already count as attempted), so it
    // would report 94 and make "not reached" come out as 0. pass_attempted_count is the pass's own.
    expect(suggestOutcomeCounts(scopedHalted)).toEqual({
      reExtracted: 2,        // this pass finished 2
      carriedForward: 92,    // 94 document rows it never touched
      notReached: 2,         // 2 of the 4 ticked rows left unfinished
      splitUnavailable: false,
    });
  });

  it("SCOPED HALTED on a LEGACY payload: degrades to the honest 'split unavailable'", () => {
    // backwards compatibility: a payload from before the pass count must not invent numbers
    expect(suggestOutcomeCounts(scopedHaltedLegacy).splitUnavailable).toBe(true);
    expect(suggestOutcomeCounts(scopedHaltedLegacy).notReached).toBeNull();
  });

  it("a null summary yields nothing rather than zeroes", () => {
    expect(suggestOutcomeCounts(null)).toEqual({
      reExtracted: null, carriedForward: null, notReached: null, splitUnavailable: false,
    });
  });
});

describe("suggestCompletionLine (the wording)", () => {
  it("WHOLE-SHEET COMPLETE -- one count, and NO carried line (a zero line is noise)", () => {
    const line = suggestCompletionLine(wholeSheetComplete);
    expect(line).toBe("94 rows re-extracted.");
    expect(line).not.toContain("carried");
    expect(line).not.toContain("not reached");
  });

  it("SCOPED COMPLETE -- re-extracted AND carried forward, both named", () => {
    expect(suggestCompletionLine(scopedComplete)).toBe(
      "4 rows re-extracted. 90 rows carried forward unchanged.",
    );
  });

  it("SCOPED COMPLETE -- the POPULATION number never appears", () => {
    // the defect: this line used to read "94 wiring rows extracted"
    expect(suggestCompletionLine(scopedComplete)).not.toContain("94");
  });

  it("WHOLE-SHEET HALTED -- re-extracted and not-reached are SEPARATE, never folded", () => {
    const line = suggestCompletionLine(wholeSheetHalted);
    expect(line).toBe("12 rows re-extracted. 82 rows not reached.");
    // the two are different facts to whoever is deciding what to check
    expect(line).toContain("re-extracted");
    expect(line).toContain("not reached");
  });

  it("SCOPED HALTED -- all three counts, each named separately", () => {
    expect(suggestCompletionLine(scopedHalted)).toBe(
      "2 rows re-extracted. 92 rows carried forward unchanged. 2 rows not reached.",
    );
  });

  it("SCOPED HALTED -- 'carried forward' and 'not reached' stay SEPARATE facts", () => {
    const line = suggestCompletionLine(scopedHalted);
    expect(line).toContain("carried forward unchanged");
    expect(line).toContain("not reached");
    // never folded into one number: 92 and 2 are different things to whoever checks
    expect(line).not.toContain("94 rows");
  });

  it("SCOPED HALTED on a LEGACY payload -- states what is known, invents no number", () => {
    const line = suggestCompletionLine(scopedHaltedLegacy);
    expect(line).toContain("stopped before finishing the 4 rows you selected");
    expect(line).toContain("carried forward unchanged");
    expect(line).not.toContain("not reached");
  });

  it("singular wording for exactly one row, on both halves", () => {
    expect(suggestCompletionLine({ ...scopedComplete, results: doc(2), scoped_row_count: 1 }))
      .toBe("1 row re-extracted. 1 row carried forward unchanged.");
  });

  it("NEGATIVE: the stale 'wiring' label is gone from every case", () => {
    for (const s of [wholeSheetComplete, scopedComplete, wholeSheetHalted, scopedHalted]) {
      expect(suggestCompletionLine(s).toLowerCase()).not.toContain("wiring");
    }
  });

  it("NEGATIVE: a zero count is never printed as its own clause", () => {
    // a scoped run covering the entire population carries nothing
    const all: SuggestModalSummary = { ...scopedComplete, scoped_row_count: 94 };
    expect(suggestCompletionLine(all)).toBe("94 rows re-extracted.");
  });

  it("the badges line is KEPT and is its own second line", () => {
    expect(SUGGEST_BADGES_LINE).toBe("Badges are on the rate cells.");
    // it is deliberately NOT folded into the count line
    expect(suggestCompletionLine(scopedComplete)).not.toContain("Badges");
  });
});

describe("pre-existing modal helpers still behave (regression guard)", () => {
  it("phase derivation is unchanged", () => {
    expect(deriveSuggestModalPhase(true, null, null)).toBe("starting");
    expect(deriveSuggestModalPhase(true, { done: 1, total: 4 }, null)).toBe("running");
    expect(deriveSuggestModalPhase(false, null, { status: "error" })).toBe("error");
    expect(deriveSuggestModalPhase(false, null, { run_status: "partial" })).toBe("partial");
    expect(deriveSuggestModalPhase(false, null, { status: "success" })).toBe("success");
  });

  it("percent + AI warning are unchanged", () => {
    expect(suggestPercent({ done: 1, total: 4 })).toBe(25);
    expect(suggestPercent(null)).toBe(0);
    expect(suggestAiStatusWarning("ran")).toBe("");
    expect(suggestAiStatusWarning("disabled")).toContain("AI extraction was OFF");
  });
});

// ⚠️ THE REGRESSION THE OWNER ASKED TO PIN RATHER THAN ASSUME.
// Publishing a new payload field must not disturb the three shapes that already read correctly.
// Each is asserted BYTE-FOR-BYTE identical with and without `pass_attempted_count` present -- so a
// future reader can see that the addition is inert everywhere except the halted-scoped branch.
describe("adding pass_attempted_count leaves the three already-correct shapes UNCHANGED", () => {
  const withCount = (s: SuggestModalSummary): SuggestModalSummary =>
    ({ ...s, pass_attempted_count: 7 });   // a value that would be WRONG if it were ever read here

  const cases: Array<[string, SuggestModalSummary, string]> = [
    ["whole-sheet complete", wholeSheetComplete, "94 rows re-extracted."],
    ["scoped complete", scopedComplete, "4 rows re-extracted. 90 rows carried forward unchanged."],
    ["whole-sheet halted", wholeSheetHalted, "12 rows re-extracted. 82 rows not reached."],
  ];

  for (const [label, summary, expected] of cases) {
    it(`${label}: wording is identical with and without the new field`, () => {
      expect(suggestCompletionLine(summary)).toBe(expected);
      expect(suggestCompletionLine(withCount(summary))).toBe(expected);
    });

    it(`${label}: the derived counts are identical too`, () => {
      expect(suggestOutcomeCounts(withCount(summary))).toEqual(suggestOutcomeCounts(summary));
    });
  }

  it("the new field is read ONLY on the halted-scoped branch", () => {
    // same summary, only the new field differs -> only this shape's numbers move
    const a = suggestOutcomeCounts({ ...scopedHalted, pass_attempted_count: 1 });
    const b = suggestOutcomeCounts({ ...scopedHalted, pass_attempted_count: 3 });
    expect(a).not.toEqual(b);
    // ...while a complete scoped run ignores it entirely
    expect(suggestOutcomeCounts({ ...scopedComplete, pass_attempted_count: 1 }))
      .toEqual(suggestOutcomeCounts({ ...scopedComplete, pass_attempted_count: 3 }));
  });
});

// SLICE SR-1 C10: a FIRST selected run (nothing carried) read its rows for the first time -- the line says "read" and
// how many eligible rows are still unread; a later selected run keeps the re-extracted / carried wording.
describe("SR-1 C10 the completion line on a first selected run", () => {
  it("POSITIVE: 5 rows read, 115 of the 120-row population still unread", () => {
    const first: SuggestModalSummary = { status: "success", run_status: "complete", results: doc(5), scoped_row_count: 5,
      attempted_count: 5, population_count: 120, pass_attempted_count: 5, first_selected_run: true };
    expect(suggestCompletionLine(first)).toBe("5 rows read. 115 rows on this sheet have not been read yet.");
  });
  it("every eligible row selected -> only 'N rows read.' (the unread part left out at 0)", () => {
    const all: SuggestModalSummary = { status: "success", run_status: "complete", results: doc(3), scoped_row_count: 3, population_count: 3, first_selected_run: true };
    expect(suggestCompletionLine(all)).toBe("3 rows read.");
  });
  it("NEGATIVE: a later selected run over a live run keeps 're-extracted' + 'carried forward unchanged'", () => {
    const later: SuggestModalSummary = { status: "success", run_status: "complete", results: doc(94), scoped_row_count: 4, population_count: 94, first_selected_run: false };
    expect(suggestCompletionLine(later)).toBe("4 rows re-extracted. 90 rows carried forward unchanged.");
    // a later run that ticked every row is NOT a first run: still "re-extracted" (the key, not a guess from the counts)
    expect(suggestCompletionLine({ ...later, results: doc(4) })).toBe("4 rows re-extracted.");
  });
});

// SLICE SR-1 C9: the error modal shows the server's own refusal text instead of the generic line.
describe("SR-1 C9 serverRefusalText", () => {
  it("reads frappe's _server_messages (a JSON list of JSON strings), HTML stripped", () => {
    const err = { _server_messages: JSON.stringify([JSON.stringify({ message: "These rows are not part of this sheet's suggestion population: 99. <b>Reload</b> and try again.", title: "Rows not eligible" })]) };
    expect(serverRefusalText(err)).toBe("These rows are not part of this sheet's suggestion population: 99. Reload and try again.");
  });
  it("falls back to message, then exception (without the Python class prefix)", () => {
    expect(serverRefusalText({ message: "A suggestion run is already in progress for this sheet." })).toBe("A suggestion run is already in progress for this sheet.");
    expect(serverRefusalText({ exception: "frappe.exceptions.ValidationError: AI extraction is off" })).toBe("AI extraction is off");
  });
  it("NEGATIVE: nothing readable -> null (the modal keeps its generic line)", () => {
    expect(serverRefusalText(null)).toBeNull();
    expect(serverRefusalText("boom")).toBeNull();
    expect(serverRefusalText({ _server_messages: "not json" })).toBeNull();
    expect(serverRefusalText({})).toBeNull();
  });
});

// SR-1 C10 (found in the AC5 cert, step C2): SheetPricingPage copies the done payload FIELD BY FIELD into the modal's
// summary, so the live modal said "3 rows re-extracted." although the server sent first_selected_run=true. Source pin.
// SR-1 K4 (review R1): the same field-by-field copy also dropped pass_attempted_count (QR-1 call 6). The page now passes
// the WHOLE done payload through, so a future additive worker key cannot be dropped the same way.
describe("SR-1 K3/K4 the page passes the whole done payload to the modal", () => {
  it("SheetPricingPage hands the done payload through whole, not field by field", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../SheetPricingPage.tsx", import.meta.url), "utf-8");
    expect(src).toContain("setSuggestSummary({ ...msg });");
    // the old field-by-field copy is gone (it began with `status: msg.status,`)
    expect(src).not.toContain("status: msg.status,");
  });
  it("the status response type declares first_selected_run and pass_attempted_count", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../SheetPricingPage.tsx", import.meta.url), "utf-8");
    const block = src.slice(src.indexOf("interface SuggestStatusResponse {"), src.indexOf("interface PartialSuggestRun"));
    expect(block).toContain("first_selected_run?: boolean;");
    expect(block).toContain("pass_attempted_count?: number;");
  });
});
