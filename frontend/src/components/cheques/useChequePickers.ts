import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";

import type { ChequeLineType } from "@/types/NirmaanStack/Cheques";
import type { EligibleExpenses, EligiblePayments, VendorRecord } from "@/utils/cheques/chequeLines";

const PICKERS = "nirmaan_stack.api.cheques.pickers";

/** The Vendor's POs and Work Orders, each with its project (the Add Cheque line pickers, #1410). */
export const useVendorRecords = (vendor: string | undefined) => {
    const { data, error, isLoading } = useFrappeGetCall<{ message: VendorRecord[] }>(
        `${PICKERS}.get_vendor_records`,
        { vendor },
        vendor ? `cheque-vendor-records-${vendor}` : null
    );
    return { records: data?.message ?? [], error, isLoading };
};

/**
 * The expenses an expense line may name, and what was hidden (#1411). A Project Expense line asks
 * only once its project is picked; a Non-project Expense line at once. `cheque` is the Cheque being
 * edited (#1418): its own expenses stay offered.
 */
export const useEligibleExpenses = (lineType: ChequeLineType, project: string, cheque?: string) => {
    const ready = lineType === "Non-project Expense" || (lineType === "Project Expense" && Boolean(project));
    const { data, error, isLoading } = useFrappeGetCall<{ message: EligibleExpenses }>(
        `${PICKERS}.get_eligible_expenses`,
        { line_type: lineType, project: project || undefined, cheque },
        ready ? `cheque-eligible-expenses-${lineType}-${project}-${cheque ?? ""}` : null
    );
    return { eligible: data?.message, error, isLoading };
};

/** Every project by name, for a Project Expense line (any project's expense may go on a cheque). */
export const useAllProjects = () => {
    const { data, isLoading } = useFrappeGetDocList<{ name: string; project_name: string }>(
        "Projects",
        { fields: ["name", "project_name"], limit: 0, orderBy: { field: "project_name", order: "asc" } },
        "cheque-line-all-projects"
    );
    const options = (data ?? []).map((p) => ({ value: p.name, label: p.project_name || p.name }));
    return { options, isLoading };
};

/**
 * A PO's or Work Order's payments that may go on a Cheque, and what was hidden. `cheque` is the
 * Cheque being edited (#1418): its own payments stay offered.
 */
export const useEligiblePayments = (recordDoctype: string, recordName: string, cheque?: string) => {
    const ready = Boolean(recordDoctype && recordName);
    const { data, error, isLoading } = useFrappeGetCall<{ message: EligiblePayments }>(
        `${PICKERS}.get_eligible_payments`,
        { record_doctype: recordDoctype, record_name: recordName, cheque },
        ready ? `cheque-eligible-payments-${recordDoctype}-${recordName}-${cheque ?? ""}` : null
    );
    return { eligible: data?.message, error, isLoading };
};
