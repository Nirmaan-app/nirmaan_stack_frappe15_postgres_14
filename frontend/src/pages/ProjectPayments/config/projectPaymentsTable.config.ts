import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import { PAYMENT_STATUS } from '../approve-payments/constants';
import { PP_TABS } from './ppTabs.constants';

export const DEFAULT_PP_FIELDS_TO_FETCH: (keyof ProjectPayments | 'name')[] =  [
    "name", "project", "owner", "vendor", "document_name", "document_type",
    "status", "amount","approval_date",
];

export const PP_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "Payment ID", placeholder: "Search by Payment ID...", default: true },
    { value: "project", label: "Project ID", placeholder: "Search by Project ID..." },
    // { value: "project_name", label: "Project Name", placeholder: "Search by Project Name..." },
    { value: "vendor", label: "Vendor ID", placeholder: "Search by Vendor ID..." },
    {value: "document_name", label: "Document Name", placeholder: "Search by Document Name..."},
    {value: "document_type", label: "Document Type", placeholder: "Search by Document Type..."},
    {value: "amount", label: "Amount", placeholder: "Search by Amount..."},
];

// Date columns commonly used for filtering Payments tables
export const PP_DATE_COLUMNS: string[] = ["creation", "modified", "payment_date", "approval_date"];

/**
 * The `useServerDataTable` URL-sync key for an `AllPayments` view.
 *
 * ⚠️ EXPORTED SO IT HAS ONE OWNER. `AllPayments` built this string inline, and it is also the only
 * way an OUTSIDE screen can deep-link to a row in one of these tables -- the hook derives its
 * `<key>_q` / `<key>_searchBy` params from it. A second copy of the format elsewhere would keep
 * working right up until this one changed, and then fail silently by landing on an unfiltered table
 * rather than erroring (ADR-0010 F1: a shape gets one home).
 */
export const buildPaymentsUrlSyncKey = (contextKey: string, tab: string): string =>
    `all_pay_${contextKey}_${tab.toLowerCase().replace(/\s+/g, "_")}`;

/**
 * A link straight to one payment, in a tab that will actually contain it.
 *
 * `name` is a searchable field (the default one), so pre-seeding the table's own search params
 * lands on exactly that row.
 *
 * ⚠️ THE TAB MUST MATCH THE PAYMENT'S STATUS, AND GETTING THIS WRONG FAILS SILENTLY. "Payments
 * Done" filters `status = Paid`. A payment that has been SETTLED is Paid and belongs there -- but a
 * payment merely SUGGESTED by a matcher is still `Approved`, and that same link lands on an empty
 * table with no hint as to why. Verified live before this parameter existed. So callers say which
 * they have, and an unsettled record goes to "All Payments", which carries no status filter at all.
 *
 * ⚠️ COLD LOADS BOUNCE. Opening one of these in a FRESH tab redirects to `/` -- the app does that
 * before auth resolves, which is pre-existing behaviour and not specific to this link. An in-app
 * client-side navigation is fine; middle-click / "open in new tab" is not.
 */
export const paymentHref = (paymentName: string, isPaid: boolean): string => {
    const tab = isPaid ? PP_TABS.PAYMENTS_DONE : PP_TABS.ALL_PAYMENTS;
    const key = buildPaymentsUrlSyncKey("all", tab);
    const params = new URLSearchParams({
        tab,
        [`${key}_searchBy`]: "name",
        [`${key}_q`]: paymentName,
    });
    return `/project-payments?${params.toString()}`;
};

// Function to get static filters based on tab for ProjectPayments context
export const getProjectPaymentsStaticFilters = (tab: string): Array<[string, string, string | string[]]> => {

    const base: Array<[string, string, string | string[]]> = [];

    // const isEstimatesExec = role === "Nirmaan Estimates Executive Profile";
    // if (isEstimatesExec) {
    //     return [["status", "in", ["PO Approved", "Dispatched", "Partially Delivered", "Delivered"]]];
    // }
    switch (tab) {
        case "CEO Pending": return [...base, ["status", "=", PAYMENT_STATUS.CEO_PENDING]];
        case "New Payments": return [...base, ["status", "=", PAYMENT_STATUS.APPROVED]];
        case "Fulfilled Payments": return [...base, ["status", "=", PAYMENT_STATUS.PAID]];
        case "Payments Done": return [...base, ["status", "=", PAYMENT_STATUS.PAID]];
        case "Payments Pending": return [...base, ["status", "in", [PAYMENT_STATUS.REQUESTED, PAYMENT_STATUS.CEO_PENDING, PAYMENT_STATUS.APPROVED]]];
        case "All Payments": return [];
        default: return base; // Or specific default for this view
    }
};