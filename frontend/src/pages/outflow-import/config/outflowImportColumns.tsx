// src/pages/outflow-import/config/outflowImportColumns.tsx

import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";

import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { facetMeta } from "@/components/data-table/facetConfig";
import { Badge } from "@/components/ui/badge";
import { OutflowImportBatch } from "@/types/NirmaanStack/OutflowImportBatch";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

interface GetOutflowImportColumnsOptions {
    getUserName?: (userId?: string) => string;
}

/**
 * Batch status -> badge tone.
 *
 * `Completed with exceptions` is amber, NOT red: the batch closed deliberately with open rows
 * abandoned, which is a decision someone made, not a failure. Red is reserved for rows that
 * errored.
 */
const STATUS_TONE: Record<string, string> = {
    Draft: "bg-gray-100 text-gray-700",
    "In Review": "bg-blue-50 text-blue-700",
    "Partially Settled": "bg-indigo-50 text-indigo-700",
    Completed: "bg-emerald-50 text-emerald-700",
    "Completed with exceptions": "bg-amber-50 text-amber-700",
};

export const getOutflowImportColumns = ({
    getUserName,
}: GetOutflowImportColumnsOptions = {}): ColumnDef<OutflowImportBatch>[] => [
    {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Import ID" />,
        cell: ({ row }) => (
            <Link
                to={`/bulk-import-outflow/${row.original.name}`}
                className="font-medium text-primary underline underline-offset-2 hover:text-primary/80 whitespace-nowrap"
            >
                {row.original.name}
            </Link>
        ),
        size: 150,
        meta: {
            exportHeaderName: "Import ID",
            exportValue: (row: OutflowImportBatch) => row.name,
        },
    },
    {
        accessorKey: "source",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Source" />,
        cell: ({ row }) => <span className="whitespace-nowrap">{row.original.source}</span>,
        enableColumnFilter: true,
        size: 110,
        meta: {
            ...facetMeta({ field: "source", title: "Source" }),
            exportHeaderName: "Source",
        },
    },
    {
        id: "period",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Period" />,
        cell: ({ row }) => {
            const { period_from, period_to } = row.original;
            if (!period_from) return <span className="text-muted-foreground">--</span>;
            const from = formatDate(period_from);
            const to = period_to ? formatDate(period_to) : from;
            return (
                <span className="whitespace-nowrap">{from === to ? from : `${from} - ${to}`}</span>
            );
        },
        size: 200,
        meta: {
            exportHeaderName: "Period",
            exportValue: (row: OutflowImportBatch) =>
                row.period_from
                    ? `${formatDate(row.period_from)} - ${formatDate(row.period_to || row.period_from)}`
                    : "",
        },
    },
    {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
            <Badge
                variant="outline"
                className={`whitespace-nowrap border-0 ${STATUS_TONE[row.original.status] || ""}`}
            >
                {row.original.status}
            </Badge>
        ),
        enableColumnFilter: true,
        size: 190,
        meta: {
            ...facetMeta({ field: "status", title: "Status" }),
            exportHeaderName: "Status",
        },
    },
    {
        id: "progress",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Decisions" />,
        cell: ({ row }) => {
            const { reviewed_rows = 0, total_rows = 0 } = row.original;
            return (
                <span className="tabular-nums whitespace-nowrap">
                    {reviewed_rows} / {total_rows}
                </span>
            );
        },
        size: 110,
        meta: {
            exportHeaderName: "Decisions Taken",
            exportValue: (row: OutflowImportBatch) =>
                `${row.reviewed_rows ?? 0} of ${row.total_rows ?? 0}`,
        },
    },
    {
        id: "outcomes",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Outcomes" />,
        cell: ({ row }) => {
            const { reconciled_rows = 0, settled_rows = 0, exception_rows = 0, skipped_rows = 0 } =
                row.original;
            return (
                <div className="flex flex-wrap items-center gap-1 text-xs">
                    {reconciled_rows > 0 && (
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                            {reconciled_rows} reconciled
                        </span>
                    )}
                    {settled_rows > 0 && (
                        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">
                            {settled_rows} settled
                        </span>
                    )}
                    {exception_rows > 0 && (
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">
                            {exception_rows} to review
                        </span>
                    )}
                    {skipped_rows > 0 && (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">
                            {skipped_rows} skipped
                        </span>
                    )}
                    {!reconciled_rows && !settled_rows && !exception_rows && !skipped_rows && (
                        <span className="text-muted-foreground">--</span>
                    )}
                </div>
            );
        },
        size: 260,
        meta: {
            exportHeaderName: "Outcomes",
            exportValue: (row: OutflowImportBatch) =>
                [
                    `${row.reconciled_rows ?? 0} reconciled`,
                    `${row.settled_rows ?? 0} settled`,
                    `${row.exception_rows ?? 0} exceptions`,
                    `${row.skipped_rows ?? 0} skipped`,
                ].join(", "),
        },
    },
    {
        accessorKey: "gross_amount",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Transferred" />,
        cell: ({ row }) => (
            <span className="tabular-nums whitespace-nowrap">
                {formatToRoundedIndianRupee(row.original.gross_amount ?? 0)}
            </span>
        ),
        size: 140,
        meta: {
            exportHeaderName: "Transferred",
            exportValue: (row: OutflowImportBatch) => row.gross_amount ?? 0,
        },
    },
    {
        accessorKey: "charges_amount",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Bank Charges" />,
        cell: ({ row }) => (
            <span className="tabular-nums whitespace-nowrap text-muted-foreground">
                {formatToRoundedIndianRupee(row.original.charges_amount ?? 0)}
            </span>
        ),
        size: 130,
        meta: {
            exportHeaderName: "Bank Charges",
            exportValue: (row: OutflowImportBatch) => row.charges_amount ?? 0,
        },
    },
    {
        accessorKey: "uploaded_by",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Uploaded By" />,
        cell: ({ row }) => (
            <span className="whitespace-nowrap">
                {getUserName?.(row.original.uploaded_by) || row.original.uploaded_by || "--"}
            </span>
        ),
        enableColumnFilter: true,
        size: 170,
        meta: {
            ...facetMeta({ field: "uploaded_by", title: "Uploaded By" }),
            exportHeaderName: "Uploaded By",
        },
    },
    {
        accessorKey: "creation",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Uploaded On" />,
        cell: ({ row }) => (
            <span className="whitespace-nowrap">{formatDate(row.original.creation)}</span>
        ),
        size: 140,
        meta: {
            exportHeaderName: "Uploaded On",
            exportValue: (row: OutflowImportBatch) => formatDate(row.creation),
        },
    },
];
