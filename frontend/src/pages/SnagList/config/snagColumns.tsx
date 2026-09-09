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
import { SquarePen } from "lucide-react";

import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { facetMeta } from "@/components/data-table/facetConfig";
import { Button } from "@/components/ui/button";
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
  /**
   * Open the Edit dialog (Area / Category / Description). Withheld when the actor
   * may not edit a row's DATA — a DIFFERENT question from its status, and a
   * NARROWER set: a Project Manager records work done but does not rewrite what the
   * consultant reported (`snagPermissions.canEditRow`, owner Q8a).
   */
  onEditRow?: (snag: SnagListRow) => void;
  /** `name` of the row whose write is currently in flight, if any. */
  savingStatusFor?: string | null;
}

const dash = (v?: string | null) => (v && v.trim() ? v : "--");

export const getSnagColumns = ({
  onStatusChange,
  onEditRow,
  savingStatusFor,
}: GetSnagColumnsOptions): ColumnDef<SnagListRow>[] => [
  {
    // The number the snag is quoted by: the consultant's own, or the position the
    // import gave it. Frappe `Data`, so it sorts as TEXT -- "10" before "2" -- which
    // is why the LIST's own order stays the default and this column is not the sort
    // anyone should reach for. Blank on a manually added snag.
    accessorKey: "source_serial",
    size: 70,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="S.No" />
    ),
    cell: ({ row }) => (
      <div className="truncate text-xs tabular-nums text-muted-foreground">
        {dash(row.original.source_serial)}
      </div>
    ),
    meta: {
      exportHeaderName: "S.No",
      exportValue: (r: SnagListRow) => r.source_serial || "",
    },
  },
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
      // The whole row is in hand here, so the change dialog's read-only
      // Description / Area / Category context costs NO extra fetch — it is passed
      // straight down (Revision 3, R3.3 #5).
      <SnagStatusCell
        status={row.original.status}
        remark={row.original.remark}
        description={row.original.description}
        area={row.original.area}
        category={row.original.category}
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
  /* ── Actions ────────────────────────────────────────────────────────────────
   * LAST in the array, which is what "far right" means here. It is NOT pinned:
   * nothing in this app's tables is. `useServerDataTable` declares no
   * `columnPinning` and `new-data-table.tsx`'s sticky class for data columns is
   * commented out, so pinning would be a shared-infrastructure change across ~40
   * pages — explicitly out of scope (Revision 3, owner Q7a).
   *
   * TWO buttons, TWO DIFFERENT GATES, and the whole column is omitted when neither
   * callback was supplied — presence of the callback IS the gate, exactly as the
   * status cell already works. There is no second `disabled` signal anywhere.
   */
  ...(onStatusChange || onEditRow
    ? [
        {
          id: "actions",
          size: 90,
          enableSorting: false,
          enableColumnFilter: false,
          header: () => <div className="text-center text-xs">Actions</div>,
          cell: ({ row }: { row: { original: SnagListRow } }) => (
            <div className="flex items-center justify-center gap-1">
              {/* The status button is a SECOND DOOR ONTO THE SAME DIALOG, never a
                  second rule (owner Q10a): it renders the very same
                  `SnagStatusCell`, only as an icon trigger, so the "Not Applicable
                  takes no remark" carve-out cannot drift between the two. The
                  inline dropdown in the Status column stays. */}
              {onStatusChange && (
                <SnagStatusCell
                  variant="icon"
                  status={row.original.status}
                  remark={row.original.remark}
                  description={row.original.description}
                  area={row.original.area}
                  category={row.original.category}
                  isSaving={savingStatusFor === row.original.name}
                  onChange={(next, remark) =>
                    onStatusChange(row.original, next, remark)
                  }
                />
              )}
              {onEditRow && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  title="Edit area, category and description"
                  aria-label="Edit snag details"
                  onClick={() => onEditRow(row.original)}
                >
                  <SquarePen className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ),
          meta: { excludeFromExport: true },
        } as ColumnDef<SnagListRow>,
      ]
    : []),
];

/**
 * Initial column visibility.
 *
 * `status_changed_by` is folded into the "Last updated" cell, so it starts hidden
 * but stays toggleable and exported.
 *
 * The hidden `batch` FILTER-HOST column that used to be listed here went with the
 * Batch funnel in Revision 3 (owner Q6): batch provenance now lives in the Edit
 * dialog, read-only. Its id was removed from `SNAG_FILTERABLE_COLUMN_IDS` in the
 * same change — see the warning there; the two are one removal.
 */
export const SNAG_INITIAL_COLUMN_VISIBILITY: Record<string, boolean> = {
  status_changed_by: false,
};
