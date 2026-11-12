// @vitest-environment jsdom
/**
 * The "+ Add item" picker on screen: item first fills the category, category first narrows the items, a category
 * change empties the item, and item + qty errors show under their fields. The searchable selects are stood in for by
 * plain <select>s (react-select needs a real pointer and layout); the picker's own wiring is what is tested.
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EstimateItemRow } from "@/utils/estimations/estimateTypes";

vi.mock("@/components/ui/fuzzy-search-select", async (importActual) => ({
  ...(await importActual<typeof import("@/components/ui/fuzzy-search-select")>()),
  FuzzySearchSelect: ({ allOptions, value, onChange, placeholder, isDisabled }: {
    allOptions: { value: string; label: string }[];
    value: { value: string } | null;
    onChange: (o: { value: string } | null) => void;
    placeholder?: string;
    isDisabled?: boolean;
  }) => (
    <select aria-label={placeholder} disabled={isDisabled} value={value?.value ?? ""}
      onChange={(e) => onChange(allOptions.find((o) => o.value === e.target.value) ?? null)}>
      <option value="">—</option>
      {allOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));
vi.mock("@/components/helpers/SelectUnit", () => ({ SelectUnit: () => null }));

import { NormalItemPicker, rowFromItem, similarItems } from "./ItemPickers";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CATALOG = {
  items: [
    { name: "ITEM-PANEL", item_name: "Made-up panel", unit_name: "sqm", category: "Made-up Boards" },
    { name: "ITEM-BOARD", item_name: "Made-up board", unit_name: "Nos", category: "Made-up Boards" },
    { name: "ITEM-CLIP", item_name: "Made-up clip", unit_name: "NOS", category: "Made-up Fixings" },
  ],
  categories: [{ name: "Made-up Boards", work_package: null }, { name: "Made-up Fixings", work_package: null }],
  makesByCategory: { "Made-up Fixings": ["Made-up make"] } as Record<string, string[]>,
  isLoading: false,
};

let container: HTMLDivElement;
let root: Root;
let added: EstimateItemRow[];
let reply: string | null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  added = [];
  reply = null;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (presetItem?: string) => act(() => root.render(
  <NormalItemPicker catalog={CATALOG} presetItem={presetItem} onCancel={() => undefined}
    onAdd={(row) => { if (!reply) added.push(row); return reply; }} />,
));
const select = (label: string) => container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
const category = () => select("Category (optional)");
const item = () => select("Search item… *");
const qty = () => container.querySelector<HTMLInputElement>('input[aria-label="Quantity"]')!;
const alerts = () => [...container.querySelectorAll('[role="alert"]')].map((a) => a.textContent);
const options = (el: HTMLSelectElement) => [...el.options].map((o) => o.value).filter(Boolean);

function choose(el: HTMLSelectElement, value: string) {
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function type(el: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const clickAdd = () => act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Add")!.click());

describe("NormalItemPicker", () => {
  it("fills in the category when the item is picked first", () => {
    render();
    expect(options(item())).toEqual(["ITEM-PANEL", "ITEM-BOARD", "ITEM-CLIP"]);
    choose(item(), "ITEM-CLIP");
    expect(category().value).toBe("Made-up Fixings");
    expect(item().value).toBe("ITEM-CLIP");
    expect(container.textContent).toContain("category Made-up Fixings");
    expect(options(select("Make (optional)"))).toEqual(["Made-up make"]);
  });

  it("lists only the chosen category's items, and empties the item when the category changes", () => {
    render();
    choose(category(), "Made-up Boards");
    expect(options(item())).toEqual(["ITEM-PANEL", "ITEM-BOARD"]);
    choose(item(), "ITEM-BOARD");
    choose(category(), "Made-up Fixings");
    expect(item().value).toBe("");
    expect(options(item())).toEqual(["ITEM-CLIP"]);
    choose(category(), "");
    expect(options(item())).toHaveLength(3);
  });

  it("keeps the category when the item is cleared", () => {
    render();
    choose(item(), "ITEM-PANEL");
    choose(item(), "");
    expect(category().value).toBe("Made-up Boards");
  });

  it("shows the item and qty errors under their fields and adds nothing", () => {
    render();
    clickAdd();
    expect(alerts()).toEqual(["Pick an item from the Items list.", "Enter a quantity above 0."]);
    expect(qty().getAttribute("aria-invalid")).toBe("true");
    expect(added).toEqual([]);
    type(qty(), "3");
    expect(alerts()).toEqual(["Pick an item from the Items list."]);
    choose(item(), "ITEM-CLIP");
    expect(alerts()).toEqual([]);
  });

  it("refuses decimals on NOS, then adds the row with the item's category", () => {
    render();
    choose(item(), "ITEM-CLIP");
    type(qty(), "2.5");
    clickAdd();
    expect(alerts()).toEqual(["NOS is counted in whole numbers. Enter a quantity without decimals."]);
    expect(added).toEqual([]);
    type(qty(), "4");
    clickAdd();
    expect(added).toEqual([{ item_type: "Normal", item_id: "ITEM-CLIP", item_name: "Made-up clip", unit: "NOS",
      category: "Made-up Fixings", make: null, quantity: 4 }]);
  });

  it("shows a rule the whole row breaks (a duplicate) below the fields", () => {
    reply = '"Made-up panel" is in this estimate twice with the same make.';
    render();
    choose(item(), "ITEM-PANEL");
    type(qty(), "2");
    clickAdd();
    expect(alerts()).toEqual([reply]);
  });

  it("opens on a preset item with its category filled in", () => {
    render("ITEM-BOARD");
    expect(item().value).toBe("ITEM-BOARD");
    expect(category().value).toBe("Made-up Boards");
  });
});

describe("similarItems and rowFromItem (the custom form's suggestions, Match, and every picked row)", () => {
  it("suggests Items that share words with a typed name, best first, and nothing for under two letters", () => {
    expect(similarItems(CATALOG, "m")).toEqual([]);
    const found = similarItems(CATALOG, "made-up clip");
    expect(found[0]).toEqual({ value: "ITEM-CLIP", label: "Made-up clip", unit: "NOS", category: "Made-up Fixings" });
    expect(similarItems(CATALOG, "made-up", 2)).toHaveLength(2);
  });

  it("copies name, unit and category from the Items record, or keeps the id when it is not in the list", () => {
    expect(rowFromItem(CATALOG, "ITEM-BOARD", 2, "Made-up make")).toEqual({ item_type: "Normal", item_id: "ITEM-BOARD",
      item_name: "Made-up board", unit: "Nos", category: "Made-up Boards", make: "Made-up make", quantity: 2 });
    expect(rowFromItem(CATALOG, "ITEM-GONE", 1, null)).toEqual({ item_type: "Normal", item_id: "ITEM-GONE",
      item_name: "ITEM-GONE", unit: null, category: null, make: null, quantity: 1 });
  });
});
