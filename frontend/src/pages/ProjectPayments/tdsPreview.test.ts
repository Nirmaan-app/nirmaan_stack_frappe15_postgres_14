import { describe, expect, it } from "vitest";

import { paymentTableFigures, requestPreviewLines, toTdsForecast } from "./tdsPreview";

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

	it("shows the amount alone when there is no tax", () => {
		expect(paymentTableFigures(1800, undefined, undefined)).toEqual({
			requested: 1800, tds: undefined, toBePaid: 1800, companyOnTop: false, forecast: false,
		});
	});
});
