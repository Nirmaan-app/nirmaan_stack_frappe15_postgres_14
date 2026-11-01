// @vitest-environment jsdom
//
// ELR-4c -- the REAL `RateHelperPanel` in its two shapes, for the three things a pure test cannot see: R-FLOAT (P6 "Q3 a" /
// "Q3b a": the figure, the "Use this value" box and what "Use this value" hands on are the 2-decimal value), the tray
// thickness "*" words (P6 "Q4 a": the BoQ panel only) and TS-15 (P6 "Q5 a": no "*" on the calculator's stretch). jsdom +
// react-dom/client only (frontend/CLAUDE.md); how it LOOKS is the browser cert's (C3 / C4 / C5).
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calculatorCtx } from "@/pages/pricing/PricingCalculator";
import { ELECTRICAL_CONFIGS, ELECTRICAL_ITEMS, ELECTRICAL_RULE_CASES, caseCells } from "@/pages/pricing/electricalRuleCases";
import { RateHelperPanel } from "./RateHelperPanel";
import { makePricingSheetHelper } from "./pricingSheetHelper";
import type { ExtractionRow, RateHelperRowContext } from "./rateHelperTypes";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class StubResizeObserver { observe() { /* no layout */ } unobserve() { /* no layout */ } disconnect() { /* no layout */ } }
if (!(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver;
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => { /* no layout */ };

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });
function mount(el: JSX.Element): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}

function boqPanel(caseId: string, onUse: (...a: unknown[]) => void = () => undefined): HTMLElement {
  const c = ELECTRICAL_RULE_CASES.find((x) => x.id === caseId)!;
  const ext = new Map<number, ExtractionRow>([[7, { excelRow: 7, description: "", attributes: caseCells(c) } as unknown as ExtractionRow]]);
  const helper = makePricingSheetHelper({ configsByCategory: ELECTRICAL_CONFIGS, items: ELECTRICAL_ITEMS, extractionByRow: ext });
  const ctx = { excelRow: 7, description: "", nodeType: "Line Item", category: c.cat, discipline: "Electrical", rateKinds: ["supply_rate", "install_rate", "combined_rate"], headings: [], ownNotes: [], unit: "" } as RateHelperRowContext;
  const el = mount(<RateHelperPanel variant="embedded" excelRow={7} col="F" kind="supply_rate" ctx={ctx} helpers={[helper]} onUse={onUse as never} />);
  const header = [...el.querySelectorAll("button")].find((b) => !b.getAttribute("aria-label") && b.querySelector(".text-sm.font-medium"));
  act(() => header!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  return el;
}
function calculator(cat: string): HTMLElement {
  const helper = makePricingSheetHelper({ configsByCategory: ELECTRICAL_CONFIGS, items: ELECTRICAL_ITEMS, extractionByRow: new Map() });
  const ctx = calculatorCtx("Electrical", cat);
  return mount(<RateHelperPanel variant="calculator" excelRow={ctx.excelRow} col="__calc__" kind="supply_rate" ctx={ctx} helpers={[helper]} />);
}
const markerAfter = (el: HTMLElement, label: string) => {
  const l = [...el.querySelectorAll("label")].find((x) => (x.textContent ?? "").trim() === label)!;
  return l.parentElement!;
};

describe("R-FLOAT on the BoQ panel -- the earthing Without row (BOQ-26-00183 r88)", () => {
  it("the header, the block figures and the 'Use this value' box read 216.05 / 245.05; no long float anywhere", () => {
    const el = boqPanel("EA1+");
    const text = el.textContent ?? "";
    expect(text).toContain("216.05");
    expect(text).toContain("245.05");
    expect(text).not.toMatch(/216\.0499|245\.0499/);
    const box = el.querySelector('input[aria-label="Final value"]') as HTMLInputElement;
    expect(box.value).toBe("216.05");
  });
  it("Q3b a: 'Use this value' hands on 216.05, and the feedback log's computed value is the same 216.05", () => {
    const onUse = vi.fn();
    const el = boqPanel("EA1+", onUse);
    const use = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Use this value")!;
    act(() => use.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onUse.mock.calls[0][1]).toBe(216.05);
    expect((onUse.mock.calls[0][2] as { computedValue: number }).computedValue).toBe(216.05);
  });
  it("NEGATIVE: an exact figure renders exactly as before (the DB row's 5930)", () => {
    const el = boqPanel("DB1+");
    expect((el.querySelector('input[aria-label="Final value"]') as HTMLInputElement).value).toBe("5930");
  });
});

describe("Q4 a -- the tray thickness '*' words: the BoQ panel only", () => {
  it("BoQ panel: '* this, or a thickness the BoQ gives another way' beside Thickness (mm), and only there", () => {
    const el = boqPanel("CT1+");
    const words = [...el.querySelectorAll('[data-testid="needed-either"]')];
    expect(words.map((w) => (w.textContent ?? "").trim())).toEqual(["this, or a thickness the BoQ gives another way"]);
    expect(markerAfter(el, "Thickness (mm)").querySelector('[data-testid="needed-either"]')).not.toBeNull();
    expect(el.textContent ?? "").not.toMatch(/SWG|gauge/i);
  });
  it("calculator: the plain '*', no words", () => {
    const el = calculator("cabletray_raceway");
    expect(markerAfter(el, "Thickness (mm)").querySelector('[data-testid="needed-marker"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="needed-either"]')).toBeNull();
  });
});

describe("TS-15 -- the calculator, point wiring, fresh", () => {
  it("'Circuit wiring stretch (m)' carries no '*' while 'Circuit wiring included' (blank) does", () => {
    const el = calculator("point_wiring");
    expect(markerAfter(el, "Circuit wiring included").querySelector('[data-testid="needed-marker"]')).not.toBeNull();
    expect(markerAfter(el, "Circuit wiring stretch (m)").querySelector('[data-testid="needed-marker"]')).toBeNull();
  });
});
