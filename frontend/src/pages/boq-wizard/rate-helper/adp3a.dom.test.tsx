// @vitest-environment jsdom
//
// ADP-3a U8 / AC5 (owner standing rule: every control a pricer can reach has a name a screen reader reads) -- the REAL
// `RateHelperPanel`, mounted in its two shapes (the calculator, and the BoQ panel holding a stored row), on the LIVE
// assets (HVAC v48, Electrical v66). jsdom + react-dom/client only, no `@testing-library` (frontend/CLAUDE.md).
//
// The accessible name is computed here the way the browser's accessibility tree does for these elements (the subset
// this component uses): aria-labelledby, then aria-label, then a <label for=id>, then a wrapping <label>, then (for a
// button) its text, then its title. jsdom does no layout, so what it proves is the NAMES and the ARIA attributes; how
// the marker LOOKS is the browser cert's (C9).
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import { RateHelperPanel } from "./RateHelperPanel";
import { CONFIGS, ITEMS, DISCIPLINE_OF } from "./adp3a.harness";
import { makePricingSheetHelper } from "./pricingSheetHelper";
import type { ExtractionRow, RateHelperRowContext } from "./rateHelperTypes";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class StubResizeObserver { observe() { /* no layout */ } unobserve() { /* no layout */ } disconnect() { /* no layout */ } }
if (!(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver;
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => { /* no layout */ };

const RATE_KINDS = ["supply_rate", "install_rate", "combined_rate"];
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
const text = (n: Element | null | undefined) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();
/** The accessible name of a form control or button, by the steps the browser takes for these elements. */
export function accessibleName(el: Element): string {
  const doc = el.ownerDocument;
  const by = el.getAttribute("aria-labelledby");
  if (by) return by.split(/\s+/).map((id) => text(doc.getElementById(id))).join(" ").trim();
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim()) return aria.trim();
  if (el.id) {
    // compared, not selected: React's useId ids hold ':' and jsdom has no CSS.escape
    const lab = [...doc.querySelectorAll("label")].find((l) => l.htmlFor === el.id);
    if (lab && text(lab)) return text(lab);
  }
  const wrap = el.closest("label");
  if (wrap && text(wrap)) return text(wrap);
  if (el.tagName === "BUTTON" && text(el)) return text(el);
  return (el.getAttribute("title") ?? "").trim();
}
const controls = (scope: Element) =>
  [...scope.querySelectorAll("select, input:not([type=hidden]), textarea, button")] as HTMLElement[];

function calculatorPanel(cat: string): HTMLElement {
  const ctx: RateHelperRowContext = { excelRow: 1, description: "", nodeType: "", category: cat, discipline: DISCIPLINE_OF(cat), rateKinds: RATE_KINDS };
  const helper = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map() });
  return mount(<RateHelperPanel variant="calculator" excelRow={1} col="__calc__" kind="supply_rate" ctx={ctx} helpers={[helper]} />);
}
function boqPanel(cat: string, unit: string, row: { model?: Array<Record<string, string>>; attrs?: Record<string, string> }): HTMLElement {
  const cell = (a: Record<string, string>) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
  const ext = new Map<number, ExtractionRow>([[7, { excelRow: 7, description: "", attributes: cell(row.attrs ?? {}),
    ...(row.model ? { items: row.model.map((a) => ({ attributes: cell(a) })) } : {}) } as unknown as ExtractionRow]]);
  const helper = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: ext });
  const ctx = { excelRow: 7, description: "", nodeType: "Line Item", category: cat, discipline: DISCIPLINE_OF(cat), rateKinds: RATE_KINDS, headings: [], ownNotes: [], unit } as RateHelperRowContext;
  const el = mount(<RateHelperPanel variant="embedded" excelRow={7} col="F" kind="supply_rate" ctx={ctx} helpers={[helper]} onUse={() => undefined} />);
  // the BoQ panel's card opens on its header (the calculator opens it already)
  const header = [...el.querySelectorAll("button")].find((b) => !b.getAttribute("aria-label") && b.querySelector(".text-sm.font-medium"));
  act(() => header!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  return el;
}
/** What a screen reader hears for every control, and where the "*" markers and the note are. */
function audit(el: HTMLElement) {
  const all = controls(el);
  const unnamed = all.filter((c) => !accessibleName(c)).map((c) => c.outerHTML.slice(0, 120));
  const fields = all.filter((c) => c.tagName !== "BUTTON");
  return {
    controls: all.length,
    unnamed,
    names: fields.map((c) => accessibleName(c)),
    required: fields.filter((c) => c.getAttribute("aria-required") === "true").map((c) => accessibleName(c)),
    markers: el.querySelectorAll('[data-testid="needed-marker"]').length,
    groupHeads: [...el.querySelectorAll('[data-testid="item-field-group"]')].map((g) => text(g)),
    notes: el.querySelectorAll('[data-testid="needed-to-price-note"]').length,
    buttonInLabel: el.querySelectorAll("label button, label select, label input").length,
    markerHidden: [...el.querySelectorAll('[data-testid="needed-marker"]')].every((m) => m.getAttribute("aria-hidden") === "true"),
  };
}

describe("U8 -- every control on the panel has a screen-reader name (live v48 / v66)", () => {
  it("the calculator on an attribute category: each field is named by its own label, never the '*' or an undo button", () => {
    const a = audit(calculatorPanel("conduit_piping"));
    expect(a.unnamed).toEqual([]);
    expect(a.names).toEqual(expect.arrayContaining(["Conduit Type", "Size (mm)"]));
    expect(a.names.some((n) => /\*|Undo/.test(n))).toBe(false);
    expect(a.buttonInLabel).toBe(0);
    expect(a.notes).toBe(1);
    expect(a.markerHidden).toBe(true);
    expect(a.markers).toBe(a.required.length);
  });

  it("the BoQ panel on a per-number VCD: the either-or group is ONE '*' heading, its two fields carry none; the quantity is named", () => {
    const a = audit(boqPanel("hvac_adp", "nos", { model: [{ family: "VCD", variant: "GI rectangular", size_mm: "550X300" }] }));
    expect(a.unnamed).toEqual([]);
    expect(a.groupHeads).toEqual(["Size (W x H), or Area band *"]);
    expect(a.names).toEqual(expect.arrayContaining(["Size (as written)", "Area band (as written)", "How many in one nos of this row"]));
    expect(a.required).toEqual([]);
    expect(a.markers).toBe(0);
    expect(a.notes).toBe(1);
    expect(a.buttonInLabel).toBe(0);
  });

  it("the BoQ panel on a square diffuser with an air stream: ONE group heading (cert C3 found it drawn twice)", () => {
    const a = audit(boqPanel("hvac_adp", "nos", { model: [{ family: "square diffuser", damper: "with", air: "supply", size_mm: "595x595" }] }));
    expect(a.groupHeads).toEqual(["Neck size, or Outer size *"]);
    expect(a.unnamed).toEqual([]);
  });

  it("the BoQ panel on Insulation: each needed field is aria-required AND carries the hidden '*'; one note", () => {
    const a = audit(boqPanel("hvac_insulation", "RMT", { model: [{ item: "Nitrile Rubber Insulation", thickness_mm: "19" }] }));
    expect(a.unnamed).toEqual([]);
    expect(a.required).toEqual(["Cladding", "Pipe size (mm)"]);
    expect(a.markers).toBe(2);
    expect(a.markerHidden).toBe(true);
    expect(a.notes).toBe(1);
  });

  it("the BoQ panel on an attribute row: Size is aria-required, red and named; no control is unnamed", () => {
    const a = audit(boqPanel("conduit_piping", "RMT", { attrs: { conduit_type: "MS" } }));
    expect(a.unnamed).toEqual([]);
    expect(a.required).toEqual(expect.arrayContaining(["Conduit Type", "Size (mm)"]));
    expect(a.markers).toBe(a.required.length);
  });

  // AC5's counts: every category of both live assets, in the calculator -- how many controls, and how many unnamed
  it("AC5: no category of either asset leaves a control unnamed in the calculator", () => {
    const counts: Record<string, { controls: number; unnamed: number }> = {};
    for (const cat of [...CONFIGS.keys()].sort()) {
      const a = audit(calculatorPanel(cat));
      counts[cat] = { controls: a.controls, unnamed: a.unnamed.length };
      act(() => root?.unmount()); host?.remove(); root = null; host = null;
    }
    const bad = Object.entries(counts).filter(([, c]) => c.unnamed > 0);
    expect(bad).toEqual([]);
    expect(Object.values(counts).reduce((n, c) => n + c.controls, 0)).toBeGreaterThan(100);
    // eslint-disable-next-line no-console
    console.log("ADP3A_AC5_COUNTS " + JSON.stringify(counts));
  });
});
