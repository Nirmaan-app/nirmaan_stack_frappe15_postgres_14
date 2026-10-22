// src/pages/Reimbursements/config/reimbursementsTable.config.ts

import type { SearchFieldOption } from "@/components/data-table/new-data-table";

export const REIMBURSEMENT_FIELDS_TO_FETCH: string[] = [
    "name", "creation", "modified", "owner", "claimant_name", "claimant_role",
    "title", "description", "amount", "status",
    "pay_to_account_name", "pay_to_account_number", "pay_to_ifsc", "pay_to_bank_name", "pay_to_bank_branch",
    "attachment", "approved_by", "rejection_reason",
];

export const REIMBURSEMENT_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "title", label: "Title", placeholder: "Search by Title..." },
    { value: "name", label: "ID", placeholder: "Search by ID..." },
    { value: "claimant_name", label: "Claimant", placeholder: "Search by Claimant..." },
    { value: "amount", label: "Amount", placeholder: "Search by Amount..." },
    { value: "pay_to_account_name", label: "Account Holder", placeholder: "Search by Account Holder..." },
    { value: "description", label: "Description", placeholder: "Search by Description..." },
];

export const REIMBURSEMENT_DATE_COLUMNS: string[] = ["creation", "modified"];
