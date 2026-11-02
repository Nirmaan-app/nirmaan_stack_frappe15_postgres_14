import { useFrappeGetCall } from "frappe-react-sdk";

import type { SecurableRecord } from "@/utils/cheques/chequeDeposit";

const PICKERS = "nirmaan_stack.api.cheques.pickers";

/** The Vendor's open POs and Work Orders: what a Security Deposit cheque may secure (#1486, ADR-0035 Amendment C). */
export const useSecurableRecords = (vendor: string | undefined) => {
    const { data, error, isLoading } = useFrappeGetCall<{ message: SecurableRecord[] }>(
        `${PICKERS}.get_securable_records`,
        { vendor },
        vendor ? `cheque-securable-records-${vendor}` : null
    );
    return { records: data?.message ?? [], error, isLoading };
};
