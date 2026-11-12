// @vitest-environment jsdom
/** BOQ View's grid: the Estimate Items column after Row type, its cells on line items only, "(+N lines)" on folded
 * headings, and a line's materials drawn under it when it is open. */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { gridRows } from "@/utils/estimations/estimateRules";
import type { EstimateEntry } from "@/utils/estimations/estimateTypes";

import { customItem, estimate, normalItem, SHEET_ROWS } from "../estimatesTestData";
import { EstimateSheetGrid } from "./EstimateSheetGrid";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROWS = gridRows(SHEET_ROWS, { showNotes: true, showSubtotals: true, showSpacers: true, search: "" });
const ESTIMATES = new Map<string, EstimateEntry>([["L1", estimate("L1", [normalItem(), customItem()])]]);

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

type Props = Parameters<typeof EstimateSheetGrid>[0];
const render = (over: Partial<Props> = {}) => {
  const props: Props = {
    rows: ROWS, estimates: ESTIMATES, expanded: new Set(), highlight: null, canEdit: true,
    onToggle: vi.fn(), onEdit: vi.fn(), onOpenInLineView: vi.fn(), ...over,
  };
  act(() => root.render(<EstimateSheetGrid {...props} />));
  return props;
};
const row = (name: string) => container.querySelector<HTMLTableRowElement>(`#est-row-${name}`);
const cell = (name: string, i: number) => row(name)!.querySelectorAll("td")[i];
const MATERIALS = 4;

describe("EstimateSheetGrid", () => {
  it("puts the Estimate Items column right after Row type", () => {
    render();
    const heads = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(heads).toEqual(["Excel", "Sl.No", "Parent", "Row type", "Estimate Items", "Description", "Unit", "Qty",
      "Rate (Supply)", "Rate (Install)", "Amount"]);
  });

  it("draws every row in sheet order with its parent's Excel row", () => {
    render();
    expect([...container.querySelectorAll("tbody tr[id]")].map((tr) => tr.id)).toEqual(
      ["est-row-H1", "est-row-L1", "est-row-L2", "est-row-H2", "est-row-SH", "est-row-L3"]);
    expect(cell("L3", 2).textContent).toBe("↑ 13");
    expect(cell("H1", 3).textContent).toBe("Preamble");
  });

  it("fills the Estimate Items cell on line items only", () => {
    render();
    expect(cell("H1", MATERIALS).textContent).toBe("");
    expect(cell("SH", MATERIALS).textContent).toBe("");
    expect(cell("L1", MATERIALS).textContent).toContain("▸ 2 items");
    expect(cell("L2", MATERIALS).textContent).toBe("+ Add");
  });

  it("gives a viewer no + Add and no Edit", () => {
    render({ canEdit: false });
    expect(cell("L2", MATERIALS).textContent).toBe("—");
    expect([...cell("L1", MATERIALS).querySelectorAll("button")].map((b) => b.textContent?.trim())).toEqual(["▸ 2 items"]);
  });

  it("passes the line to the handlers", () => {
    const props = render();
    act(() => cell("L1", MATERIALS).querySelector("button")!.click());
    act(() => cell("L2", MATERIALS).querySelector("button")!.click());
    expect(props.onToggle).toHaveBeenCalledWith("L1");
    expect((props.onEdit as ReturnType<typeof vi.fn>).mock.calls[0][0].name).toBe("L2");
  });

  it("draws an open line's materials under it, and nothing for an open line with none", () => {
    render({ expanded: new Set(["L1", "L2"]) });
    const under = row("L1")!.nextElementSibling!;
    expect(under.id).toBe("");
    expect(under.textContent).toContain("Made-up clip");
    expect(under.querySelector("td")!.getAttribute("colspan")).toBe("11");
    expect(row("L2")!.nextElementSibling!.id).toBe("est-row-H2");
  });

  it("shows how many lines a folded heading hides, in the singular for one", () => {
    render({ rows: ROWS.filter((r) => r.name === "H1" || r.name === "H2"), hiddenUnder: new Map([[0, 2], [3, 1]]) });
    expect(cell("H1", 5).textContent).toBe("MADE-UP SYSTEM(+2 lines)");
    expect(cell("H2", 5).textContent).toBe("MADE-UP DUCTS(+1 line)");
  });

  it("marks the highlighted line, and says so when nothing matches", () => {
    render({ highlight: "L2" });
    expect(row("L2")!.className).toContain("bg-yellow-50");
    expect(row("L1")!.className).not.toContain("bg-yellow-50");
    render({ rows: [] });
    expect(container.querySelector("tbody")!.textContent).toBe("No rows match. Clear the search or show more row types.");
  });
});
