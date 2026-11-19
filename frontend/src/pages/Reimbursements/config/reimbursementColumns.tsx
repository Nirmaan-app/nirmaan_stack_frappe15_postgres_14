// src/pages/Reimbursements/config/reimbursementColumns.tsx
//
// Columns for every Reimbursements tab (ADR-0040 Amendment C): one config, so every tab reads the same way. The three
// approval tabs end with Approve / Reject (`DecideButtons`), Payment need to be paid with Mark as Paid, Reconciliation
// Pending with Mark Reconciled; the tabs where people act on ticked rows start with a tick box. Every tab after the first
// approval shows the claim's Non-Project Expense (its ID and its own status).
//
// EVERY FIELD IS A COLUMN, because the default Export writes every column definition (hidden ones
// included) and the payers asked for "all the fields" (owner, 2026-10-22). The bank fields, description
// and claimant email are hidden on screen (`HIDDEN_BY_DEFAULT`) and still exported; the on-screen "Pay to"
// column is display only.

import type { ColumnDef } from "@tanstack/react-table";
import { BadgeCheck, FileText, IndianRupee, Pencil, Trash2 } from "lucide-react";

import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import SITEURL from "@/constants/siteURL";
import { cn } from "@/lib/utils";
import type { ClaimRow } from "@/types/NirmaanStack/Reimbursement";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { accountNumberCsvCell } from "@/utils/payees/payeeForm";

import { DecideButtons } from "../components/DecideButtons";
import type { Decision } from "../components/DecisionDialog";
import { PayToCell, TitleCell } from "../components/HoverDetails";
import {
    APPROVED,
    PAID,
    REJECTED,
    TAB_ALL,
    TAB_APPROVED,
    TAB_CEO,
    TAB_L1,
    TAB_MINE,
    TAB_PAID,
    TAB_PENDING,
    TAB_RECONCILIATION,
    claimantName,
    deleteProblem,
    editProblem,
    roleLabel,
    type ReimbursementTab,
} from "@/utils/reimbursements/rules";

export const STATUS_BADGE: Record<string, string> = {
    "Pending Approval": "bg-amber-100 text-amber-800",
    Approved: "bg-emerald-100 text-emerald-800",
    Rejected: "bg-red-100 text-red-800",
    Paid: "bg-sky-100 text-sky-800",
};

/** Exported, never shown: the Pay to column already shows them in one cell. */
export const HIDDEN_BY_DEFAULT = {
    description: false,
    claimant_email: false,
    claimant_role: false,
    pay_to_account_name: false,
    pay_to_account_number: false,
    pay_to_ifsc: false,
    pay_to_bank_name: false,
    pay_to_bank_branch: false,
};

/** The expense's own status, coloured as the claim's are. */
export const EXPENSE_STATUS_BADGE: Record<string, string> = {
    Requested: "bg-amber-100 text-amber-800",
    "CEO Pending": "bg-orange-100 text-orange-800",
    Approved: "bg-emerald-100 text-emerald-800",
    "Reconciliation Pending": "bg-violet-100 text-violet-800",
    Paid: "bg-sky-100 text-sky-800",
    Rejected: "bg-red-100 text-red-800",
};

/** The tabs after the first approval, which show the claim's expense. */
const EXPENSE_TABS: readonly ReimbursementTab[] = [TAB_L1, TAB_CEO, TAB_APPROVED, TAB_RECONCILIATION, TAB_PAID, TAB_ALL, TAB_MINE];

/** What each tab shows on screen: the hidden-by-default fields, plus Approved By on the tabs after the first
 *  approval. All and Reimbursement Raised By Me show the decision (and a rejection's reason) inside the Status cell.
 *  Every column still exports. */
export const columnVisibilityFor = (tab: ReimbursementTab) => ({
    ...HIDDEN_BY_DEFAULT,
    approved_by: [TAB_L1, TAB_CEO, TAB_APPROVED, TAB_RECONCILIATION, TAB_PAID].includes(tab),
    rejection_reason: false,
    expense_status: false,
});


interface Args {
    tab: ReimbursementTab;
    userId: string;
    getUserName: (id?: string | null) => string;
    onOpen: (r: ClaimRow) => void;
    onEdit: (r: ClaimRow) => void;
    onDelete: (r: ClaimRow) => void;
    /** The tab has tick boxes (this person acts on ticked rows here). */
    selectable?: boolean;
    /** Whether this person may act on a row of this tab, and why not (the approval tabs show it on hover). */
    canAct?: (r: ClaimRow) => boolean;
    cannotActReason?: (r: ClaimRow) => string | null | undefined;
    /** The approval tabs. */
    onDecide?: (decision: Decision, r: ClaimRow) => void;
    /** Payment need to be paid / Reconciliation Pending. */
    onMarkPaid?: (r: ClaimRow) => void;
    onReconcile?: (r: ClaimRow) => void;
}

export function getReimbursementColumns({
    tab, userId, getUserName, onOpen, onEdit, onDelete, selectable, canAct, cannotActReason, onDecide, onMarkPaid,
    onReconcile,
}: Args): ColumnDef<ClaimRow>[] {
    const mine = tab === TAB_MINE;
    // Reimbursement Raised By Me and All span every status, so they show it (with the decision under it).
    const showStatus = mine || tab === TAB_ALL;
    const exported = (header: string, value: (r: ClaimRow) => string | number) => ({
        exportHeaderName: header, exportValue: value,
    });

    const columns: ColumnDef<ClaimRow>[] = [];
    if (selectable) {
        columns.push({
            id: "select",
            size: 36,
            header: ({ table }) => (
                <Checkbox
                    checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
                    onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                    aria-label="Select every claim you can on this page"
                />
            ),
            cell: ({ row }) => (
                <Checkbox
                    checked={row.getIsSelected()}
                    disabled={!row.getCanSelect()}
                    onCheckedChange={(value) => row.toggleSelected(!!value)}
                    aria-label={`Select ${row.original.name}`}
                    title={row.getCanSelect() ? undefined : (cannotActReason?.(row.original) ?? "You can't act on this claim.")}
                />
            ),
            enableSorting: false,
            enableHiding: false,
            meta: { excludeFromExport: true },
        });
    }
    columns.push(
        {
            accessorKey: "name",
            size: 135,
            header: ({ column }) => <DataTableColumnHeader column={column} title="ID" />,
            cell: ({ row }) => (
                <button type="button" onClick={() => onOpen(row.original)}
                    className="whitespace-nowrap font-medium text-left text-primary hover:underline">
                    {row.original.name}
                </button>
            ),
            meta: exported("ID", (r) => r.name),
        },
    );

    if (!mine) {
        columns.push(
            {
                accessorKey: "owner",
                size: 140,
                header: ({ column }) => <DataTableColumnHeader column={column} title="Claimant" />,
                cell: ({ row }) => (
                    <div>
                        <div>{claimantName(row.original, getUserName)}</div>
                        {row.original.claimant_role && (
                            <div className="text-[11px] text-muted-foreground">{roleLabel(row.original.claimant_role)}</div>
                        )}
                    </div>
                ),
                meta: exported("Claimant", (r) => claimantName(r, getUserName)),
            },
            {
                accessorKey: "claimant_role",
                header: "Claimant Role",
                meta: exported("Claimant Role", (r) => roleLabel(r.claimant_role)),
            },
            {
                id: "claimant_email",
                accessorKey: "owner",
                header: "Claimant Email",
                cell: ({ row }) => row.original.owner,
                meta: exported("Claimant Email", (r) => r.owner),
            },
        );
    }

    columns.push(
        {
            accessorKey: "title",
            size: 165,
            header: ({ column }) => <DataTableColumnHeader column={column} title="Title" />,
            cell: ({ row }) => <TitleCell claim={row.original} />,
            meta: exported("Title", (r) => r.title),
        },
        {
            accessorKey: "description",
            header: "Description",
            meta: exported("Description", (r) => r.description ?? ""),
        },
        {
            accessorKey: "amount",
            size: 100,
            header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" />,
            cell: ({ row }) => <span className="tabular-nums font-medium">{formatToIndianRupee(row.original.amount)}</span>,
            meta: exported("Amount", (r) => r.amount),
        },
    );

    columns.push(
        {
            id: "pay_to",
            size: 165,
            header: "Pay to",
            // The last four digits in the cell; the whole account (number, IFSC, bank, branch) on hover.
            cell: ({ row }) => <PayToCell claim={row.original} />,
            meta: { excludeFromExport: true },
        },
        { accessorKey: "pay_to_account_name", header: "Account Holder", meta: exported("Account Holder", (r) => r.pay_to_account_name ?? "") },
        // As text, so a spreadsheet keeps the leading zeros and every digit (the payments export's own cell).
        { accessorKey: "pay_to_account_number", header: "Account Number", meta: exported("Account Number", (r) => accountNumberCsvCell(r.pay_to_account_number)) },
        { accessorKey: "pay_to_ifsc", header: "IFSC", meta: exported("IFSC", (r) => r.pay_to_ifsc ?? "") },
        { accessorKey: "pay_to_bank_name", header: "Bank", meta: exported("Bank", (r) => r.pay_to_bank_name ?? "") },
        { accessorKey: "pay_to_bank_branch", header: "Branch", meta: exported("Branch", (r) => r.pay_to_bank_branch ?? "") },
    );

    if (showStatus) {
        columns.push({
            accessorKey: "status",
            size: 165,
            header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
            // The decision sits under the status, so Reimbursement Raised By Me needs no Approved By / Rejection
            // Reason columns of its own (both still export).
            cell: ({ row }) => {
                const r = row.original;
                return (
                    <div className="min-w-0">
                        <span className={cn("px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap", STATUS_BADGE[r.status])}>
                            {r.status}
                        </span>
                        {(r.status === APPROVED || r.status === PAID) && r.approved_by && (
                            <div className="mt-1 truncate text-[11px] text-muted-foreground">by {getUserName(r.approved_by)}</div>
                        )}
                        {r.status === REJECTED && r.rejection_reason && (
                            <div className="mt-1 line-clamp-2 text-[11px] text-red-700" title={r.rejection_reason}>{r.rejection_reason}</div>
                        )}
                    </div>
                );
            },
            meta: exported("Status", (r) => r.status),
        });
    }

    if (EXPENSE_TABS.includes(tab)) {
        columns.push(
            {
                accessorKey: "expense",
                size: 165,
                header: "Non-Project Expense",
                enableSorting: false,
                // The claim's expense (ADR-0040) and the expense's own status; "--" before the first approval.
                cell: ({ row }) => row.original.expense ? (
                    <button type="button" onClick={() => onOpen(row.original)} className="min-w-0 text-left">
                        <span className="block truncate font-mono text-xs text-primary hover:underline">{row.original.expense}</span>
                        {row.original.expense_status && (
                            <span className={cn("mt-0.5 inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium",
                                EXPENSE_STATUS_BADGE[row.original.expense_status] ?? "bg-muted text-muted-foreground")}>
                                {row.original.expense_status}
                            </span>
                        )}
                    </button>
                ) : <span className="text-muted-foreground">--</span>,
                meta: exported("Non-Project Expense", (r) => r.expense ?? ""),
            },
            {
                accessorKey: "expense_status",
                header: "Expense Status",
                enableSorting: false,
                meta: exported("Expense Status", (r) => r.expense_status ?? ""),
            },
        );
    }

    columns.push({
        accessorKey: "creation",
        size: 125,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Raised On" />,
        cell: ({ row }) => formatDate(row.original.creation),
        meta: exported("Raised On", (r) => formatDate(r.creation)),
    });

    columns.push(
        {
            accessorKey: "approved_by",
            size: 120,
            header: ({ column }) => <DataTableColumnHeader column={column} title="Approved By" />,
            cell: ({ row }) => row.original.approved_by ? getUserName(row.original.approved_by) : <span className="text-muted-foreground">--</span>,
            meta: exported("Approved By", (r) => (r.approved_by ? getUserName(r.approved_by) : "")),
        },
        {
            accessorKey: "rejection_reason",
            size: 150,
            header: "Rejection Reason",
            cell: ({ row }) => row.original.status === REJECTED
                ? <div className="line-clamp-2 text-red-700" title={row.original.rejection_reason ?? ""}>{row.original.rejection_reason}</div>
                : <span className="text-muted-foreground">--</span>,
            meta: exported("Rejection Reason", (r) => r.rejection_reason ?? ""),
        },
    );

    columns.push({
        accessorKey: "attachment",
        size: 85,
        header: "Receipts",
        cell: ({ row }) => row.original.attachment ? (
            <a href={`${SITEURL}${row.original.attachment}`} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline">
                <FileText className="w-4 h-4" /> PDF
            </a>
        ) : <span className="text-muted-foreground">--</span>,
        meta: exported("Receipts PDF", (r) => (r.attachment ? `${SITEURL}${r.attachment}` : "")),
    });

    // The approval tabs: Approve / Reject as icons in the last column (narrow enough to stay on screen).
    if ((tab === TAB_PENDING || tab === TAB_L1 || tab === TAB_CEO) && canAct && onDecide) {
        columns.push({
            id: "decide",
            size: 90,
            header: "",
            cell: ({ row }) => (
                <DecideButtons
                    canDecide={canAct(row.original)}
                    reason={cannotActReason?.(row.original)}
                    onApprove={() => onDecide("approve", row.original)}
                    onReject={() => onDecide("reject", row.original)}
                />
            ),
            meta: { excludeFromExport: true },
        });
    }

    if (tab === TAB_APPROVED && canAct && onMarkPaid) {
        columns.push({
            id: "mark_paid",
            size: 120,
            header: "",
            cell: ({ row }) => canAct(row.original) ? (
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onMarkPaid(row.original)}>
                    <IndianRupee className="mr-1 h-3.5 w-3.5" /> Mark as Paid
                </Button>
            ) : null,
            meta: { excludeFromExport: true },
        });
    }

    if (tab === TAB_RECONCILIATION && canAct && onReconcile) {
        columns.push({
            id: "reconcile",
            size: 140,
            header: "",
            cell: ({ row }) => canAct(row.original) ? (
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onReconcile(row.original)}>
                    <BadgeCheck className="mr-1 h-3.5 w-3.5" /> Mark Reconciled
                </Button>
            ) : null,
            meta: { excludeFromExport: true },
        });
    }

    if (mine) {
        columns.push({
            id: "actions",
            size: 80,
            header: "",
            cell: ({ row }) => {
                const r = row.original;
                const isClaimant = r.owner === userId;
                return (
                    <div className="flex gap-1 justify-end">
                        {!editProblem(r.status, isClaimant) && (
                            <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => onEdit(r)} aria-label={`Edit ${r.name}`}>
                                <Pencil className="w-3.5 h-3.5" />
                            </Button>
                        )}
                        {!deleteProblem(r.status, isClaimant) && (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-red-600" onClick={() => onDelete(r)} aria-label={`Delete ${r.name}`}>
                                <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                        )}
                    </div>
                );
            },
            meta: { excludeFromExport: true },
        });
    }

    return columns;
}
