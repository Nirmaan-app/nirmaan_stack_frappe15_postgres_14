import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";

import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ITMStatusBadge } from "@/pages/InternalTransferMemos/components/ITMStatusBadge";
import type { ITMListRow } from "@/pages/InternalTransferMemos/config/itmList.config";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";

/**
 * Columns for the "Dispatched for 1+ days (ITM)" report. ITM analog of the
 * PO version — leads with the dispatched timestamp so the most-stale ITMs
 * (when sorted ``dispatched_on asc``) surface at the top.
 */
export const itmDispatchedColumns: ColumnDef<ITMListRow>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="ITM ID" />
    ),
    cell: ({ row }) => (
      <Link
        to={`/internal-transfer-memos/${row.original.name}`}
        className="font-medium text-primary underline underline-offset-2 hover:text-primary/80 whitespace-nowrap"
      >
        {row.original.name}
      </Link>
    ),
    size: 170,
    meta: {
      exportHeaderName: "ITM ID",
      exportValue: (row: ITMListRow) => row.name,
    },
  },
  {
    id: "dispatched_on",
    accessorFn: (row) => row.dispatched_on,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Dispatched On" />
    ),
    cell: ({ row }) => {
      const value = row.original.dispatched_on as string | undefined;
      return (
        <div className="whitespace-nowrap">
          {value ? formatDate(value) : "--"}
        </div>
      );
    },
    enableSorting: true,
    size: 140,
    meta: {
      exportHeaderName: "Dispatched On",
      exportValue: (row: ITMListRow) => {
        const value = row.dispatched_on as string | undefined;
        return value ? formatDate(value) : "";
      },
    },
  },
  {
    accessorKey: "source_project_name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="From" />
    ),
    cell: ({ row }) => {
      const label = row.original.source_type === "Warehouse"
        ? "Warehouse"
        : (row.original.source_project_name || row.original.source_project || "--");
      return (
        <div className="truncate max-w-[220px]" title={label}>
          {label}
        </div>
      );
    },
    enableColumnFilter: true,
    size: 200,
    meta: {
      enableFacet: true,
      facetTitle: "From",
      exportHeaderName: "From",
      exportValue: (row: ITMListRow) =>
        row.source_type === "Warehouse"
          ? "Warehouse"
          : (row.source_project_name || row.source_project || ""),
    },
  },
  {
    accessorKey: "target_project_name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="To" />
    ),
    cell: ({ row }) => {
      const label = row.original.target_type === "Warehouse"
        ? "Warehouse"
        : (row.original.target_project_name || row.original.target_project || "--");
      return (
        <div className="truncate max-w-[220px]" title={label}>
          {label}
        </div>
      );
    },
    enableColumnFilter: true,
    size: 200,
    meta: {
      enableFacet: true,
      facetTitle: "To",
      exportHeaderName: "To",
      exportValue: (row: ITMListRow) =>
        row.target_type === "Warehouse"
          ? "Warehouse"
          : (row.target_project_name || row.target_project || ""),
    },
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => <ITMStatusBadge status={row.original.status} />,
    size: 130,
    meta: {
      exportHeaderName: "Status",
      exportValue: (row: ITMListRow) => row.status,
    },
  },
  {
    accessorKey: "total_items",
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title="Total Items"
        className="flex-1 justify-end pr-2"
      />
    ),
    cell: ({ row }) => (
      <div className="text-right pr-2 tabular-nums">
        {row.original.total_items ?? 0}
      </div>
    ),
    size: 110,
    meta: {
      exportHeaderName: "Total Items",
      exportValue: (row: ITMListRow) => row.total_items ?? 0,
    },
  },
  {
    accessorKey: "total_quantity",
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title="Total Qty"
        className="flex-1 justify-end pr-2"
      />
    ),
    cell: ({ row }) => {
      const qty = parseNumber(row.original.total_quantity ?? 0) || 0;
      return (
        <div className="text-right pr-2 tabular-nums">{qty.toFixed(2)}</div>
      );
    },
    size: 110,
    meta: {
      exportHeaderName: "Total Qty",
      exportValue: (row: ITMListRow) =>
        parseNumber(row.total_quantity ?? 0) || 0,
    },
  },
  {
    accessorKey: "estimated_value",
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title="Est Value"
        className="flex-1 justify-end pr-2"
      />
    ),
    cell: ({ row }) => (
      <div className="font-medium pr-2 text-right tabular-nums">
        {formatToRoundedIndianRupee(row.original.estimated_value ?? 0)}
      </div>
    ),
    size: 140,
    meta: {
      exportHeaderName: "Est Value",
      exportValue: (row: ITMListRow) =>
        parseNumber(row.estimated_value ?? 0) || 0,
    },
  },
  {
    accessorKey: "requested_by_full_name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Requested By" />
    ),
    cell: ({ row }) => {
      const label =
        row.original.requested_by_full_name ||
        row.original.requested_by ||
        row.original.owner ||
        "--";
      return (
        <div className="truncate max-w-[180px]" title={label}>
          {label}
        </div>
      );
    },
    size: 180,
    meta: {
      exportHeaderName: "Requested By",
      exportValue: (row: ITMListRow) =>
        row.requested_by_full_name ||
        row.requested_by ||
        row.owner ||
        "",
    },
  },
];
