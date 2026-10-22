import { parseNumber } from "./parseNumber";
import { roundToRupee } from "./FormatPrice";
import { workOrderTotal } from "./workOrderGst";

/** The footer of a Work Order's page and PDF: GST, the round-off to a whole rupee, and the total. */
export interface WorkOrderPrintTotals {
  /** The GST in the stored total: stored total less the items' sub-total (0 on a GST-off Work Order). */
  tax: number;
  /** What rounding the stored total to the nearest rupee adds (negative when it takes away). */
  roundOff: number;
  /** The stored total, to the nearest rupee. */
  total: number;
}

const toPaise = (amount: number): number => Math.round(amount * 100) / 100;

/** The printed Work Order's state, when its stored total is not the printed items' (an open amendment). */
export interface PrintState {
  /** The amendment is open: `total_amount` is still the total from before it. */
  amendmentOpen: boolean;
  gstOn: boolean;
}

/**
 * Footer figures from the server's total (`Service Requests.total_amount`), never one worked out again
 * in the browser (`items x 1.18`, floored), so the page and the PDF print the total Amount Due is taken
 * from, to the nearest rupee (#1543, spec #1528 story 68; frontend/CODING_STANDARDS.md § Displaying money).
 * While an amendment is open the stored total is the old one and the printed items are the amended ones,
 * so the footer is the amended items' total by the server's rule (`workOrderTotal`), which the accept stores.
 */
export const workOrderPrintTotals = (
  subTotal: number | string,
  storedTotal: number | string,
  state?: PrintState
): WorkOrderPrintTotals => {
  const items = parseNumber(subTotal);
  const exact = state?.amendmentOpen ? toPaise(workOrderTotal(items, state.gstOn)) : parseNumber(storedTotal);
  const total = roundToRupee(exact);
  return { tax: toPaise(exact - items), roundOff: toPaise(total - exact), total };
};
