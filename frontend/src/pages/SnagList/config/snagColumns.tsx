/**
 * Snag List — column definitions for the tracking table.
 *
 * Facets are declared HERE via `meta.facet` (the self-fetching path, ADR-0010
 * "Option 2"); the page opts in with `facetDoctype` and supplies render-scope
 * context via `facetOverrides`. Do NOT hand-roll `useFacetValues` +
 * `facetFilterOptions` — that legacy path is being sunset.
 *
 * CSV export uses the app's real export contract: `meta.exportHeaderName` +
 * `meta.exportValue` + `meta.excludeFromExport`, read by `utils/exportToCsv.ts`.
 */

import { ColumnDef } from "@tanstack/react-table";

import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { facetMeta } from "@/components/data-table/facetConfig";
import { formatDate } from "@/utils/FormatDate";

import { SnagStatus } from "../types";
import { SnagStatusCell } from "../components/SnagStatusCell";
import { SnagListRow } from "./snagTable.config";

export interface GetSnagColumnsOptions {
  /**
   * Withheld (undefined) when the actor may not edit — presence IS the gate.
   *
   * The remark rides the status change (ADR-0018): `undefined` leaves the stored
   * text alone, `""` clears it. There is no separate remark-save callback, because
   * there is no standalone remark editor.
   */
  onStatusChange?: (
    snag: SnagListRow,
    next: SnagStatus,
    remark: string | undefined
  ) => Promise<boolean> | void;
  /** `name` of the row whose write is currently in flight, if any. */
  savingStatusFor?: string | null;
}

const dash = (v?: string | null) => (v && v.trim() ? v : "--");

export const getSnagColumns = ({
  onStatusChange,
  savingStatusFor,
}: GetSnagColumnsOptions): ColumnDef<SnagListRow>[] => [
  {
    accessorKey: "area",
    size: 150,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Area" />
    ),
    cell: ({ row }) => (
      <div className="truncate text-xs" title={row.original.area || undefined}>
        {dash(row.original.area)}
      </div>
    ),
    enableColumnFilter: true,
    meta: {
      ...facetMeta({ field: "area", title: "Area" }),
      exportHeaderName: "Area / Location",
      exportValue: (r: SnagListRow) => r.area || "",
    },
  },
  {
    accessorKey: "category",
    size: 140,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Category" />
    ),
    cell: ({ row }) => (
      <div
        className="truncate text-xs"
        title={row.original.category || undefined}
      >
        {dash(row.original.category)}
      </div>
    ),
    enableColumnFilter: true,
    meta: {
      ...facetMeta({ field: "category", title: "Category" }),
      exportHeaderName: "Category",
      exportValue: (r: SnagListRow) => r.category || "",
    },
  },
  {
    accessorKey: "description",
    size: 340,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Description" />
    ),
    cell: ({ row }) => (
      <div
        className="line-clamp-2 whitespace-pre-wrap break-words text-xs"
        title={row.original.description || undefined}
      >
        {dash(row.original.description)}
      </div>
    ),
    meta: {
      exportHeaderName: "Snag Description",
      exportValue: (r: SnagListRow) => r.description || "",
    },
  },
  {
    accessorKey: "status",
    size: 160,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => (
      <SnagStatusCell
        status={row.original.status}
        remark={row.original.remark}
        isSaving={savingStatusFor === row.original.name}
        onChange={
          onStatusChange
            ? (next, remark) => onStatusChange(row.original, next, remark)
            : undefined
        }
      />
    ),
    enableColumnFilter: true,
    meta: {
      ...facetMeta({ field: "status", title: "Status" }),
      exportHeaderName: "Status",
      exportValue: (r: SnagListRow) => r.status,
    },
  },
  {
    // THE one free-text field (ADR-0018). It arrives holding the imported text and
    // is overwritten by whoever next changes the Snag's status — which is why it is
    // read-only HERE and editable only from the status-change dialog. There is no
    // standalone remark editor, and this cell must not become one.
    accessorKey: "remark",
    size: 240,
    enableSorting: false,
    header: () => <div className="text-xs">Remarks</div>,
    cell: ({ row }) => (
      <div
        className="line-clamp-2 whitespace-pre-wrap break-words text-xs text-muted-foreground"
        title={row.original.remark || undefined}
      >
        {dash(row.original.remark)}
      </div>
    ),
    meta: {
      exportHeaderName: "Remarks",
      exportValue: (r: SnagListRow) => r.remark || "",
    },
  },
  {
    /* ── The Batch FILTER's host column ───────────────────────────────────────
     * There is deliberately NO Batch column in the grid any more (Revision 2 Q5),
     * but the Batch FILTER stays. This column exists ONLY to carry the filter, and
     * it is not something to "clean up".
     *
     * WHY IT HAS TO EXIST: the faceted filter writes its selection through
     * `column.setFilterValue()`, so the resulting `columnFilters` entry is keyed by
     * the HOST COLUMN'S ID — and `convertTanstackFiltersToFrappe` turns that id
     * straight into the queried FIELD NAME. Re-siting the declaration onto the Area
     * or Status column would therefore send `["area", "in", ["<batch doc name>"]]`:
     * the funnel would populate correctly (options come from `facet.field`) and then
     * filter the wrong field. Keeping a column whose id IS `batch` is what keeps the
     * emitted filter honest.
     *
     * It is a DISPLAY column (no `accessorKey`, so `accessorFn` is undefined), which
     * is what keeps it out of the "Toggle columns" menu — that menu lists only
     * accessor columns. Hidden via `SNAG_INITIAL_COLUMN_VISIBILITY`, so it renders
     * no header and no cells; `SnagListTab` renders the funnel itself, in the
     * toolbar, reading this column's declaration through `getColumnFacet`.
     */
    id: "batch",
    enableSorting: false,
    enableColumnFilter: true,
    size: 0,
    header: () => null,
    cell: () => null,
    meta: {
      ...facetMeta({
        field: "batch",
        title: "Batch",
        includeBlankBucket: true,
        blankLabel: "Manual (no batch)",
      }),
      excludeFromExport: true,
    },
  },
  {
    // "Last updated" = the two status-change stamps, rendered as one column.
    // They answer "who last moved the STATUS" — NOT generic "last edited"
    // attribution (ADR-0018): a `Not Applicable` change carries no remark, so the
    // two are not interchangeable. Do not relabel this column.
    id: "status_changed_on",
    accessorKey: "status_changed_on",
    size: 165,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Last updated" />
    ),
    cell: ({ row }) => {
      const { status_changed_on, status_changed_by } = row.original;
      if (!status_changed_on) {
        return <span className="text-xs text-muted-foreground">--</span>;
      }
      return (
        <div className="text-xs leading-tight">
          <div>{formatDate(status_changed_on)}</div>
          {status_changed_by && (
            <div
              className="truncate text-[11px] text-muted-foreground"
              title={status_changed_by}
            >
              {status_changed_by}
            </div>
          )}
        </div>
      );
    },
    meta: {
      exportHeaderName: "Last Updated On",
      exportValue: (r: SnagListRow) =>
        r.status_changed_on ? formatDate(r.status_changed_on) : "",
    },
  },
  {
    // Who last moved the status. HIDDEN BY DEFAULT (it already rides the
    // "Last updated" cell) but a real, toggleable column — and always its own
    // column in the CSV, which reads the `columns` prop, not the visible set.
    accessorKey: "status_changed_by",
    size: 170,
    enableSorting: false,
    header: () => <div className="text-xs">Last updated by</div>,
    cell: ({ row }) => (
      <div
        className="truncate text-xs"
        title={row.original.status_changed_by || undefined}
      >
        {dash(row.original.status_changed_by)}
      </div>
    ),
    meta: {
      columnLabel: "Last updated by",
      exportHeaderName: "Last Updated By",
      exportValue: (r: SnagListRow) => r.status_changed_by || "",
    },
  },
];

/**
 * Initial column visibility.
 *
 *  - `status_changed_by` is folded into the "Last updated" cell, so it starts
 *    hidden but stays toggleable and exported.
 *  - `batch` is the FILTER-HOST column above: hidden permanently, and unreachable
 *    from the "Toggle columns" menu because it declares no accessor.
 */
export const SNAG_INITIAL_COLUMN_VISIBILITY: Record<string, boolean> = {
  status_changed_by: false,
  batch: false,
};

/** The filter-host column's id — the ONE literal, shared with the page's funnel. */
export const SNAG_BATCH_FILTER_COLUMN_ID = "batch";
