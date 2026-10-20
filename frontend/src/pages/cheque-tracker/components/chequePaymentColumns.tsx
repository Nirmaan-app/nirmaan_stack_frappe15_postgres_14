import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronDown, ChevronRight, Info } from "lucide-react";

import { ChequePhotoLink } from "@/components/cheques/ChequePhotoLink";
import { ChequeStatusBadge } from "@/components/cheques/ChequeStatusBadge";
import { TruncatedText } from "@/components/common/TruncatedText";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import SITEURL from "@/constants/siteURL";
import { cn } from "@/lib/utils";
import { CHEQUE_PAYMENT_DATE_LABEL, CHEQUE_TYPE } from "@/types/NirmaanStack/Cheques";
import { chequeDateText } from "@/utils/cheques/chequeChip";
import { securedRecords } from "@/utils/cheques/chequeDeposit";
import type { ChequeRowAction } from "@/utils/cheques/chequeRowActions";
import { formatForReport, formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import {
    ChequeRow,
    chequeTypeLabel,
    daysSinceIssue,
    firstWithMore,
    hasNoPhoto,
    isStale,
    linesGap,
    payeeOf,
    paymentCount,
    statusChangeText,
} from "../config/chequePaymentTable.config";

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
    const days = daysSinceIssue(r);
    if (days === null) return "";
    return days < 0 ? "Post-dated" : `${days} ${days === 1 ? "day" : "days"}`;
};

export interface ChequeColumnActions {
    /** The buttons a row shows (`utils/cheques/chequeRowActions`). */
    actionsOf: (row: ChequeRow) => ChequeRowAction[];
    /** Opens the Cheque detail view. */
    onOpen: (cheque: string) => void;
    /** Opens Edit for one Cheque (#1418). */
    onEdit: (row: ChequeRow) => void;
    /** Opens the Cancel dialog (#1484). There is no Clear: only a bank-statement line clears a cheque (#1516). */
    onCancel: (row: ChequeRow) => void;
}

/**
 * The Cheque Tracker's All Cheques columns (spec #1407, #1483): one row per Cheque. The cheque number and View
 * open the detail view; Edit opens the Edit dialog (#1418); Cancel shows by type, status and role
 * (`chequeRowActions`). The chevron beside the number expands the row into its lines (#1417; the page passes
 * `renderExpandedRow` to DataTable).
 *
 * The facet columns' ids (`cheque_type`, `status`, `bank_label`, `vendor`, `project`, `record_name`) are
 * the endpoint's filter fields, and so are the date columns (`cheque_date`, the Cheque/Payment Date, and
 * `issue_date`; #1520). An Old-type cheque carries an "Old type" tag under its type (#1478).
 */
export const getChequePaymentColumns = ({ actionsOf, onOpen, onEdit, onCancel }: ChequeColumnActions): ColumnDef<ChequeRow>[] => [
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
        accessorKey: "cheque_type",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" className={WRAP_HEADER} />,
        cell: ({ row }) => (
            <div className="flex flex-col items-start gap-1">
                <span
                    className={cn(
                        "whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium",
                        row.original.cheque_type === CHEQUE_TYPE.SECURITY_DEPOSIT
                            ? "bg-purple-50 text-purple-800"
                            : "bg-blue-50 text-blue-800",
                    )}
                >
                    {chequeTypeLabel(row.original.cheque_type)}
                </span>
                {row.original.old_type ? (
                    <span
                        className="whitespace-nowrap rounded border border-dashed border-gray-400 bg-gray-50 px-1.5 text-[11px] font-medium text-gray-600"
                        title="Recorded before cheque types: it pays Expenses, has no lines or names a typed payee. Its bank line clears it, every line paid in full; it may be cancelled."
                    >
                        Old type
                    </span>
                ) : null}
            </div>
        ),
        size: 125,
        meta: {
            exportHeaderName: "Type",
            exportValue: (r: ChequeRow) => [chequeTypeLabel(r.cheque_type), r.old_type ? "Old type" : ""].filter(Boolean).join(" "),
        },
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
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title={CHEQUE_PAYMENT_DATE_LABEL} className={WRAP_HEADER} />
        ),
        cell: ({ row }) => <div className="whitespace-nowrap">{chequeDateText(row.original.cheque_date) || "--"}</div>,
        size: 125,
        meta: { exportHeaderName: CHEQUE_PAYMENT_DATE_LABEL, exportValue: (r: ChequeRow) => chequeDateText(r.cheque_date) },
    },
    {
        accessorKey: "issue_date",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Issue Date" className={WRAP_HEADER} />,
        cell: ({ row }) => <div className="whitespace-nowrap">{chequeDateText(row.original.issue_date) || "--"}</div>,
        size: 115,
        meta: { exportHeaderName: "Issue Date", exportValue: (r: ChequeRow) => chequeDateText(r.issue_date) },
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
        id: "days_since_issue",
        accessorFn: (r) => daysSinceIssue(r),
        header: "Days Since Issue",
        cell: ({ row }) => {
            const text = daysText(row.original);
            if (!text) return <span className="text-muted-foreground">--</span>;
            return (
                <div className="flex flex-col items-start gap-0.5">
                    <span className="whitespace-nowrap">{text}</span>
                    {isStale(row.original) && (
                        <span
                            className="rounded bg-red-100 px-1 text-[11px] font-medium text-red-700"
                            title="Issued more than 90 days ago: a cheque is good for 3 months."
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
            exportHeaderName: "Days Since Issue",
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
        cell: ({ row }) => <ChequeRowButtons row={row.original} actions={{ actionsOf, onOpen, onEdit, onCancel }} />,
        size: 110,
        enableSorting: false,
        enableHiding: false,
        meta: { excludeFromExport: true },
    },
];

const ACTION_LABEL: Record<ChequeRowAction, string> = { view: "View", edit: "Edit", cancel: "Cancel" };

/** A row's button text: a Security Deposit is "marked returned" rather than cancelled (#1486). */
const actionLabel = (action: ChequeRowAction, row: ChequeRow) =>
    action === "cancel" && row.cheque_type === CHEQUE_TYPE.SECURITY_DEPOSIT ? "Mark returned" : ACTION_LABEL[action];

/** The row's buttons, one under the other, in `chequeRowActions` order. */
const ChequeRowButtons = ({ row, actions }: { row: ChequeRow; actions: ChequeColumnActions }) => {
    const handler: Record<ChequeRowAction, () => void> = {
        view: () => actions.onOpen(row.name),
        edit: () => actions.onEdit(row),
        cancel: () => actions.onCancel(row),
    };
    return (
        <div className="flex flex-col items-stretch gap-1">
            {actions.actionsOf(row).map((action) => (
                <Button
                    key={action}
                    size="sm"
                    variant="outline"
                    className={cn(
                        "h-7 px-2",
                        action === "cancel" && "text-red-700 hover:text-red-800",
                    )}
                    onClick={handler[action]}
                    aria-label={`${actionLabel(action, row)} cheque ${row.cheque_no}`}
                >
                    {actionLabel(action, row)}
                </Button>
            ))}
        </div>
    );
};

/** The Payments cell of the Issued tab: how many payments the cheque pays. */
const paymentsColumn: ColumnDef<ChequeRow> = {
    id: "payments",
    accessorFn: (r) => paymentCount(r),
    header: "Payments",
    cell: ({ row }) => <div className="tabular-nums">{paymentCount(row.original)}</div>,
    size: 90,
    enableSorting: false,
    meta: { isNumeric: true, exportHeaderName: "Payments", exportValue: (r: ChequeRow) => String(paymentCount(r)) },
};

/** The Cheque Issued – Reconciliation Pending tab's columns, in order (#1483): one row per Issued Payment cheque. */
const ISSUED_COLUMN_IDS = [
    "cheque_no", "vendor", "amount", "cheque_date", "issue_date", "days_since_issue", "payments", "project",
    "record_name", "bank_label", "actions",
];

const columnId = (c: ColumnDef<ChequeRow>) => c.id ?? ("accessorKey" in c ? String(c.accessorKey) : "");

/** The Issued tab's columns: the All Cheques cells it needs, plus the payment count. */
export const getIssuedChequeColumns = (actions: ChequeColumnActions): ColumnDef<ChequeRow>[] => {
    const byId = new Map([...getChequePaymentColumns(actions), paymentsColumn].map((c) => [columnId(c), c]));
    return ISSUED_COLUMN_IDS.map((id) => byId.get(id)).filter((c): c is ColumnDef<ChequeRow> => !!c);
};

const projectNames = (r: ChequeRow) => [...new Set(r.lines.map((l) => l.project_name || l.project).filter(Boolean))];

const securesText = (r: ChequeRow) => securedRecords(r.lines).join(", ") || "Nothing named";

/** The Secures cell of the Security Deposits tab: the POs the deposit names, and their projects. */
const securesColumn: ColumnDef<ChequeRow> = {
    id: "secures",
    accessorFn: (r) => securesText(r),
    header: "Secures",
    cell: ({ row }) => {
        const records = securedRecords(row.original.lines);
        if (!records.length) {
            return (
                <div className="flex flex-col">
                    <span className="text-muted-foreground">Nothing named</span>
                    {row.original.description && (
                        <TruncatedText text={row.original.description} className="max-w-full text-[11px] text-muted-foreground" />
                    )}
                </div>
            );
        }
        return (
            <div className="flex min-w-0 flex-col">
                {records.map((r) => (
                    <TruncatedText key={r} text={r} className="max-w-full" />
                ))}
                <span className="text-[11px] text-muted-foreground">{projectNames(row.original).join(", ")}</span>
            </div>
        );
    },
    size: 230,
    enableSorting: false,
    meta: { exportHeaderName: "Secures", exportValue: (r: ChequeRow) => securesText(r) },
};

/** The Security Deposits tab's columns, in order (#1486): one row per deposit cheque, at any status. */
const DEPOSIT_COLUMN_IDS = [
    "cheque_no", "bank_label", "vendor", "amount", "cheque_date", "issue_date", "secures", "status", "actions",
];

/** The Security Deposits tab's columns: the All Cheques cells it needs, plus what the deposit secures. */
export const getDepositChequeColumns = (actions: ChequeColumnActions): ColumnDef<ChequeRow>[] => {
    const byId = new Map([...getChequePaymentColumns(actions), securesColumn].map((c) => [columnId(c), c]));
    return DEPOSIT_COLUMN_IDS.map((id) => byId.get(id)).filter((c): c is ColumnDef<ChequeRow> => !!c);
};
