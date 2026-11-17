// @vitest-environment jsdom
/** Estimate Items: Material totals first (owner 17 Nov), By line item, the Normal / Custom filter, "All sheets", "All
 * BOQs" (every Selected BOQ of the project together), and the note about estimates still on an older version.
 * Reads stubbed at `../hooks/useEstimatesData`. */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EstimatesReply } from "@/utils/estimations/estimateTypes";

import { BOQS, customItem, estimate, normalItem, olderEstimate } from "../estimatesTestData";
import type { PanelProps } from "./panelTypes";

const line = (sheet: string, row: number) => ({ sheet_name: sheet, excel_row: row, sl_no: null, description: `Made-up line ${row}`,
  unit: "Sqm", qty: 10, is_current: true });
const empty = { current: [], older: [] } as unknown as EstimatesReply;
const data = vi.hoisted(() => ({
  reply: { current: [], older: [] } as unknown as EstimatesReply,
  project: { current: [], older: [] } as unknown as EstimatesReply,
  asked: [] as unknown[], askedProject: [] as unknown[],
}));
vi.mock("../hooks/useEstimatesData", () => ({
  useEstimates: (...args: unknown[]) => { data.asked.push(args); return { estimates: args[0] ? data.reply : empty, isLoading: false }; },
  useProjectEstimates: (project: string | null) => {
    data.askedProject.push(project);
    return { estimates: project ? data.project : empty, isLoading: false };
  },
}));

import { EstimateItemsPanel } from "./EstimateItemsPanel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
  data.asked = [];
  data.askedProject = [];
  data.reply = {
    current: [
      estimate("L1", [normalItem({ make: "Made-up make", quantity: 3 }), customItem({ quantity: 2 })],
        { line: line("Made-up sheet", 10), boq: "BOQ-A", boq_name: "Made-up BOQ A" }),
      estimate("L2", [normalItem({ make: "Made-up make", quantity: 5 })],
        { line: line("Made-up sheet B", 20), boq: "BOQ-A", boq_name: "Made-up BOQ A" }),
    ],
    older: [olderEstimate("E-OLD", "changed", 30, [normalItem()])],
  };
  data.project = {
    current: [
      ...data.reply.current,
      estimate("B1", [normalItem({ make: "Made-up make", quantity: 4 })],
        { line: line("Made-up other sheet", 5), boq: "BOQ-B", boq_name: "Made-up BOQ B" }),
    ],
    older: [],
  };
});
afterEach(() => act(() => root.unmount()));

type Props = PanelProps & { projectId: string };
const props = (over: Partial<Props> = {}): Props => ({
  projectId: "PROJ-1", boqs: BOQS, boq: BOQS[0], sheetName: null, focusRow: null, canEdit: true,
  onBoq: vi.fn(), onSheet: vi.fn(), onFocusRow: vi.fn(), onEdit: vi.fn(), onOpenLine: vi.fn(), onCountsChanged: vi.fn(),
  ...over,
});
const render = (p: Props) => act(() => root.render(<EstimateItemsPanel {...p} />));
const click = (text: string) => act(() => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!.click());
const bodyRows = () => [...container.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));
const heads = () => [...container.querySelectorAll("thead th")].map((th) => th.textContent);
const modeButtons = () => [...container.querySelectorAll("button")].filter((b) => ["Material totals", "By line item"].includes(b.textContent ?? ""));

describe("EstimateItemsPanel: one BOQ", () => {
  it("reads every sheet of that BOQ, and offers All sheets", () => {
    render(props());
    expect(data.asked[0]).toEqual(["BOQ-A"]);
    expect(data.askedProject[0]).toBeNull();
    expect([...container.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(
      ["All sheets", "Made-up sheet", "Made-up sheet B"]);
  });

  it("opens on Material totals, the first button: same item + make added up across lines; Custom shows only custom", () => {
    render(props());
    expect(modeButtons().map((b) => [b.textContent, b.className.includes("bg-sky-600")])).toEqual(
      [["Material totals", true], ["By line item", false]]);
    expect(heads()).not.toContain("BOQs");
    expect(bodyRows().map((r) => [r[1], r[2], r[5], r[6]])).toEqual([["Made-up clip", "—", "2", "1"], ["Made-up panel", "Made-up make", "8", "2"]]);
    click("Custom");
    expect(bodyRows().map((r) => r[1])).toEqual(["Made-up clip"]);
  });

  it("by line item: each line with its sheet, then its materials; Open line names the BOQ", () => {
    const p = props();
    render(p);
    click("By line item");
    const rows = bodyRows();
    expect(rows[0][0]).toContain("Made-up sheet · row 10");
    expect(rows[0][0]).not.toContain("Made-up BOQ A ·");
    expect(rows.slice(1, 3).map((r) => [r[0], r[1], r[5]])).toEqual([["Normal", "Made-up panel", "3"], ["Custom", "Made-up clip", "2"]]);
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Open line")!.click());
    expect(p.onOpenLine).toHaveBeenCalledWith("Made-up sheet", 10, "BOQ-A");
  });

  it("one sheet shows only its lines, without the sheet name", () => {
    render(props({ sheetName: "Made-up sheet B" }));
    click("By line item");
    const rows = bodyRows();
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toContain("row 20");
    expect(rows[0][0]).not.toContain("Made-up sheet B ·");
  });

  it("a project with a single Selected BOQ opens that BOQ, with no BOQ picker", () => {
    render(props({ boqs: [BOQS[0]], boq: null }));
    expect(data.asked[0]).toEqual(["BOQ-A"]);
    expect(container.querySelector("select")).toBeNull();
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
    click("By line item");
    expect(container.querySelector("tbody")!.textContent).toBe("No materials yet. Add them from BOQ View or Line Item View.");
  });
});

describe("EstimateItemsPanel: All BOQs", () => {
  it("with no BOQ chosen reads the whole project once, picker on All BOQs, sheet strip just All sheets", () => {
    render(props({ boq: null, sheetName: "Made-up sheet" }));
    expect(data.askedProject[0]).toBe("PROJ-1");
    expect(data.asked[0]).toEqual([null]);
    const select = container.querySelector("select")!;
    expect([select.value, [...select.options].map((o) => o.textContent)]).toEqual(
      ["all", ["All BOQs (2)", "Made-up BOQ A · BOQ-A", "Made-up BOQ B · BOQ-B"]]);
    expect(container.textContent).toContain("Every BOQ and every sheet of the project");
    expect([...container.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(["All sheets"]);
  });

  it("material totals add across BOQs and say in how many", () => {
    render(props({ boq: null }));
    expect(heads()).toEqual(["Type", "Item", "Make", "Category", "Unit", "Total qty", "Used in lines", "BOQs"]);
    expect(bodyRows().map((r) => [r[1], r[5], r[6], r[7]])).toEqual([["Made-up clip", "2", "1", "1"], ["Made-up panel", "12", "3", "2"]]);
  });

  it("by line item: BOQ · sheet · row on every line, and Open line opens that line's BOQ", () => {
    const p = props({ boq: null });
    render(p);
    click("By line item");
    const groups = bodyRows().filter((r) => r.length === 1).map((r) => r[0]);
    expect(groups.map((g) => g!.split("Made-up line")[0])).toEqual([
      "Made-up BOQ A · Made-up sheet · row 10", "Made-up BOQ A · Made-up sheet B · row 20", "Made-up BOQ B · Made-up other sheet · row 5"]);
    act(() => [...container.querySelectorAll("button")].filter((b) => b.textContent === "Open line")[2].click());
    expect(p.onOpenLine).toHaveBeenCalledWith("Made-up other sheet", 5, "BOQ-B");
  });

  it("picking a BOQ, or All BOQs again, goes through onBoq", () => {
    const p = props({ boq: null });
    render(p);
    const select = container.querySelector("select")!;
    act(() => { select.value = "BOQ-B"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(p.onBoq).toHaveBeenLastCalledWith("BOQ-B");
    render(props({ boq: BOQS[1], onBoq: p.onBoq }));
    act(() => { select.value = "all"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(p.onBoq).toHaveBeenLastCalledWith("all");
  });
});
