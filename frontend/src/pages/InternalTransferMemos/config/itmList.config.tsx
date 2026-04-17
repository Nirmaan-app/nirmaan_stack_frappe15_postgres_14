import { ColumnDef, VisibilityState } from "@tanstack/react-table";
import { Link } from "react-router-dom";

import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import type { SearchFieldOption } from "@/components/data-table/new-data-table";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";

import { ITMStatusBadge } from "../components/ITMStatusBadge";

/**
 * Row shape returned by `nirmaan_stack.api.internal_transfers.get_itms_list`.
 *
 * Narrower than the doctype interface because the list endpoint joins
 * Projects + User for display-name columns and omits heavy fields
 * (items, source_rir, etc.) that the list view never renders.
 */
export interface ITMListRow {
  name: string;
  creation: string;
  modified?: string;
  status:
    | "Pending Approval"
    | "Approved"
    | "Rejected"
    | "Dispatched"
    | "Partially Delivered"
    | "Delivered";
  source_project: string;
  source_project_name?: string | null;
  target_project: string;
  target_project_name?: string | null;
  transfer_request?: string | null;
  source_rir?: string | null;
  estimated_value?: number | null;
  total_items?: number | null;
  total_quantity?: number | null;
  requested_by?: string | null;
  requested_by_full_name?: string | null;
  approved_by?: string | null;
  approved_on?: string | null;
  rejection_reason?: string | null;
  owner?: string | null;
}

/**
 * Whitelisted API backing the list tabs — matches get_itms_list.py.
 * Overridden via useServerDataTable's `apiEndpoint` config.
 */
export const ITM_LIST_API_ENDPOINT =
  "nirmaan_stack.api.internal_transfers.get_itms_list.get_itms_list";

/**
 * Server-side search across ITM ID + source/target project names (per
 * backend: tokens matched with ILIKE against itm.name, src.project_name,
 * tgt.project_name). The backend applies the union of these fields
 * automatically, so the user-facing "Search By" dropdown only needs one entry.
 */
export const ITM_SEARCHABLE_FIELDS: SearchFieldOption[] = [
  {
    value: "name",
    label: "ITM ID / From / To",
    placeholder: "Search by ITM ID or project name...",
    default: true,
  },
];

/**
 * Fields to request from the API. The backend returns the full joined
 * row regardless, but this keeps the hook contract satisfied.
 */
export const ITM_FETCH_FIELDS: (keyof ITMListRow)[] = [
  "name",
  "creation",
  "status",
  "transfer_request",
  "source_project",
  "source_project_name",
  "target_project",
  "target_project_name",
  "estimated_value",
  "total_items",
  "total_quantity",
  "requested_by",
  "requested_by_full_name",
];

export const ITM_DATE_COLUMNS: string[] = ["creation"];

/**
 * Canonical column set for the ITM list. Every column ships export metadata
 * so the default CSV handler (onExport="default") produces meaningful rows.
 */
export const itmListColumns: ColumnDef<ITMListRow>[] = [
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
    size: 160,
    meta: {
      exportHeaderName: "ITM ID",
      exportValue: (row: ITMListRow) => row.name,
    },
  },
  {
    accessorKey: "transfer_request",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Request" />
    ),
    cell: ({ row }) => {
      const val = row.original.transfer_request;
      return val ? (
        <span className="text-xs text-muted-foreground whitespace-nowrap">{val}</span>
      ) : (
        <span className="text-muted-foreground text-xs">—</span>
      );
    },
    size: 140,
    meta: {
      exportHeaderName: "Request",
      exportValue: (row: ITMListRow) => row.transfer_request || "",
    },
  },
  {
    accessorKey: "source_project_name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="From" />
    ),
    cell: ({ row }) => {
      const label =
        row.original.source_project_name || row.original.source_project || "--";
      return (
        <div className="truncate max-w-[200px]" title={label}>
          {label}
        </div>
      );
    },
    enableColumnFilter: true,
    size: 200,
    meta: {
      exportHeaderName: "From",
      exportValue: (row: ITMListRow) =>
        row.source_project_name || row.source_project || "",
    },
  },
  {
    accessorKey: "target_project_name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="To" />
    ),
    cell: ({ row }) => {
      const label =
        row.original.target_project_name || row.original.target_project || "--";
      return (
        <div className="truncate max-w-[200px]" title={label}>
          {label}
        </div>
      );
    },
    enableColumnFilter: true,
    size: 200,
    meta: {
      exportHeaderName: "To",
      exportValue: (row: ITMListRow) =>
        row.target_project_name || row.target_project || "",
    },
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => <ITMStatusBadge status={row.original.status} />,
    enableColumnFilter: true,
    size: 160,
    meta: {
      enableFacet: true,
      facetTitle: "Status",
      exportHeaderName: "Status",
      exportValue: (row: ITMListRow) => row.status,
    },
  },
  {
    accessorKey: "estimated_value",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Est Value" />
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
    accessorKey: "total_items",
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title="Total Items"
        className="justify-end"
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
        className="justify-end"
      />
    ),
    cell: ({ row }) => {
      const qty = parseNumber(row.original.total_quantity ?? 0) || 0;
      return (
        <div className="text-right pr-2 tabular-nums">
          {qty.toFixed(2)}
        </div>
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
    accessorKey: "creation",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Created On" />
    ),
    cell: ({ row }) => (
      <div className="whitespace-nowrap">{formatDate(row.original.creation)}</div>
    ),
    size: 130,
    meta: {
      exportHeaderName: "Created On",
      exportValue: (row: ITMListRow) => formatDate(row.creation),
    },
  },
  {
    accessorKey: "requested_by_full_name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Created By" />
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
    enableSorting: true,
    meta: {
      exportHeaderName: "Created By",
      exportValue: (row: ITMListRow) =>
        row.requested_by_full_name ||
        row.requested_by ||
        row.owner ||
        "",
    },
  },
];

/**
 * Per-tab column visibility. Tabs whose name already implies the status
 * hide the Status column to avoid a wall of identical badges. "All
 * Requests" is the only tab where Status is meaningful, so it stays
 * visible there.
 */
export const itmTabColumnVisibility: Record<string, VisibilityState> = {
  "Pending Approval": { status: false },
  Rejected: { status: false },
  "All Requests": {},
  Approved: { status: false },
  Dispatched: { status: false },
  Delivered: { status: false },
};
