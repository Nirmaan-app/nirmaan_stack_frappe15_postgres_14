import { describe, expect, it } from "vitest";

import {
	chequeAmountFor,
	chequeAmountHint,
	chequeModeOffered,
	EMPTY_PAYMENT_MODE,
	isChequePayment,
	isPaymentModeComplete,
	paymentModeArgs,
	paymentModeSummary,
	type PaymentModeValue,
} from "./paymentMode";
import { forecastTds } from "./tdsForecast";

/** A cheque as the dialog holds it once its photo is uploaded and read. */
const cheque: PaymentModeValue = {
	...EMPTY_PAYMENT_MODE,
	mode: "Cheque",
	cheque_no: " 004512 ",
	cheque_date: "2026-09-19",
	amount: "49000",
	attachment: "/private/files/cheque.jpg",
};

describe("paymentMode", () => {
	it("an online request needs nothing more and sends only its mode", () => {
		expect(isPaymentModeComplete(EMPTY_PAYMENT_MODE, "")).toBe(true);
		expect(paymentModeArgs(EMPTY_PAYMENT_MODE)).toEqual({ mode_of_payment: "Online" });
	});

	it("a cheque needs its photo, number, date and amount", () => {
		expect(isPaymentModeComplete(cheque, "")).toBe(true);
		expect(isPaymentModeComplete({ ...cheque, attachment: "" }, "")).toBe(false);
		expect(isPaymentModeComplete({ ...cheque, cheque_no: "  " }, "")).toBe(false);
		expect(isPaymentModeComplete({ ...cheque, cheque_date: "" }, "")).toBe(false);
		expect(isPaymentModeComplete({ ...cheque, amount: "" }, "")).toBe(false);
		expect(isPaymentModeComplete({ ...cheque, amount: 0 }, "")).toBe(false);
	});

	it("a cheque cannot be requested while its photo is read, or once its number is already recorded", () => {
		expect(isPaymentModeComplete({ ...cheque, photoBusy: true }, "")).toBe(false);
		expect(isPaymentModeComplete(cheque, "CHQ-26-00007")).toBe(false);
	});

	it("sends the cheque trimmed, leading zeros kept, drawn on ICICI Bank", () => {
		expect(paymentModeArgs(cheque)).toEqual({
			mode_of_payment: "Cheque",
			bank: "ICICI Bank",
			cheque_no: "004512",
			cheque_date: "2026-09-19",
			cheque_amount: 49000,
			cheque_attachment: "/private/files/cheque.jpg",
		});
	});

	it("a Payment cheque is always drawn on ICICI Bank, the only bank whose statement clears it (#1516)", () => {
		expect(paymentModeArgs(cheque)).toMatchObject({ bank: "ICICI Bank" });
		expect(paymentModeArgs(cheque)).not.toHaveProperty("bank_name");
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

		it("a GST payment is never taxed and is written for the full amount", () => {
			expect(chequeAmountFor(50000, forecastTds("Service Requests", 50000, 2, false, true))).toBe(50000);
		});

		it("a Procurement Order has no TDS and is written for the amount", () => {
			expect(chequeAmountFor(50000, forecastTds("Procurement Orders", 50000, 2))).toBe(50000);
		});
	});

	describe("chequeAmountHint: a soft warning on the cheque's amount, never a block", () => {
		const wo = forecastTds("Service Requests", 50000, 2);

		it("says nothing when the cheque matches what it should be written for, within ₹2", () => {
			expect(chequeAmountHint(49000, 50000, wo)).toBeNull();
			expect(chequeAmountHint("49001.5", 50000, wo)).toBeNull();
			expect(chequeAmountHint(50000, 50000, null)).toBeNull();
		});

		it("says nothing before there is an amount", () => {
			expect(chequeAmountHint("", 50000, wo)).toBeNull();
		});

		it("on a Work Order, names a cheque written for the gross amount", () => {
			expect(chequeAmountHint(50000, 50000, wo)).toEqual({ kind: "gross", expected: 49000, gross: 50000, tds: 1000 });
		});

		it("names any other difference", () => {
			expect(chequeAmountHint(45000, 50000, wo)).toEqual({ kind: "differs", expected: 49000, gross: 50000, tds: 1000 });
			expect(chequeAmountHint(45000, 50000, null)).toEqual({ kind: "differs", expected: 50000, gross: 50000, tds: 0 });
		});

		it("a company-borne Work Order's cheque is the full amount, so the gross is right", () => {
			expect(chequeAmountHint(50000, 50000, forecastTds("Service Requests", 50000, 2, true))).toBeNull();
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

describe("chequeModeOffered", () => {
	it("offers Cheque on a PO payment only: a Work Order payment is paid Online (spec #1477)", () => {
		expect(chequeModeOffered("Procurement Orders")).toBe(true);
		expect(chequeModeOffered("Service Requests")).toBe(false);
	});
});
