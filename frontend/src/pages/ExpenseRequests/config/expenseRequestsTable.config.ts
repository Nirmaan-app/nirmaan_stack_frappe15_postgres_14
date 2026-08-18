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

export const EXR_STATUS_TABS = [
    { label: "Pending Approval", value: "Pending Approval" },
    { label: "Approved", value: "Approved" },
    { label: "Paid", value: "Paid" },
    { label: "Rejected", value: "Rejected" },
    { label: "All", value: "All" },
] as const;
