import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";

/** The two order doctypes that store an Amount Paid. */
export type OrderDoctype = "Procurement Orders" | "Service Requests";

/**
 * One order whose stored Amount Paid or Amount Due is ₹1 or more off its source (Paid payments less
 * Received refunds). Shape of `api/reports/amount_paid_mismatch.get_amount_paid_mismatches`.
 */
export interface AmountPaidMismatchRow {
  doctype: OrderDoctype;
  name: string;
  project: string | null;
  project_name: string | null;
  vendor: string | null;
  vendor_name: string | null;
  status: string | null;
  stored_paid: number;
  correct_paid: number;
  /** correct_paid − stored_paid: positive when the order reads less paid than it was. */
  paid_difference: number;
  stored_due: number;
  correct_due: number;
}

interface RecountReply {
  recounted: boolean;
  before: AmountPaidMismatchRow | null;
}

const API = "nirmaan_stack.api.reports.amount_paid_mismatch";

/**
 * The Amount Paid Mismatch report's data: every mismatched order of `doctype`, worked out on the
 * server each time it is fetched, and `recount(name)`, which sets one order from source and then
 * refetches the list. Both endpoints refuse anyone outside Admin and Accountant Lead.
 */
export const useAmountPaidMismatch = (doctype: OrderDoctype) => {
  const { data, isLoading, isValidating, error, mutate } = useFrappeGetCall<{ message: AmountPaidMismatchRow[] }>(
    `${API}.get_amount_paid_mismatches`,
    { doctype },
    `amount-paid-mismatch-${doctype}`,
    { revalidateOnFocus: false },
  );
  const { call } = useFrappePostCall<{ message: RecountReply }>(`${API}.recount_amount_paid`);

  const recount = async (name: string): Promise<RecountReply> => {
    const reply = await call({ doctype, name });
    await mutate();
    return reply.message;
  };

  return {
    rows: data?.message ?? [],
    isLoading,
    isRefreshing: isValidating,
    error,
    refresh: () => mutate(),
    recount,
  };
};
