import { useFrappeGetCall } from "frappe-react-sdk";

import type { EligiblePayments, VendorRecord } from "@/utils/cheques/chequeLines";

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

/** A PO's or Work Order's payments that may go on a Cheque, and what was hidden. */
export const useEligiblePayments = (recordDoctype: string, recordName: string) => {
    const ready = Boolean(recordDoctype && recordName);
    const { data, error, isLoading } = useFrappeGetCall<{ message: EligiblePayments }>(
        `${PICKERS}.get_eligible_payments`,
        { record_doctype: recordDoctype, record_name: recordName },
        ready ? `cheque-eligible-payments-${recordDoctype}-${recordName}` : null
    );
    return { eligible: data?.message, error, isLoading };
};
