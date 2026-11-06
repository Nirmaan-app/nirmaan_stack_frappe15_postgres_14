// @vitest-environment jsdom
//
// DEV2-B6 S2 MOVABLE POP-UP (owner 23:22: "...can we make it move freely across the screen so that the user can also
// move it to see the backgroyund row"). The REAL card and pop-up, jsdom + react-dom/client only (frontend/CLAUDE.md).
// jsdom does no layout (every box is 0 x 0 in a 1024 x 768 window), so the clamp's arithmetic is pinned in clampDrag's
// own tests below; the live drag is the browser cert's (S3).
//
//   clampDrag   inside the window; the top bar never leaves the screen; a box wider than the window
//   the pop-up  no dimming overlay  /  drag by the top bar moves it, clamped  /  the position kept on next / prev  /
//               a press on a bar button does not drag  /  a click on the page behind does not close it  /  Esc closes  /
//               the next open is centred  /  focus is inside the pop-up
//   the title   (owner answer 3) a failed row's greyed card shows the plain words; the technical reason is ONLY its
//               hover title  /  a decline without `detail` has no title (every other helper unchanged)
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PreviouslyPricedCard, clampDrag } from "./PreviouslyPricedMatches";
import { RateHelperPanel } from "./RateHelperPanel";
import { MATCH_FAILURE_TEXT } from "./rateHelperRegistry";
import type { MatchDetail, PreviousMatch, PreviouslyPricedView, RateHelper } from "./rateHelperTypes";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("clampDrag (pure; the top-left corner)", () => {
  const view = { width: 1000, height: 800 };
  const box = { width: 600, height: 500 };
  it("a move inside the window is kept as asked", () => {
    expect(clampDrag({ left: 100, top: 200 }, box, view, 40)).toEqual({ left: 100, top: 200 });
  });
  it("past the left / right edge stops at the edge", () => {
    expect(clampDrag({ left: -900, top: 0 }, box, view, 40)).toEqual({ left: 0, top: 0 });
    expect(clampDrag({ left: 900, top: 0 }, box, view, 40)).toEqual({ left: 400, top: 0 });     // right edge at 1000
  });
  it("the top bar never leaves the screen (top >= 0, top + bar <= height)", () => {
    expect(clampDrag({ left: 0, top: -900 }, box, view, 40)).toEqual({ left: 0, top: 0 });
    expect(clampDrag({ left: 0, top: 900 }, box, view, 40)).toEqual({ left: 0, top: 760 });     // 800 - 40
  });
  it("a box wider than the window keeps its edges outside it", () => {
    const wide = { width: 1200, height: 300 };
    expect(clampDrag({ left: 500, top: 0 }, wide, view, 40)).toEqual({ left: 0, top: 0 });
    expect(clampDrag({ left: -500, top: 0 }, wide, view, 40)).toEqual({ left: -200, top: 0 });  // right edge 1000
  });
});

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
const all = (sel: string) => Array.from(document.body.querySelectorAll(sel));
const q = (sel: string) => document.body.querySelector(sel) as HTMLElement | null;
const text = (n: Element | null | undefined) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const fire = async (el: EventTarget, type: string, init: MouseEventInit = {}) => {
  await act(async () => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })); });
};
const dlg = () => q('[data-testid="match-dialog"]');
const bar = () => q('[data-testid="match-dialog-bar"]')!;
/** The dragged pop-up's top-left corner [left, top] in px from its inline style; null while it is centred (as opened:
 *  no inline position, the centring classes). */
const where = (): [number, number] | null => {
  const st = dlg()!.style;
  return st.left ? [parseFloat(st.left), parseFloat(st.top)] : null;
};

const M = (key: string, colour: PreviousMatch["colour"]): PreviousMatch => ({
  key, boq: "BOQ-26-00001", sheet_name: "S", excel_row: Number(key.slice(1)), verdict: "SAME", colour, n1b: null,
  total_rate: 100, unit: "Nos", priced_at: "2026-10-01", description: `row ${key}` });
const DETAIL: MatchDetail = { boq: "BOQ-26-00001", boq_name: "B", project: "P", project_name: "Proj", sheet_name: "S",
  excel_row: 1, committed_version: 1, can_open: false, payload: { id: 1, description: "row" } };
const view = (): PreviouslyPricedView => ({
  matchRun: "BRMR-1", boq: "BOQ-T", sheetName: "S", excelRow: 5, rowUnit: "Nos",
  matches: [M("r1", "green"), M("r2", "amber"), M("r3", "red")], canMark: true, canOpenBoqs: true,
  loadDetail: vi.fn(async () => DETAIL), onMark: vi.fn(async () => {}), onUndo: vi.fn(async () => {}),
});
async function openFirst() {
  mount(<PreviouslyPricedCard view={view()} />);
  await fire(all('[data-testid="match-row"]')[0], "click");
  await flush();
}
async function dragBar(dx: number, dy: number) {
  await fire(bar(), "pointerdown", { clientX: 500, clientY: 300 });
  await fire(bar(), "pointermove", { clientX: 500 + dx, clientY: 300 + dy });
  await fire(bar(), "pointerup", { clientX: 500 + dx, clientY: 300 + dy });
}

describe("the movable pop-up", () => {
  it("opens centred with NO dimming overlay (the page behind visible)", async () => {
    await openFirst();
    expect(dlg()).not.toBeNull();
    expect(where()).toBeNull();
    expect(dlg()!.className).toContain("-translate-y-1/2");
    expect(all('[class*="bg-black"]')).toEqual([]);                 // the shadcn overlay (bg-black/80) is not drawn
    expect(dlg()!.className).toContain("fixed");
  });

  it("dragging the top bar moves it; toward off-screen it stops with the bar on screen", async () => {
    await openFirst();
    await dragBar(120, 40);                                            // jsdom: the box is 0 x 0 at 0, 0
    expect(where()).toEqual([120, 40]);
    // dragged = anchored by its TOP-LEFT corner (C4): the centring transform is gone, so a taller match cannot move it
    expect(dlg()!.className).not.toContain("-translate-y-1/2");
    await dragBar(-5000, -5000);                                       // 1024 x 768 window: left 0, top 0
    expect(where()).toEqual([0, 0]);
    await dragBar(9000, 9000);
    expect(where()).toEqual([1024, 768]);
  });

  it("the position is kept while stepping next / prev", async () => {
    await openFirst();
    await dragBar(200, 60);
    const at = where();
    await fire(all("button").find((b) => b.getAttribute("aria-label") === "Next match")!, "click");
    await flush();
    expect(text(dlg())).toContain("Match 2 of 3");
    expect(where()).toEqual(at);
    await fire(all("button").find((b) => b.getAttribute("aria-label") === "Previous match")!, "click");
    expect(text(dlg())).toContain("Match 1 of 3");
    expect(where()).toEqual(at);
  });

  it("a press on a button in the bar does not start a drag", async () => {
    await openFirst();
    const next = all("button").find((b) => b.getAttribute("aria-label") === "Next match")!;
    await fire(next, "pointerdown", { clientX: 500, clientY: 300 });
    await fire(bar(), "pointermove", { clientX: 100, clientY: 100 });
    expect(where()).toBeNull();
  });

  it("a click on the page behind does NOT close it; Esc closes it; the next open is centred again", async () => {
    await openFirst();
    await dragBar(150, 50);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });   // Radix arms its outside listener a tick later
    await fire(document.body, "pointerdown", { clientX: 5, clientY: 5 });
    await fire(document.body, "click", { clientX: 5, clientY: 5 });
    await flush();
    expect(dlg()).not.toBeNull();
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await flush();
    expect(dlg()).toBeNull();
    await fire(all('[data-testid="match-row"]')[1], "click");
    await flush();
    expect(text(dlg())).toContain("Match 2 of 3");
    expect(where()).toBeNull();                                        // centred again
  });

  it("focus is inside the pop-up, and the close button is there", async () => {
    await openFirst();
    expect(dlg()!.contains(document.activeElement)).toBe(true);
    const close = all("button").find((b) => text(b) === "Close");
    expect(close && dlg()!.contains(close)).toBe(true);
    await fire(close!, "click");
    await flush();
    expect(dlg()).toBeNull();
  });
});

describe("the greyed failure card's hover title (owner answer 3)", () => {
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
  const ctx = { excelRow: 419, description: "d", nodeType: "Line Item", category: null, discipline: null, rateKinds: ["supply_rate" as const] };
  const helper = (r: { reason: string; detail?: string }): RateHelper => ({ id: "previously_priced_boqs", label: "Previously priced BoQs", compute: () => ({ kind: "none", ...r }) });

  it("plain words as text, the technical reason as the title only", () => {
    const tech = "not sent: caller_refused (test budget: this call would pass the budget)";
    mount(<RateHelperPanel excelRow={419} col="F" kind="supply_rate" ctx={ctx} helpers={[helper({ reason: MATCH_FAILURE_TEXT.retry, detail: tech })]} onUse={() => {}} />);
    const line = all("div").find((d) => d.textContent === MATCH_FAILURE_TEXT.retry && d.children.length === 0)!;
    expect(line.getAttribute("title")).toBe(tech);
    expect(text(document.body)).not.toContain("test budget");
    expect(text(document.body)).not.toContain("caller_refused");
  });

  it("a decline without detail renders no title (as before)", () => {
    mount(<RateHelperPanel excelRow={419} col="F" kind="supply_rate" ctx={ctx} helpers={[helper({ reason: "Matching not run yet" })]} onUse={() => {}} />);
    const line = all("div").find((d) => d.textContent === "Matching not run yet" && d.children.length === 0)!;
    expect(line.hasAttribute("title")).toBe(false);
  });
});
