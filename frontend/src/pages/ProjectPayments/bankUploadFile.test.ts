import { describe, expect, it } from "vitest";

import { buildBankFile, describeLeftOut, type BankFileRow } from "./bankUploadFile";

// 2026-10-14 09:30:00.000 local time; Date.now() for it ends in the ten digits the
// Cashfree transferId takes.
const NOW = new Date(2026, 9, 14, 9, 30, 0, 0);
const STAMP = String(NOW.getTime()).slice(-10);

const vendorPayment = (over: Partial<BankFileRow> = {}): BankFileRow => ({
	kind: "vendor_payment",
	documentName: "PO/001/26-27",
	amount: 125000.5,
	projectLabel: "Tower A",
	vendorName: "Acme Traders",
	account: { holderName: "ACME TRADERS PVT LTD", accountNumber: "0050200012345", ifsc: "HDFC0001234" },
	...over,
});

const ICICI = { format: "icici", paymentMode: "IMPS", debitAccountNumber: "093705003327", now: NOW } as const;
const CASHFREE = { format: "cashfree", paymentMode: "NEFT", debitAccountNumber: "093705003327", now: NOW } as const;

describe("buildBankFile — ICICI", () => {
	it("writes today's PAB_VENDOR columns, in today's order", () => {
		const file = buildBankFile([vendorPayment()], ICICI);

		expect(file.csv).toBe(
			"PYMT_PROD_TYPE_CODE,PYMT_MODE,DEBIT_ACC_NO,BNF_NAME,BENE_ACC_NO,BENE_IFSC,AMOUNT,DEBIT_NARR,CREDIT_NARR,MOBILE_NUM,EMAIL_ID,REMARK,PYMT_DATE,REF_NO,ADDL_INFO1,ADDL_INFO2,ADDL_INFO3,ADDL_INFO4,ADDL_INFO5,LEI_NUMBER\r\n" +
			"PAB_VENDOR,IMPS,093705003327,ACME TRADERS PVT LTD,0050200012345,HDFC0001234,125000.5,,,,,PO/001/26-27,14-10-2026,,,,,,,",
		);
		expect(file.leftOut).toEqual([]);
	});
});

describe("buildBankFile — Cashfree", () => {
	it("writes today's payout-template columns, numbering transferIds from one stamp", () => {
		const file = buildBankFile(
			[vendorPayment(), vendorPayment({ documentName: "SR/007/26-27", amount: "4000", projectLabel: "Villa 3" })],
			CASHFREE,
		);

		expect(file.csv).toBe(
			"transferId,bankAccount,ifsc,name,email,phone,amount,remarks,transferMode\r\n" +
			`${STAMP}01,0050200012345,HDFC0001234,ACME TRADERS PVT LTD,accounts@nirmaan.app,8904007419,125000.5,Tower A - PO/001/26-27,neft\r\n` +
			`${STAMP}02,0050200012345,HDFC0001234,ACME TRADERS PVT LTD,accounts@nirmaan.app,8904007419,4000,Villa 3 - SR/007/26-27,neft`,
		);
	});

	it("names the vendor when the account holder name has no letters in it", () => {
		const numberTypedAsName = vendorPayment({
			vendorName: "SAFETYWALA EQUIPMENTS LLP",
			account: { holderName: " 50200012345 ", accountNumber: "50200012345", ifsc: "HDFC0001234" },
		});
		const blankName = vendorPayment({
			vendorName: "Blank Name Co",
			account: { holderName: "", accountNumber: "1234", ifsc: "SBIN0000001" },
		});

		const file = buildBankFile([numberTypedAsName, blankName], CASHFREE);

		expect(file.rows.map((r) => r.name)).toEqual(["SAFETYWALA EQUIPMENTS LLP", "Blank Name Co"]);
	});

	it("keeps a holder name that has letters, trimmed", () => {
		const file = buildBankFile(
			[vendorPayment({ account: { holderName: "  R. Kumar  ", accountNumber: "1234", ifsc: "SBIN0000001" } })],
			CASHFREE,
		);

		expect(file.rows[0].name).toBe("R. Kumar");
	});
});

describe("buildBankFile — file name", () => {
	it("names the file after the format and today's date", () => {
		// formatDate spells the month in the runtime's locale, so only its day and year are pinned.
		expect(buildBankFile([vendorPayment()], ICICI).fileName).toMatch(/^New_Payments_14-.+-2026\.csv$/);
		expect(buildBankFile([vendorPayment()], CASHFREE).fileName).toMatch(/^Cashfree_Payments_14-.+-2026\.csv$/);
	});
});

describe("buildBankFile — rows left out", () => {
	const expense: BankFileRow = {
		kind: "expense",
		documentName: "Site diesel",
		amount: 900,
		projectLabel: "Tower A",
		vendorName: "Acme Traders",
		account: { holderName: "ACME TRADERS PVT LTD", accountNumber: "0050200012345", ifsc: "HDFC0001234" },
	};
	const noIfsc = vendorPayment({
		documentName: "PO/002/26-27",
		account: { holderName: "X", accountNumber: "1234", ifsc: "  " },
	});
	const noAccountNumber = vendorPayment({
		documentName: "PO/003/26-27",
		account: { holderName: "X", accountNumber: "", ifsc: "SBIN0000001" },
	});
	const noAccountAtAll = vendorPayment({ documentName: "PO/004/26-27", account: undefined });

	it("leaves out expenses, and vendor payments missing the account number or IFSC, saying why", () => {
		const payable = vendorPayment();
		const file = buildBankFile([expense, noIfsc, payable, noAccountNumber, noAccountAtAll], ICICI);

		expect(file.rows.map((r) => r.REMARK)).toEqual(["PO/001/26-27"]);
		expect(file.leftOut).toEqual([
			{ row: expense, reason: "expense" },
			{ row: noIfsc, reason: "no_account" },
			{ row: noAccountNumber, reason: "no_account" },
			{ row: noAccountAtAll, reason: "no_account" },
		]);
	});

	it("numbers Cashfree transferIds over the rows in the file only", () => {
		const file = buildBankFile([noIfsc, vendorPayment(), expense, vendorPayment()], CASHFREE);

		expect(file.rows.map((r) => r.transferId)).toEqual([`${STAMP}01`, `${STAMP}02`]);
	});

	it("produces an empty file when no row can be paid", () => {
		const file = buildBankFile([expense, noIfsc], ICICI);

		expect(file.rows).toEqual([]);
		expect(file.leftOut).toHaveLength(2);
	});

	it("names the left-out rows the way the toast says them", () => {
		const fourNoBank = [noIfsc, noAccountNumber, noAccountAtAll, vendorPayment({ documentName: "PO/005/26-27", account: undefined })];

		expect(describeLeftOut(buildBankFile([expense], ICICI).leftOut)).toEqual(["1 expense (no vendor)"]);
		expect(describeLeftOut(buildBankFile([noIfsc], ICICI).leftOut)).toEqual([
			"1 payment with no vendor bank account / IFSC (PO/002/26-27)",
		]);
		expect(describeLeftOut(buildBankFile([expense, expense, ...fourNoBank], ICICI).leftOut)).toEqual([
			"2 expenses (no vendor)",
			"4 payments with no vendor bank account / IFSC (PO/002/26-27, PO/003/26-27, PO/004/26-27, …)",
		]);
		expect(describeLeftOut([])).toEqual([]);
	});
});
