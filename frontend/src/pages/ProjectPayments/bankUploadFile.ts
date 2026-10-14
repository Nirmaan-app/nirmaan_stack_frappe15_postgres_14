import { unparse } from "papaparse";

import { formatDate, formatDateToDDMMYYYY } from "@/utils/FormatDate";
import { parseNumber } from "@/utils/parseNumber";

/** Which bulk-transfer file to emit. ICICI's PAB_VENDOR layout and Cashfree's payout template share no columns. */
export type BankFileFormat = "icici" | "cashfree";

/** The bank account a row is paid into. */
export interface BankFileAccount {
	holderName?: string;
	accountNumber?: string | number;
	ifsc?: string;
}

/** One ticked row on "Payment need to paid", with the account it is paid into. */
export interface BankFileRow {
	kind: "vendor_payment" | "expense";
	/** PO / SR number: the ICICI remark and the tail of the Cashfree remark. */
	documentName: string;
	amount: number | string;
	projectLabel: string | undefined;
	vendorName?: string;
	account?: BankFileAccount;
}

export interface BankFileOptions {
	format: BankFileFormat;
	paymentMode: string;
	/** ICICI only: Cashfree's source account is fixed on the Cashfree side. */
	debitAccountNumber: string;
	now: Date;
}

/** Why a ticked row is not in the bank file. */
export type BankFileLeftOutReason = "expense" | "no_account";

export interface BankFileLeftOut {
	row: BankFileRow;
	reason: BankFileLeftOutReason;
}

export type BankFileCell = string | number | undefined;

// Cashfree's contact columns are the payout-notification address, and Nirmaan wants those
// notifications at its own accounts desk, not at each payee. Fixed on every row by design: the
// payee is identified by bankAccount + ifsc, not by these.
const CASHFREE_CONTACT_EMAIL = "accounts@nirmaan.app";
const CASHFREE_CONTACT_PHONE = "8904007419";

export interface BankFile {
	rows: Record<string, BankFileCell>[];
	leftOut: BankFileLeftOut[];
	csv: string;
	fileName: string;
}

function iciciRow(row: BankFileRow, options: BankFileOptions): Record<string, BankFileCell> {
	const account = row.account;
	return {
		PYMT_PROD_TYPE_CODE: "PAB_VENDOR",
		PYMT_MODE: options.paymentMode,
		DEBIT_ACC_NO: options.debitAccountNumber,
		BNF_NAME: account?.holderName || "",
		BENE_ACC_NO: account?.accountNumber || "",
		BENE_IFSC: account?.ifsc || "",
		AMOUNT: parseNumber(row.amount),
		DEBIT_NARR: "",
		CREDIT_NARR: "",
		MOBILE_NUM: "",
		EMAIL_ID: "",
		REMARK: row.documentName,
		PYMT_DATE: formatDateToDDMMYYYY(options.now),
		REF_NO: "",
		ADDL_INFO1: "", ADDL_INFO2: "", ADDL_INFO3: "", ADDL_INFO4: "", ADDL_INFO5: "",
		LEI_NUMBER: "",
	};
}

function cashfreeRow(row: BankFileRow, idx: number, batchStamp: string, options: BankFileOptions): Record<string, BankFileCell> {
	const account = row.account;
	// Cashfree's `name` must be the ACCOUNT HOLDER's name, not the vendor's trading name. But
	// some records have the account NUMBER typed into the holder name (SAFETYWALA EQUIPMENTS LLP is
	// one). A name has at least one letter; if this one does not, fall back to the vendor name
	// rather than send Cashfree a number to match on.
	const holderName = (account?.holderName || "").trim();
	const name = /[A-Za-z]/.test(holderName) ? holderName : (row.vendorName || "");
	return {
		transferId: `${batchStamp}${String(idx + 1).padStart(2, "0")}`,
		bankAccount: account?.accountNumber || "",
		ifsc: account?.ifsc || "",
		name,
		email: CASHFREE_CONTACT_EMAIL,
		phone: CASHFREE_CONTACT_PHONE,
		amount: parseNumber(row.amount),
		remarks: `${row.projectLabel} - ${row.documentName}`,
		transferMode: options.paymentMode.toLowerCase(),
	};
}

/**
 * Builds the ICICI or Cashfree upload file from the ticked rows: the file rows, the CSV text,
 * and the rows left out with the reason for each.
 */
export function buildBankFile(rows: BankFileRow[], options: BankFileOptions): BankFile {
	const payable: BankFileRow[] = [];
	const leftOut: BankFileLeftOut[] = [];
	for (const row of rows) {
		const reason = leftOutReason(row);
		if (reason) leftOut.push({ row, reason });
		else payable.push(row);
	}

	// One stamp per file, shared by every row. Cashfree keys a payout on transferId and rejects one
	// it has already processed, so ids must never repeat across files. The time rather than a
	// random number, because it is certainly unique per export; its last 10 digits repeat only
	// every ~115 days.
	const batchStamp = String(options.now.getTime()).slice(-10);
	const fileRows = options.format === "cashfree"
		? payable.map((row, idx) => cashfreeRow(row, idx, batchStamp, options))
		: payable.map((row) => iciciRow(row, options));
	const fileName = options.format === "cashfree"
		? `Cashfree_Payments_${formatDate(options.now)}.csv`
		: `New_Payments_${formatDate(options.now)}.csv`;
	return { rows: fileRows, leftOut, csv: unparse(fileRows), fileName };
}

// ICICI and Cashfree both accept a file holding a row with a blank account or IFSC, and reject
// that row only after upload, so an unpayable row is left out here, not at the bank. BOTH the
// account number and the IFSC are required. The holder name needs no check: the Cashfree name
// falls back to the vendor name.
function leftOutReason(row: BankFileRow): BankFileLeftOutReason | null {
	if (row.kind !== "vendor_payment") return "expense";
	const accountNumber = String(row.account?.accountNumber ?? "").trim();
	const ifsc = String(row.account?.ifsc ?? "").trim();
	return accountNumber && ifsc ? null : "no_account";
}

/**
 * The left-out rows as phrases for the export toast, one per reason, e.g.
 * "2 expenses (no vendor)". The accountant must know the file is shorter than their selection.
 */
export function describeLeftOut(leftOut: BankFileLeftOut[]): string[] {
	const expenses = leftOut.filter((l) => l.reason === "expense").length;
	const noAccount = leftOut.filter((l) => l.reason === "no_account").map((l) => l.row.documentName);
	const parts: string[] = [];
	if (expenses > 0) {
		parts.push(`${expenses} expense${expenses > 1 ? "s" : ""} (no vendor)`);
	}
	if (noAccount.length > 0) {
		const named = noAccount.slice(0, 3).join(", ") + (noAccount.length > 3 ? ", …" : "");
		parts.push(`${noAccount.length} payment${noAccount.length > 1 ? "s" : ""} with no vendor bank account / IFSC (${named})`);
	}
	return parts;
}
