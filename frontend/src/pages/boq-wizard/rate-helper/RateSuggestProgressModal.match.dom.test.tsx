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
  type MatchPhaseState,
  type SuggestModalSummary,
} from "./RateSuggestProgressModal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PACES = { suggest_seconds_per_row: 3.12, match_fixed_seconds: 120, match_seconds_per_row: 1.0 };

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
  it("20 rows: suggest ceil(20 x 3.12 / 60) = 2, match ceil((120 + 20 x 1.0) / 60) = 3, total 5", () => {
    const e = matchWaitEstimate(20, PACES);
    expect([e.suggestMin, e.matchMin, e.totalMin]).toEqual([2, 3, 5]);
    expect(e.line).toBe("This will take about 5 minutes in all: about 2 to suggest rates and about 3 to match with previously priced BoQs.");
  });

  it("rounds UP, never down: 19 rows of 3.12 s = 59.3 s -> 1 minute; 20 rows = 62.4 s -> 2", () => {
    expect(matchWaitEstimate(19, PACES).suggestMin).toBe(1);
    expect(matchWaitEstimate(20, PACES).suggestMin).toBe(2);
    expect(matchWaitEstimate(0, PACES).suggestMin).toBe(1);   // never "0 minutes"
  });

  it("a whole sheet of 206 rows: 11 + 6 = 17 minutes", () => {
    const e = matchWaitEstimate(206, PACES);
    expect([e.suggestMin, e.matchMin, e.totalMin]).toEqual([11, 6, 17]);
  });

  it("the paces dev2 measured (api/boq/rate_match.PACES): 20 rows -> 2 + 2 = 4; 206 rows -> 11 + 3 = 14", () => {
    const DEV2 = { suggest_seconds_per_row: 3.12, match_fixed_seconds: 65, match_seconds_per_row: 0.45 };
    expect(matchWaitEstimate(20, DEV2).line).toBe(
      "This will take about 4 minutes in all: about 2 to suggest rates and about 2 to match with previously priced BoQs.");
    const w = matchWaitEstimate(206, DEV2);
    expect([w.suggestMin, w.matchMin, w.totalMin]).toEqual([11, 3, 14]);
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
