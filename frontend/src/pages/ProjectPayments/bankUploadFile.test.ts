import { describe, expect, it } from "vitest";

import { buildBankFile, describeLeftOut, describeSwitched, type BankFileRow } from "./bankUploadFile";

// 2026-10-14 09:30:00.000 local time; Date.now() for it ends in the ten digits the
// Cashfree transferId takes.
const NOW = new Date(2026, 9, 14, 9, 30, 0, 0);
const STAMP = String(NOW.getTime()).slice(-10);

const vendorPayment = (over: Partial<BankFileRow> = {}): BankFileRow => ({
	kind: "vendor_payment",
	documentName: "PO/001/26-27",
	amount: 125000.5,
	projectLabel: "Tower A",
	account: { account_name: "ACME TRADERS PVT LTD", account_number: "0050200012345", ifsc: "HDFC0001234" },
	...over,
});

const ICICI = { format: "icici", paymentMode: "IMPS", debitAccountNumber: "093705003327", now: NOW } as const;
const CASHFREE = { format: "cashfree", paymentMode: "NEFT", debitAccountNumber: "093705003327", now: NOW } as const;

describe("buildBankFile — ICICI", () => {
	it("pays a vendor payment into its own pay-to account, in today's PAB_VENDOR columns and order", () => {
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

	it("names the beneficiary by the pay-to account's holder name, never the vendor's", () => {
		const file = buildBankFile(
			[vendorPayment({ account: { account_name: "SAFETYWALA EQUIPMENTS LLP", account_number: "50200012345", ifsc: "HDFC0001234" } })],
			CASHFREE,
		);

		expect(file.rows[0].name).toBe("SAFETYWALA EQUIPMENTS LLP");
	});

	it("keeps the holder name as the copy holds it, trimmed, even when it is not a name", () => {
		const file = buildBankFile(
			[
				vendorPayment({ account: { account_name: "  R. Kumar  ", account_number: "1234", ifsc: "SBIN0000001" } }),
				vendorPayment({ account: { account_name: " 50200012345 ", account_number: "50200012345", ifsc: "HDFC0001234" } }),
			],
			CASHFREE,
		);

		expect(file.rows.map((r) => r.name)).toEqual(["R. Kumar", "50200012345"]);
	});
});

describe("buildBankFile — file name", () => {
	it("names the file after the format and today's date", () => {
		// formatDate spells the month in the runtime's locale, so only its day and year are pinned.
		expect(buildBankFile([vendorPayment()], ICICI).fileName).toMatch(/^New_Payments_14-.+-2026\.csv$/);
		expect(buildBankFile([vendorPayment()], CASHFREE).fileName).toMatch(/^Cashfree_Payments_14-.+-2026\.csv$/);
	});
});

describe("buildBankFile — expenses", () => {
	const expense = (over: Partial<BankFileRow> = {}): BankFileRow => ({
		kind: "expense",
		documentName: "PE-2026-00841",
		amount: 25000,
		projectLabel: "Whitefield Tower B",
		account: { account_name: "Ramesh Kumar Yadav", account_number: "36147100982211", ifsc: "SBIN0003435" },
		...over,
	});

	it("pays an expense into its own pay-to account, in both files", () => {
		expect(buildBankFile([expense()], ICICI).csv.split("\r\n")[1]).toBe(
			"PAB_VENDOR,IMPS,093705003327,Ramesh Kumar Yadav,36147100982211,SBIN0003435,25000,,,,,PE-2026-00841,14-10-2026,,,,,,,",
		);
		expect(buildBankFile([expense()], CASHFREE).csv.split("\r\n")[1]).toBe(
			`${STAMP}01,36147100982211,SBIN0003435,Ramesh Kumar Yadav,accounts@nirmaan.app,8904007419,25000,Whitefield Tower B - PE-2026-00841,neft`,
		);
	});

	it("puts vendor payments and expenses of one selection in one file", () => {
		const file = buildBankFile([vendorPayment(), expense()], CASHFREE);

		expect(file.rows.map((r) => [r.transferId, r.name])).toEqual([
			[`${STAMP}01`, "ACME TRADERS PVT LTD"],
			[`${STAMP}02`, "Ramesh Kumar Yadav"],
		]);
		expect(file.leftOut).toEqual([]);
	});
});

describe("buildBankFile — a PO payment paid into its vendor's current account (#1463)", () => {
	const vendorNow = { account_name: "ACME TRADERS PVT LTD", account_number: "50100234567812", ifsc: "ICIC0000456" };
	const changed = vendorPayment({ documentName: "PO/009/26-27", switchTo: vendorNow });
	const raisedWithNone = vendorPayment({ documentName: "PO/010/26-27", account: undefined, switchTo: vendorNow });

	it("pays a payment whose vendor's account changed into the vendor's current account, in both files", () => {
		expect(buildBankFile([changed], ICICI).csv.split("\r\n")[1]).toBe(
			"PAB_VENDOR,IMPS,093705003327,ACME TRADERS PVT LTD,50100234567812,ICIC0000456,125000.5,,,,,PO/009/26-27,14-10-2026,,,,,,,",
		);
		expect(buildBankFile([changed], CASHFREE).rows[0]).toMatchObject({
			bankAccount: "50100234567812",
			ifsc: "ICIC0000456",
			name: "ACME TRADERS PVT LTD",
		});
	});

	it("pays a payment raised with no account into its vendor's account, never leaving it out", () => {
		const file = buildBankFile([raisedWithNone], ICICI);

		expect(file.leftOut).toEqual([]);
		expect(file.rows[0]).toMatchObject({ BENE_ACC_NO: "50100234567812", BENE_IFSC: "ICIC0000456" });
	});

	it("lists the switched rows so the export can say how many, and leaves the others off the list", () => {
		const file = buildBankFile([changed, vendorPayment(), raisedWithNone], ICICI);

		expect(file.switched).toEqual([changed, raisedWithNone]);
		expect(describeSwitched(file.switched)).toBe(
			"2 payments paid into their vendor's current account (PO/009/26-27; PO/010/26-27)",
		);
		expect(describeSwitched(buildBankFile([changed], ICICI).switched)).toBe(
			"1 payment paid into its vendor's current account (PO/009/26-27)",
		);
		expect(describeSwitched([])).toBeNull();
	});
});

describe("buildBankFile — rows left out", () => {
	const noAccountExpense = (documentName: string, over: Partial<BankFileRow> = {}): BankFileRow => ({
		kind: "expense",
		documentName,
		amount: 900,
		projectLabel: "Tower A",
		description: "Hotel stay for site team\nA/c 1234",
		expenseType: "Accommodation",
		...over,
	});
	const expense = noAccountExpense("PE-2026-00900");
	const noPayee = (documentName: string) => vendorPayment({ documentName, account: undefined });
	const [noPayee2, noPayee3, noPayee4] = ["PO/002/26-27", "PO/003/26-27", "PO/004/26-27"].map(noPayee);

	it("leaves out expenses and vendor payments with no pay-to account of their own, saying why", () => {
		const payable = vendorPayment();
		const file = buildBankFile([expense, noPayee2, payable, noPayee3, noPayee4], ICICI);

		expect(file.rows.map((r) => r.REMARK)).toEqual(["PO/001/26-27"]);
		expect(file.leftOut).toEqual([
			{ row: expense, reason: "expense_has_no_account" },
			{ row: noPayee2, reason: "payment_has_no_account" },
			{ row: noPayee3, reason: "payment_has_no_account" },
			{ row: noPayee4, reason: "payment_has_no_account" },
		]);
	});

	it("numbers Cashfree transferIds over the rows in the file only", () => {
		const file = buildBankFile([noPayee2, vendorPayment(), expense, vendorPayment()], CASHFREE);

		expect(file.rows.map((r) => r.transferId)).toEqual([`${STAMP}01`, `${STAMP}02`]);
	});

	it("produces an empty file when no row can be paid", () => {
		const file = buildBankFile([expense, noPayee2], ICICI);

		expect(file.rows).toEqual([]);
		expect(file.leftOut).toHaveLength(2);
	});

	it("names the left-out rows the way the toast says them: a payment by its PO / SR, an expense by what it is", () => {
		const fourNoPayee = [noPayee2, noPayee3, noPayee4, noPayee("PO/005/26-27")];
		const expense2 = noAccountExpense("NPE-2026-00012", { description: "", expenseType: "Travel", amount: 12500 });

		expect(describeLeftOut(buildBankFile([expense], ICICI).leftOut)).toEqual([
			"1 expense with no account (Hotel stay for site team ₹900)",
		]);
		expect(describeLeftOut(buildBankFile([noPayee2], ICICI).leftOut)).toEqual([
			"1 payment with no account (PO/002/26-27)",
		]);
		expect(describeLeftOut(buildBankFile([expense, expense2, ...fourNoPayee], ICICI).leftOut)).toEqual([
			"2 expenses with no account (Hotel stay for site team ₹900; Travel ₹12,500)",
			"4 payments with no account (PO/002/26-27; PO/003/26-27; PO/004/26-27; …)",
		]);
		expect(describeLeftOut([])).toEqual([]);
	});

	it("never names a left-out expense by its ID, and keeps a long description short", () => {
		const long = noAccountExpense("0ni7ufc29r", { description: "Advance to the shuttering contractor for the third floor slab" });
		const bare = noAccountExpense("mpc0t7hd08", { description: undefined, expenseType: undefined });

		expect(describeLeftOut(buildBankFile([long, bare], ICICI).leftOut)).toEqual([
			"2 expenses with no account (Advance to the shuttering cont… ₹900; Expense ₹900)",
		]);
	});
});
