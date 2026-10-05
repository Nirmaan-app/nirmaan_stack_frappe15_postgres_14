// Column config for the bills DataTable (standard useServerDataTable + DataTable).
// Facets self-fetch from `meta.facet` (Project, Package, Bill Type, Status); the
// three date columns get the DataTable's built-in date-range filter.

import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { FileText, Link2, Lock, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { facetMeta } from "@/components/data-table/facetConfig";
import type { SearchFieldOption } from "@/components/data-table/new-data-table";
import { cn } from "@/lib/utils";
import { formatDate } from "@/utils/FormatDate";
import type { BillDoc } from "../types";
import { inr, isPending } from "../utils/billingFormat";
import { EtaCell, PackageChip, PersonChips, StatusBadge } from "../components/BillingBits";
import { AssignedHeader } from "../components/AssignedFilter";

export const BILL_DOCTYPE = "Project Billing";

export const BILL_FETCH_FIELDS: (keyof BillDoc)[] = [
  "name",
  "billing_tracker",
  "project",
  "package",
  "bill_type",
  "status",
  "bill_value",
  "payment_received",
  "invoice_requested",
  "eta_date",
  "first_submission_date",
  "approval_date",
  "bill_document_link",
  "bill_attachment",
];

export const BILL_SEARCH_FIELDS: SearchFieldOption[] = [
  { value: "project", label: "Project ID", default: true },
  { value: "bill_type", label: "Bill Type" },
  { value: "status", label: "Status" },
];

export const BILL_DATE_COLUMNS = ["eta_date", "first_submission_date", "approval_date"];

export interface BillColumnOptions {
  showProject: boolean;
  showManager: boolean;
  /** Show the Edit column: the user can edit at least one package in this list. */
  showEdit: boolean;
  /** Whether the user can edit bills of this package (Admin, or one of its managers). */
  canEditRow: (tracker: string) => boolean;
  projectName: (project: string) => string;
  /** The bill's package managers, in pick order; empty when unassigned. */
  managersOf: (tracker: string) => string[];
  onEdit: (bill: BillDoc) => void;
}

const money = (value: number | null) =>
  value === null || value === undefined ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <span className="whitespace-nowrap font-medium text-gray-900">{inr(value)}</span>
  );

const day = (value: string | null) =>
  value ? <span className="whitespace-nowrap">{formatDate(value)}</span> : <span className="text-muted-foreground">—</span>;

export function buildBillColumns(o: BillColumnOptions): ColumnDef<BillDoc>[] {
  const columns: ColumnDef<BillDoc>[] = [];

  if (o.showProject) {
    columns.push({
      accessorKey: "project",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
      cell: ({ row }) => (
        <Link to={`/projects/${row.original.project}?page=billing`} className="font-semibold text-gray-900 hover:underline">
          {o.projectName(row.original.project)}
        </Link>
      ),
      size: 170,
      enableColumnFilter: true,
      meta: {
        ...facetMeta({ field: "project", title: "Project" }),
        exportHeaderName: "Project",
        exportValue: (row: BillDoc) => o.projectName(row.project),
      },
    });
  }

  columns.push({
    accessorKey: "package",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Package" />,
    cell: ({ row }) => <PackageChip label={row.original.package} />,
    size: 130,
    enableColumnFilter: true,
    meta: { ...facetMeta({ field: "package", title: "Package" }), exportHeaderName: "Package" },
  });

  if (o.showManager) {
    columns.push({
      id: "billing_managers",
      // Its filter is not a column filter (assignees live on the package): see AssignedHeader.
      header: () => <AssignedHeader />,
      cell: ({ row }) => <PersonChips names={o.managersOf(row.original.billing_tracker)} />,
      enableSorting: false,
      size: 170,
      meta: {
        exportHeaderName: "Assigned",
        exportValue: (row: BillDoc) => o.managersOf(row.billing_tracker).join(", ") || "Unassigned",
      },
    });
  }

  columns.push(
    {
      accessorKey: "bill_type",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Bill Type" />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap rounded-md bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">
          {row.original.bill_type}
        </span>
      ),
      size: 110,
      enableColumnFilter: true,
      meta: { ...facetMeta({ field: "bill_type", title: "Bill Type" }), exportHeaderName: "Bill Type" },
    },
    {
      accessorKey: "bill_value",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Bill Value" />,
      cell: ({ row }) => <div className="text-right">{money(row.original.bill_value)}</div>,
      size: 120,
      meta: { exportHeaderName: "Bill Value", exportValue: (row: BillDoc) => row.bill_value ?? "" },
    },
    {
      accessorKey: "eta_date",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={
            <span className="whitespace-normal text-left leading-tight">
              ETA
              <br />
              Date
            </span>
          }
        />
      ),
      cell: ({ row }) => <EtaCell eta={row.original.eta_date} done={!isPending(row.original.status)} />,
      size: 170,
      meta: {
        exportHeaderName: "ETA Date",
        exportValue: (row: BillDoc) => (row.eta_date ? formatDate(row.eta_date) : ""),
      },
    },
    {
      accessorKey: "first_submission_date",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={
            <span className="whitespace-normal text-left leading-tight">
              First Submission
              <br />
              Date
            </span>
          }
        />
      ),
      cell: ({ row }) => day(row.original.first_submission_date),
      size: 120,
      meta: {
        exportHeaderName: "First Submission Date",
        exportValue: (row: BillDoc) => (row.first_submission_date ? formatDate(row.first_submission_date) : ""),
      },
    },
    {
      accessorKey: "approval_date",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={
            <span className="whitespace-normal text-left leading-tight">
              Approval
              <br />
              Date
            </span>
          }
        />
      ),
      cell: ({ row }) => day(row.original.approval_date),
      size: 120,
      meta: {
        exportHeaderName: "Approval Date",
        exportValue: (row: BillDoc) => (row.approval_date ? formatDate(row.approval_date) : ""),
      },
    },
    {
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
      size: 190,
      enableColumnFilter: true,
      meta: { ...facetMeta({ field: "status", title: "Status" }), exportHeaderName: "Status" },
    },
    {
      accessorKey: "payment_received",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Payment Recd" />,
      cell: ({ row }) => <div className="text-right">{money(row.original.payment_received)}</div>,
      size: 130,
      meta: { exportHeaderName: "Payment Received", exportValue: (row: BillDoc) => row.payment_received ?? "" },
    },
    {
      accessorKey: "invoice_requested",
      header: "Invoice Req.",
      cell: ({ row }) => (
        <div
          className={cn(
            "text-center font-semibold",
            row.original.invoice_requested ? "text-green-700" : "text-muted-foreground",
          )}
        >
          {row.original.invoice_requested ? "Yes" : "No"}
        </div>
      ),
      enableSorting: false,
      size: 100,
      meta: {
        exportHeaderName: "Invoice Requested",
        exportValue: (row: BillDoc) => (row.invoice_requested ? "Yes" : "No"),
      },
    },
    {
      // A bill's document can be a link, an attached file, or both. Each gets its own
      // icon and colour: link = blue chain, attached file = violet document.
      accessorKey: "bill_document_link",
      header: "Bill Link / Attach",
      cell: ({ row }) => {
        const { bill_document_link: link, bill_attachment: file, package: pkg, bill_type } = row.original;
        if (!link && !file) return <div className="text-center text-sm text-gray-300">—</div>;
        return (
          <div className="flex items-center justify-center gap-1.5">
            {link && (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open bill link — ${pkg} ${bill_type}`}
                aria-label={`Open bill link for ${pkg} ${bill_type}`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
              >
                <Link2 className="h-4 w-4" />
              </a>
            )}
            {file && (
              <a
                href={file}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open attached bill file — ${pkg} ${bill_type}`}
                aria-label={`Open attached bill file for ${pkg} ${bill_type}`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100"
              >
                <FileText className="h-4 w-4" />
              </a>
            )}
          </div>
        );
      },
      enableSorting: false,
      size: 100,
      meta: {
        exportHeaderName: "Bill Link / Attach",
        exportValue: (row: BillDoc) => [row.bill_document_link, row.bill_attachment].filter(Boolean).join(" | "),
      },
    },
  );

  if (o.showEdit) {
    columns.push({
      id: "edit",
      header: "Edit",
      cell: ({ row }) => (
        <div className="text-center">
          {o.canEditRow(row.original.billing_tracker) ? (
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label="Edit bill"
              onClick={() => o.onEdit(row.original)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <span
              className="inline-flex h-8 w-8 items-center justify-center text-gray-300"
              title="Only this package's billing managers or Admin can edit its bills"
            >
              <Lock className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">Not editable: you are not a billing manager of this package</span>
            </span>
          )}
        </div>
      ),
      enableSorting: false,
      size: 70,
      meta: { excludeFromExport: true },
    });
  }

  return columns;
}
