import { useFrappeGetCall } from "frappe-react-sdk";

import { PO_DOCTYPE, type EligiblePayments, type VendorRecord } from "@/utils/cheques/chequeLines";

const PICKERS = "nirmaan_stack.api.cheques.pickers";

/** The Vendor's open POs, each with its project (the Add Cheque line pickers, #1410, #1482). */
export const useVendorRecords = (vendor: string | undefined) => {
    const { data, error, isLoading } = useFrappeGetCall<{ message: VendorRecord[] }>(
        `${PICKERS}.get_vendor_records`,
        { vendor },
        vendor ? `cheque-vendor-records-${vendor}` : null
    );
    return { records: data?.message ?? [], error, isLoading };
};

/**
 * A PO's payments that may go on a Payment cheque, and what was hidden (#1482). `cheque` is the Cheque being
 * edited: its own payments stay offered. `otherPayments` are the payments on the cheque's other lines: only
 * their step is offered, and they are not offered again.
 */
export const useEligiblePayments = (recordName: string, cheque: string | undefined, otherPayments: string[]) => {
    const others = otherPayments.join(",");
    const { data, error, isLoading } = useFrappeGetCall<{ message: EligiblePayments }>(
        `${PICKERS}.get_eligible_payments`,
        { record_doctype: PO_DOCTYPE, record_name: recordName, cheque, other_payments: JSON.stringify(otherPayments) },
        recordName ? `cheque-eligible-payments-${recordName}-${cheque ?? ""}-${others}` : null
    );
    return { eligible: data?.message, error, isLoading };
};
