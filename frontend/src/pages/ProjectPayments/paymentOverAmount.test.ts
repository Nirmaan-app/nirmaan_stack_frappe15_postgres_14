import { describe, expect, it } from "vitest";

import { paymentOverAmountWarning } from "./paymentOverAmount";

// PO worth ₹1,18,000 incl. GST. ₹1,00,000 was paid, then ₹50,000 came back as a Received
// refund, so its stored Amount Paid is ₹50,000 and ₹68,000 is left to pay.
const refundedPO = { amount_paid: 50000 };
const poTotals = { total: 100000, totalWithTax: 118000 };

describe("paymentOverAmountWarning", () => {
	it("stays quiet on a refunded order that the new payment does not overpay", () => {
		expect(paymentOverAmountWarning("60000", "Procurement Orders", refundedPO, poTotals)).toBe("");
		expect(paymentOverAmountWarning("68000", "Procurement Orders", refundedPO, poTotals)).toBe("");
	});

	it("warns once the payment goes past what is left after Amount Paid", () => {
		expect(paymentOverAmountWarning("68001", "Procurement Orders", refundedPO, poTotals)).toBe(
			"Entered amount exceeds the total remaining amount including GST: ₹68,000",
		);
	});

	it("compares a WO without GST against its total excluding GST", () => {
		const wo = { gst: "false", amount_paid: "20000" };
		const woTotals = { total: 50000, totalWithTax: 50000 };
		expect(paymentOverAmountWarning("30000", "Service Requests", wo, woTotals)).toBe("");
		expect(paymentOverAmountWarning("30001", "Service Requests", wo, woTotals)).toBe(
			"Entered amount exceeds the total remaining amount excluding GST: ₹30,000",
		);
	});

	it("drops 'remaining' when nothing has been paid yet", () => {
		expect(paymentOverAmountWarning("118001", "Procurement Orders", {}, poTotals)).toBe(
			"Entered amount exceeds the total amount including GST: ₹1,18,000",
		);
	});
});
