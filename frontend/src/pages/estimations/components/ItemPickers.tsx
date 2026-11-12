import React, { useMemo, useState } from "react";

import { SelectUnit } from "@/components/helpers/SelectUnit";
import { Button } from "@/components/ui/button";
import { FuzzySearchSelect, rankByTokenScore, type TokenSearchConfig } from "@/components/ui/fuzzy-search-select";
import { Input } from "@/components/ui/input";
import type { EstimateItemRow } from "@/utils/estimations/estimateTypes";
import {
  initialPicker, itemsInCategory, pickCategory, pickerErrors, pickItem, type PickerErrors, type PickerState,
} from "@/utils/estimations/itemPicker";

import type { useItemsCatalog } from "../hooks/useEstimatesData";

type Catalog = ReturnType<typeof useItemsCatalog>;
interface Option { value: string; label: string; unit?: string | null; category?: string | null }

const SEARCH: TokenSearchConfig = { searchFields: ["label", "value"], partialMatch: true };
const portal = { menuPortalTarget: typeof document !== "undefined" ? document.body : undefined, menuPosition: "fixed" as const };

/** Items-list entries ranked by how many words of `name` they share (the New PR "Similar Existing Items" search). */
export function similarItems(catalog: Catalog, name: string, limit = 8): Option[] {
  if (name.trim().length < 2) return [];
  const options = catalog.items.map((i) => ({ value: i.name, label: i.item_name, unit: i.unit_name, category: i.category }));
  return rankByTokenScore(options, name, { searchFields: ["label"], partialMatch: true, minSearchLength: 2 }).slice(0, limit);
}

/** Builds the row a picked Items record becomes (name, unit and category copied from it). */
export function rowFromItem(catalog: Catalog, itemId: string, quantity: number, make: string | null): EstimateItemRow {
  const item = catalog.items.find((i) => i.name === itemId);
  return { item_type: "Normal", item_id: itemId, item_name: item?.item_name ?? itemId, unit: item?.unit_name ?? null,
    category: item?.category ?? null, make, quantity };
}

interface NormalPickerProps {
  catalog: Catalog;
  presetItem?: string | null;
  presetQty?: string;
  onAdd: (row: EstimateItemRow) => string | null;
  onCancel: () => void;
}

/**
 * "+ Add item": category (optional) → item from the Items list → make (optional) → qty. Picking an item fills in its
 * category; changing the category empties the item and make; item and qty are required (`utils/estimations/itemPicker`).
 */
export const NormalItemPicker: React.FC<NormalPickerProps> = ({ catalog, presetItem, presetQty, onAdd, onCancel }) => {
  const [state, setState] = useState<PickerState>(() => initialPicker(catalog.items, presetItem));
  const { category, itemId, make } = state;
  const [qty, setQty] = useState(presetQty ?? "");
  const [fieldErrors, setFieldErrors] = useState<PickerErrors>({});
  /** A rule the row breaks as a whole (a duplicate, say), shown below the fields. */
  const [error, setError] = useState<string | null>(null);

  const categoryOptions = useMemo<Option[]>(() => catalog.categories.map((c) => ({ value: c.name, label: c.name })), [catalog.categories]);
  const itemOptions = useMemo<Option[]>(
    () => itemsInCategory(catalog.items, category)
      .map((i) => ({ value: i.name, label: i.item_name, unit: i.unit_name, category: i.category })),
    [catalog.items, category],
  );
  const picked = catalog.items.find((i) => i.name === itemId);
  const makeOptions = useMemo<Option[]>(
    () => (catalog.makesByCategory[picked?.category ?? category ?? ""] ?? []).map((m) => ({ value: m, label: m })),
    [catalog.makesByCategory, picked?.category, category],
  );

  const onCategory = (value: string | null) => {
    const next = pickCategory(state, value);
    if (next !== state) { setState(next); setFieldErrors({}); setError(null); }
  };
  const onItem = (value: string | null) => {
    setState(pickItem(state, catalog.items, value));
    setFieldErrors((e) => ({ ...e, item: undefined }));
    setError(null);
  };

  const add = () => {
    const problems = pickerErrors(state, catalog.items, qty);
    setFieldErrors(problems);
    if (problems.item || problems.qty || !itemId) return setError(null);
    setError(onAdd(rowFromItem(catalog, itemId, Number(qty), make)));
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
      <h4 className="text-sm font-semibold">Add item from the Items list</h4>
      <div className="grid gap-2 sm:grid-cols-2">
        <FuzzySearchSelect<Option> {...portal} allOptions={categoryOptions} tokenSearchConfig={SEARCH} placeholder="Category (optional)" isClearable
          value={categoryOptions.find((o) => o.value === category) ?? null}
          onChange={(o) => onCategory(o?.value ?? null)} />
        <div>
          <FuzzySearchSelect<Option> {...portal} allOptions={itemOptions} tokenSearchConfig={SEARCH} placeholder="Search item… *" isClearable
            value={itemOptions.find((o) => o.value === itemId) ?? null}
            onChange={(o) => onItem(o?.value ?? null)} />
          {fieldErrors.item && <p className="mt-1 text-xs font-semibold text-red-600" role="alert">{fieldErrors.item}</p>}
        </div>
        <FuzzySearchSelect<Option> {...portal} allOptions={makeOptions} tokenSearchConfig={SEARCH} isClearable
          placeholder={makeOptions.length ? "Make (optional)" : "No makes for this category"} isDisabled={!makeOptions.length}
          value={makeOptions.find((o) => o.value === make) ?? null} onChange={(o) => setState((s) => ({ ...s, make: o?.value ?? null }))} />
        <div>
          <Input type="number" min={0} step="any" value={qty}
            onChange={(e) => { setQty(e.target.value); setFieldErrors((f) => ({ ...f, qty: undefined })); setError(null); }}
            placeholder={`Qty${picked?.unit_name ? ` (${picked.unit_name})` : ""} *`} aria-label="Quantity"
            aria-invalid={!!fieldErrors.qty} className={fieldErrors.qty ? "border-red-500" : undefined} />
          {fieldErrors.qty && <p className="mt-1 text-xs font-semibold text-red-600" role="alert">{fieldErrors.qty}</p>}
        </div>
      </div>
      {picked && <p className="text-xs text-sky-700">Picked: <b>{picked.item_name}</b> · {picked.name} · unit {picked.unit_name || "—"} · category {picked.category || "—"}</p>}
      {error && <p className="text-xs font-semibold text-red-600" role="alert">{error}</p>}
      <div className="flex gap-2"><Button size="sm" onClick={add}>Add</Button><Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button></div>
    </div>
  );
};

interface CustomPickerProps {
  catalog: Catalog;
  onAdd: (row: EstimateItemRow) => string | null;
  onUseExisting: (itemId: string, qty: string) => void;
  onCancel: () => void;
}

/** "+ Add custom item": not in the Items list. Similar existing items are shown first, as on the New PR screen. */
export const CustomItemPicker: React.FC<CustomPickerProps> = ({ catalog, onAdd, onUseExisting, onCancel }) => {
  const [category, setCategory] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [qty, setQty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const categoryOptions = useMemo<Option[]>(() => catalog.categories.map((c) => ({ value: c.name, label: c.name })), [catalog.categories]);
  const similar = useMemo(() => similarItems(catalog, name), [catalog, name]);

  const add = () => setError(onAdd({ item_type: "Custom", item_id: null, item_name: name.trim(), unit, category, make: null, quantity: Number(qty) }));

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
      <h4 className="text-sm font-semibold">Add custom item</h4>
      <p className="text-xs text-muted-foreground">For an item that is not in the Items list. Similar existing items are shown first, so a real one can be picked instead.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <FuzzySearchSelect<Option> {...portal} allOptions={categoryOptions} tokenSearchConfig={SEARCH} placeholder="Category"
          value={categoryOptions.find((o) => o.value === category) ?? null} onChange={(o) => setCategory(o?.value ?? null)} />
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Item name" aria-label="Custom item name" autoComplete="off" />
      </div>
      {name.trim().length >= 2 && (
        <div className="max-h-48 overflow-auto rounded border bg-background">
          <div className="sticky top-0 bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground">
            {similar.length ? "Similar existing items: use one of these instead?" : "No similar items in the Items list. It will be added as custom."}
          </div>
          {similar.map((o) => (
            <div key={o.value} className="flex items-center justify-between gap-2 border-t px-2 py-1.5 text-xs">
              <span>{o.label}<span className="block text-[11px] text-muted-foreground">Category: {o.category || "—"} · Unit: {o.unit || "—"}</span></span>
              <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => onUseExisting(o.value, qty)}>Use this</Button>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <SelectUnit value={unit} onChange={setUnit} />
        <Input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qty" aria-label="Quantity" />
      </div>
      {error && <p className="text-xs font-semibold text-red-600" role="alert">{error}</p>}
      <div className="flex gap-2"><Button size="sm" onClick={add}>Add as custom</Button><Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button></div>
    </div>
  );
};

interface MatchPickerProps {
  catalog: Catalog;
  row: EstimateItemRow;
  onPick: (itemId: string) => string | null;
  onCancel: () => void;
}

/** "Match" on a custom row: the same search on its name; picking turns it into a normal item and keeps its qty. */
export const MatchPicker: React.FC<MatchPickerProps> = ({ catalog, row, onPick, onCancel }) => {
  const [error, setError] = useState<string | null>(null);
  const similar = useMemo(() => similarItems(catalog, row.item_name ?? "", 10), [catalog, row.item_name]);
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
      <h4 className="text-sm font-semibold">Match "{row.item_name}" to the Items list</h4>
      <p className="text-xs text-muted-foreground">Picking an item turns this row into a normal item. The quantity is kept.</p>
      <div className="max-h-56 overflow-auto rounded border bg-background">
        {similar.length ? similar.map((o) => (
          <div key={o.value} className="flex items-center justify-between gap-2 border-t px-2 py-1.5 text-xs first:border-t-0">
            <span>{o.label}<span className="block text-[11px] text-muted-foreground">Category: {o.category || "—"} · Unit: {o.unit || "—"}</span></span>
            <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => setError(onPick(o.value))}>Use this</Button>
          </div>
        )) : <p className="px-2 py-2 text-xs text-muted-foreground">No similar items found. Keep it as custom.</p>}
      </div>
      {error && <p className="text-xs font-semibold text-red-600" role="alert">{error}</p>}
      <div><Button size="sm" variant="ghost" onClick={onCancel}>Keep as custom</Button></div>
    </div>
  );
};
