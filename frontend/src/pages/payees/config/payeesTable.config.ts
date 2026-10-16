import { SearchFieldOption } from "@/components/data-table/new-data-table";
import { PAYEE_TABS, type PayeeTab } from "@/utils/payees/payeeRoutes";

/**
 * The Payees page (spec #1420, mockup screen 1): one row per Payee, served by
 * `api/payees/list_payees.get_payees` (the `useServerDataTable` custom-endpoint contract). The tab
 * travels as the filter `["tab", "=", <tab>]`, and the pills' counts are that call's `aggregates`,
 * so the pills and the rows always agree.
 */
export const PAYEES_LIST_API = "nirmaan_stack.api.payees.list_payees.get_payees";

/** Nominal: the endpoint fixes the row shape (`PayeeSummary`). */
export const PAYEE_FETCH_FIELDS: string[] = ["name"];

export const PAYEE_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "account_name", label: "Holder name", placeholder: "Search by holder name", default: true },
    { value: "account_number", label: "Account number", placeholder: "Search by account number" },
    { value: "vendor_name", label: "Linked vendor", placeholder: "Search by linked vendor" },
    { value: "name", label: "Payee ID", placeholder: "Search by Payee ID" },
];

/** One pill: its tab, label and the `aggregates` key holding its count. */
export interface PayeeTabPill {
    tab: PayeeTab;
    label: string;
    countKey: string;
}

export const PAYEE_TAB_PILLS: PayeeTabPill[] = [
    { tab: PAYEE_TABS.ALL, label: "All", countKey: "all_count" },
    { tab: PAYEE_TABS.NO_VENDOR, label: "No vendor", countKey: "no_vendor_count" },
];

/** A pill's count from the list call's `aggregates`; 0 until it arrives. */
export const pillCount = (aggregates: Record<string, unknown> | null | undefined, pill: PayeeTabPill): number => {
    const n = Number(aggregates?.[pill.countKey]);
    return Number.isFinite(n) ? n : 0;
};
