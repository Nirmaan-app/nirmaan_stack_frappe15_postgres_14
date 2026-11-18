import { itemRowProblem } from "./estimateRules";

/**
 * The "+ Add item" picker's rules (owner 12 Nov), kept pure so they are tested without a browser:
 *   - picking an item fills in its category (the item list then narrows to that category, the item stays in it);
 *   - picking a category first lists only that category's items;
 *   - changing the category empties the item and make, to be picked again; re-picking the same one does not;
 *   - clearing the item keeps the category;
 *   - item and qty are required (category comes with the item, so it stays optional).
 */

/** The fields of an Items record the picker uses. */
export interface PickerItem {
  name: string;
  item_name: string;
  unit_name: string | null;
  category: string | null;
}

export interface PickerState {
  category: string | null;
  itemId: string | null;
  make: string | null;
}

/** Where a picker opens: empty, or on a preset item (the custom picker's "Use this") with its category. */
export function initialPicker(items: PickerItem[], presetItem?: string | null): PickerState {
  const item = presetItem ? items.find((i) => i.name === presetItem) : undefined;
  return { category: item?.category || null, itemId: presetItem || null, make: null };
}

/** The items the item box lists: all of them, or the chosen category's. */
export function itemsInCategory<T extends PickerItem>(items: T[], category: string | null): T[] {
  return category ? items.filter((i) => i.category === category) : items;
}

/** An item was picked (or cleared). Picking fills in its category; a different item empties the make. */
export function pickItem(state: PickerState, items: PickerItem[], itemId: string | null): PickerState {
  if (!itemId) return { ...state, itemId: null, make: null };
  const item = items.find((i) => i.name === itemId);
  return {
    category: item ? item.category || null : state.category,
    itemId,
    make: itemId === state.itemId ? state.make : null,
  };
}

/** The user changed the category (or cleared it): the item and make are emptied, unless it is the same category. */
export function pickCategory(state: PickerState, category: string | null): PickerState {
  const next = category || null;
  if (next === state.category) return state;
  return { category: next, itemId: null, make: null };
}

export interface PickerErrors {
  item?: string;
  qty?: string;
}

/** What stops "Add": no item, or a qty that is empty, 0 or less, or has decimals on a unit counted in pieces.
 * The messages are the save rules' own (`itemRowProblem`, mirroring the server). */
export function pickerErrors(state: PickerState, items: PickerItem[], qty: string): PickerErrors {
  const errors: PickerErrors = {};
  if (!state.itemId) errors.item = "Pick an item from the Items list.";
  const unit = items.find((i) => i.name === state.itemId)?.unit_name ?? null;
  // A stand-in item id, so only the quantity checks speak here; an empty box is 0, not "no value".
  const qtyProblem = itemRowProblem({ item_type: "Normal", item_id: "-", unit, quantity: qty.trim() === "" ? 0 : Number(qty) });
  if (qtyProblem) errors.qty = qtyProblem;
  return errors;
}
