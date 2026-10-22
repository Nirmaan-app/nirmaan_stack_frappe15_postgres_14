import { parseNumber } from "./parseNumber";
import { roundToRupee } from "./FormatPrice";

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

/**
 * Footer figures from the server's total (`Service Requests.total_amount`), never one worked out again
 * in the browser (`items x 1.18`, floored), so the page and the PDF print the total Amount Due is taken
 * from, to the nearest rupee (#1543, spec #1528 story 68; frontend/CODING_STANDARDS.md § Displaying money).
 */
export const workOrderPrintTotals = (subTotal: number | string, storedTotal: number | string): WorkOrderPrintTotals => {
  const items = parseNumber(subTotal);
  const exact = parseNumber(storedTotal);
  const total = roundToRupee(exact);
  return { tax: toPaise(exact - items), roundOff: toPaise(total - exact), total };
};
