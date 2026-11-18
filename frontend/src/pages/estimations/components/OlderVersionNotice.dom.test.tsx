// @vitest-environment jsdom
/**
 * The older-version notice: what it lists and what each button sends. Remove always asks first and sends exactly the
 * one estimate chosen (never "[]", which the server reads as none); "Add to a line" settles the older estimate only
 * once the form says materials were kept (review issue 6). The writes are stubbed at `../hooks/useEstimatesData`.
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { EstimateEntry, SheetRow } from "@/utils/estimations/estimateTypes";

import { normalItem, olderEstimate, SHEET_ROWS } from "../estimatesTestData";
import type { CarriedRows } from "./panelTypes";

const writes = vi.hoisted(() => ({
  reattachEstimates: vi.fn(), settleOlder: vi.fn(), olderBusy: false,
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock("../hooks/useEstimatesData", () => ({ useEstimateWrites: () => writes }));
vi.mock("@/components/ui/use-toast", () => ({ toast }));

import { OlderVersionNotice } from "./OlderVersionNotice";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LINES = SHEET_ROWS.filter((r) => r.classification === "line_item");
const COPY = olderEstimate("E-COPY", "can_copy", 10, [normalItem({ quantity: 12 })]);
const CHANGED = olderEstimate("E-CHANGED", "changed", 11, [normalItem({ quantity: 4 })]);
const GONE = olderEstimate("E-GONE", "line_missing", 20, [normalItem({ quantity: 1 })]);

let container: HTMLDivElement;
let root: Root;
let onDone: Mock<() => void>;
let onAddTo: Mock<(line: SheetRow, carried: CarriedRows) => void>;
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
  onDone = vi.fn<() => void>();
  onAddTo = vi.fn<(line: SheetRow, carried: CarriedRows) => void>();
  writes.reattachEstimates = vi.fn().mockResolvedValue({ message: { copied: 1, unmatched: [], failed: [] } });
  writes.settleOlder = vi.fn().mockResolvedValue({ message: { settled: 1 } });
  toast.mockReset();
});
afterEach(() => act(() => root.unmount()));

const render = (older: EstimateEntry[], canEdit = true, lines = LINES) => act(() => root.render(
  <OlderVersionNotice boq="BOQ-A" sheetName="Made-up sheet" older={older} canEdit={canEdit} onDone={onDone}
    lines={lines} onAddTo={onAddTo} />,
));
const buttons = () => [...container.querySelectorAll("button")].map((b) => b.textContent);
const click = async (text: string, nth = 0) => {
  const b = [...container.querySelectorAll("button")].filter((x) => x.textContent === text)[nth];
  if (!b) throw new Error(`no button "${text}" in ${JSON.stringify(buttons())}`);
  await act(async () => { b.click(); });
};
const item = (name: string) => [...container.querySelectorAll("li")].find((li) => li.textContent?.includes(`Row ${name}`))!;

describe("OlderVersionNotice", () => {
  it("shows nothing when no older estimate needs a person", () => {
    render([]);
    expect(container.innerHTML).toBe("");
  });

  it("says how many wait and why, with each one's materials", () => {
    render([COPY, CHANGED, GONE]);
    expect(container.textContent).toContain("3 material estimates from an older version of this sheet are not on the new version yet.");
    expect(container.textContent).toContain("(1 not copied yet · 2 changed lines need a decision)");
    expect(item("10").textContent).toContain("Made-up panel ×12 sqm");
    expect(item("10").textContent).toContain("Re-attach copies it now.");
    expect(item("11").textContent).toContain("This line changed on the new version");
    expect(item("20").textContent).toContain("no longer exists in the BOQ");
  });

  it("gives a viewer no buttons", () => {
    render([COPY, CHANGED], false);
    expect(buttons()).toEqual([]);
  });

  it("offers Add to a line only for a changed or missing line with materials, when there are lines", () => {
    const empty = olderEstimate("E-EMPTY", "changed", 30, []);
    render([COPY, CHANGED, GONE, empty]);
    expect(buttons()).toEqual(["Re-attach (1)", "Remove", "Add to a line…", "Remove", "Add to a line…", "Remove", "Remove"]);
    render([CHANGED], true, []);
    expect(buttons()).toEqual(["Remove"]);
  });

  it("Re-attach copies the sheet's waiting estimates and reports it", async () => {
    render([COPY, CHANGED]);
    await click("Re-attach (1)");
    expect(writes.reattachEstimates).toHaveBeenCalledWith({ boq: "BOQ-A", sheet_name: "Made-up sheet" });
    expect(toast).toHaveBeenCalledWith({ title: "Copied 1 estimate to the new version." });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("Re-attach lists the copies a rule refused", async () => {
    writes.reattachEstimates.mockResolvedValue({ message: { copied: 0, unmatched: [], failed: [
      { estimate: "E-COPY", excel_row: 10, description: null, reason: "NOS is counted in whole numbers." },
    ] } });
    render([COPY]);
    await click("Re-attach (1)");
    expect(toast).toHaveBeenCalledWith({
      title: "Copied 0 estimates to the new version. 1 could not be copied.",
      description: "Row 10: NOS is counted in whole numbers.",
    });
  });

  it("Remove asks first; No sends nothing; Yes settles exactly that estimate", async () => {
    render([COPY, CHANGED]);
    await click("Remove", 1);
    expect(item("11").textContent).toContain("Not carry it to the new version?");
    await click("No");
    expect(writes.settleOlder).not.toHaveBeenCalled();
    await click("Remove", 1);
    await click("Yes, remove");
    expect(writes.settleOlder).toHaveBeenCalledTimes(1);
    expect(writes.settleOlder).toHaveBeenCalledWith({ boq: "BOQ-A", sheet_name: "Made-up sheet", estimates: '["E-CHANGED"]' });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("reports a failed write and still refreshes", async () => {
    writes.settleOlder.mockRejectedValue({ message: "Estimates are read-only on a Completed project." });
    render([CHANGED]);
    await click("Remove");
    await click("Yes, remove");
    expect(toast.mock.calls[0][0]).toMatchObject({ title: "That did not work", variant: "destructive" });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("Add to a line opens the form on the chosen line and settles only when the form keeps materials", async () => {
    render([CHANGED]);
    await click("Add to a line…");
    expect(buttons()).toContain("Open form");
    const openForm = [...container.querySelectorAll("button")].find((b) => b.textContent === "Open form")!;
    expect(openForm.disabled).toBe(true);
    const select = container.querySelector("select")!;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Choose a current line…", "Row 10 · Made-up plenum", "Row 11 · Made-up diffuser", "Row 14 · Made-up sheet metal"]);
    act(() => {
      select.value = "L2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click("Open form");
    expect(onAddTo).toHaveBeenCalledTimes(1);
    const [line, carried] = onAddTo.mock.calls[0];
    expect([line.name, carried.fromRow, carried.rows]).toEqual(["L2", 11, CHANGED.items]);
    expect(writes.settleOlder).not.toHaveBeenCalled();  // a cancelled form leaves it listed

    await act(async () => { carried.onKept(); });
    expect(writes.settleOlder).toHaveBeenCalledWith({ boq: "BOQ-A", sheet_name: "Made-up sheet", estimates: '["E-CHANGED"]' });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("lists the first 30 and counts the rest", () => {
    render(Array.from({ length: 32 }, (_, i) => olderEstimate(`E-${i}`, "changed", 100 + i, [normalItem()])));
    expect(container.querySelectorAll("li")).toHaveLength(31);
    expect(container.textContent).toContain("…and 2 more");
  });
});
