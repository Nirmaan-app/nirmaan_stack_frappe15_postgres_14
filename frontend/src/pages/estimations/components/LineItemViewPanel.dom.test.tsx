// @vitest-environment jsdom
/** Line Item View: only line items, under their headings, with the Estimate Items column, the Estimated filter,
 * search, Expand / Collapse all, and the form opened for the right line. Reads stubbed at `../hooks/useEstimatesData`. */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BOQS, customItem, estimate, normalItem, SHEET_ROWS } from "../estimatesTestData";
import type { PanelProps } from "./panelTypes";

const data = vi.hoisted(() => ({ refresh: vi.fn(), sheetAsked: [] as unknown[] }));
vi.mock("../hooks/useEstimatesData", () => ({
  useSheetRows: (boq: string | null, sheet: string | null) => { data.sheetAsked.push([boq, sheet]); return { rows: SHEET_ROWS, isLoading: false }; },
  useEstimates: () => ({ estimates: { current: [estimate("L1", [normalItem(), customItem()])], older: [] }, isLoading: false }),
  useRefreshEstimates: () => data.refresh,
  useEstimateWrites: () => ({ reattachEstimates: vi.fn(), settleOlder: vi.fn(), olderBusy: false }),
}));

import { LineItemViewPanel } from "./LineItemViewPanel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  data.sheetAsked = [];
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const props = (over: Partial<PanelProps> = {}): PanelProps => ({
  boqs: BOQS, boq: null, sheetName: null, focusRow: null, canEdit: true,
  onBoq: vi.fn(), onSheet: vi.fn(), onFocusRow: vi.fn(), onEdit: vi.fn(), onOpenLine: vi.fn(), onCountsChanged: vi.fn(),
  ...over,
});
const render = (p: PanelProps) => act(() => root.render(<LineItemViewPanel {...p} />));
const lines = () => [...container.querySelectorAll("tbody tr[id^='est-row-']")].map((tr) => tr.id.replace("est-row-", ""));
const headings = () => [...container.querySelectorAll("tbody tr.bg-muted\\/50")].map((tr) => tr.textContent);
const click = (text: string) => act(() => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!.click());

describe("LineItemViewPanel", () => {
  it("opens the first BOQ's first sheet when none is chosen", () => {
    render(props());
    expect(data.sheetAsked[0]).toEqual(["BOQ-A", "Made-up sheet"]);
  });

  it("lists only line items, each under its heading, with the Estimate Items column", () => {
    render(props());
    expect([...container.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(
      ["", "Sl.No", "Description", "Unit", "BOQ qty", "Estimate Items"]);
    expect(lines()).toEqual(["L1", "L2", "L3"]);
    expect(headings()).toEqual(["MADE-UP SYSTEM", "Made-up sub heading"]);
  });

  it("filters Estimated / Not estimated, and searches", () => {
    render(props());
    click("Estimated");
    expect(lines()).toEqual(["L1"]);
    click("Not estimated");
    expect(lines()).toEqual(["L2", "L3"]);
    click("All");
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Search line items"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "nothing like this");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector("tbody")!.textContent).toBe("No line items match. Clear the search or the filter.");
  });

  it("opens a line with ▸, shows its materials or says it has none, and Expand / Collapse all", () => {
    const p = props();
    render(p);
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Show materials for row 11"]')!.click());
    expect(p.onFocusRow).toHaveBeenLastCalledWith(11);
    expect(container.textContent).toContain("No materials yet for this line.");
    click("▾ Expand all");
    expect(container.textContent).toContain("Made-up clip");
    click("▸ Collapse all");
    expect(container.textContent).not.toContain("Made-up clip");
  });

  it("opens the form for the line, and refreshes after a save", () => {
    const p = props();
    render(p);
    act(() => container.querySelector("#est-row-L2")!.querySelectorAll("td")[5].querySelector("button")!.click());
    const target = (p.onEdit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect([target.boq, target.node, target.sheetName, target.excelRow, target.entry]).toEqual(["BOQ-A", "L2", "Made-up sheet", 11, undefined]);
    target.afterSave();
    expect(data.refresh).toHaveBeenCalledWith("BOQ-A");
  });

  it("gives a viewer no + Add", () => {
    render(props({ canEdit: false }));
    expect(container.querySelector("#est-row-L2")!.querySelectorAll("td")[5].textContent).toBe("—");
  });
});
