// @vitest-environment jsdom
/**
 * The material estimate form: what Save sends, when it refuses before sending, and what happens around it. Rows keep
 * their saved `name`; rows carried from an older estimate come in as new rows; the older estimate is settled only
 * after a save that KEPT materials (review issue 6). The server is stubbed at `../hooks/useEstimatesData`; the
 * searchable selects are plain <select>s (react-select needs a real pointer), their search helpers are the real ones.
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { EstimateItemRow } from "@/utils/estimations/estimateTypes";
import { safeJsonParse } from "@/utils/safeJsonParse";

import { customItem, estimate, normalItem } from "../estimatesTestData";
import type { EditTarget } from "./panelTypes";

const server = vi.hoisted(() => ({ saveEstimate: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("../hooks/useEstimatesData", () => ({
  useEstimateWrites: () => ({ saveEstimate: server.saveEstimate, saving: false }),
  useItemsCatalog: () => ({
    items: [
      { name: "ITEM-PANEL", item_name: "Made-up panel", unit_name: "sqm", category: "Made-up Boards" },
      { name: "ITEM-CLIP", item_name: "Made-up clip", unit_name: "NOS", category: "Made-up Fixings" },
    ],
    categories: [{ name: "Made-up Boards", work_package: null }, { name: "Made-up Fixings", work_package: null }],
    makesByCategory: { "Made-up Boards": ["Made-up make A", "Made-up make B"] },
    isLoading: false,
  }),
}));
vi.mock("@/components/ui/use-toast", () => ({ toast }));
vi.mock("@/components/helpers/SelectUnit", () => ({ SelectUnit: () => null }));
vi.mock("@/components/ui/fuzzy-search-select", async (importActual) => ({
  ...(await importActual<typeof import("@/components/ui/fuzzy-search-select")>()),
  FuzzySearchSelect: ({ allOptions, value, onChange, placeholder }: {
    allOptions: { value: string; label: string }[]; value: { value: string } | null;
    onChange: (o: { value: string } | null) => void; placeholder?: string;
  }) => (
    <select aria-label={placeholder} value={value?.value ?? ""}
      onChange={(e) => onChange(allOptions.find((o) => o.value === e.target.value) ?? null)}>
      <option value="">—</option>
      {allOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

import { MaterialEstimateDialog } from "./MaterialEstimateDialog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let onClose: Mock<() => void>;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  onClose = vi.fn<() => void>();
  server.saveEstimate = vi.fn().mockResolvedValue({ message: { name: "E-L1", modified: "x", item_count: 1 } });
  toast.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

const SAVED = [normalItem({ name: "ROW-1", make: "Made-up make A" }), customItem({ name: "ROW-2" })];
const target = (over: Partial<EditTarget> = {}): EditTarget => ({
  boq: "BOQ-A", node: "L1", sheetName: "Made-up sheet", excelRow: 10, slNo: "1.1", description: "Made-up plenum",
  unit: "Sqm", qty: 12, entry: estimate("L1", SAVED), afterSave: vi.fn(), ...over,
});
const render = (t: EditTarget) => act(() => root.render(<MaterialEstimateDialog target={t} onClose={onClose} />));
const body = () => document.body;
const button = (text: string, nth = 0) => {
  const b = [...body().querySelectorAll("button")].filter((x) => x.textContent?.trim() === text)[nth];
  if (!b) throw new Error(`no button "${text}"`);
  return b;
};
const click = async (text: string, nth = 0) => { await act(async () => { button(text, nth).click(); }); };
const tableRows = () => [...body().querySelectorAll("table tbody tr")].map((tr) => tr.querySelectorAll("td")[1].textContent);
const sent = () => {
  const args = server.saveEstimate.mock.calls[0][0];
  return { ...args, items: safeJsonParse<EstimateItemRow[] | null>(args.items, null) };
};
const alertText = () => [...body().querySelectorAll('[role="alert"]')].map((a) => a.textContent);
function typeInto(el: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function choose(el: HTMLSelectElement, value: string) {
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("MaterialEstimateDialog", () => {
  it("opens on the line with its saved materials", () => {
    render(target());
    expect(body().textContent).toContain("Material estimate · Made-up sheet · row 10 (1.1)");
    expect(body().textContent).toContain("Made-up plenum · BOQ qty 12 Sqm");
    expect(tableRows()).toEqual(["Made-up panelITEM-PANEL", "Made-up clip"]);
  });

  it("saves every row with its name and the modified it loaded, then refreshes and closes", async () => {
    const t = target();
    render(t);
    await click("Save");
    expect(sent()).toEqual({ boq_node: "L1", items: SAVED, expected_modified: "2026-11-12 10:00:00.000000" });
    expect(toast).toHaveBeenCalledWith({ title: "Saved 2 materials on row 10" });
    expect(t.afterSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("sends an empty modified for a line that had no estimate", async () => {
    render(target({ entry: undefined }));
    expect(body().textContent).toContain("No materials yet.");
    await click("+ Add item");
    choose(body().querySelector<HTMLSelectElement>('select[aria-label="Search item… *"]')!, "ITEM-CLIP");
    typeInto(body().querySelector<HTMLInputElement>('input[aria-label="Quantity"]')!, "4");
    await click("Add");
    expect(tableRows()).toEqual(["Made-up clipITEM-CLIP"]);
    await click("Save");
    expect(sent().expected_modified).toBe("");
    expect(sent().items).toEqual([{ item_type: "Normal", item_id: "ITEM-CLIP", item_name: "Made-up clip", unit: "NOS",
      category: "Made-up Fixings", make: null, quantity: 4 }]);
  });

  it("refuses to send a row that breaks a rule, and a change clears the message", async () => {
    render(target());
    typeInto(body().querySelector<HTMLInputElement>('input[aria-label="Quantity for Made-up clip"]')!, "2.5");
    await click("Save");
    expect(alertText()).toEqual(["NOS is counted in whole numbers. Enter a quantity without decimals."]);
    expect(server.saveEstimate).not.toHaveBeenCalled();
    typeInto(body().querySelector<HTMLInputElement>('input[aria-label="Quantity for Made-up clip"]')!, "0");
    expect(alertText()).toEqual([]);
    await click("Save");
    expect(alertText()).toEqual(["Enter a quantity above 0."]);
  });

  it("refuses the same item twice with the same make", async () => {
    render(target({ entry: estimate("L1", [normalItem({ name: "ROW-1", make: "Made-up make A" }),
      normalItem({ name: "ROW-3", make: "Made-up make B" })]) }));
    choose(body().querySelectorAll<HTMLSelectElement>('select[aria-label="Make for Made-up panel"]')[1], "Made-up make A");
    await click("Save");
    expect(alertText()[0]).toContain('"Made-up panel" is in this estimate twice with the same make');
    expect(server.saveEstimate).not.toHaveBeenCalled();
  });

  it("keeps a saved make that is no longer in the category's list", () => {
    render(target({ entry: estimate("L1", [normalItem({ name: "ROW-1", make: "Made-up retired make" })]) }));
    const makes = body().querySelector<HTMLSelectElement>('select[aria-label="Make for Made-up panel"]')!;
    expect([...makes.options].map((o) => o.value)).toEqual(["", "Made-up retired make", "Made-up make A", "Made-up make B"]);
    expect(makes.value).toBe("Made-up retired make");
  });

  it("shows the server's refusal and stays open", async () => {
    server.saveEstimate.mockRejectedValue({ message: "Someone else changed this estimate while you had it open." });
    const t = target();
    render(t);
    await click("Save");
    expect(alertText()).toEqual(["Someone else changed this estimate while you had it open."]);
    expect([onClose.mock.calls.length, (t.afterSave as ReturnType<typeof vi.fn>).mock.calls.length]).toEqual([0, 0]);
  });

  it("removing every row saves an empty list (the server deletes the estimate)", async () => {
    render(target());
    await click("Remove");
    await click("Remove");
    await click("Save");
    expect(sent().items).toEqual([]);
    expect(toast).toHaveBeenCalledWith({ title: "Material estimate removed" });
  });

  describe("materials carried from an older estimate", () => {
    const carriedRows = [normalItem({ name: "OLD-ROW", procurement_package: "Made-up package", quantity: 7 })];

    it("come in as new rows next to the line's own, and settle the older estimate after the save", async () => {
      const onKept = vi.fn();
      render(target({ entry: estimate("L1", [customItem({ name: "ROW-2" })]), carried: { rows: carriedRows, fromRow: 11, onKept } }));
      expect(body().textContent).toContain("1 material copied from the older version of row 11.");
      await click("Save");
      const { procurement_package: _p, name: _n, ...fresh } = carriedRows[0];
      expect(sent().items).toEqual([customItem({ name: "ROW-2" }), fresh]);
      expect(onKept).toHaveBeenCalledTimes(1);
    });

    it("leave the older estimate listed when every row is removed before the save", async () => {
      const onKept = vi.fn();
      render(target({ entry: undefined, carried: { rows: carriedRows, fromRow: 11, onKept } }));
      await click("Remove");
      await click("Save");
      expect(sent().items).toEqual([]);
      expect(onKept).not.toHaveBeenCalled();
    });

    it("leave it listed when the save fails", async () => {
      server.saveEstimate.mockRejectedValue({ message: "Estimates are read-only on a Completed project." });
      const onKept = vi.fn();
      render(target({ entry: undefined, carried: { rows: carriedRows, fromRow: 11, onKept } }));
      await click("Save");
      expect(onKept).not.toHaveBeenCalled();
    });
  });

  it("Match turns a custom row into the Items record picked, keeping its qty and row name", async () => {
    render(target({ entry: estimate("L1", [customItem({ name: "ROW-2", item_name: "made-up clip", quantity: 6 })]) }));
    await click("Match");
    expect(body().textContent).toContain('Match "made-up clip" to the Items list');
    await click("Use this");
    expect(toast).toHaveBeenCalledWith({ title: '"made-up clip" is now Made-up clip' });
    await click("Save");
    expect(sent().items).toEqual([{ name: "ROW-2", comment: undefined, item_type: "Normal", item_id: "ITEM-CLIP",
      item_name: "Made-up clip", unit: "NOS", category: "Made-up Fixings", make: null, quantity: 6 }]);
  });
});
