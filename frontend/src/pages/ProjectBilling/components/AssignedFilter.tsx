import { createContext, useContext, useMemo } from "react";
import type { Column } from "@tanstack/react-table";
import { DataTableFacetedFilter } from "@/components/data-table/data-table-faceted-filter";

interface AssignedFilterState {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (people: string[]) => void;
}

/** Provided by BillsDataTable, read by the Assigned column header. */
export const AssignedFilterContext = createContext<AssignedFilterState | null>(null);

/**
 * Header of the bills table's Assigned column: the title plus the same funnel the other columns use.
 *
 * Assignees live on the package tracker, not on the bill, so this cannot be a TanStack column
 * filter: every column filter reaches the server as `[column, "in", values]`, and bills have no
 * assignee field. The popover only reads and writes a filter value, so it gets an adapter with
 * those two methods; BillsDataTable turns the selection into `billing_tracker in [...]`.
 */
export function AssignedHeader() {
  const state = useContext(AssignedFilterContext);
  const column = useMemo(
    () =>
      state &&
      ({
        id: "billing_managers",
        getFilterValue: () => (state.selected.length ? state.selected : undefined),
        setFilterValue: (value?: string[]) => state.onChange(value ?? []),
      } as unknown as Column<unknown, unknown>),
    [state],
  );

  return (
    <div className="flex items-center gap-1">
      {column && state!.options.length > 0 && (
        <DataTableFacetedFilter column={column} title="Assigned" options={state!.options} />
      )}
      <span>Assigned</span>
    </div>
  );
}
