// DEV2-B6 S2 PLAIN WORDING (owner 22:55 on cert 16: "...shows an error message of not being done due to som etest budget
// ...what is it??"). Every stored failure reason maps to plain words; the technical reason is kept for the hover title;
// an UNKNOWN reason gets the first wording, never raw text. The reasons below are every value P0 (b) found in dev2's 15
// match runs and every text a code path writes (judge.judged / parse_reply / judge_items, match_run, rate_match, the
// healer, the page's default).
import { describe, expect, it } from "vitest";

import { MATCH_FAILURE_TEXT, plainMatchFailure, previouslyPricedResult } from "./rateHelperRegistry";
import type { PreviouslyPricedInput } from "./rateHelperRegistry";

const RETRY = [
  "not sent",
  "not sent: caller_refused (test budget: this call would pass the budget (calls 478, tokens 6641015+2324261, usd 1.1078+0.8596))",
  "the call failed: RuntimeError: object is not bound",
  "the reply was cut at max_tokens",
  "the model refused",
  "no JSON object in the reply",
  "the reply's JSON does not parse: Expecting value: line 1 column 1 (char 0)",
  "the reply has no verdicts / order lists",
  "a verdict has no c or v",
  "a candidate number is not a whole number",
  "the verdicts do not cover the candidates exactly once",
  "the order does not cover the candidates exactly once",
  "unknown verdicts ['MAYBE']",
  "The call runner stopped: connection_error_with_nothing_landing (BOQ-26-00328|BOQ|118: ...)",
  "The call runner stopped: rate_limit_429 (429 x)",
  "The match run stopped unexpectedly.",
  "stale - worker gone",
  "the match run stopped",
];

describe("every stored reason maps to plain words", () => {
  it("not sent / refused / call failed / every judge reply error / a stopped run -> the retry words", () => {
    for (const r of RETRY) expect(plainMatchFailure(r)).toEqual({ words: MATCH_FAILURE_TEXT.retry, detail: r });
  });

  it("pool not ready -> being prepared", () => {
    const r = "pool not ready: the earlier-BoQ pool is being built by another job";
    expect(plainMatchFailure(r)).toEqual({ words: "Earlier BoQs are being prepared. Try again in a few minutes.", detail: r });
  });

  it("too large / switched off / the Suggest run changed -> their own words", () => {
    expect(plainMatchFailure("not sent: too_large (estimate 120000 > 100000)").words).toBe(MATCH_FAILURE_TEXT.tooLong);
    expect(plainMatchFailure("Historical matching is switched off (match_enabled).").words).toBe(MATCH_FAILURE_TEXT.switchedOff);
    expect(plainMatchFailure("The Suggest run this match follows is no longer the sheet's active complete run.").words)
      .toBe(MATCH_FAILURE_TEXT.suggestChanged);
  });

  it("an UNKNOWN reason gets the first wording, never raw text", () => {
    const r = "something new went wrong: E1234";
    expect(plainMatchFailure(r).words).toBe(MATCH_FAILURE_TEXT.retry);
    expect(plainMatchFailure(r).words).not.toContain("E1234");
    expect(plainMatchFailure(null)).toEqual({ words: MATCH_FAILURE_TEXT.retry, detail: "" });
    expect(Object.values(MATCH_FAILURE_TEXT).some((w) => /test budget|caller_refused|not sent/i.test(w))).toBe(false);
  });
});

describe("the card shows the words, not the stored text", () => {
  const input = (over: Partial<PreviouslyPricedInput> = {}): PreviouslyPricedInput => ({
    run: { name: "BRMR-1", status: "complete", commit_version: 1, rows: [
      { excel_row: 419, status: "no verdict", no_verdict: "not sent: caller_refused (test budget: ...)" }] },
    running: false, failedReason: null, boq: "B", sheetName: "S", unitByExcelRow: new Map(),
    actions: { canMark: true, canOpenBoqs: true, loadDetail: async () => { throw new Error("x"); }, onMark: async () => {}, onUndo: async () => {} },
    ...over,
  });

  it("a no-verdict row (the cert's row 419)", () => {
    const r = previouslyPricedResult(input(), 419);
    // the plain words as the text; the technical reason ONLY as `detail` (the panel's hover title, owner answer 3)
    expect(r).toEqual({ kind: "none", reason: MATCH_FAILURE_TEXT.retry, detail: "not sent: caller_refused (test budget: ...)" });
    expect(r.kind === "none" && r.reason).not.toMatch(/test budget|caller_refused|Matching failed/);
  });

  it("a failed run with no current run (pool not ready)", () => {
    const r = previouslyPricedResult(input({ run: null, failedReason: "pool not ready: being built" }), 5);
    expect(r).toEqual({ kind: "none", reason: MATCH_FAILURE_TEXT.poolNotReady, detail: "pool not ready: being built" });
  });
});
