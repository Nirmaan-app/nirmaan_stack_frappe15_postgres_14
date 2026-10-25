import { parseNumber } from "./parseNumber";
import { roundToRupee } from "./FormatPrice";

/** The footer of a Work Order's page and PDF: GST, the round-off to a whole rupee, and the total. */
export interface WorkOrderPrintTotals {
  /** The GST in the total: the total less the printed rows' sub-total (0 on a GST-off Work Order). */
  tax: number;
  /** What rounding the total to the nearest rupee adds (negative when it takes away). */
  roundOff: number;
  /** The total, to the nearest rupee. */
  total: number;
}

const toPaise = (amount: number): number => Math.round(amount * 100) / 100;

/**
 * Footer figures from the server's (`api/service_requests/print_totals.get_work_order_print_totals`: the
 * printed rows' value and the Work Order's total, or while an amendment is open the total its accept will
 * store), never a total worked out again in the browser (`items x 1.18`, floored), to the nearest rupee
 * (#1543, spec #1528 story 68; frontend/CODING_STANDARDS.md § Displaying money). Only the rounding is here.
 */
export const workOrderPrintTotals = (subTotal: number | string, total: number | string): WorkOrderPrintTotals => {
  const items = parseNumber(subTotal);
  const exact = parseNumber(total);
  const rounded = roundToRupee(exact);
  return { tax: toPaise(exact - items), roundOff: toPaise(rounded - exact), total: rounded };
};
