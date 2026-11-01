import { useCallback } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import type { TdsRegisterOrderValue } from "../config/paymentTdsDeductions.config";

/**
 * The WO / PO value behind every TDS register row, keyed by order name (`get_tds_register_order_values`).
 * One read for the whole register rather than per page, so the CSV export carries the values for every
 * row it writes. Its own endpoint because `document_name` is a Dynamic Link the list query cannot join.
 */
export const useTdsRegisterOrderValues = () => {
    const { data, isLoading } = useFrappeGetCall<{ message: Record<string, TdsRegisterOrderValue> }>(
        "nirmaan_stack.api.payments.tds_register_orders.get_tds_register_order_values",
        undefined,
        "TdsRegisterOrderValues"
    );
    const values = data?.message;
    const getOrderValue = useCallback(
        (orderName?: string) => (orderName ? values?.[orderName] : undefined),
        [values]
    );
    return { getOrderValue, isLoading };
};
