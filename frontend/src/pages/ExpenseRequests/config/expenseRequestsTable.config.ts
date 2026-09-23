// src/pages/ExpenseRequests/config/expenseRequestsTable.config.ts

import { SearchFieldOption } from "@/components/data-table/new-data-table";
import { ExpenseRequest } from "@/types/NirmaanStack/ExpenseRequest";

export const DEFAULT_EXR_FIELDS_TO_FETCH: (keyof ExpenseRequest | "name" | "owner")[] = [
    "name", "creation", "modified", "owner",
    "type", "projects", "amount", "comment",
    "status", "reviewed_by", "reviewed_on", "review_comment",
];

export const EXR_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "Request ID", placeholder: "Search by Request ID..." },
    { value: "type", label: "Expense Type", placeholder: "Search by Expense Type..." },
    { value: "projects", label: "Project", placeholder: "Search by Project..." },
    { value: "amount", label: "Amount", placeholder: "Search by Amount..." },
    { value: "comment", label: "Comment", placeholder: "Search by Comment..." },
    { value: "review_comment", label: "Review Comment", placeholder: "Search by Review Comment..." },
];

export const EXR_DATE_COLUMNS: string[] = ["creation", "modified", "reviewed_on"];

// ⚠️ NOT A STATUS. `EXR_RAISED_BY_ME` sits in the same strip as the two status tabs, but it
// filters on OWNER and spans every status -- so it can never be handed to a `status =` filter.
// Every switch over a tab value has to case it out explicitly; see `additionalFilters` in
// ExpenseRequestsPage and `showStatus` in expenseRequestsColumns.
export const EXR_RAISED_BY_ME = "Raised By Me";

// Approved / Paid / Rejected tabs removed (owner, 17 Sep 2026): those rows are still listed
// under All, which shows the Status column.
export const EXR_STATUS_TABS = [
    { label: "Pending Approval", value: "Pending Approval" },
    { label: "All", value: "All" },
    { label: "Expense Raised By Me", value: EXR_RAISED_BY_ME },
] as const;

// The two review tabs list OTHER PEOPLE'S requests, so only a reviewer gets them (owner,
// 23 Sep 2026). Everyone else keeps "Expense Raised By Me" alone -- PMO Executive, Project
// Manager and the four procurement profiles in practice, that being the rest of the
// `/expense` sidebar audience.
//
// ⚠️ DISPLAY SCOPING, NOT ACCESS CONTROL. `Expense Request` has no row scoping on the server
// (`access.get_permission_query_conditions` is written but NOT wired into hooks.py), so the
// narrowed roles can still read every request through the generic API or Desk. What IS
// enforced is REVIEW, by `access.guard_reviewer`.
//
// Note the direction: a role that is not a reviewer falls through to the narrow list, so a
// new or unrecognised profile -- including anyone who deep-links past the sidebar, the route
// having no guard -- sees their own rows rather than everybody's.
export const getExrStatusTabs = (isReviewer: boolean) =>
    isReviewer
        ? EXR_STATUS_TABS
        : EXR_STATUS_TABS.filter((t) => t.value === EXR_RAISED_BY_ME);
