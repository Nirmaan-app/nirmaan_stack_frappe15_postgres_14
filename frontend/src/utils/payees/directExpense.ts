/**
 * The failed-save toast of Add Expense's Direct Expense (spec #1470 tickets #1471, #1474). Pure, so it
 * tests without React; `components/payees/useCreateDirectExpense` holds the save.
 */

import { getFrappeError } from "@/utils/frappeErrors";

import { DuplicatePayeeError } from "./payToChoice";

/** A destructive toast: its title and what it says. */
export interface DirectExpenseErrorToast {
    title: string;
    description: string;
    variant: "destructive";
}

/** The toast for a failed save: a duplicate account says so (its Payee now shows to pick); anything
 *  else gives the server's reason, or `fallback`. */
export const directExpenseErrorToast = (error: unknown, title: string, fallback: string): DirectExpenseErrorToast =>
    error instanceof DuplicatePayeeError
        ? { title: "This account is already a payee", description: error.message, variant: "destructive" }
        : { title, description: getFrappeError(error) || fallback, variant: "destructive" };
