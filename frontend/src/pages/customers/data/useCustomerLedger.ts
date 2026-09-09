import { useFrappeGetCall } from "frappe-react-sdk";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";

/** One row exactly as `get_customer_ledger_data` returns it (amounts in rupees). */
export interface CustomerLedgerTransaction {
  type: "Invoice Raised" | "Inflow Received";
  /** yyyy-MM-dd — invoice_date for invoices, payment_date for inflows. */
  date: string;
  /** Display name of the linked project. */
  project: string;
  /** Project docname, for linking; "" when the row has no project. */
  project_id: string;
  details: string;
  /** Invoice amount INCL. GST; 0 on inflow rows. */
  invoice: number;
  /** Cash received; 0 on invoice rows. */
  inflow: number;
}

/**
 * The API sends a date-only string. `new Date("2026-01-22")` parses that as UTC
 * midnight, which renders as the PREVIOUS day in any negative-offset timezone;
 * appending a time forces local-midnight parsing so the row shows the date the
 * invoice/inflow actually carries, everywhere.
 *
 * (Filtering is unaffected either way -- `dateFilterFn` uses date-fns `parseISO`,
 * which already treats a bare yyyy-MM-dd as local.)
 */
export const parseLedgerDate = (date: string): Date => new Date(`${date}T00:00:00`);

export const customerLedgerKey = (customerId: string) =>
  ["customer", "ledgerData", customerId] as const;

export const useCustomerLedgerData = (customerId: string) => {
  const response = useFrappeGetCall<{ message: CustomerLedgerTransaction[] }>(
    "nirmaan_stack.api.customers.customer_ledger.get_customer_ledger_data",
    { customer_id: customerId },
    customerLedgerKey(customerId)
  );
  useApiErrorLogger(response.error, {
    hook: "useCustomerLedgerData",
    api: "get_customer_ledger_data",
    feature: "customer",
    entity_id: customerId,
  });
  return response;
};
