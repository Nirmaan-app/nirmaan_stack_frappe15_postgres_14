import { describe, expect, it } from "vitest";

import { forecastTds, forecastTdsTotals, isDeductible } from "./tdsForecast";

const SR = "Service Requests";
const PO = "Procurement Orders";

describe("forecastTds", () => {
	it("matches the server's worked case", () => {
		// PAY-00103-283: Rs 38,550 at 2% -> Rs 771.00 withheld -> Rs 37,779.00 to the vendor.
		expect(forecastTds(SR, 38550, 2)).toEqual({ ratePct: 2, tds: 771, net: 37779 });
	});

	it("rounds to 2 decimals the way flt(x, 2) does", () => {
		// 1333.33 @ 2% = 26.6666 -> 26.67, mirroring payment_tds.record_deduction.
		expect(forecastTds(SR, 1333.33, 2)).toEqual({ ratePct: 2, tds: 26.67, net: 1306.66 });
	});

	it("honours a rate that is not the 2% default", () => {
		// 537 of the 625 historical deductions were taken at 1%.
		expect(forecastTds(SR, 100000, 1)).toEqual({ ratePct: 1, tds: 1000, net: 99000 });
	});

	it("returns null for a Procurement Order — that ledger is not deducted from", () => {
		expect(forecastTds(PO, 38550, 2)).toBeNull();
	});

	it("returns null when the vendor has no rate", () => {
		expect(forecastTds(SR, 38550, 0)).toBeNull();
		expect(forecastTds(SR, 38550, null)).toBeNull();
		expect(forecastTds(SR, 38550, undefined)).toBeNull();
	});

	it("returns null on a refund or a zero payment", () => {
		// A negative Project Payment is a real, common document here.
		expect(forecastTds(SR, -5000, 2)).toBeNull();
		expect(forecastTds(SR, 0, 2)).toBeNull();
	});

	it("returns null rather than a zero forecast, so callers render nothing", () => {
		// A "Rs 0 TDS" chip on every PO row would train people to ignore the one place it matters.
		expect(forecastTds(PO, 1000, 2)).toBeNull();
	});

	it("refuses a deduction that would swallow the whole payment", () => {
		expect(forecastTds(SR, 1000, 100)).toBeNull();
		expect(forecastTds(SR, 1000, 150)).toBeNull();
	});

	it("reads string amounts and rates, as they arrive from Frappe", () => {
		expect(forecastTds(SR, "38550", "2")).toEqual({ ratePct: 2, tds: 771, net: 37779 });
	});

	it("forecasts the amount BEING APPROVED, not the amount requested", () => {
		// A partial CEO approval splits first, so the tax is taken on the typed figure.
		expect(forecastTds(SR, 10000, 2)?.tds).toBe(200);
		expect(forecastTds(SR, 25000, 2)?.tds).toBe(500);
	});

	it("trims the doctype, matching the server's stripped comparison", () => {
		expect(forecastTds(" Service Requests ", 1000, 2)?.tds).toBe(20);
	});
});

describe("isDeductible", () => {
	it("requires an SR parent, a positive amount and a positive rate", () => {
		expect(isDeductible(SR, 1000, 2)).toBe(true);
		expect(isDeductible(PO, 1000, 2)).toBe(false);
		expect(isDeductible(SR, -1, 2)).toBe(false);
		expect(isDeductible(SR, 1000, 0)).toBe(false);
		expect(isDeductible(undefined, 1000, 2)).toBe(false);
	});
});

describe("forecastTdsTotals", () => {
	const rate = () => 2;

	it("counts only the payments that are actually deducted from", () => {
		const rows = [
			{ document_type: SR, amount: 25000 }, // 500
			{ document_type: PO, amount: 90000 }, // excluded entirely
			{ document_type: SR, amount: 10000 }, // 200
		];
		expect(forecastTdsTotals(rows, rate)).toEqual({
			count: 2,
			tds: 700,
			gross: 35000, // ⚠️ the PO's 90,000 must NOT appear here
			net: 34300,
		});
	});

	it("is all-zero when nothing in the selection is deductible", () => {
		expect(forecastTdsTotals([{ document_type: PO, amount: 5000 }], rate)).toEqual({
			count: 0,
			tds: 0,
			gross: 0,
			net: 0,
		});
	});

	it("takes a per-row rate, so a 1% vendor and a 2% vendor can be selected together", () => {
		const rows = [
			{ document_type: SR, amount: 100000 },
			{ document_type: SR, amount: 100000 },
		];
		const rates = [1, 2];
		let i = 0;
		expect(forecastTdsTotals(rows, () => rates[i++]).tds).toBe(3000);
	});

	it("does not accumulate floating-point drift across many rows", () => {
		const rows = Array.from({ length: 100 }, () => ({ document_type: SR, amount: 1333.33 }));
		expect(forecastTdsTotals(rows, rate).tds).toBe(2667);
	});
});
