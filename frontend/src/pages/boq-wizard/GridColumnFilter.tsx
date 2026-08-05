/**
 * U1 -- the pricing grid's Excel-style per-column header filter.
 *
 * DELIBERATE DUPLICATION (owner ruling): this is a SIBLING of `ColumnFilter` in
 * `pages/pricing/rate-master/RateMasterDataViewer.tsx`, not an import of it. Exporting that one
 * would couple two currently-independent modules, and the two are already diverging: this filter
 * needs a first-class "(Blanks)" entry and a label/id split (see below); the data viewer needs
 * neither. Recorded as a choice in the plan doc so it reads as a decision, not as drift.
 *
 * THE LABEL/ID SPLIT (owner ruling: "filter on the label, match on the id"):
 * an option carries BOTH a stable `id` (what the predicate compares) and a human `label` (what is
 * displayed, searched and sorted). The grid's Category cell renders `labelFor(...)`, so listing
 * labels is what makes the filter agree with the cell -- but persisting labels would break the
 * filter the moment a catalog label is edited. Selections are therefore ALWAYS sets of ids.
 *
 * PERFORMANCE -- the load-bearing property of this file:
 * the type-to-search box (`q`) is LOCAL state inside this popover. It is never lifted to the page,
 * so a keystroke re-renders THIS component only -- not `PricingGrid`, and not the ~1,093 memoized
 * rows of the largest live sheet. Only ticking a checkbox raises `onChange`, which is a real change
 * to the row set. Do NOT hoist `q`.
 */
import { useMemo, useState } from "react";
import { Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** The sentinel id for the "(Blanks)" entry. Not a category id -- the empty string can never collide
 * with a real id, and the predicate special-cases it against the SHARED `isMasterSetBlank`. */
export const BLANKS_FILTER_ID = "";
export const BLANKS_FILTER_LABEL = "(Blanks)";

export interface ColumnFilterOption {
  /** Stable identity the predicate matches on (a category id, a classification token, or BLANKS_FILTER_ID). */
  id: string;
  /** Human text -- displayed, searched and sorted. Never persisted into filter state. */
  label: string;
}

/**
 * PURE -- does a value pass this column's filter?
 * An EMPTY selection is a PASS-THROUGH (no filtering on this column), never "hide everything".
 * Within a column the selected ids are OR-ed; the page ANDs the columns together.
 */
export function passesColumnFilter(
  selected: ReadonlySet<string>,
  valueId: string | null | undefined,
): boolean {
  if (selected.size === 0) return true;
  return selected.has(valueId ?? BLANKS_FILTER_ID);
}

export function GridColumnFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: readonly ColumnFilterOption[];
  selected: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(""); // LOCAL -- see the performance note above.
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  }, [options, q]);
  const active = selected.size > 0;

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  const allShownSelected = shown.length > 0 && shown.every((o) => selected.has(o.id));
  const toggleAllShown = () => {
    const next = new Set(selected);
    if (allShownSelected) for (const o of shown) next.delete(o.id);
    else for (const o of shown) next.add(o.id);
    onChange(next);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Filter ${label}`}
          title={`Filter ${label}`}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            // h-4 + leading-none is LOAD-BEARING, not styling. The active-state count badge is taller
            // than the bare icon, and in FROZEN (two-pane) mode this <th> lives in the frozen table
            // while the Category one lives in the scrolling table. An unpinned height grew the frozen
            // header row 32px -> 36px the moment a filter went active, offsetting that pane's body by
            // 4px so the two grids visibly stopped lining up (owner-observed). Pinning the trigger
            // height keeps BOTH header rows identical in both states.
            "inline-flex h-4 shrink-0 items-center gap-0.5 rounded px-0.5 leading-none text-muted-foreground/70 transition-colors hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring",
            active && "text-blue-600 dark:text-blue-400",
          )}
        >
          <Filter className="h-3 w-3 shrink-0" />
          {active && (
            <span className="text-[9px] font-semibold leading-none tabular-nums">{selected.size}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2" onClick={(e) => e.stopPropagation()}>
        <Input
          autoFocus
          className="h-7 text-xs"
          placeholder={`Search ${label}...`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {shown.length > 0 && (
          <button
            type="button"
            className="mt-2 w-full rounded border px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-muted"
            onClick={toggleAllShown}
          >
            {allShownSelected ? "Clear all shown" : "Select all shown"}
          </button>
        )}
        <div className="mt-1 max-h-56 space-y-0.5 overflow-y-auto">
          {shown.length === 0 && (
            <div className="px-1 py-2 text-xs text-muted-foreground">No values.</div>
          )}
          {shown.map((o) => (
            <label
              key={o.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={selected.has(o.id)}
                onChange={() => toggle(o.id)}
              />
              <span className={cn("truncate", o.id === BLANKS_FILTER_ID && "italic text-muted-foreground")}>
                {o.label}
              </span>
            </label>
          ))}
        </div>
        {active && (
          <button
            type="button"
            className="mt-2 w-full rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            onClick={() => onChange(new Set())}
          >
            Clear ({selected.size})
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
