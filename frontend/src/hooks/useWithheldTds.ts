/**
 * The tax withheld from Non-Project Expenses, for a screen that holds only the Expense (spec #1522, #1527).
 *
 * ⚠️ "TDS" HERE IS TAX DEDUCTED AT SOURCE (section 194-I, rent), not a Technical Data Sheet.
 *
 * `api/approvals/expense_tds.get_withheld_tds` serves each named Expense's tax record past the record's
 * own permission, which only the Accountant roles hold. The payments queue, the approve dialog and the
 * request page get the same figures in their own answers (`withheld_tds`) and do not call this. Only
 * Office Rent expenses are asked about: no other type withholds anything.
 */
import { createContext, useMemo } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

import { OFFICE_RENT_TDS, type WithheldTds } from "@/utils/expenses/expenseTds";

export const WITHHELD_TDS_API = "nirmaan_stack.api.approvals.expense_tds.get_withheld_tds";

const NONE: Readonly<Record<string, WithheldTds>> = Object.freeze({});

/** The rows of a list worth asking about: Office Rent only. */
export const officeRentNames = (rows: readonly { name: string; type?: string | null }[] | undefined): string[] =>
  (rows ?? []).filter((r) => r.type === OFFICE_RENT_TDS.expenseType).map((r) => r.name);

/** Expense name -> its tax record, for those of `names` that have one. Asks nothing for an empty list. */
export function useWithheldTds(names: readonly string[]): Readonly<Record<string, WithheldTds>> {
  const key = names.join(",");
  // POST: a page of a list can name a few hundred Expenses.
  const { data } = useFrappeGetCall<{ message?: Record<string, WithheldTds> }>(
    WITHHELD_TDS_API,
    { names },
    key ? ["withheld_tds", key] : null,
    undefined,
    "POST",
  );
  const answer = data?.message;
  return useMemo(() => answer ?? NONE, [answer]);
}

/** A list page's answer, handed to its Amount cells, which its column config cannot be passed directly
 *  (the table hook takes the columns before the rows exist). */
export const WithheldTdsContext = createContext<Readonly<Record<string, WithheldTds>>>(NONE);
