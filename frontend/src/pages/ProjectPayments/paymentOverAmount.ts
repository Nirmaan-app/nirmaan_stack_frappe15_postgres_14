import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";

/**
 * The payments list's over-amount warning for a new Paid payment: "" when `amount` fits in what is
 * left to pay. What is left is the order's total less its stored Amount Paid (ADR-0034), so a
 * Received refund makes room again. A PO, and a WO with GST, compare against the total incl. GST;
 * a WO without GST against its total excl. GST.
 */
export const paymentOverAmountWarning = (
	amount: string | number,
	doctype: string,
	order: { gst?: string; amount_paid?: number | string },
	totals: { total: number; totalWithTax: number },
): string => {
	const amountPaid = parseNumber(order.amount_paid);
	const withGst = doctype === "Procurement Orders" || order.gst === "true";
	const leftToPay = (withGst ? totals.totalWithTax : totals.total) - amountPaid;
	if (parseNumber(amount) <= leftToPay) return "";
	return `Entered amount exceeds the total ${amountPaid ? "remaining " : ""}amount ${withGst ? "including" : "excluding"} GST: ${formatToRoundedIndianRupee(leftToPay)}`;
};
