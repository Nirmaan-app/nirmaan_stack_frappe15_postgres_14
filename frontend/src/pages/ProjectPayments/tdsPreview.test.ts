import { describe, expect, it } from "vitest";

import { forecastTotals, paymentTableFigures, requestPreviewLines, tdsColumnNote, toTdsForecast } from "./tdsPreview";

const VENDOR_BORNE = { rate: 2, tds: 200, vendor_gets: 9800, borne_by: "Vendor" } as const;
const COMPANY_BORNE = { rate: 2, tds: 200, vendor_gets: 10000, borne_by: "Company" } as const;

describe("requestPreviewLines", () => {
	it("says the rate, the tax and what the vendor gets when the tax is withheld", () => {
		expect(requestPreviewLines(VENDOR_BORNE, false)).toEqual(["TDS 2%: ₹200.00 · Vendor gets ₹9,800.00"]);
	});

	it("says the company pays the tax on top on a Misc / Transport Work Order", () => {
		expect(requestPreviewLines(COMPANY_BORNE, false)).toEqual([
			"Vendor gets ₹10,000.00 · TDS ₹200.00 paid by company on top",
		]);
	});

	it("adds that the tax is cut now when the request is approved at once", () => {
		expect(requestPreviewLines(VENDOR_BORNE, true)).toEqual([
			"TDS 2%: ₹200.00 · Vendor gets ₹9,800.00",
			"Tax is cut now",
		]);
	});

	it("says nothing when nothing will be withheld", () => {
		expect(requestPreviewLines(null, true)).toEqual([]);
		expect(requestPreviewLines(undefined, false)).toEqual([]);
	});
});

describe("toTdsForecast", () => {
	it("maps the server's answer onto the cheque fields' forecast", () => {
		expect(toTdsForecast(VENDOR_BORNE)).toEqual({ ratePct: 2, tds: 200, net: 9800 });
		expect(toTdsForecast(null)).toBeNull();
	});
});

describe("paymentTableFigures", () => {
	it("shows a waiting payment's forecast: the full bill, the tax and what will be paid", () => {
		expect(paymentTableFigures(20000, undefined, { rate: 2, tds: 400, vendor_gets: 19600, borne_by: "Vendor" })).toEqual({
			requested: 20000, tds: 400, toBePaid: 19600, companyOnTop: false, forecast: true,
		});
	});

	it("adds the withheld tax back for an approved payment, whose amount is already cut", () => {
		expect(paymentTableFigures(9800, { tds_amount: 200, borne_by: "Vendor" }, undefined)).toEqual({
			requested: 10000, tds: 200, toBePaid: 9800, companyOnTop: false, forecast: false,
		});
	});

	it("keeps a company-borne payment whole: the tax is on top", () => {
		expect(paymentTableFigures(10000, { tds_amount: 200, borne_by: "Company" }, undefined)).toEqual({
			requested: 10000, tds: 200, toBePaid: 10000, companyOnTop: true, forecast: false,
		});
	});

	it("reads the server's full bill when it gives one: a cut payment marked TDS paid by company (walk W5)", () => {
		// 16,000 cut to 15,840 by 160, then marked TDS paid by company before Paid: no figure moved (story 46).
		expect(paymentTableFigures(15840, { tds_amount: 160, borne_by: "Company", requested_amount: 16000 }, undefined)).toEqual({
			requested: 16000, tds: 160, toBePaid: 15840, companyOnTop: true, forecast: false,
		});
	});

	it("shows the amount alone when there is no tax", () => {
		expect(paymentTableFigures(1800, undefined, undefined)).toEqual({
			requested: 1800, tds: undefined, toBePaid: 1800, companyOnTop: false, forecast: false,
		});
	});
});

describe("tdsColumnNote (the Work Order payment table labels company tax, #1543)", () => {
	it("labels tax the company paid on top, so it doesn't read as a deduction from the vendor", () => {
		const recorded = paymentTableFigures(10000, { tds_amount: 200, borne_by: "Company" }, undefined);
		expect(tdsColumnNote(recorded)).toBe("Company Bears TDS");
	});

	it("labels a waiting payment's company-borne forecast the same way", () => {
		expect(tdsColumnNote(paymentTableFigures(10000, undefined, COMPANY_BORNE))).toBe("Company Bears TDS");
	});

	it("has no label for tax withheld from the vendor, nor for a payment without tax", () => {
		expect(tdsColumnNote(paymentTableFigures(9800, { tds_amount: 200, borne_by: "Vendor" }, undefined))).toBeUndefined();
		expect(tdsColumnNote(paymentTableFigures(1800, undefined, undefined))).toBeUndefined();
	});
});

describe("forecastTotals (the bulk approve dialog, from the server's forecasts)", () => {
	it("adds only the payments the server forecasts tax on, so the figures describe one subset", () => {
		const rows = [
			{ name: "PAY-1", amount: 10000 },
			{ name: "PAY-2", amount: 10000 },
			{ name: "PAY-PO", amount: 70000 }, // a PO payment: no forecast, adds nothing
		];
		expect(forecastTotals(rows, { "PAY-1": VENDOR_BORNE, "PAY-2": COMPANY_BORNE })).toEqual({
			count: 2,
			tds: 400,
			companyBorneTds: 200,
			gross: 20000,
			net: 19800,
		});
	});

	it("is all zero with no forecasts", () => {
		expect(forecastTotals([{ name: "PAY-1", amount: 10000 }], {})).toEqual({
			count: 0, tds: 0, companyBorneTds: 0, gross: 0, net: 0,
		});
	});
});
