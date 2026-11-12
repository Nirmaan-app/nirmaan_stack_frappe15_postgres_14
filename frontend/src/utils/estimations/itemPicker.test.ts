import { describe, expect, it } from "vitest";

import { initialPicker, itemsInCategory, pickCategory, pickerErrors, pickItem, type PickerItem, type PickerState } from "./itemPicker";

const ITEMS: PickerItem[] = [
  { name: "ITEM-PANEL", item_name: "Made-up panel", unit_name: "sqm", category: "Made-up Boards" },
  { name: "ITEM-BOARD", item_name: "Made-up board", unit_name: "Nos", category: "Made-up Boards" },
  { name: "ITEM-CLIP", item_name: "Made-up clip", unit_name: "NOS", category: "Made-up Fixings" },
  { name: "ITEM-LOOSE", item_name: "Made-up loose item", unit_name: "kg", category: null },
];
const EMPTY: PickerState = { category: null, itemId: null, make: null };

describe("item first", () => {
  it("fills in the item's category", () => {
    expect(pickItem(EMPTY, ITEMS, "ITEM-CLIP")).toEqual({ category: "Made-up Fixings", itemId: "ITEM-CLIP", make: null });
  });

  it("leaves the category empty for an item that has none", () => {
    expect(pickItem(EMPTY, ITEMS, "ITEM-LOOSE")).toEqual({ category: null, itemId: "ITEM-LOOSE", make: null });
  });

  it("keeps the item listed once its category narrows the list", () => {
    const state = pickItem(EMPTY, ITEMS, "ITEM-BOARD");
    expect(itemsInCategory(ITEMS, state.category).map((i) => i.name)).toEqual(["ITEM-PANEL", "ITEM-BOARD"]);
  });

  it("empties the make for a different item, keeps it for the same one", () => {
    const withMake: PickerState = { category: "Made-up Boards", itemId: "ITEM-PANEL", make: "Made-up make" };
    expect(pickItem(withMake, ITEMS, "ITEM-BOARD").make).toBeNull();
    expect(pickItem(withMake, ITEMS, "ITEM-PANEL").make).toBe("Made-up make");
  });

  it("keeps the category when the item is cleared", () => {
    const state = pickItem(EMPTY, ITEMS, "ITEM-CLIP");
    expect(pickItem(state, ITEMS, null)).toEqual({ category: "Made-up Fixings", itemId: null, make: null });
  });
});

describe("category first", () => {
  it("lists only that category's items; no category lists all", () => {
    expect(itemsInCategory(ITEMS, "Made-up Fixings").map((i) => i.name)).toEqual(["ITEM-CLIP"]);
    expect(itemsInCategory(ITEMS, null)).toHaveLength(4);
  });

  it("then picking an item keeps that category", () => {
    const state = pickItem(pickCategory(EMPTY, "Made-up Boards"), ITEMS, "ITEM-PANEL");
    expect(state).toEqual({ category: "Made-up Boards", itemId: "ITEM-PANEL", make: null });
  });

  it("changing the category empties the item and make", () => {
    const state: PickerState = { category: "Made-up Boards", itemId: "ITEM-PANEL", make: "Made-up make" };
    expect(pickCategory(state, "Made-up Fixings")).toEqual({ category: "Made-up Fixings", itemId: null, make: null });
  });

  it("clearing the category empties the item too", () => {
    const state: PickerState = { category: "Made-up Boards", itemId: "ITEM-PANEL", make: null };
    expect(pickCategory(state, null)).toEqual(EMPTY);
  });

  it("re-picking the same category changes nothing", () => {
    const state: PickerState = { category: "Made-up Boards", itemId: "ITEM-PANEL", make: "Made-up make" };
    expect(pickCategory(state, "Made-up Boards")).toBe(state);
  });
});

describe("opening the picker", () => {
  it("opens empty, or on a preset item with its category", () => {
    expect(initialPicker(ITEMS)).toEqual(EMPTY);
    expect(initialPicker(ITEMS, "ITEM-BOARD")).toEqual({ category: "Made-up Boards", itemId: "ITEM-BOARD", make: null });
  });
});

describe("item and qty are required", () => {
  const picked = (itemId: string): PickerState => pickItem(EMPTY, ITEMS, itemId);

  it("asks for an item and a qty when both are missing", () => {
    expect(pickerErrors(EMPTY, ITEMS, "")).toEqual({
      item: "Pick an item from the Items list.",
      qty: "Enter a quantity above 0.",
    });
  });

  it("refuses an empty, zero, negative or non-numeric qty", () => {
    for (const qty of ["", "  ", "0", "-3", "abc"]) {
      expect(pickerErrors(picked("ITEM-PANEL"), ITEMS, qty), qty).toEqual({ qty: "Enter a quantity above 0." });
    }
  });

  it("refuses decimals on a unit counted in pieces, whatever its case", () => {
    expect(pickerErrors(picked("ITEM-CLIP"), ITEMS, "2.5").qty).toBe("NOS is counted in whole numbers. Enter a quantity without decimals.");
    expect(pickerErrors(picked("ITEM-BOARD"), ITEMS, "1.5").qty).toBe("Nos is counted in whole numbers. Enter a quantity without decimals.");
  });

  it("accepts an item with a valid qty", () => {
    expect(pickerErrors(picked("ITEM-CLIP"), ITEMS, "4")).toEqual({});
    expect(pickerErrors(picked("ITEM-PANEL"), ITEMS, "2.5")).toEqual({});
  });

  it("checks the qty even before an item is picked", () => {
    expect(pickerErrors(EMPTY, ITEMS, "3")).toEqual({ item: "Pick an item from the Items list." });
  });
});
