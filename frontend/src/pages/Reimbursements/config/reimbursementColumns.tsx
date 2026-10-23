// src/pages/Reimbursements/config/reimbursementColumns.tsx
//
// Columns for the Reimbursement Raised By Me, Pending Approval, Approved, Paid and Rejected tables: one config, so every tab
// reads the same way. Pending Approval ends with Approve / Reject (`DecideButtons`).
//
// EVERY FIELD IS A COLUMN, because the default Export writes every column definition (hidden ones
// included) and the payers asked for "all the fields" (owner, 2026-10-22). The bank fields, description
// and claimant email are hidden on screen (`HIDDEN_BY_DEFAULT`) and still exported; the on-screen "Pay to"
// column is display only.

import type { ColumnDef } from "@tanstack/react-table";
import { FileText, Pencil, Trash2 } from "lucide-react";

import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import SITEURL from "@/constants/siteURL";
import { cn } from "@/lib/utils";
import type { Reimbursement } from "@/types/NirmaanStack/Reimbursement";
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
    TAB_MINE,
    TAB_PAID,
    TAB_PENDING,
    TAB_REJECTED,
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

/** What each tab shows on screen: the hidden-by-default fields, plus Approved By only on Approved and Paid, and
 *  Rejection Reason only on Rejected (Reimbursement Raised By Me shows both inside its Status cell). Every column
 *  still exports. */
export const columnVisibilityFor = (tab: ReimbursementTab) => ({
    ...HIDDEN_BY_DEFAULT,
    approved_by: tab === TAB_APPROVED || tab === TAB_PAID,
    rejection_reason: tab === TAB_REJECTED,
});


interface Args {
    tab: ReimbursementTab;
    userId: string;
    getUserName: (id?: string | null) => string;
    onOpen: (r: Reimbursement) => void;
    onEdit: (r: Reimbursement) => void;
    onDelete: (r: Reimbursement) => void;
    /** Pending Approval only: whether this person may decide a claim (the server's `can_decide`), and why not. */
    canDecide?: (name: string) => boolean;
    cannotDecideReason?: (name: string) => string | null | undefined;
    onDecide?: (decision: Decision, r: Reimbursement) => void;
}

export function getReimbursementColumns({
    tab, userId, getUserName, onOpen, onEdit, onDelete, canDecide, cannotDecideReason, onDecide,
}: Args): ColumnDef<Reimbursement>[] {
    const mine = tab === TAB_MINE;
    // Reimbursement Raised By Me and All span every status, so they show it (with the decision under it).
    const showStatus = mine || tab === TAB_ALL;
    const exported = (header: string, value: (r: Reimbursement) => string | number) => ({
        exportHeaderName: header, exportValue: value,
    });

    const columns: ColumnDef<Reimbursement>[] = [
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
    ];

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

    // Pending Approval: Approve / Reject as icons in the last column (narrow enough to stay on screen).
    if (tab === TAB_PENDING && canDecide && onDecide) {
        columns.push({
            id: "decide",
            size: 90,
            header: "",
            cell: ({ row }) => (
                <DecideButtons
                    canDecide={canDecide(row.original.name)}
                    reason={cannotDecideReason?.(row.original.name)}
                    onApprove={() => onDecide("approve", row.original)}
                    onReject={() => onDecide("reject", row.original)}
                />
            ),
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
