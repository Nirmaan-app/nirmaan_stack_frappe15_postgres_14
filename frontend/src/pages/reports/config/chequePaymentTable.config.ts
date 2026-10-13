import { SearchFieldOption } from "@/components/data-table/new-data-table";
import type { ChequeBank, ChequeMadeFrom, ChequeStatus } from "@/types/NirmaanStack/Cheques";
import { formatDate } from "@/utils/FormatDate";

/**
 * Reports > Payment > Cheque Payment: one row per Cheque (spec #1407), served by
 * `api/cheques/list_cheques.get_cheques` (the `useServerDataTable` custom-endpoint contract).
 */
export const CHEQUES_DOCTYPE = "Cheques";
export const CHEQUES_LIST_API = "nirmaan_stack.api.cheques.list_cheques.get_cheques";
/** Published by the backend after every Cheque write. */
export const CHEQUES_CHANGED_EVENT = "cheques:changed";

/** One row of the report, exactly as `get_cheques` returns it. */
export interface ChequeRow {
    name: string;
    creation: string;
    owner: string;
    owner_name?: string | null;
    cheque_no: string;
    bank: ChequeBank;
    bank_name?: string | null;
    /** The typed name for an Others bank, else the bank. */
    bank_label: string;
    cheque_date: string;
    status: ChequeStatus;
    amount: number;
    description?: string | null;
    vendor?: string | null;
    vendor_name?: string | null;
    payee_name?: string | null;
    attachment?: string | null;
    made_from: ChequeMadeFrom;
    /** The newest status-history row: who made the last change, and when. */
    status_changed_by?: string | null;
    status_changed_by_name?: string | null;
    status_changed_at?: string | null;
}

/** Nominal: the endpoint fixes the row shape. */
export const CHEQUE_FETCH_FIELDS: string[] = ["name"];

export const CHEQUE_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "cheque_no", label: "Cheque No", default: true },
    { value: "vendor_name", label: "Vendor" },
    { value: "payee_name", label: "Payee" },
    { value: "description", label: "Description" },
];

export const CHEQUE_DATE_COLUMNS = ["cheque_date", "creation"];

/** Who the cheque is made out to, as the table shows it: the Vendor (linked) or the typed payee. */
export const payeeOf = (row: Pick<ChequeRow, "vendor" | "vendor_name" | "payee_name">): { label: string; vendor?: string } =>
    row.vendor
        ? { label: row.vendor_name || row.vendor, vendor: row.vendor }
        : { label: row.payee_name || "" };

/** "by Ravi Kumar · 12-Oct-2026": the last status change, shown under the status. Empty when unknown. */
export const statusChangeText = (
    row: Pick<ChequeRow, "status_changed_by" | "status_changed_by_name" | "status_changed_at">,
): string => {
    const who = row.status_changed_by_name || row.status_changed_by;
    if (!who || !row.status_changed_at) return "";
    return `by ${who} · ${formatDate(row.status_changed_at)}`;
};
