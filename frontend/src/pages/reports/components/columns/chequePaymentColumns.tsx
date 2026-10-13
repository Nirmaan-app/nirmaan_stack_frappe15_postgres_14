import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronDown, ChevronRight, Info } from "lucide-react";

import { ChequePhotoLink } from "@/components/cheques/ChequePhotoLink";
import { ChequeStatusBadge } from "@/components/cheques/ChequeStatusBadge";
import { TruncatedText } from "@/components/common/TruncatedText";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import SITEURL from "@/constants/siteURL";
import { chequeDateText } from "@/utils/cheques/chequeChip";
import { formatForReport, formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import {
    ChequeRow,
    daysOutstanding,
    firstWithMore,
    hasNoPhoto,
    isStale,
    linesGap,
    payeeOf,
    statusChangeText,
} from "../../config/chequePaymentTable.config";

/** Lets a sortable header's title break onto a second line, so columns stay narrow. */
const WRAP_HEADER = "[&_button]:whitespace-normal text-left";

const projectsOf = (r: ChequeRow) => r.lines.map((l) => l.project_name || l.project);
const recordsOf = (r: ChequeRow) => r.lines.map((l) => l.record_name);

const firstWithMoreText = (values: (string | null | undefined)[]) => {
    const { first, more } = firstWithMore(values);
    return first ? `${first}${more ? ` +${more}` : ""}` : "";
};

/** "PO-001 +2": the first line's value, and a muted count of the others. */
const FirstWithMore = ({ values }: { values: (string | null | undefined)[] }) => {
    const { first, more } = firstWithMore(values);
    if (!first) return <span className="text-muted-foreground">--</span>;
    return (
        <div className="flex min-w-0 items-center gap-1">
            <TruncatedText text={first} className="max-w-full" />
            {more > 0 && (
                <span className="shrink-0 rounded bg-muted px-1 text-[11px] text-muted-foreground">+{more}</span>
            )}
        </div>
    );
};

/** What the ⚠ beside the amount says. */
const gapText = (gap: number) =>
    `The lines are ${formatToRoundedIndianRupee(Math.abs(gap))} ${gap > 0 ? "short of" : "more than"} the cheque amount.`;

const daysText = (r: ChequeRow) => {
    const days = daysOutstanding(r);
    if (days === null) return "";
    return days < 0 ? "Post-dated" : `${days} ${days === 1 ? "day" : "days"}`;
};

interface ChequeColumnActions {
    /** Opens the Cheque detail view. */
    onOpen: (cheque: string) => void;
    /** Opens Change status for one Cheque; absent for a user who may not change status. */
    onChangeStatus?: (row: ChequeRow) => void;
    /** Opens Edit for one Cheque (#1418), shown on the rows `canEdit` allows. */
    onEdit?: (row: ChequeRow) => void;
    canEdit?: (row: ChequeRow) => boolean;
}

/**
 * The Cheque Payments report's columns (spec #1407): one row per Cheque. The cheque number and
 * "Details" open the detail view; "Status" opens Change status (#1412); "Edit" opens the Edit dialog
 * (#1418). The chevron beside the number expands the row into its lines (#1417; the page passes
 * `renderExpandedRow` to DataTable).
 *
 * The facet columns' ids (`status`, `bank_label`, `vendor`, `project`, `record_name`) are the
 * endpoint's filter fields.
 */
export const getChequePaymentColumns = ({ onOpen, onChangeStatus, onEdit, canEdit }: ChequeColumnActions): ColumnDef<ChequeRow>[] => [
    {
        accessorKey: "cheque_no",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cheque No" className={WRAP_HEADER} />,
        cell: ({ row }) => (
            <div className="flex items-center gap-1">
                {row.original.lines.length > 0 ? (
                    <button
                        type="button"
                        onClick={() => row.toggleExpanded()}
                        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"
                        aria-label={row.getIsExpanded() ? "Hide the lines" : "Show the lines"}
                        aria-expanded={row.getIsExpanded()}
                    >
                        {row.getIsExpanded() ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                ) : (
                    <span className="w-5 shrink-0" />
                )}
                <button
                    type="button"
                    onClick={() => onOpen(row.original.name)}
                    className="font-medium whitespace-nowrap text-blue-600 hover:underline"
                    title="Open the cheque"
                >
                    {row.original.cheque_no}
                </button>
            </div>
        ),
        size: 125,
        meta: { exportHeaderName: "Cheque No", exportValue: (r: ChequeRow) => r.cheque_no },
    },
    {
        accessorKey: "bank_label",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Bank" className={WRAP_HEADER} />,
        cell: ({ row }) => <TruncatedText text={row.original.bank_label} className="max-w-full" />,
        size: 120,
        meta: { exportHeaderName: "Bank", exportValue: (r: ChequeRow) => r.bank_label },
    },
    {
        accessorKey: "cheque_date",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cheque Date" className={WRAP_HEADER} />,
        cell: ({ row }) => <div className="whitespace-nowrap">{chequeDateText(row.original.cheque_date) || "--"}</div>,
        size: 115,
        meta: { exportHeaderName: "Cheque Date", exportValue: (r: ChequeRow) => chequeDateText(r.cheque_date) },
    },
    {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" className={WRAP_HEADER} />,
        cell: ({ row }) => {
            const changed = statusChangeText(row.original);
            return (
                <div className="flex flex-col items-start gap-0.5">
                    <ChequeStatusBadge status={row.original.status} />
                    {changed && <span className="text-[11px] leading-tight text-muted-foreground">{changed}</span>}
                </div>
            );
        },
        size: 150,
        meta: {
            exportHeaderName: "Status",
            exportValue: (r: ChequeRow) => [r.status, statusChangeText(r)].filter(Boolean).join(" "),
        },
    },
    {
        accessorKey: "amount",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" className={WRAP_HEADER} />,
        cell: ({ row }) => {
            const gap = linesGap(row.original);
            return (
                <div className="flex items-center gap-1 whitespace-nowrap font-medium">
                    {formatToRoundedIndianRupee(row.original.amount)}
                    {gap !== null && (
                        <span title={gapText(gap)} aria-label={gapText(gap)}>
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        </span>
                    )}
                </div>
            );
        },
        size: 120,
        meta: { isNumeric: true, exportHeaderName: "Amount", exportValue: (r: ChequeRow) => formatForReport(r.amount) },
    },
    {
        id: "record_name",
        accessorFn: (r) => firstWithMoreText(recordsOf(r)),
        header: "PO / WO",
        cell: ({ row }) => <FirstWithMore values={recordsOf(row.original)} />,
        size: 150,
        enableSorting: false,
        meta: { exportHeaderName: "PO / WO", exportValue: (r: ChequeRow) => firstWithMoreText(recordsOf(r)) },
    },
    {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => <TruncatedText text={row.original.description} className="max-w-full" />,
        size: 180,
        enableSorting: false,
        meta: { exportHeaderName: "Description", exportValue: (r: ChequeRow) => r.description || "" },
    },
    {
        id: "project",
        accessorFn: (r) => firstWithMoreText(projectsOf(r)),
        header: "Project",
        cell: ({ row }) => <FirstWithMore values={projectsOf(row.original)} />,
        size: 160,
        enableSorting: false,
        meta: { exportHeaderName: "Project", exportValue: (r: ChequeRow) => firstWithMoreText(projectsOf(r)) },
    },
    {
        id: "vendor",
        accessorFn: (r) => payeeOf(r).label,
        header: "Vendor / Payee",
        cell: ({ row }) => {
            const payee = payeeOf(row.original);
            if (!payee.vendor) return <TruncatedText text={payee.label} className="max-w-full" />;
            return (
                <div className="flex min-w-0 items-center gap-1">
                    <TruncatedText text={payee.label} className="max-w-full" />
                    <Link to={`/vendors/${payee.vendor}`} title="Open Vendor" className="shrink-0">
                        <Info className="h-3 w-3 text-blue-500" />
                    </Link>
                </div>
            );
        },
        size: 170,
        enableSorting: false,
        meta: { exportHeaderName: "Vendor / Payee", exportValue: (r: ChequeRow) => payeeOf(r).label },
    },
    {
        id: "days_outstanding",
        accessorFn: (r) => daysOutstanding(r),
        header: "Days Outstanding",
        cell: ({ row }) => {
            const text = daysText(row.original);
            if (!text) return <span className="text-muted-foreground">--</span>;
            return (
                <div className="flex flex-col items-start gap-0.5">
                    <span className="whitespace-nowrap">{text}</span>
                    {isStale(row.original) && (
                        <span
                            className="rounded bg-red-100 px-1 text-[11px] font-medium text-red-700"
                            title="Issued more than 90 days ago: a cheque is good for 3 months from its date."
                        >
                            Stale
                        </span>
                    )}
                </div>
            );
        },
        size: 105,
        enableSorting: false,
        meta: {
            exportHeaderName: "Days Outstanding",
            exportValue: (r: ChequeRow) => [daysText(r), isStale(r) ? "Stale" : ""].filter(Boolean).join(" "),
        },
    },
    {
        accessorKey: "owner",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Created By" className={WRAP_HEADER} />,
        cell: ({ row }) => (
            <div className="flex flex-col">
                <TruncatedText text={row.original.owner_name || row.original.owner} className="max-w-full" />
                <span className="text-[11px] text-muted-foreground">{chequeDateText(row.original.creation)}</span>
            </div>
        ),
        size: 135,
        enableSorting: false,
        meta: {
            exportHeaderName: "Created By",
            exportValue: (r: ChequeRow) => `${r.owner_name || r.owner} ${chequeDateText(r.creation)}`.trim(),
        },
    },
    {
        accessorKey: "attachment",
        header: "Photo",
        cell: ({ row }) =>
            hasNoPhoto(row.original) ? (
                <span className="whitespace-nowrap rounded bg-amber-100 px-1 text-[11px] font-medium text-amber-800">
                    No photo
                </span>
            ) : (
                <ChequePhotoLink url={row.original.attachment} chequeNo={row.original.cheque_no} />
            ),
        size: 80,
        enableSorting: false,
        meta: {
            exportHeaderName: "Photo",
            exportValue: (r: ChequeRow) => (r.attachment ? `${SITEURL}${r.attachment}` : "No photo"),
        },
    },
    {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
            <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onOpen(row.original.name)}>
                    Details
                </Button>
                {onEdit && canEdit?.(row.original) && (
                    <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => onEdit(row.original)}>
                        Edit
                    </Button>
                )}
                {onChangeStatus && (
                    <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => onChangeStatus(row.original)}>
                        Status
                    </Button>
                )}
            </div>
        ),
        size: 190,
        enableSorting: false,
        enableHiding: false,
        meta: { excludeFromExport: true },
    },
];
