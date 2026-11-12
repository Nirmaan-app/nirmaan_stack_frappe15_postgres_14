// @vitest-environment jsdom
/**
 * BOQ View: the BOQ list, and a sheet's grid with its one Expand all / Collapse all button (owner 12 Nov): Collapse
 * all folds every heading so only top-level rows stay (with "+N lines") and closes every line's materials; Expand all
 * shows every row and opens every line that has materials; a search shows its matches through a fold; another sheet
 * opens unfolded. The data reads are stubbed at `../hooks/useEstimatesData`; the BOQ viewer's collapse helpers run.
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EstimatesReply } from "@/utils/estimations/estimateTypes";

import { BOQS, customItem, estimate, normalItem, SHEET_ROWS } from "../estimatesTestData";
import type { PanelProps } from "./panelTypes";

const data = vi.hoisted(() => ({ estimates: { current: [], older: [] } as unknown as EstimatesReply, refresh: vi.fn() }));
vi.mock("../hooks/useEstimatesData", () => ({
  useSheetRows: () => ({ rows: SHEET_ROWS, isLoading: false }),
  useEstimates: () => ({ estimates: data.estimates, isLoading: false }),
  useRefreshEstimates: () => data.refresh,
  useEstimateWrites: () => ({ reattachEstimates: vi.fn(), settleOlder: vi.fn(), olderBusy: false }),
}));

import { BoqViewPanel } from "./BoqViewPanel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  data.estimates = { current: [estimate("L1", [normalItem(), customItem()]), estimate("L3", [normalItem()])], older: [] };
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const props = (over: Partial<PanelProps> = {}): PanelProps => ({
  boqs: BOQS, boq: BOQS[0], sheetName: "Made-up sheet", focusRow: null, canEdit: true,
  onBoq: vi.fn(), onSheet: vi.fn(), onFocusRow: vi.fn(), onEdit: vi.fn(), onOpenLine: vi.fn(), onCountsChanged: vi.fn(),
  ...over,
});
const render = (p: PanelProps) => act(() => root.render(<BoqViewPanel {...p} />));
const shown = () => [...container.querySelectorAll("tbody tr[id^='est-row-']")].map((tr) => tr.id.replace("est-row-", ""));
const toggleButton = () => [...container.querySelectorAll("button")].find((b) => /(Expand|Collapse) all/.test(b.textContent ?? ""))!;
const openMaterials = () => [...container.querySelectorAll("tbody tr")].filter((tr) => tr.textContent?.includes("BOQ qty")).length;
const description = (name: string) => container.querySelector(`#est-row-${name}`)!.querySelectorAll("td")[5].textContent;
function search(text: string) {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Search description"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("BOQ View: the BOQ list", () => {
  it("lists each Selected BOQ with its sheets, line items and estimated count, and opens one", () => {
    const p = props({ boq: null });
    render(p);
    const cells = [...container.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].slice(0, 4).map((td) => td.textContent));
    expect(cells).toEqual([
      ["Made-up BOQ ABOQ-A", "2", "8", "2/8"],
      ["Made-up BOQ BBOQ-B", "1", "7", "7/7"],
    ]);
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Open")!.click());
    expect(p.onBoq).toHaveBeenCalledWith("BOQ-A");
  });
});

describe("BOQ View: one toggle for headings and materials", () => {
  it("starts unfolded with materials closed, and Expand all opens every line that has materials", () => {
    render(props());
    expect(shown()).toEqual(["H1", "L1", "L2", "H2", "SH", "L3"]);
    expect([toggleButton().textContent, openMaterials()]).toEqual(["▾ Expand all", 0]);
    act(() => toggleButton().click());
    expect([toggleButton().textContent, openMaterials()]).toEqual(["▸ Collapse all", 2]);
  });

  it("Collapse all keeps only the top-level headings, says what each hides, and closes the materials", () => {
    const p = props();
    render(p);
    act(() => toggleButton().click());
    act(() => toggleButton().click());
    expect(shown()).toEqual(["H1", "H2"]);
    expect(description("H1")).toBe("MADE-UP SYSTEM(+2 lines)");
    expect(description("H2")).toBe("MADE-UP DUCTS(+1 line)");
    expect([toggleButton().textContent, openMaterials()]).toEqual(["▾ Expand all", 0]);
    expect(p.onFocusRow).toHaveBeenLastCalledWith(null);

    act(() => toggleButton().click());
    expect(shown()).toEqual(["H1", "L1", "L2", "H2", "SH", "L3"]);
    expect([toggleButton().textContent, openMaterials()]).toEqual(["▸ Collapse all", 2]);
  });

  it("on a sheet with no materials it offers Collapse all first", () => {
    data.estimates = { current: [], older: [] };
    render(props());
    expect(toggleButton().textContent).toBe("▸ Collapse all");
    act(() => toggleButton().click());
    expect([shown(), toggleButton().textContent]).toEqual([["H1", "H2"], "▾ Expand all"]);
  });

  it("a search shows its matches through a fold, and the fold comes back when it is cleared", () => {
    render(props());
    act(() => toggleButton().click());
    act(() => toggleButton().click());
    search("diffuser");
    expect(shown()).toEqual(["H1", "L2", "H2", "SH"]);
    expect(description("H1")).toBe("MADE-UP SYSTEM");
    search("");
    expect(shown()).toEqual(["H1", "H2"]);
  });

  it("another sheet opens unfolded", () => {
    const p = props();
    render(p);
    act(() => toggleButton().click());
    act(() => toggleButton().click());
    expect(shown()).toEqual(["H1", "H2"]);
    render({ ...p, sheetName: "Made-up sheet B" });
    expect(shown()).toEqual(["H1", "L1", "L2", "H2", "SH", "L3"]);
  });

  it("starts with notes and subtotals shown and spacers hidden", () => {
    render(props());
    const box = (label: string) => [...container.querySelectorAll("label")].find((l) => l.textContent === label)!.querySelector("input")!;
    expect([box("Notes").checked, box("Subtotals").checked, box("Spacers").checked]).toEqual([true, true, false]);
  });
});

describe("BOQ View: the form", () => {
  it("opens the material form for the line with its estimate", () => {
    const p = props();
    render(p);
    act(() => container.querySelector("#est-row-L1")!.querySelectorAll("td")[4].querySelectorAll("button")[1].click());
    const target = (p.onEdit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect([target.boq, target.node, target.sheetName, target.excelRow, target.qty, target.entry.name])
      .toEqual(["BOQ-A", "L1", "Made-up sheet", 10, 12, "E-L1"]);
    target.afterSave();
    expect(data.refresh).toHaveBeenCalledWith("BOQ-A");
    expect(p.onCountsChanged).toHaveBeenCalled();
  });
});
