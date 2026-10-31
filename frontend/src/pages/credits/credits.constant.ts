
import { SearchFieldOption } from '@/components/data-table/new-data-table';

export const PO_PAYMENT_TERM_DOCTYPE = 'Procurement Orders';

// Define exactly what fields to pull. Use dot notation for parent fields.
export const TERM_LIST_FIELDS_TO_FETCH = [
    'name', "creation", "modified", "total_amount", "status as postatus", "project", "project_name", "vendor", "vendor_name", '`tabPO Payment Terms`.name as ptname', '`tabPO Payment Terms`.term_status', '`tabPO Payment Terms`.label', '`tabPO Payment Terms`.amount', '`tabPO Payment Terms`.percentage', '`tabPO Payment Terms`.due_date', '`tabPO Payment Terms`.modified as term_modified',]

// Define what the user can search for.
export const TERM_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "PO Number", default: true },
    { value: "vendor_name", label: "Vendor" },
    { value: "project_name", label: "Project" },
];

// Define which columns should have a date range filter.
export const TERM_DATE_COLUMNS = ["due_date"];

// The tabs (`status_filter`), filtered server-side (`get_credits_list._add_status_condition`):
// - Due: Created terms past their due date, and terms Requested / CEO Pending / Approved, none paid by cheque.
// - Cheque Issued: terms paid by cheque and not yet Paid, from the request until the bank clears the cheque.
// - All Credits: every credit term.
export const CREDIT_TAB_CHEQUE_ISSUED = "Cheque Issued";
export const PAYMENT_TERM_STATUS_OPTIONS = [
    { label: "Due", value: "Due" },
    { label: "Cheque Issued", value: CREDIT_TAB_CHEQUE_ISSUED },
    { label: "All Credits", value: "All" },
];

/** A tab's key in the sidebar counts (`sidebar_counts`): lower case, no spaces ("Cheque Issued" -> "chequeissued"). */
export const creditTabCountKey = (tab: string): string => tab.toLowerCase().replace(/\s+/g, "");

export type FacetOption = { label: string; value: string };
export type FacetConfig = { title: string; options: FacetOption[]; isLoading?: boolean };

// Facet filter options. All three are dynamically populated by useCredits.ts
// from the backend get_credits_facets API based on rows actually present in
// the current filtered dataset. display_status is a computed value: "Due" for
// Created terms with past due_date, otherwise the raw term_status.
export const CREDIT_FACET_FILTER_OPTIONS: Record<string, FacetConfig> = {
    "display_status": {
        title: "Status",
        options: [], // populated dynamically (Due, Requested, CEO Pending, Approved, Paid)
    },
    "project_name": {
        title: "Project",
        options: [], // populated dynamically
    },
    "vendor_name": {
        title: "Vendor",
        options: [], // populated dynamically
    },
};