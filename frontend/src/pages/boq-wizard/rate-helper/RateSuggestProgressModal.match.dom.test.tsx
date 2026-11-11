// @vitest-environment jsdom
//
// DEV2-B4 S3 (owner SEQUENCE G1 16:13: "the wait time should be adequately dsiclosed to the user and the progress shown
// properly as we do for the suggest rate run currently"; 2026-11-03 11:11: "it should give total estinmate _ suggest
// rate + historical rates -- with splits -- give a safe number"). The REAL RateSuggestProgressModal, mounted with
// jsdom + react-dom/client only (no @testing-library, frontend/CLAUDE.md), and the pure estimate functions.
//
//   the estimate line   total + split; each phase at its p90 pace, rounded UP to whole minutes; total = the two parts
//                       / switch OFF (or no paces) -> "" (the dialog shows no line: exactly as before)
//   the second phase    "Matching with previously priced BoQs - x of y rows", the bar, elapsed + time left; the modal
//                       is NOT dismissable while it runs; a clear "done" / "failed: <reason>" end
//   switch OFF          no `match` prop -> the modal's text is exactly today's (no phase, the Done button as before)
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import {
  MATCH_PHASE_LABEL,
  RateSuggestProgressModal,
  confirmEstimateLine,
  formatSeconds,
  matchWaitEstimate,
  suggestReadRows,
  type MatchPhaseState,
  type SuggestModalSummary,
} from "./RateSuggestProgressModal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// DEV2-B5 S2 (mechanical inversion, the SAFE ESTIMATE ruling 11:11): Suggest = fixed + one part a batch of 20 rows (B4
// pinned 3.12 s a row). Fixture paces; the dev2 ones are pinned below and in test_rate_match.
const PACES = { suggest_fixed_seconds: 13, suggest_seconds_per_batch: 53, suggest_batch_rows: 20, match_fixed_seconds: 120, match_seconds_per_row: 1.0 };
const DEV2 = { suggest_fixed_seconds: 13, suggest_seconds_per_batch: 53, suggest_batch_rows: 20, match_fixed_seconds: 65, match_seconds_per_row: 0.45 };

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = "";
});

function mount(el: JSX.Element) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
}
const text = (n: Element | null | undefined) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();
const dialog = () => document.body.querySelector('[role="dialog"]');
const SUCCESS: SuggestModalSummary = { status: "success", run_status: "complete", results: [{}, {}, {}], scoped_row_count: 3 };

function modal(match?: MatchPhaseState | null) {
  return (
    <RateSuggestProgressModal open running={false} sheetName="BOQ" progress={null} summary={SUCCESS} onClose={() => {}}
      {...(match !== undefined ? { match } : {})} />
  );
}

describe("DEV2-B4 the estimate line (total + split, safe: p90, rounded up)", () => {
  it("20 rows: suggest ceil((13 + 1 x 53) / 60) = 2, match ceil((120 + 20 x 1.0) / 60) = 3, total 5", () => {
    const e = matchWaitEstimate(20, PACES);
    expect([e.suggestMin, e.matchMin, e.totalMin]).toEqual([2, 3, 5]);
    expect(e.line).toBe("This will take about 5 minutes in all: about 2 to suggest rates and about 3 to match with previously priced BoQs.");
  });

  it("rounds UP, never down: 1 row = one batch = 66 s -> 2 minutes; 0 rows -> 1 (never \"0 minutes\")", () => {
    expect(matchWaitEstimate(1, PACES).suggestMin).toBe(2);
    expect(matchWaitEstimate(20, PACES).suggestMin).toBe(2);
    expect(matchWaitEstimate(0, PACES).suggestMin).toBe(1);
  });

  it("the batch term counts BATCHES of 20, not rows: 1 .. 20 rows the same, 41 rows = 3 batches = 172 s -> 3", () => {
    expect(matchWaitEstimate(1, PACES).suggestMin).toBe(matchWaitEstimate(20, PACES).suggestMin);
    expect(matchWaitEstimate(40, PACES).suggestMin).toBe(2);
    expect(matchWaitEstimate(41, PACES).suggestMin).toBe(3);
  });

  it("a whole sheet of 206 rows: 11 batches -> 10 + 6 = 16 minutes", () => {
    const e = matchWaitEstimate(206, PACES);
    expect([e.suggestMin, e.matchMin, e.totalMin]).toEqual([10, 6, 16]);
  });

  it("the paces dev2 measured (api/boq/rate_match.PACES): 20 rows -> 2 + 2 = 4; 206 rows -> 10 + 3 = 13", () => {
    expect(matchWaitEstimate(20, DEV2).line).toBe(
      "This will take about 4 minutes in all: about 2 to suggest rates and about 2 to match with previously priced BoQs.");
    const w = matchWaitEstimate(206, DEV2);
    expect([w.suggestMin, w.matchMin, w.totalMin]).toEqual([10, 3, 13]);
  });

  it("the Suggest part equals the server's suggest_estimate_minutes (test_rate_match pins the same numbers)", () => {
    expect([0, 1, 20, 21, 40, 41, 206, 361].map((n) => matchWaitEstimate(n, DEV2).suggestMin)).toEqual([1, 2, 2, 2, 2, 3, 10, 17]);
  });

  it("switch OFF or no paces -> no line at all", () => {
    expect(confirmEstimateLine(false, 20, PACES)).toBe("");
    expect(confirmEstimateLine(true, 20, null)).toBe("");
    expect(confirmEstimateLine(true, 20, PACES)).toBe(matchWaitEstimate(20, PACES).line);
  });

  it("formatSeconds", () => {
    expect(formatSeconds(45)).toBe("45 s");
    expect(formatSeconds(185)).toBe("3 min 05 s");
  });
});

// DEV2-B8 S2 (WAIT ESTIMATE, owner 2026-11-06 12:42): the matching part counts the rows that need a new spec card.
// The paces api/boq/rate_match.PACES serves since B8 (test_rate_match pins them; test_match_estimate pins the cases).
const B8 = { ...DEV2, estimate_match_fixed_seconds: 49, estimate_match_seconds_per_row: 0.4, estimate_match_seconds_per_card: 2 };

describe("DEV2-B8 the matching part counts the rows that need a new card", () => {
  it("the same minutes as the server's match_estimate_minutes (test_match_estimate PARITY)", () => {
    const cases: [number, number | null, number][] = [[0, null, 1], [1, 0, 1], [20, 0, 1], [20, 20, 2], [81, 38, 3],
      [81, null, 5], [81, 0, 2], [206, 0, 3], [361, 361, 16], [30, 999, 3]];
    expect(cases.map(([n, c]) => matchWaitEstimate(n, B8, c).matchMin)).toEqual(cases.map(([, , m]) => m));
  });

  it("production's watched run: 81 rows, 38 new cards -> 49 + 32.4 + 76 = 157.4 s -> 3 minutes (it took 142 s)", () => {
    const e = matchWaitEstimate(81, B8, 38);
    expect([e.suggestMin, e.matchMin, e.totalMin]).toEqual([5, 3, 8]);
    expect(e.matchMin * 60).toBeGreaterThanOrEqual(142);
    expect(matchWaitEstimate(81, DEV2).matchMin * 60).toBeLessThan(142);   // B4's 101.5 s -> 2 min under-ran it
  });

  it("the count not known yet, or its call failed (null / undefined) -> every row needs a card (the safe side)", () => {
    expect(matchWaitEstimate(81, B8, null).matchMin).toBe(matchWaitEstimate(81, B8, 81).matchMin);
    expect(matchWaitEstimate(81, B8).matchMin).toBe(matchWaitEstimate(81, B8, 81).matchMin);
    expect(matchWaitEstimate(81, B8, null).matchMin).toBeGreaterThanOrEqual(matchWaitEstimate(81, B8, 38).matchMin);
  });

  it("fewer rows without a card -> a smaller figure; a count above the rows is capped; never below 1", () => {
    expect(matchWaitEstimate(361, B8, 0).matchMin).toBeLessThan(matchWaitEstimate(361, B8, 361).matchMin);
    expect(matchWaitEstimate(30, B8, 999).matchMin).toBe(matchWaitEstimate(30, B8, 30).matchMin);
    expect(matchWaitEstimate(0, B8, 0).matchMin).toBe(1);
  });

  it("the Suggest part and the sentence are unchanged: only the numbers move", () => {
    expect(matchWaitEstimate(81, B8, 38).suggestMin).toBe(matchWaitEstimate(81, DEV2).suggestMin);
    expect(matchWaitEstimate(81, B8, 38).line).toBe(
      "This will take about 8 minutes in all: about 5 to suggest rates and about 3 to match with previously priced BoQs.");
    expect(confirmEstimateLine(true, 81, B8, 38)).toBe(matchWaitEstimate(81, B8, 38).line);
    expect(confirmEstimateLine(false, 81, B8, 38)).toBe("");
  });

  it("an older server with no estimate_match_* paces -> the B4 formula, the count ignored", () => {
    expect(matchWaitEstimate(206, DEV2, 0).matchMin).toBe(matchWaitEstimate(206, DEV2).matchMin);
    expect(matchWaitEstimate(206, DEV2, 0).matchMin).toBe(3);
  });

  it("suggestReadRows: the ticked rows + the never-read ones, or the whole eligible set; sorted, no repeats", () => {
    const eligible = new Set([5, 1, 3, 9]);
    expect(suggestReadRows(new Set(), [{ excel_row: 7 }], eligible)).toEqual([1, 3, 5, 9]);
    expect(suggestReadRows(new Set([9, 3]), [{ excel_row: 7 }, { excel_row: 3 }], eligible)).toEqual([3, 7, 9]);
    expect(suggestReadRows(new Set(), [], new Set())).toEqual([]);
  });
});

describe("DEV2-B4 the matching phase in the progress modal", () => {
  it("running: the label with x of y rows, the bar, elapsed and time left; not dismissable", () => {
    mount(modal({ state: "running", done: 12, total: 20, elapsedS: 75, leftS: 65 }));
    const ph = document.body.querySelector('[data-testid="match-phase"]');
    expect(text(ph)).toContain(`${MATCH_PHASE_LABEL} — 12 of 20 rows`);
    expect(text(document.body.querySelector('[data-testid="match-times"]'))).toBe("1 min 15 s elapsed · about 1 min 05 s left");
    const bar = ph!.querySelector(".bg-sky-500") as HTMLElement;
    expect(bar.style.width).toBe("60%");
    // the Suggest result stays above it, and there is no way out while matching runs
    expect(text(document.body.querySelector('[data-testid="suggest-outcome"]'))).toContain("3 rows re-extracted.");
    expect([...dialog()!.querySelectorAll("button")].map((b) => text(b))).not.toContain("Done");
  });

  it("done: a clear end, and the modal can be closed", () => {
    mount(modal({ state: "done", done: 20, total: 20, elapsedS: 0, leftS: null }));
    expect(text(document.body.querySelector('[data-testid="match-done"]'))).toBe(`${MATCH_PHASE_LABEL}: done.`);
    expect([...dialog()!.querySelectorAll("button")].map((b) => text(b))).toContain("Done");
  });

  it("failed: the reason is shown", () => {
    mount(modal({ state: "failed", done: 0, total: 0, elapsedS: 0, leftS: null, reason: "The call runner stopped: rate_limit_429" }));
    expect(text(document.body.querySelector('[data-testid="match-failed"]'))).toBe(
      `${MATCH_PHASE_LABEL} failed: The call runner stopped: rate_limit_429`);
  });

  it("switch OFF (no match prop, or null): exactly today's modal -- no phase, the same text and buttons", () => {
    mount(modal());
    const today = text(dialog());
    const buttonsToday = [...dialog()!.querySelectorAll("button")].map((b) => text(b));
    expect(document.body.querySelector('[data-testid="match-phase"]')).toBeNull();
    // the committed (pre-B4) modal renders exactly this (proved DOM-equal to HEAD in the slice, outputs/s3_switch_off_dom_vs_head.log)
    expect(today).toBe("Suggestions ready3 rows re-extracted.Badges are on the rate cells.DoneClose");
    act(() => root!.render(modal(null)));
    expect(text(dialog())).toBe(today);
    expect([...dialog()!.querySelectorAll("button")].map((b) => text(b))).toEqual(buttonsToday);
  });
});
