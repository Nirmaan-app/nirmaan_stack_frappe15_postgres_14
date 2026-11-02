// @vitest-environment jsdom
//
// ELR-4a AC4 / U2 (owner R-PW-BLANK, 2026-10-29) -- the REAL `RateHelperPanel` in its two shapes (the calculator, and the
// BoQ panel holding a stored point wiring row): no "Blank plate" field, the note N1 drawn where it was, before "Blank
// plate qty"; switches & sockets keep their field and draw no note. jsdom + react-dom/client only (frontend/CLAUDE.md);
// how it LOOKS is the browser cert's (C5 / C6).
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import type { RateCategoryConfig } from "@/pages/pricing/rate-master/rateMasterTypes";
import { calculatorCtx } from "@/pages/pricing/PricingCalculator";
import { RateHelperPanel } from "./RateHelperPanel";
import { makePricingSheetHelper } from "./pricingSheetHelper";
import type { ExtractionRow, RateHelperRowContext } from "./rateHelperTypes";
import { HIDDEN, ITEMS, N1, pwRow } from "./elr4aBlankPlate.harness";

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
const labels = (el: HTMLElement) => [...el.querySelectorAll("label")].map((l) => (l.textContent ?? "").trim());

function calculator(configs: Map<string, RateCategoryConfig>, cat: string): HTMLElement {
  const helper = makePricingSheetHelper({ configsByCategory: configs, items: ITEMS, extractionByRow: new Map() });
  const ctx = calculatorCtx("Electrical", cat);
  return mount(<RateHelperPanel variant="calculator" excelRow={ctx.excelRow} col="__calc__" kind="supply_rate" ctx={ctx} helpers={[helper]} />);
}
function boqPanel(configs: Map<string, RateCategoryConfig>, cat: string, attrs: Record<string, string | null>): HTMLElement {
  const cell = Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
  const ext = new Map<number, ExtractionRow>([[7, { excelRow: 7, description: "", attributes: cell } as unknown as ExtractionRow]]);
  const helper = makePricingSheetHelper({ configsByCategory: configs, items: ITEMS, extractionByRow: ext });
  const ctx = { excelRow: 7, description: "", nodeType: "Line Item", category: cat, discipline: "Electrical", rateKinds: ["supply_rate", "install_rate", "combined_rate"], headings: [], ownNotes: [], unit: "" } as RateHelperRowContext;
  const el = mount(<RateHelperPanel variant="embedded" excelRow={7} col="F" kind="supply_rate" ctx={ctx} helpers={[helper]} onUse={() => undefined} />);
  const header = [...el.querySelectorAll("button")].find((b) => !b.getAttribute("aria-label") && b.querySelector(".text-sm.font-medium"));
  act(() => header!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  return el;
}

describe("ELR-4a U2: point wiring on both screens", () => {
  for (const [name, open] of [
    ["calculator", () => calculator(HIDDEN, "point_wiring")],
    ["BoQ panel", () => boqPanel(HIDDEN, "point_wiring", pwRow("None"))],
  ] as const) {
    it(`${name}: no 'Blank plate' field; N1 drawn once, right before 'Blank plate qty'`, () => {
      const el = open();
      expect(labels(el)).not.toContain("Blank plate");
      expect(labels(el)).toContain("Blank plate qty");
      const notes = el.querySelectorAll('[data-testid="attribute-lead-note"]');
      expect(notes.length).toBe(1);
      expect((notes[0].textContent ?? "").trim()).toBe(N1);
      const qtyLabel = [...el.querySelectorAll("label")].find((l) => (l.textContent ?? "").trim() === "Blank plate qty")!;
      // document order: the note, then the field it stands before
      expect(notes[0].compareDocumentPosition(qtyLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  }
});

describe("ELR-4a R-KEEP: switches & sockets keeps 'Blank plate' and draws no note", () => {
  it("calculator", () => {
    const el = calculator(HIDDEN, "switches_sockets");
    expect(labels(el)).toContain("Blank plate");
    expect(el.querySelector('[data-testid="attribute-lead-note"]')).toBeNull();
  });
});
