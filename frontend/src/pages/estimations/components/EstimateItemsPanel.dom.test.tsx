// @vitest-environment jsdom
/** Estimate Items: every material of a BOQ by line or added up, the Normal / Custom filter, "All sheets", and the note
 * about estimates still on an older version. Reads stubbed at `../hooks/useEstimatesData`. */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EstimatesReply } from "@/utils/estimations/estimateTypes";

import { BOQS, customItem, estimate, normalItem, olderEstimate } from "../estimatesTestData";
import type { PanelProps } from "./panelTypes";

const line = (sheet: string, row: number) => ({ sheet_name: sheet, excel_row: row, sl_no: null, description: `Made-up line ${row}`,
  unit: "Sqm", qty: 10, is_current: true });
const data = vi.hoisted(() => ({ reply: { current: [], older: [] } as unknown as EstimatesReply, asked: [] as unknown[] }));
vi.mock("../hooks/useEstimatesData", () => ({
  useEstimates: (...args: unknown[]) => { data.asked.push(args); return { estimates: data.reply, isLoading: false }; },
}));

import { EstimateItemsPanel } from "./EstimateItemsPanel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
  data.asked = [];
  data.reply = {
    current: [
      estimate("L1", [normalItem({ make: "Made-up make", quantity: 3 }), customItem({ quantity: 2 })], { line: line("Made-up sheet", 10) }),
      estimate("L2", [normalItem({ make: "Made-up make", quantity: 5 })], { line: line("Made-up sheet B", 20) }),
    ],
    older: [olderEstimate("E-OLD", "changed", 30, [normalItem()])],
  };
});
afterEach(() => act(() => root.unmount()));

const props = (over: Partial<PanelProps> = {}): PanelProps => ({
  boqs: BOQS, boq: null, sheetName: null, focusRow: null, canEdit: true,
  onBoq: vi.fn(), onSheet: vi.fn(), onFocusRow: vi.fn(), onEdit: vi.fn(), onOpenLine: vi.fn(), onCountsChanged: vi.fn(),
  ...over,
});
const render = (p: PanelProps) => act(() => root.render(<EstimateItemsPanel {...p} />));
const click = (text: string) => act(() => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!.click());
const bodyRows = () => [...container.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));

describe("EstimateItemsPanel", () => {
  it("reads every sheet of the first BOQ, and offers All sheets", () => {
    render(props());
    expect(data.asked[0]).toEqual(["BOQ-A"]);
    expect([...container.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(
      ["All sheets", "Made-up sheet", "Made-up sheet B"]);
  });

  it("by line item: each line with its sheet, then its materials", () => {
    const p = props();
    render(p);
    const rows = bodyRows();
    expect(rows[0][0]).toContain("Made-up sheet · row 10");
    expect(rows.slice(1, 3).map((r) => [r[0], r[1], r[5]])).toEqual([["Normal", "Made-up panel", "3"], ["Custom", "Made-up clip", "2"]]);
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Open line")!.click());
    expect(p.onOpenLine).toHaveBeenCalledWith("Made-up sheet", 10);
  });

  it("one sheet shows only its lines, without the sheet name", () => {
    render(props({ sheetName: "Made-up sheet B" }));
    const rows = bodyRows();
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toContain("row 20");
    expect(rows[0][0]).not.toContain("Made-up sheet B ·");
  });

  it("material totals add the same item + make across lines; Custom shows only custom ones", () => {
    render(props());
    click("Material totals");
    expect(bodyRows().map((r) => [r[1], r[2], r[5], r[6]])).toEqual([["Made-up clip", "—", "2", "1"], ["Made-up panel", "Made-up make", "8", "2"]]);
    click("Custom");
    expect(bodyRows().map((r) => r[1])).toEqual(["Made-up clip"]);
  });

  it("says how many estimates still sit on an older version", () => {
    render(props());
    expect(container.querySelector('[role="status"]')!.textContent).toContain("1 material estimate is on an older version of this BOQ's sheets");
    data.reply = { ...data.reply, older: [] };
    render(props({ sheetName: "Made-up sheet B" }));
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("says so when there are no materials yet", () => {
    data.reply = { current: [], older: [] };
    render(props());
    expect(container.querySelector("tbody")!.textContent).toBe("No materials yet. Add them from BOQ View or Line Item View.");
  });
});
