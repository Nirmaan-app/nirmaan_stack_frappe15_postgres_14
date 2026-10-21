// The Inventory List / Asset List, filled the way a site is walked (owner 2026-10-15): one location at a
// time, then the materials found there and their count. The matrix the PDF prints (materials as columns,
// locations as rows) is only the collapsed Preview at the foot -- typing straight into it was the
// headache this replaced. The draft carries `entries` while the dialog is open; Mark as Done stores the
// matrix (`hodRules.inventoryMatrixOf`, in DocumentDialog's `finalize`).

import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";

import {
  asString,
  canonicalMaterial,
  duplicateItems,
  duplicateLocations,
  inventoryEntries,
  inventoryMatrixOf,
  inventoryTotals,
  materialUse,
  nameKey,
} from "../hodRules";
import type { InventoryEntry, InventoryItem, InventoryLocation } from "../types";
import type { FormProps } from "./TableForms";

const cell = "h-8 rounded-sm border-gray-200 px-2 text-sm";
const th =
  "border-b bg-gray-50 px-2 py-1.5 text-xs font-semibold text-gray-600";
const iconButton = "h-7 w-7 shrink-0 text-gray-400 hover:text-red-600";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function countTotal(items: InventoryItem[]): number {
  return items.reduce((sum, i) => {
    const n = Number(i.qty);
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);
}

function shown(n: number): string {
  return String(Number.isInteger(n) ? n : Number(n.toFixed(2)));
}

export const InventoryForm: React.FC<FormProps> = ({
  value,
  onChange,
  readOnly,
}) => {
  const entries = inventoryEntries(value);
  const matrix = inventoryMatrixOf(value);
  // One card open at a time: adding a location folds the one before it into its summary line. A list
  // that already has locations opens with all of them folded.
  const [open, setOpen] = React.useState<number | null>(
    entries.length ? null : 0,
  );
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const listId = React.useId();

  if (readOnly) return <InventoryTable {...matrix} />;

  // Nothing entered yet: one empty location to start typing in (written on the first keystroke).
  const cards = entries.length ? entries : [{ name: "", items: [] }];
  const use = materialUse(cards);
  const repeats = duplicateLocations(cards);
  const write = (next: InventoryEntry[]) =>
    onChange({ ...value, entries: next });
  const setCard = (i: number, next: InventoryEntry) =>
    write(cards.map((e, k) => (k === i ? next : e)));

  // `min-w-0`: the dialog lays its body out as a GRID, and a grid item grows to its widest content -- so
  // without it a wide Preview stretched the whole dialog sideways instead of scrolling inside its box.
  return (
    <div className="min-w-0 space-y-3">
      <p className="text-xs text-gray-500">
        Add each location, then the materials found there and how many. A
        material entered once is offered again in the next location. The PDF
        prints landscape: locations as rows, materials as columns (0 where a
        location has none), with a total per material.
      </p>

      <div className="space-y-2">
        {cards.map((entry, i) => (
          <LocationCard
            key={i}
            index={i}
            entry={entry}
            repeatOf={repeats.get(i)}
            open={open === i}
            onToggle={() => setOpen(open === i ? null : i)}
            onChange={(next) => setCard(i, next)}
            onRemove={() => {
              write(cards.filter((_, k) => k !== i));
              setOpen(null);
            }}
            onSnap={(j) => {
              const typed = entry.items[j].material;
              const snapped = canonicalMaterial(cards, typed, {
                entry: i,
                item: j,
              });
              if (snapped !== typed) {
                setCard(i, {
                  ...entry,
                  items: entry.items.map((it, k) =>
                    k === j ? { ...it, material: snapped } : it,
                  ),
                });
              }
            }}
            suggestions={use.filter(
              (u) =>
                !entry.items.some(
                  (it) => nameKey(it.material) === nameKey(u.name),
                ),
            )}
            listId={`${listId}-${i}`}
          />
        ))}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="h-8"
        onClick={() => {
          write([...cards, { name: "", items: [] }]);
          setOpen(cards.length);
        }}
      >
        <Plus className="mr-1 h-3.5 w-3.5" /> Add location
      </Button>

      <Collapsible
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        className="rounded-md border"
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold"
          >
            {previewOpen ? (
              <ChevronDown className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0" />
            )}
            Preview
            <span className="font-normal text-gray-500">
              {plural(matrix.locations.length, "location")} ×{" "}
              {plural(matrix.materials.length, "material")}, as the PDF prints
              it
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t p-2">
          <InventoryTable {...matrix} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

// ------------------------------------------------------------------------- one location

interface LocationCardProps {
  index: number;
  entry: InventoryEntry;
  /** Set when this location's name is already an earlier location's: that one's index. */
  repeatOf?: number;
  open: boolean;
  onToggle: () => void;
  onChange: (next: InventoryEntry) => void;
  onRemove: () => void;
  /** A material just typed: snap it to the spelling the list already has. */
  onSnap: (item: number) => void;
  /** Materials already on the list that this location does not have yet. */
  suggestions: Array<{ name: string; locations: number }>;
  listId: string;
}

const LocationCard: React.FC<LocationCardProps> = ({
  index,
  entry,
  repeatOf,
  open,
  onToggle,
  onChange,
  onRemove,
  onSnap,
  suggestions,
  listId,
}) => {
  const dupes = duplicateItems(entry.items);
  // 1-based, as the cards are numbered on screen.
  const sameAs = repeatOf === undefined ? null : repeatOf + 1;
  const repeated = sameAs !== null;
  const named = entry.items.filter((i) => nameKey(i.material)).length;

  const setItem = (j: number, patch: Partial<InventoryItem>) =>
    onChange({
      ...entry,
      items: entry.items.map((it, k) => (k === j ? { ...it, ...patch } : it)),
    });
  const addItem = () =>
    onChange({ ...entry, items: [...entry.items, { material: "", qty: "" }] });
  const addOnEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addItem();
    }
  };

  return (
    <div className="rounded-md border">
      <div
        className={`flex gap-2 px-2 py-1.5 ${open ? "items-end" : "items-center"}`}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          title={open ? "Fold" : "Open"}
          onClick={onToggle}
        >
          {open ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </Button>
        <span
          className={`w-6 shrink-0 text-sm text-gray-500 ${open ? "pb-1.5" : ""}`}
        >
          {index + 1}.
        </span>
        {open ? (
          <div className="flex-1 space-y-1">
            {/* Labelled like Material / Count below: once a name is typed the placeholder is gone, and
                nothing else said what the box was. */}
            <label
              htmlFor={`${listId}-name`}
              className="block text-xs font-semibold text-gray-600"
            >
              Location
            </label>
            <Input
              id={`${listId}-name`}
              className={`${cell} font-medium ${repeated ? "border-red-400" : ""}`}
              placeholder="e.g. OPS - 02"
              value={entry.name}
              autoFocus={!entry.name}
              onChange={(e) => onChange({ ...entry, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !entry.items.length) addOnEnter(e);
              }}
            />
          </div>
        ) : (
          // Folded, the card still says what the name IS -- the same label the open card carries, in a
          // light grey so the name beside it reads first (owner 2026-10-16).
          <button
            type="button"
            className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
            onClick={onToggle}
          >
            <span className="shrink-0 text-xs font-normal text-gray-500">
              Location
            </span>
            <span
              className={`truncate text-sm font-semibold ${repeated ? "text-red-600" : "text-gray-900"}`}
            >
              {entry.name.trim() || (
                <span className="font-normal italic text-gray-400">
                  not named yet
                </span>
              )}
            </span>
            {repeated && (
              <span className="shrink-0 rounded bg-red-50 px-1.5 text-[11px] font-medium text-red-600">
                Same as location {sameAs}
              </span>
            )}
          </button>
        )}
        <span
          className={`shrink-0 text-xs text-gray-500 ${open ? "pb-2" : ""}`}
        >
          {plural(named, "material")} · {shown(countTotal(entry.items))} nos
        </span>
        <Button
          variant="ghost"
          size="icon"
          className={iconButton}
          title="Remove location"
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {open && repeated && (
        <p className="pb-1.5 pl-[4.5rem] text-[11px] text-red-600">
          Already entered as location {sameAs}. Each location can be
          entered only once.
        </p>
      )}

      {open && (
        <div className="space-y-1.5 border-t bg-gray-50/60 py-2 pl-[4.5rem] pr-2">
          {entry.items.length > 0 && (
            <div className="grid grid-cols-[1fr_7rem_1.75rem] gap-2 text-xs font-semibold text-gray-600">
              <span>Material</span>
              <span className="text-center">Count</span>
            </div>
          )}
          {entry.items.map((item, j) => (
            <div key={j}>
              <div className="grid grid-cols-[1fr_7rem_1.75rem] items-center gap-2">
                <Input
                  className={`${cell} bg-white`}
                  list={listId}
                  placeholder="Pick or type a material"
                  value={item.material}
                  autoFocus={!item.material}
                  onChange={(e) => setItem(j, { material: e.target.value })}
                  onBlur={() => onSnap(j)}
                />
                <Input
                  className={`${cell} bg-white text-center`}
                  inputMode="decimal"
                  value={item.qty}
                  onChange={(e) => setItem(j, { qty: e.target.value })}
                  onKeyDown={addOnEnter}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className={iconButton}
                  title="Remove material"
                  onClick={() =>
                    onChange({
                      ...entry,
                      items: entry.items.filter((_, k) => k !== j),
                    })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              {dupes.has(j) && (
                <p className="mt-0.5 text-[11px] text-red-600">
                  Already in this location. Remove one of them.
                </p>
              )}
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="h-8 bg-white"
            onClick={addItem}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add material
          </Button>
          <datalist id={listId}>
            {suggestions.map((s) => (
              <option
                key={s.name}
                value={s.name}
                label={`used in ${plural(s.locations, "location")}`}
              />
            ))}
          </datalist>
        </div>
      )}
    </div>
  );
};

// ------------------------------------------------------------------------- the printed matrix
//
// Scrolls both ways inside its own box (owner 2026-10-15): the material names stay pinned along the top,
// S No + Location down the left, and the Total along the foot, so a cell can always be read against its
// location and its material however far the grid is scrolled. `border-separate` because a collapsed
// border is drawn by the table, not the cell, and scrolls away from a sticky cell.

const pinLeft = "sticky left-0 w-12 min-w-[3rem] max-w-[3rem]";
const pinLocation = "sticky left-12 min-w-[10rem] max-w-[14rem] border-r";

const InventoryTable: React.FC<{
  materials: string[];
  locations: InventoryLocation[];
}> = ({ materials, locations }) => {
  if (!locations.length) {
    return (
      <p className="py-4 text-center text-sm text-gray-500">
        No locations yet. The PDF prints a blank sheet to fill in by hand.
      </p>
    );
  }
  const totals = inventoryTotals(locations, materials.length);
  const body = "border-b bg-white px-2 py-1";
  const foot =
    "sticky bottom-0 border-t bg-gray-50 px-2 py-1.5 font-semibold";
  return (
    <div className="max-h-[60vh] min-w-0 overflow-auto rounded-md border">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className={`${th} ${pinLeft} top-0 z-30 text-center`}>S No</th>
            <th className={`${th} ${pinLocation} top-0 z-30 text-left`}>
              Location
            </th>
            {materials.map((m, j) => (
              <th
                key={j}
                className={`${th} sticky top-0 z-20 min-w-[90px] text-center`}
              >
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {locations.map((l, i) => (
            <tr key={i}>
              <td className={`${body} ${pinLeft} z-10 text-center text-gray-500`}>
                {i + 1}
              </td>
              <td className={`${body} ${pinLocation} z-10 font-medium`}>
                {asString(l.name)}
              </td>
              {materials.map((_, j) => (
                <td key={j} className={`${body} text-center`}>
                  {asString(l.qty?.[j])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className={`${foot} ${pinLeft} z-30`} />
            <td className={`${foot} ${pinLocation} z-30 text-right`}>Total</td>
            {totals.map((t, j) => (
              <td key={j} className={`${foot} z-20 text-center`}>
                {shown(t)}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
};
