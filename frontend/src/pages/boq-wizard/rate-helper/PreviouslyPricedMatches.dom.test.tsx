// @vitest-environment jsdom
//
// DEV2-B5 S4 (owner R-H2AI, mockup 2026-11-02 15:23). The REAL card and pop-up mounted with jsdom + react-dom/client only
// (no @testing-library, frontend/CLAUDE.md), and the panel's branch.
//
//   the card    header, range, dots with their words, struck-through not-a-match, other-unit note, the key; NO
//               "Use this value" and no figure to use  /  without `matches` the panel's greyed card is as before
//   the pop-up  project / BoQ / sheet, the payload levels with notes, rates + date, verdict words + note; prev / next
//               wrap; "Not a match" -> reason + note -> onMark(match, reason, note); a flagged match -> Undo -> onUndo;
//               "Open this row" only when the user may open that BoQ (can_open AND the route role)
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PreviouslyPricedCard } from "./PreviouslyPricedMatches";
import { RateHelperPanel } from "./RateHelperPanel";
import type { MatchDetail, PreviousMatch, PreviouslyPricedView, RateHelper } from "./rateHelperTypes";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
/** The text nodes joined by a space (adjacent elements' words stay apart). */
const spaced = (n: Element | null | undefined): string => {
  const out: string[] = [];
  const walk = (x: Node) => { if (x.nodeType === 3) out.push(x.textContent ?? ""); x.childNodes.forEach(walk); };
  if (n) walk(n);
  return out.join(" ").replace(/\s+/g, " ").trim();
};
// jsdom does no layout: the panel's scroll-into-view guard calls this
(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
const all = (sel: string) => Array.from(document.body.querySelectorAll(sel));
const click = async (el: Element | null | undefined) => {
  await act(async () => { (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })); });
};
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const button = (label: string) => all("button").find((b) => text(b) === label || b.getAttribute("aria-label") === label);

const MATCHES: PreviousMatch[] = [
  { key: "a", boq: "BOQ-26-00341", sheet_name: "Elec BOQ", excel_row: 31, verdict: "SAME", colour: "green", n1b: null,
    supply_rate: 1050, install_rate: 140, unit: "Rm", priced_at: "2026-10-14 10:00:00", description: "4C x 16 sq.mm" },
  { key: "b", boq: "BOQ-26-00265", sheet_name: "LT works", excel_row: 12, verdict: "CLOSE", colour: "amber", n1b: "Armouring not stated in this row",
    total_rate: 1020, unit: "Rm", priced_at: "2026-09-02", description: "4C x 16 sq.mm Cu XLPE",
    flag: { action: "not_a_match", reason: "Different spec" } },
  { key: "c", boq: "BOQ-26-00187", sheet_name: "External", excel_row: 4, verdict: "CLOSE", colour: "red", n1b: null,
    total_rate: 90, unit: "Nos", priced_at: "2026-08-11", description: "4C x 16 sq.mm in trench" },
];
const DETAIL: MatchDetail = {
  boq: "BOQ-26-00341", boq_name: "Office tender", project: "PROJ-1", project_name: "Sample project A", sheet_name: "Elec BOQ",
  excel_row: 31, committed_version: 2, can_open: true,
  payload: { id: 31, description: "4C x 16 sq.mm", ancestor_chain: [{ relation: "sheet", description: "Elec BOQ" },
    { relation: "parent", distance: 1, description: "C. LT cables", notes: { attached: ["All cables FRLS"] } }] },
};
function view(over: Partial<PreviouslyPricedView> = {}): PreviouslyPricedView {
  return {
    matchRun: "BRMR-1", boq: "BOQ-T", sheetName: "S", excelRow: 5, rowUnit: "Rm", matches: MATCHES,
    canMark: true, canOpenBoqs: true,
    loadDetail: vi.fn(async (m: PreviousMatch) => ({ ...DETAIL, boq: m.boq, sheet_name: m.sheet_name, excel_row: m.excel_row })),
    onMark: vi.fn(async () => {}), onUndo: vi.fn(async () => {}), ...over,
  };
}

describe("the card", () => {
  it("range over the shown matches leaving out not-a-match and other-unit; dots carry words; no Use", () => {
    mount(<PreviouslyPricedCard view={view()} />);
    expect(text(document.querySelector('[data-testid="match-range"]'))).toBe("Rs 1,190");      // only the green: amber flagged, red other unit
    const dots = all('[data-testid="match-dot"]');
    expect(dots.map((d) => [d.getAttribute("aria-label"), d.getAttribute("title"), d.getAttribute("role")])).toEqual([
      ["Likely the same", "Likely the same", "img"],
      ["Check - a spec is stated on one side only", "Check - a spec is stated on one side only", "img"],
      ["Close - a spec differs", "Close - a spec differs", "img"],
    ]);
    const rows = all('[data-testid="match-row"]');
    expect(rows.map(text)[0]).toContain("4C x 16 sq.mm");
    expect(rows[1].querySelector(".line-through")).not.toBeNull();
    expect(text(rows[1])).toContain("Not a match");
    expect(text(rows[2])).toContain("other unit - not in range");
    expect(rows[0].querySelector(".line-through")).toBeNull();
    expect(spaced(document.querySelector('[data-testid="match-key"]'))).toBe(
      "Likely same Check: a spec is in one row only Close: a spec differs Click a match for full details.");
    expect(text(document.body)).not.toContain("Use this value");
    expect(text(document.body)).toContain("From 1 of 3 matches (2 left out)");
  });

  it("the panel renders the card for a decline carrying matches, and the greyed reason otherwise", () => {
    const withMatches: RateHelper = { id: "previously_priced_boqs", label: "Previously priced BoQs", compute: () => ({ kind: "none", reason: "", matches: view() }) };
    const greyed: RateHelper = { id: "previously_priced_boqs", label: "Previously priced BoQs", compute: () => ({ kind: "none", reason: "Matching not run yet" }) };
    const ctx = { excelRow: 5, description: "d", nodeType: "Line Item", category: null, discipline: null, rateKinds: ["supply_rate" as const] };
    mount(<RateHelperPanel excelRow={5} col="F" kind="supply_rate" ctx={ctx} helpers={[withMatches]} onUse={() => {}} />);
    expect(document.querySelector('[data-testid="previously-priced-card"]')).not.toBeNull();
    act(() => root!.render(<RateHelperPanel excelRow={5} col="F" kind="supply_rate" ctx={ctx} helpers={[greyed]} onUse={() => {}} />));
    expect(document.querySelector('[data-testid="previously-priced-card"]')).toBeNull();
    expect(text(document.body)).toContain("Previously priced BoQs");
    expect(text(document.body)).toContain("Matching not run yet");
  });
});

describe("the pop-up", () => {
  it("project / BoQ / sheet, hierarchy with notes, rates, date, verdict words; prev / next wrap", async () => {
    const v = view();
    mount(<PreviouslyPricedCard view={v} />);
    await click(all('[data-testid="match-row"]')[0]);
    await flush();
    const dlg = document.querySelector('[data-testid="match-dialog"]');
    expect(text(dlg)).toContain("Match 1 of 3");
    expect(text(dlg)).toContain("Sample project A");
    expect(text(dlg)).toContain("Office tender (BOQ-26-00341)");
    expect(all('[data-testid="payload-level"]').map(spaced)).toEqual(["Sheet Elec BOQ", "Section C. LT cables Note: All cables FRLS", "This row 4C x 16 sq.mm · Rm"]);
    expect(spaced(document.querySelector('[data-testid="match-rates"]'))).toBe("Supply Rs 1,050 Install Rs 140 Total / Rm Rs 1,190 Priced on 2026-10-14");
    expect(text(document.querySelector('[data-testid="match-verdict"]'))).toBe("Likely the same");
    await click(button("Previous match"));
    await flush();
    expect(text(document.querySelector('[data-testid="match-dialog"]'))).toContain("Match 3 of 3");
    await click(button("Next match"));
    await click(button("Next match"));
    await flush();
    expect(text(document.querySelector('[data-testid="match-verdict"]'))).toBe("Check - a spec is stated on one side only - Armouring not stated in this row");
  });

  it("Not a match -> optional reason + note -> onMark", async () => {
    const v = view();
    mount(<PreviouslyPricedCard view={v} />);
    await click(all('[data-testid="match-row"]')[0]);
    await flush();
    await click(button("Not a match"));
    await click(button("Different unit"));
    const input = document.querySelector('[data-testid="match-flag-note"]') as HTMLInputElement;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "this one is aluminium");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("Mark as not a match"));
    await flush();
    expect(v.onMark).toHaveBeenCalledWith(MATCHES[0], "Different unit", "this one is aluminium");
    expect(v.onUndo).not.toHaveBeenCalled();
  });

  it("a flagged match shows the saved state and Undo -> onUndo", async () => {
    const v = view();
    mount(<PreviouslyPricedCard view={v} />);
    await click(all('[data-testid="match-row"]')[1]);
    await flush();
    expect(text(document.querySelector('[data-testid="match-flagged"]'))).toContain("Marked as not a match (different spec)");
    await click(button("Undo"));
    await flush();
    expect(v.onUndo).toHaveBeenCalledWith(MATCHES[1]);
  });

  it("Open this row: only when the BoQ can be opened AND the role admits the route; it links ?row=", async () => {
    mount(<PreviouslyPricedCard view={view()} />);
    await click(all('[data-testid="match-row"]')[0]);
    await flush();
    const a = document.querySelector('[data-testid="match-open-row"]') as HTMLAnchorElement;
    expect(a.getAttribute("href")).toBe("/upload-boq/hub/BOQ-26-00341/pricing/Elec%20BOQ?row=31");
    act(() => root!.unmount());
    mount(<PreviouslyPricedCard view={view({ canOpenBoqs: false })} />);
    await click(all('[data-testid="match-row"]')[0]);
    await flush();
    expect(document.querySelector('[data-testid="match-open-row"]')).toBeNull();
    act(() => root!.unmount());
    mount(<PreviouslyPricedCard view={view({ loadDetail: vi.fn(async () => ({ ...DETAIL, can_open: false })) })} />);
    await click(all('[data-testid="match-row"]')[0]);
    await flush();
    expect(document.querySelector('[data-testid="match-open-row"]')).toBeNull();
  });

  it("a read-only sheet (canMark false) offers neither Not a match nor Undo", async () => {
    mount(<PreviouslyPricedCard view={view({ canMark: false })} />);
    await click(all('[data-testid="match-row"]')[1]);
    await flush();
    expect(button("Undo")).toBeUndefined();
    await click(button("Next match"));
    await flush();
    expect(button("Not a match")).toBeUndefined();
  });
});
