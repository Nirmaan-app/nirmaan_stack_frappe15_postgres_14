import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { useState } from "react";

/** The two order doctypes that store an Amount Paid. */
export type OrderDoctype = "Procurement Orders" | "Service Requests";

/**
 * One order whose stored Amount Paid or Amount Due (a WO's Total TDS too) is ₹1 or more off its source
 * (Paid payments, plus a WO's TDS withheld from the vendor, less Received refunds). Shape of
 * `api/reports/amount_paid_mismatch.get_amount_paid_mismatches`.
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
  /** A WO's stored `total_tds` and the sum of its Paid payments' deductions; 0 on a PO. */
  stored_tds: number;
  correct_tds: number;
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
 *
 * ⚠️ EVERY OPENING FETCHES AFRESH (spec #1451: "worked out when I open it, never out of date"). The
 * SWR key carries the moment this report was opened, so reopening it in the same session starts on
 * an empty cache: it shows the loader and asks the server, never the list from the last opening.
 * Within one opening, Refresh and a Recount refetch the same key.
 */
export const useAmountPaidMismatch = (doctype: OrderDoctype) => {
  const [openedAt] = useState(() => Date.now());
  const { data, isLoading, isValidating, error, mutate } = useFrappeGetCall<{ message: AmountPaidMismatchRow[] }>(
    `${API}.get_amount_paid_mismatches`,
    { doctype },
    `amount-paid-mismatch-${doctype}-${openedAt}`,
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
