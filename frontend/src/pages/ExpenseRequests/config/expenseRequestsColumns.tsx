// src/pages/ExpenseRequests/config/expenseRequestsColumns.tsx
//
// Columns for the Expense Request table. Shaped like the two ledger tables so all three
// tabs of /expense read as one module.
//
// Status and Amount are LIVE (#1500): once a request has an Expense they show that Expense's own
// status ("Waiting for Admin", "CEO Pending", "Reconciliation Pending", ...) and its amount, as
// `get_request_standing` reads them. A row the standing read has not answered shows the request's.
//
// Tab-driven visibility:
//   Status                   -> on "All" and on "Raised By Me". Every OTHER tab is a single
//                               status by definition, so the column would repeat its own
//                               name on every row; "Raised By Me" is not -- it spans every
//                               status, so without this its rows carry no status at all.
//   Reviewed By              -> hidden on "Pending Approval" (nothing to show yet)
//   Actions                  -> "Pending Approval": edit / approve / reject.
//                               "Raised By Me": EDIT on the viewer's own pending rows
//                               (`update.can_edit`), DELETE on their rejected ones.
//                               "All": DELETE on rejected rows the viewer may delete
//                               (`delete.can_delete`). Approve / reject never leave the
//                               pending tab: `access.guard_reviewer` refuses self-review.
//   Description              -> hidden on "Pending Approval". A type WITH a format hides the
//                               description field entirely (its fields are the description),
//                               so the column read "--" on every such row -- a column of
//                               dashes costs width and tells the reviewer nothing.

import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";

import { EXR_RAISED_BY_ME } from "./expenseRequestsTable.config";
import { Check, Pencil, Trash2, X } from "lucide-react";

import LiveStatusBadge from "../components/LiveStatusBadge";
import RequestHoverCard from "@/components/common/RequestHoverCard";

import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { facetMeta } from "@/components/data-table/facetConfig";
import { Button } from "@/components/ui/button";
import {
    Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { ExpenseTdsBreakdown } from "@/components/common/ExpenseTdsBreakdown";
import { shownExpenseTds } from "@/utils/expenses/expenseTds";
import type { ExpenseRequest, RequestStanding } from "@/types/NirmaanStack/ExpenseRequest";

/** The mark on a request whose raiser records without review (GLOSSARY, #1498). */
const APPROVED_ON_SUBMIT = "Approved on submit (no review)";

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
    /** Server-computed per row: Rejected, raiser or Admin, no Expense linked. Never re-derive it. */
    canDelete: (name: string) => boolean;
    /** The row's answers labelled by its form, from the scoped read. Undefined for a row that
     *  read did not return; the hover card then shows its header alone. */
    getDetail: (name: string) => { label: string; value: string }[] | undefined;
    /** The row's live status and amount from its Expense (`get_request_standing`), or undefined
     *  until that read answers. */
    getStanding: (name: string) => RequestStanding | undefined;
    onApprove: (r: ExpenseRequest) => void;
    onReject: (r: ExpenseRequest) => void;
    onEdit: (r: ExpenseRequest) => void;
    onDelete: (r: ExpenseRequest) => void;
}

export const getExpenseRequestColumns = ({
    statusTab, getUserName, getCategory, canReview, canEdit, canDelete, getDetail, getStanding,
    onApprove, onReject, onEdit, onDelete,
}: Args): ColumnDef<ExpenseRequest>[] => {
    const showStatus = statusTab === "All" || statusTab === EXR_RAISED_BY_ME;
    const showReview = statusTab !== "Pending Approval";
    const isPendingTab = statusTab === "Pending Approval";
    const showActions = isPendingTab || statusTab === "All" || statusTab === EXR_RAISED_BY_ME;
    const showComment = statusTab !== "Pending Approval";
    const liveStatus = (r: ExpenseRequest) => getStanding(r.name)?.status ?? r.status;
    const liveAmount = (r: ExpenseRequest) => getStanding(r.name)?.amount ?? r.amount;

    const columns: ColumnDef<ExpenseRequest>[] = [
        {
            accessorKey: "name",
            size: 150,
            header: ({ column }) => <DataTableColumnHeader column={column} title="Request ID" />,
            cell: ({ row }) => (
                <div>
                    <div className="font-medium">
                        <RequestHoverCard info={{
                            name: row.original.name,
                            status: liveStatus(row.original),
                            type: row.original.type,
                            project: row.original.projects_name || row.original.projects,
                            amount: liveAmount(row.original),
                            raisedBy: getUserName(row.original.owner),
                            creation: row.original.creation,
                            detail: getDetail(row.original.name),
                        }}>
                            {/* The request's page: where it stands (#1500), its invoice (#1502). */}
                            <Link to={`/expense/requests/${row.original.name}`} className="text-primary">
                                {row.original.name}
                            </Link>
                        </RequestHoverCard>
                    </div>
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
            cell: ({ row }) => {
                const standing = getStanding(row.original.name);
                // Office Rent: Rent / TDS / Net (#1527), from the Expense's status, or the request's
                // while it has none.
                const tds = shownExpenseTds({
                    type: row.original.type,
                    amount: liveAmount(row.original),
                    status: standing?.expense?.status ?? row.original.status,
                    withheld: standing?.withheld_tds,
                });
                return (
                    <div className="tabular-nums">
                        <span>{formatToRoundedIndianRupee(liveAmount(row.original))}</span>
                        <ExpenseTdsBreakdown shown={tds} />
                    </div>
                );
            },
            meta: { exportHeaderName: "Amount", exportValue: liveAmount },
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
            cell: ({ row }) => <LiveStatusBadge status={liveStatus(row.original)} />,
            meta: {
                // The facet filters the REQUEST's own status (Approved spans every step between
                // review and payment); the cell shows the Expense's live one.
                ...facetMeta({ field: "status", title: "Status" }),
                exportHeaderName: "Status",
                exportValue: liveStatus,
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
                    {/* Records without review (#1498): nobody reviewed it, and the row says so. */}
                    <div>
                        {row.original.approved_on_submit
                            ? <span className="text-muted-foreground">{APPROVED_ON_SUBMIT}</span>
                            : row.original.reviewed_by ? getUserName(row.original.reviewed_by) : "--"}
                    </div>
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
                exportValue: (r: ExpenseRequest) =>
                    r.approved_on_submit ? APPROVED_ON_SUBMIT : r.reviewed_by || "",
            },
        });
    }

    if (showActions) {
        columns.push({
            id: "actions",
            size: 96,
            header: "Actions",
            enableSorting: false,
            // `can_review` is computed by the SERVER per row (routed reviewer, or Accountant /
            // HR on a Project Manager's request, and not the requester's own). Hiding the
            // buttons is convenience only -- the endpoint refuses regardless.
            // Review: the pending tab only. Edit: the pending tab and "Raised By Me", so a raiser
            // without the pending tab can correct their own request. Delete: wherever the
            // server says so, which is only ever a rejected row.
            cell: ({ row }) => {
                const mayReview = isPendingTab && canReview(row.original.name);
                const mayEdit = (isPendingTab || statusTab === EXR_RAISED_BY_ME)
                    && canEdit(row.original.name);
                const mayDelete = canDelete(row.original.name);
                if (!mayReview && !mayEdit && !mayDelete) {
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
                            {mayDelete && <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        size="icon" variant="ghost" aria-label="Delete request"
                                        className="h-7 w-7 text-red-700 hover:bg-red-50 hover:text-red-800"
                                        onClick={() => onDelete(row.original)}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Delete</TooltipContent>
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
