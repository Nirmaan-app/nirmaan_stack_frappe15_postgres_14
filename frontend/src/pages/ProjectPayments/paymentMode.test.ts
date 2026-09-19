import { describe, expect, it } from "vitest";

import {
	chequeAmountFor,
	EMPTY_PAYMENT_MODE,
	isChequePayment,
	isPaymentModeComplete,
	paymentModeArgs,
	paymentModeSummary,
} from "./paymentMode";
import { forecastTds } from "./tdsForecast";

const cheque = { mode: "Cheque" as const, chequeNo: " 004512 ", chequeDate: "2026-09-19" };

describe("paymentMode", () => {
	it("an online request needs nothing more and sends only its mode", () => {
		expect(isPaymentModeComplete(EMPTY_PAYMENT_MODE)).toBe(true);
		expect(paymentModeArgs(EMPTY_PAYMENT_MODE)).toEqual({ mode_of_payment: "Online" });
	});

	it("a cheque needs both its number and its date", () => {
		expect(isPaymentModeComplete(cheque)).toBe(true);
		expect(isPaymentModeComplete({ ...cheque, chequeNo: "  " })).toBe(false);
		expect(isPaymentModeComplete({ ...cheque, chequeDate: "" })).toBe(false);
	});

	it("sends the cheque number trimmed, leading zeros kept", () => {
		expect(paymentModeArgs(cheque)).toEqual({
			mode_of_payment: "Cheque",
			cheque_no: "004512",
			cheque_date: "2026-09-19",
		});
	});

	it("reads a blank mode as Online", () => {
		expect(isChequePayment({ mode_of_payment: "Cheque" })).toBe(true);
		expect(isChequePayment({ mode_of_payment: "" })).toBe(false);
		expect(isChequePayment({})).toBe(false);
		expect(isChequePayment(null)).toBe(false);
	});

	describe("the cheque is written for the amount AFTER TDS", () => {
		it("an ordinary Work Order: 50,000 at 2% is a 49,000 cheque", () => {
			expect(chequeAmountFor(50000, forecastTds("Service Requests", 50000, 2))).toBe(49000);
		});

		it("a company-borne Work Order is written for the full amount", () => {
			expect(chequeAmountFor(50000, forecastTds("Service Requests", 50000, 2, true))).toBe(50000);
		});

		it("a Procurement Order has no TDS and is written for the amount", () => {
			expect(chequeAmountFor(50000, forecastTds("Procurement Orders", 50000, 2))).toBe(50000);
		});
	});
});

describe("paymentModeSummary", () => {
	it("splits payments by mode, a blank mode reading as Online, and leaves expenses out", () => {
		expect(
			paymentModeSummary([
				{ source: "Vendor Payment", mode_of_payment: "Cheque", amount: 162075 },
				{ source: "Vendor Payment", mode_of_payment: "Online", amount: 20000 },
				{ source: "Vendor Payment", mode_of_payment: "", amount: "5000" },
				{ source: "Project Expense", mode_of_payment: "", amount: "75000" },
			])
		).toEqual({ online: { count: 2, total: 25000 }, cheque: { count: 1, total: 162075 } });
	});
});
