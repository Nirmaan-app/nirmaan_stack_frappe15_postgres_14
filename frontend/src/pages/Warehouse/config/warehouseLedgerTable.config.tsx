import { ColumnDef } from "@tanstack/react-table";

import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import type { SearchFieldOption } from "@/components/data-table/new-data-table";
import { formatDate } from "@/utils/FormatDate";

/**
 * Row shape returned by `nirmaan_stack.api.warehouse.get_warehouse_ledger`.
 */
export interface WarehouseLedgerRow {
  name: string;
  item_id: string;
  item_name: string;
  unit: string | null;
  doctype_ref: string;
  docname_ref: string;
  source_project: string;
  source_project_name: string;
  target_project: string;
  target_project_name: string;
  impact: "Increase" | "Decrease";
  quantity: number;
  date: string;
  creation: string;
}

export const WAREHOUSE_LEDGER_API_ENDPOINT =
  "nirmaan_stack.api.warehouse.get_warehouse_ledger.get_warehouse_ledger";

export const WAREHOUSE_LEDGER_SEARCHABLE_FIELDS: SearchFieldOption[] = [
  {
    value: "item_name",
    label: "Item / Ref",
    placeholder: "Search by item, item ID, or ref doc...",
    default: true,
  },
];

export const WAREHOUSE_LEDGER_FETCH_FIELDS: (keyof WarehouseLedgerRow)[] = [
  "item_id",
  "item_name",
  "unit",
  "doctype_ref",
  "docname_ref",
  "source_project",
  "source_project_name",
  "target_project",
  "target_project_name",
  "impact",
  "quantity",
  "date",
  "creation",
];

export const WAREHOUSE_LEDGER_DATE_COLUMNS: string[] = ["date", "creation"];

export const WAREHOUSE_LEDGER_IMPACT_OPTIONS = [
  { label: "Increase", value: "Increase" },
  { label: "Decrease", value: "Decrease" },
];

export const warehouseLedgerColumns: ColumnDef<WarehouseLedgerRow>[] = [
  {
    accessorKey: "date",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Date" />
    ),
    cell: ({ row }) => formatDate(row.original.date || row.original.creation),
    size: 120,
    meta: {
      exportHeaderName: "Date",
      exportValue: (row: WarehouseLedgerRow) =>
        formatDate(row.date || row.creation),
    },
  },
  {
    accessorKey: "item_name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Item" />
    ),
    cell: ({ row }) => (
      <div
        className="font-medium truncate max-w-[220px]"
        title={`${row.original.item_name}${row.original.unit ? ` · ${row.original.unit}` : ""}`}
      >
        {row.original.item_name}
      </div>
    ),
    size: 220,
    meta: {
      exportHeaderName: "Item",
      exportValue: (row: WarehouseLedgerRow) => row.item_name,
    },
  },
  {
    accessorKey: "docname_ref",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Ref Doc" />
    ),
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium text-xs">{row.original.docname_ref}</span>
        <span className="text-xs text-muted-foreground">
          {row.original.doctype_ref}
        </span>
      </div>
    ),
    size: 180,
    meta: {
      exportHeaderName: "Ref Doc",
      exportValue: (row: WarehouseLedgerRow) => row.docname_ref,
    },
  },
  {
    accessorKey: "source_project_name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="From" />
    ),
    cell: ({ row }) => (
      <div className="truncate max-w-[180px]" title={row.original.source_project_name}>
        {row.original.source_project_name || row.original.source_project || "-"}
      </div>
    ),
    size: 180,
    meta: {
      exportHeaderName: "From",
      exportValue: (row: WarehouseLedgerRow) =>
        row.source_project_name || row.source_project || "",
    },
  },
  {
    accessorKey: "target_project_name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="To" />
    ),
    cell: ({ row }) => (
      <div className="truncate max-w-[180px]" title={row.original.target_project_name}>
        {row.original.target_project_name || row.original.target_project || "-"}
      </div>
    ),
    size: 180,
    meta: {
      exportHeaderName: "To",
      exportValue: (row: WarehouseLedgerRow) =>
        row.target_project_name || row.target_project || "",
    },
  },
  {
    accessorKey: "impact",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Impact" />
    ),
    cell: ({ row }) => (
      <span
        className={
          row.original.impact === "Increase"
            ? "text-green-700 font-medium"
            : "text-red-700 font-medium"
        }
      >
        {row.original.impact}
      </span>
    ),
    enableColumnFilter: true,
    size: 110,
    meta: {
      enableFacet: true,
      facetTitle: "Impact",
      exportHeaderName: "Impact",
      exportValue: (row: WarehouseLedgerRow) => row.impact,
    },
  },
  {
    accessorKey: "quantity",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Quantity" />
    ),
    cell: ({ row }) => (
      <div className="text-right font-medium">{row.original.quantity}</div>
    ),
    size: 110,
    meta: {
      exportHeaderName: "Quantity",
      exportValue: (row: WarehouseLedgerRow) => row.quantity,
    },
  },
];
