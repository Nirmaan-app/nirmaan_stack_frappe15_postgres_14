// @vitest-environment jsdom
//
// ELR-4d (owner P6 "Q7 b") -- the REAL `RateHelperPanel`: a runs box the conductor floor raises keeps what is typed while it
// has focus, and shows the raised value, marked "(computed)", once focus leaves. jsdom + react-dom/client only
// (frontend/CLAUDE.md); how it LOOKS is the browser cert's (C1).
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { calculatorCtx } from "@/pages/pricing/PricingCalculator";
import { ELECTRICAL_CONFIGS, ELECTRICAL_ITEMS } from "@/pages/pricing/electricalRuleCases";
import { CONDUCTOR_FLOOR_NOTE, floorBoxValue } from "./conductorFloor";
import { RateHelperPanel } from "./RateHelperPanel";
import { makePricingSheetHelper } from "./pricingSheetHelper";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class StubResizeObserver { observe() { /* no layout */ } unobserve() { /* no layout */ } disconnect() { /* no layout */ } }
if (!(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver;
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => { /* no layout */ };

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

function calculator(): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const helper = makePricingSheetHelper({ configsByCategory: ELECTRICAL_CONFIGS, items: ELECTRICAL_ITEMS, extractionByRow: new Map() });
  const ctx = calculatorCtx("Electrical", "point_wiring");
  act(() => root!.render(<RateHelperPanel variant="calculator" excelRow={ctx.excelRow} col="__calc__" kind="supply_rate" ctx={ctx} helpers={[helper]} />));
  return host;
}
const field = <T extends Element>(el: HTMLElement, id: string) => el.querySelector(`[id$="-attr-${id}"]`) as T;
function setNative(node: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(node, value);
  act(() => { node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
}
const blur = (node: Element) => act(() => { node.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
const wireOne = (el: HTMLElement) => {
  setNative(field<HTMLSelectElement>(el, "wire1_core"), "1");
  setNative(field<HTMLSelectElement>(el, "wire1_thickness_sqmm"), "1.5");
};

describe("the runs box while it is being typed in", () => {
  it("'1' stays '1' while focused (not '3'), on the way to '12', which stands", () => {
    const el = calculator();
    wireOne(el);
    const box = field<HTMLInputElement>(el, "wire1_runs");
    setNative(box, "1");
    expect(field<HTMLInputElement>(el, "wire1_runs").value).toBe("1");
    setNative(field<HTMLInputElement>(el, "wire1_runs"), "12");
    expect(field<HTMLInputElement>(el, "wire1_runs").value).toBe("12");
    blur(field(el, "wire1_runs"));
    expect(field<HTMLInputElement>(el, "wire1_runs").value).toBe("12");
    expect(el.textContent).not.toContain(CONDUCTOR_FLOOR_NOTE);
  });

  it("'1' then focus leaving -> the raised 3, '(computed)', with the note", () => {
    const el = calculator();
    wireOne(el);
    setNative(field<HTMLInputElement>(el, "wire1_runs"), "1");
    expect(el.textContent).toContain(CONDUCTOR_FLOOR_NOTE);
    blur(field(el, "wire1_runs"));
    expect(field<HTMLInputElement>(el, "wire1_runs").value).toBe("3");
    const label = [...el.querySelectorAll("label")].find((l) => (l.textContent ?? "").trim() === "Wire 1 - runs")!;
    expect(label.parentElement!.textContent).toContain("(computed)");
  });

  it("a box showing a raised value selects it on focus, so typing replaces it; a box the floor did not raise does not", () => {
    const el = calculator();
    wireOne(el); // runs blank: the box shows the raised 3
    const box = field<HTMLInputElement>(el, "wire1_runs");
    expect(box.value).toBe("3");
    act(() => { box.focus(); });
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, 1]);
    blur(box);
    const points = field<HTMLInputElement>(el, "points");
    setNative(points, "2");
    points.setSelectionRange(1, 1);
    act(() => { points.focus(); });
    expect([points.selectionStart, points.selectionEnd]).toEqual([1, 1]);
  });

  it("emptying the box stays empty while focused, and shows the raised 3 on leaving", () => {
    const el = calculator();
    wireOne(el);
    setNative(field<HTMLInputElement>(el, "wire1_runs"), "1");
    setNative(field<HTMLInputElement>(el, "wire1_runs"), "");
    expect(field<HTMLInputElement>(el, "wire1_runs").value).toBe("");
    blur(field(el, "wire1_runs"));
    expect(field<HTMLInputElement>(el, "wire1_runs").value).toBe("3");
  });
});

describe("floorBoxValue, PURE", () => {
  const raised = { id: "wire1_runs", notes: [{ kind: "landed", how: CONDUCTOR_FLOOR_NOTE }] };
  it("a raised box being typed in shows the typing", () => {
    expect(floorBoxValue(raised, "3", { id: "wire1_runs", text: "1" })).toBe("1");
  });
  it("NEGATIVE: a raised box nobody is typing in shows the raised value", () => {
    expect(floorBoxValue(raised, "3", null)).toBe("3");
    expect(floorBoxValue(raised, "3", { id: "wire2_runs", text: "1" })).toBe("3");
  });
  it("NEGATIVE: a box the floor did not raise shows what it always showed, whatever is being typed, and 'None' still shows empty", () => {
    expect(floorBoxValue({ id: "points" }, "2", { id: "points", text: "9" })).toBe("2");
    expect(floorBoxValue({ id: "x", notes: [{ kind: "landed", how: "As the row states" }] }, "2", { id: "x", text: "9" })).toBe("2");
    expect(floorBoxValue({ id: "points" }, "None", null)).toBe("");
  });
});
