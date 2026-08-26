// src/pages/ExpenseRequests/config/expenseRequestsColumns.tsx
//
// Columns for the Expense Request table. Shaped like the two ledger tables so all three
// tabs of /expense read as one module.
//
// Tab-driven visibility:
//   Status                   -> only on "All" (the others are single-status by definition)
//   Reviewed By              -> hidden on "Pending Approval" (nothing to show yet)
//   Actions                  -> only on "Pending Approval", and only for a reviewer
//   Description              -> hidden on "Pending Approval". A type WITH a format hides the
//                               description field entirely (its fields are the description),
//                               so the column read "--" on every such row -- a column of
//                               dashes costs width and tells the reviewer nothing.

import { ColumnDef } from "@tanstack/react-table";
import { Check, Pencil, X } from "lucide-react";

import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { facetMeta } from "@/components/data-table/facetConfig";
import { Button } from "@/components/ui/button";
import {
    Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import type { ExpenseRequest, ExpenseRequestStatus } from "@/types/NirmaanStack/ExpenseRequest";

const STATUS_BADGE: Record<ExpenseRequestStatus, string> = {
    "Pending Approval": "bg-amber-100 text-amber-800",
    Approved: "bg-emerald-100 text-emerald-800",
    Rejected: "bg-red-100 text-red-800",
    Paid: "bg-sky-100 text-sky-800",
};

interface Args {
    statusTab: string;
    getUserName: (id: string | undefined) => string;
    /** Expense Type -> its category. The CATEGORY LIVES ON THE TYPE, not on the request, and
     *  the table reads the request doctype directly — so it has to be resolved here. */
    getCategory: (expenseType: string | undefined) => string;
    /** Server-computed per row. NEVER re-derive who may review. */
    canReview: (name: string) => boolean;
    /** Server-computed per row, and DISJOINT from `canReview` by design: a reviewer who could
     *  also edit could rewrite an amount and then approve it. Never re-derive either. */
    canEdit: (name: string) => boolean;
    onApprove: (r: ExpenseRequest) => void;
    onReject: (r: ExpenseRequest) => void;
    onEdit: (r: ExpenseRequest) => void;
}

export const getExpenseRequestColumns = ({
    statusTab, getUserName, getCategory, canReview, canEdit, onApprove, onReject, onEdit,
}: Args): ColumnDef<ExpenseRequest>[] => {
    const showStatus = statusTab === "All";
    const showReview = statusTab !== "Pending Approval";
    const showActions = statusTab === "Pending Approval";
    const showComment = statusTab !== "Pending Approval";

    const columns: ColumnDef<ExpenseRequest>[] = [
        {
            accessorKey: "name",
            size: 150,
            header: ({ column }) => <DataTableColumnHeader column={column} title="Request ID" />,
            cell: ({ row }) => (
                <div>
                    <div className="font-medium">{row.original.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                        {getCategory(row.original.type)}
                    </div>
                </div>
            ),
            meta: { exportHeaderName: "Request ID", exportValue: (r: ExpenseRequest) => r.name },
        },
        {
            accessorKey: "type",
            size: 190,
            header: ({ column }) => <DataTableColumnHeader column={column} title="Expense Type" />,
            enableColumnFilter: true,
            cell: ({ row }) => (
                <div>
                    <div>{row.original.type}</div>
                    <div className="text-[11px] text-muted-foreground">
                        {row.original.projects ? "Project" : "Non-Project"}
                    </div>
                </div>
            ),
            meta: {
                ...facetMeta({ field: "type", title: "Expense Type" }),
                exportHeaderName: "Expense Type",
                exportValue: (r: ExpenseRequest) => r.type,
            },
        },
        {
            accessorKey: "projects",
            size: 160,
            header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
            enableColumnFilter: true,
            // `projects_name` is injected by the data-table layer from LINK_FIELD_MAP
            // (projects -> Projects.project_name), so the NAME needs no client-side lookup.
            // Falls back to the id only if that injection is ever absent -- an id is worse
            // than a name, but far better than a blank.
            // Blank itself is meaningful, not missing: a non-project type has no project.
            cell: ({ row }) => {
                const { projects, projects_name } = row.original;
                if (!projects) return <span className="text-muted-foreground">--</span>;
                return (
                    <div>
                        <div>{projects_name || projects}</div>
                        {projects_name && (
                            <div className="text-[11px] text-muted-foreground">{projects}</div>
                        )}
                    </div>
                );
            },
            meta: {
                // The facet resolves through the SAME LINK_FIELD_MAP entry, so the filter list
                // shows project names and cannot disagree with the column beside it.
                ...facetMeta({ field: "projects", title: "Project" }),
                exportHeaderName: "Project",
                exportValue: (r: ExpenseRequest) => r.projects_name || r.projects || "",
            },
        },
        {
            accessorKey: "amount",
            size: 130,
            header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" />,
            cell: ({ row }) => (
                <span className="tabular-nums">{formatToRoundedIndianRupee(row.original.amount)}</span>
            ),
            meta: { exportHeaderName: "Amount", exportValue: (r: ExpenseRequest) => r.amount },
        },
        {
            accessorKey: "owner",
            size: 150,
            header: ({ column }) => <DataTableColumnHeader column={column} title="Raised By" />,
            enableColumnFilter: true,
            cell: ({ row }) => <span className="text-sm">{getUserName(row.original.owner)}</span>,
            meta: {
                ...facetMeta({ field: "owner", title: "Raised By" }),
                exportHeaderName: "Raised By",
                exportValue: (r: ExpenseRequest) => r.owner,
            },
        },
        {
            accessorKey: "creation",
            size: 120,
            header: ({ column }) => <DataTableColumnHeader column={column} title="Raised On" />,
            cell: ({ row }) => <span className="text-sm">{formatDate(row.original.creation)}</span>,
            meta: {
                exportHeaderName: "Raised On",
                exportValue: (r: ExpenseRequest) => formatDate(r.creation),
            },
        },
    ];

    if (showComment) {
        // The request's DETAIL is not a column any more -- it lives in `source_data`, which
        // this table reads as raw JSON and cannot flatten. It is shown, labelled, in the
        // approval dialog instead. The requester's `comment` is still a real field, so it
        // keeps the slot it used to share.
        const at = columns.findIndex((c) => (c as any).accessorKey === "owner");
        columns.splice(at < 0 ? columns.length : at, 0, {
            accessorKey: "comment",
            size: 260,
            header: ({ column }) => <DataTableColumnHeader column={column} title="Comment" />,
            cell: ({ row }) => (
                <span className="line-clamp-2 text-sm">{row.original.comment || "--"}</span>
            ),
            meta: {
                exportHeaderName: "Comment",
                exportValue: (r: ExpenseRequest) => r.comment || "",
            },
        });
    }

    if (showStatus) {
        columns.splice(1, 0, {
            accessorKey: "status",
            size: 140,
            header: "Status",
            enableColumnFilter: true,
            cell: ({ row }) => (
                <span className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                    STATUS_BADGE[row.original.status] || "bg-gray-100 text-gray-700"
                )}>
                    {row.original.status}
                </span>
            ),
            meta: {
                ...facetMeta({ field: "status", title: "Status" }),
                exportHeaderName: "Status",
                exportValue: (r: ExpenseRequest) => r.status,
            },
        });
    }

    if (showReview) {
        columns.push({
            accessorKey: "reviewed_by",
            size: 150,
            header: ({ column }) => <DataTableColumnHeader column={column} title="Reviewed By" />,
            enableColumnFilter: true,
            cell: ({ row }) => (
                <div className="text-sm">
                    <div>{row.original.reviewed_by ? getUserName(row.original.reviewed_by) : "--"}</div>
                    {row.original.reviewed_on && (
                        <div className="text-[11px] text-muted-foreground">
                            {formatDate(row.original.reviewed_on)}
                        </div>
                    )}
                </div>
            ),
            meta: {
                ...facetMeta({ field: "reviewed_by", title: "Reviewed By" }),
                exportHeaderName: "Reviewed By",
                exportValue: (r: ExpenseRequest) => r.reviewed_by || "",
            },
        });
    }

    if (showActions) {
        columns.push({
            id: "actions",
            size: 96,
            header: "Actions",
            enableSorting: false,
            // `can_review` is computed by the SERVER per row (routed reviewer, and not the
            // requester's own). Hiding the buttons is convenience only -- the endpoint
            // refuses regardless.
            cell: ({ row }) => {
                const mayReview = canReview(row.original.name);
                const mayEdit = canEdit(row.original.name);
                if (!mayReview && !mayEdit) {
                    return <span className="text-xs text-muted-foreground">--</span>;
                }
                // Icon-only. The tooltip and `aria-label` carry the meaning -- an icon
                // button with neither is unusable by keyboard or screen reader, and both
                // actions are consequential.
                return (
                    <TooltipProvider delayDuration={200}>
                        <div className="flex gap-1">
                            {mayEdit && (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            size="icon" variant="ghost" aria-label="Edit request"
                                            className="h-7 w-7 text-muted-foreground hover:bg-muted hover:text-foreground"
                                            onClick={() => onEdit(row.original)}
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Edit</TooltipContent>
                                </Tooltip>
                            )}
                            {mayReview && <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        size="icon" variant="ghost" aria-label="Approve request"
                                        className="h-7 w-7 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                                        onClick={() => onApprove(row.original)}
                                    >
                                        <Check className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Approve</TooltipContent>
                            </Tooltip>}
                            {mayReview && <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        size="icon" variant="ghost" aria-label="Reject request"
                                        className="h-7 w-7 text-red-700 hover:bg-red-50 hover:text-red-800"
                                        onClick={() => onReject(row.original)}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Reject</TooltipContent>
                            </Tooltip>}
                        </div>
                    </TooltipProvider>
                );
            },
            meta: { excludeFromExport: true },
        });
    }

    return columns;
};
