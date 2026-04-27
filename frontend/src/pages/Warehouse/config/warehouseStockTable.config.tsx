import { ColumnDef } from "@tanstack/react-table";

import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import type { SearchFieldOption } from "@/components/data-table/new-data-table";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

/**
 * Row shape returned by `nirmaan_stack.api.warehouse.get_warehouse_stock`.
 */
export interface WarehouseStockRow {
  name: string;
  item_id: string;
  item_name: string;
  unit: string;
  category: string;
  make?: string | null;
  current_stock: number;
  total_reserved: number;
  available_quantity: number;
  estimated_rate: number;
  estimated_value: number;
}

export const WAREHOUSE_STOCK_API_ENDPOINT =
  "nirmaan_stack.api.warehouse.get_warehouse_stock.get_warehouse_stock";

export const WAREHOUSE_STOCK_SEARCHABLE_FIELDS: SearchFieldOption[] = [
  {
    value: "item_name",
    label: "Item / Make / Category",
    placeholder: "Search by item name, ID, make or category...",
    default: true,
  },
];

export const WAREHOUSE_STOCK_FETCH_FIELDS: (keyof WarehouseStockRow)[] = [
  "item_id",
  "item_name",
  "unit",
  "category",
  "make",
  "current_stock",
  "total_reserved",
  "available_quantity",
  "estimated_rate",
  "estimated_value",
];

export const WAREHOUSE_STOCK_DATE_COLUMNS: string[] = [];

export const warehouseStockColumns: ColumnDef<WarehouseStockRow>[] = [
  {
    accessorKey: "item_name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Item Name" />
    ),
    cell: ({ row }) => (
      <div
        className="font-medium truncate max-w-[240px]"
        title={`${row.original.item_name} · ${row.original.item_id}`}
      >
        {row.original.item_name}
      </div>
    ),
    size: 240,
    meta: {
      exportHeaderName: "Item Name",
      exportValue: (row: WarehouseStockRow) => row.item_name,
    },
  },
  {
    accessorKey: "category",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Category" />
    ),
    cell: ({ row }) => row.original.category || "-",
    enableColumnFilter: true,
    size: 160,
    meta: {
      enableFacet: true,
      facetTitle: "Category",
      exportHeaderName: "Category",
      exportValue: (row: WarehouseStockRow) => row.category || "",
    },
  },
  {
    accessorKey: "unit",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Unit" />
    ),
    cell: ({ row }) => row.original.unit || "-",
    enableColumnFilter: true,
    size: 100,
    meta: {
      exportHeaderName: "Unit",
      exportValue: (row: WarehouseStockRow) => row.unit || "",
    },
  },
  {
    accessorKey: "make",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Make" />
    ),
    cell: ({ row }) => row.original.make || "-",
    enableColumnFilter: true,
    size: 140,
    meta: {
      exportHeaderName: "Make",
      exportValue: (row: WarehouseStockRow) => row.make || "",
    },
  },
  {
    accessorKey: "current_stock",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Current Stock" />
    ),
    cell: ({ row }) => (
      <div className="text-right font-medium">{row.original.current_stock}</div>
    ),
    size: 130,
    meta: {
      exportHeaderName: "Current Stock",
      exportValue: (row: WarehouseStockRow) => row.current_stock,
    },
  },
  {
    accessorKey: "total_reserved",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Reserved" />
    ),
    cell: ({ row }) => (
      <div className="text-right text-amber-600">
        {row.original.total_reserved > 0 ? row.original.total_reserved : "-"}
      </div>
    ),
    size: 110,
    meta: {
      exportHeaderName: "Reserved",
      exportValue: (row: WarehouseStockRow) => row.total_reserved,
    },
  },
  {
    accessorKey: "available_quantity",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Available" />
    ),
    cell: ({ row }) => (
      <div className="text-right font-medium">{row.original.available_quantity}</div>
    ),
    size: 110,
    meta: {
      exportHeaderName: "Available",
      exportValue: (row: WarehouseStockRow) => row.available_quantity,
    },
  },
  {
    accessorKey: "estimated_rate",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Est. Rate" />
    ),
    cell: ({ row }) => (
      <div className="text-right">
        {formatToRoundedIndianRupee(row.original.estimated_rate)}
      </div>
    ),
    size: 130,
    meta: {
      exportHeaderName: "Est. Rate",
      exportValue: (row: WarehouseStockRow) => row.estimated_rate,
    },
  },
  {
    accessorKey: "estimated_value",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Est. Value" />
    ),
    cell: ({ row }) => (
      <div className="text-right">
        {formatToRoundedIndianRupee(row.original.estimated_value)}
      </div>
    ),
    size: 140,
    meta: {
      exportHeaderName: "Est. Value",
      exportValue: (row: WarehouseStockRow) => row.estimated_value,
    },
  },
];
