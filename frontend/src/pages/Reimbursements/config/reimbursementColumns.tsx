// src/pages/Reimbursements/config/reimbursementColumns.tsx
//
// Columns for every Reimbursements tab (ADR-0040 Amendment C): one config, so every tab reads the same way. As in
// Project Payments' queue, the tabs where people act on ticked rows start with a tick box and every tab with an action
// has an Actions column right after it: Approve / Reject (circled icons) on the three approval tabs, Mark as Paid on
// Payment need to be paid, Mark Reconciled on Reconciliation Pending, Edit / Delete on Raised By Me, and, for Admin,
// Delete on rejected claims in All. Every tab after the first approval shows the claim's Non-Project Expense (its ID).
//
// EVERY FIELD IS A COLUMN, because the default Export writes every column definition (hidden ones
// included) and the payers asked for "all the fields" (owner, 2026-10-22). The bank fields, description
// and claimant email are hidden on screen (`HIDDEN_BY_DEFAULT`) and still exported; the on-screen "Pay to"
// column is display only.

import type { ColumnDef } from "@tanstack/react-table";
import { CircleCheck, CircleX, FileText, IndianRupee, Pencil, Trash2 } from "lucide-react";

import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { facetMeta } from "@/components/data-table/facetConfig";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import SITEURL from "@/constants/siteURL";
import { cn } from "@/lib/utils";
import type { ClaimRow } from "@/types/NirmaanStack/Reimbursement";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee, { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { accountNumberCsvCell } from "@/utils/payees/payeeForm";

import type { Decision } from "../components/DecisionDialog";
import { PayToCell, RejectionReason, TitleCell } from "../components/HoverDetails";
import {
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

/** What each tab shows on screen: the hidden-by-default fields, plus Approved By on Paid. All and Reimbursement
 *  Raised By Me show the decision (and a rejection's reason) inside the Status cell. Every column still exports.
 *  Sized so every tab fits a laptop's table area (~1,140px) without scrolling sideways (browser check 2026-11-19):
 *  Approved By is off on the working tabs, where the next step, not who approved, matters. */
export const columnVisibilityFor = (tab: ReimbursementTab) => ({
    ...HIDDEN_BY_DEFAULT,
    approved_by: tab === TAB_PAID,
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
    /** Admin (the CEO included): a delete button on rejected claims in All (owner, 2026-11-19). */
    isAdmin?: boolean;
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
    tab, userId, getUserName, onOpen, onEdit, onDelete, isAdmin = false, selectable, canAct, cannotActReason, onDecide,
    onMarkPaid, onReconcile,
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
            size: 120,
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
                // Its id is the field the Claimant facet filters on (the table sends a column's id as the field).
                id: "claimant_name",
                accessorKey: "claimant_name",
                size: 125,
                header: ({ column }) => <DataTableColumnHeader column={column} title="Claimant" />,
                cell: ({ row }) => (
                    <div className="min-w-0">
                        <div className="truncate">{claimantName(row.original, getUserName)}</div>
                        {/* The role under the name on every tab; no Role column or filter (owner, 2026-11-19). */}
                        {row.original.claimant_role && (
                            <div className="truncate text-[11px] text-muted-foreground">{roleLabel(row.original.claimant_role)}</div>
                        )}
                    </div>
                ),
                meta: { ...exported("Claimant", (r) => claimantName(r, getUserName)), ...facetMeta({ field: "claimant_name", title: "Claimant" }) },
            },
            {
                accessorKey: "claimant_role",
                size: 105,
                header: "Role",
                cell: ({ row }) => <span className="block truncate text-xs">{roleLabel(row.original.claimant_role) || "--"}</span>,
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
            // Its id is the claim's type, so the Type facet (Travel / Food / Others) sits on the Title header without a
            // column of its own (the table sends a column's id as the filtered field). Not sortable: it would sort by type.
            id: "reimbursement_type",
            accessorFn: (r) => r.title,
            size: 140,
            enableSorting: false,
            header: "Title",
            cell: ({ row }) => <TitleCell claim={row.original} />,
            meta: { ...exported("Title", (r) => r.title), ...facetMeta({ field: "reimbursement_type", title: "Type" }) },
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
            // Whole rupees without ".00" (₹18,000); paise only when the claim has them (₹1,999.50). Export keeps the number.
            cell: ({ row }) => {
                const amount = Number(row.original.amount) || 0;
                return (
                    <span className="tabular-nums font-medium">
                        {Number.isInteger(amount) ? formatToRoundedIndianRupee(amount) : formatToIndianRupee(amount)}
                    </span>
                );
            },
            meta: exported("Amount", (r) => r.amount),
        },
    );

    columns.push(
        {
            id: "pay_to",
            size: 140,
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
            size: 120,
            header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
            // A rejection's reason opens from an icon beside the status, so Raised By Me needs no Rejection Reason column
            // of its own (it still exports). No approver name under it (owner, 2026-11-19): Approved By is its own column on Paid.
            cell: ({ row }) => {
                const r = row.original;
                return (
                    <div className="flex min-w-0 items-center gap-1.5">
                        <span className={cn("px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap", STATUS_BADGE[r.status])}>
                            {r.status}
                        </span>
                        {/* The reason behind a message icon, read on hover or click (owner, 2026-11-19). */}
                        {r.status === REJECTED && r.rejection_reason && <RejectionReason reason={r.rejection_reason} />}
                    </div>
                );
            },
            meta: { ...exported("Status", (r) => r.status), ...facetMeta({ field: "status", title: "Status" }) },
        });
    }

    if (EXPENSE_TABS.includes(tab)) {
        columns.push(
            {
                accessorKey: "expense",
                size: 110,
                // "Expense" on screen (one line); the export keeps the full name.
                header: "Expense",
                enableSorting: false,
                // The claim's expense ID (ADR-0040); its status is the tab itself, and is in the export and the claim
                // view (owner, 2026-11-19: no status under the ID). "--" before the first approval.
                cell: ({ row }) => row.original.expense ? (
                    <button type="button" onClick={() => onOpen(row.original)}
                        className="block max-w-full truncate text-left font-mono text-xs text-primary hover:underline">
                        {row.original.expense}
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
        size: 112,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Raised On" />,
        cell: ({ row }) => formatDate(row.original.creation),
        meta: exported("Raised On", (r) => formatDate(r.creation)),
    });

    columns.push(
        {
            accessorKey: "approved_by",
            size: 110,
            header: ({ column }) => <DataTableColumnHeader column={column} title="Approved By" />,
            cell: ({ row }) => row.original.approved_by ? getUserName(row.original.approved_by) : <span className="text-muted-foreground">--</span>,
            meta: { ...exported("Approved By", (r) => (r.approved_by ? getUserName(r.approved_by) : "")), ...facetMeta({ field: "approved_by", title: "Approved By" }) },
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
        size: 72,
        header: "Receipts",
        cell: ({ row }) => row.original.attachment ? (
            <a href={`${SITEURL}${row.original.attachment}`} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline">
                <FileText className="w-4 h-4" /> PDF
            </a>
        ) : <span className="text-muted-foreground">--</span>,
        meta: exported("Receipts PDF", (r) => (r.attachment ? `${SITEURL}${r.attachment}` : "")),
    });

    // Actions, SECOND (right after the tick box), as Project Payments' queue has it: the hand never travels to the
    // right edge, and the buttons look the same as there (`ProjectPayments/config/approvalColumns.tsx`).
    const isApprovalTab = tab === TAB_PENDING || tab === TAB_L1 || tab === TAB_CEO;
    // Admin deletes anyone's rejected claim from All (owner, 2026-11-19); the claimant deletes from Raised By Me.
    const adminDeletes = isAdmin && tab === TAB_ALL;
    const actionsWidth = isApprovalTab ? 72 : tab === TAB_APPROVED ? 148 : tab === TAB_RECONCILIATION ? 156 : mine ? 72
        : adminDeletes ? 64 : 0;
    if (actionsWidth && (mine || adminDeletes || (canAct && (isApprovalTab ? onDecide : tab === TAB_APPROVED ? onMarkPaid : onReconcile)))) {
        const none = <span className="text-muted-foreground">--</span>;
        columns.splice(selectable ? 1 : 0, 0, {
            id: "actions",
            header: "Actions",
            size: actionsWidth,
            enableSorting: false,
            enableHiding: false,
            cell: ({ row }) => {
                const r = row.original;
                if (mine || adminDeletes) {
                    const isClaimant = r.owner === userId;
                    const edit = !editProblem(r.status, isClaimant);
                    const del = !deleteProblem(r.status, isClaimant, isAdmin);
                    if (!edit && !del) return none;
                    return (
                        <div className="flex items-center gap-1">
                            {edit && (
                                <Button variant="ghost" size="icon" aria-label={`Edit ${r.name}`} title="Edit"
                                    className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => onEdit(r)}>
                                    <Pencil className="h-4 w-4" />
                                </Button>
                            )}
                            {del && (
                                <Button variant="ghost" size="icon" aria-label={`Delete ${r.name}`} title="Delete"
                                    className="h-7 w-7 text-destructive hover:text-destructive/80" onClick={() => onDelete(r)}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                    );
                }
                const allowed = canAct?.(r) ?? false;
                if (isApprovalTab && onDecide) {
                    const why = allowed ? undefined : (cannotActReason?.(r) ?? "You can't decide this claim.");
                    // A disabled button fires no pointer events, so the span carries the reason on hover.
                    return (
                        <span className="flex items-center gap-1" title={why}>
                            <Button variant="ghost" size="icon" aria-label={`Approve ${r.name}`} disabled={!allowed}
                                className="h-7 w-7 text-green-600 hover:text-green-700" onClick={() => onDecide("approve", r)}>
                                <CircleCheck className="h-5 w-5" />
                            </Button>
                            <Button variant="ghost" size="icon" aria-label={`Reject ${r.name}`} disabled={!allowed}
                                className="h-7 w-7 text-destructive hover:text-destructive/80" onClick={() => onDecide("reject", r)}>
                                <CircleX className="h-5 w-5" />
                            </Button>
                        </span>
                    );
                }
                if (!allowed) return none;
                if (tab === TAB_APPROVED && onMarkPaid) {
                    return (
                        <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700" onClick={() => onMarkPaid(r)}>
                            <IndianRupee className="mr-1 h-3.5 w-3.5" />
                            Mark as Paid
                        </Button>
                    );
                }
                if (tab === TAB_RECONCILIATION && onReconcile) {
                    return (
                        <Button size="sm" variant="outline" className="h-7 border-primary text-primary" onClick={() => onReconcile(r)}>
                            Mark Reconciled
                        </Button>
                    );
                }
                return none;
            },
            meta: { excludeFromExport: true },
        });
    }

    return columns;
}
