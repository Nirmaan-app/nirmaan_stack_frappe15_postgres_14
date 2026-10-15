import { unparse } from "papaparse";

import type { PayToAccount } from "@/types/NirmaanStack/Payee";
import { formatDate, formatDateToDDMMYYYY } from "@/utils/FormatDate";
import { parseNumber } from "@/utils/parseNumber";
import { PAID_TO_MISSING, type PaidToMissing } from "@/utils/payees/paidTo";

/** Which bulk-transfer file to emit. ICICI's PAB_VENDOR layout and Cashfree's payout template share no columns. */
export type BankFileFormat = "icici" | "cashfree";

/** The account a row is paid into: its holder name, account number and IFSC. */
export type BankFileAccount = Pick<PayToAccount, "account_name" | "account_number" | "ifsc">;

/** One ticked row on "Payment need to paid", with the account it is paid into. */
export interface BankFileRow {
	kind: "vendor_payment" | "expense";
	/** PO / SR number, or the expense's ID: the ICICI remark and the tail of the Cashfree remark. */
	documentName: string;
	amount: number | string;
	projectLabel: string | undefined;
	/** The row's own pay-to account, copied when it was raised (ADR-0033, #1438): never its vendor's
	 *  Payee as it reads now. */
	account?: BankFileAccount;
	/** Why the server says the row has no account to pay into (`get_paid_to`'s `missing`), if it has
	 *  none. */
	missing?: PaidToMissing | null;
}

export interface BankFileOptions {
	format: BankFileFormat;
	paymentMode: string;
	/** ICICI only: Cashfree's source account is fixed on the Cashfree side. */
	debitAccountNumber: string;
	now: Date;
}

/** Why a ticked row is not in the bank file. */
export type BankFileLeftOutReason = PaidToMissing;

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
	const payee = row.account;
	return {
		PYMT_PROD_TYPE_CODE: "PAB_VENDOR",
		PYMT_MODE: options.paymentMode,
		DEBIT_ACC_NO: options.debitAccountNumber,
		BNF_NAME: payee?.account_name || "",
		BENE_ACC_NO: payee?.account_number || "",
		BENE_IFSC: payee?.ifsc || "",
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
	const payee = row.account;
	return {
		transferId: `${batchStamp}${String(idx + 1).padStart(2, "0")}`,
		bankAccount: payee?.account_number || "",
		ifsc: payee?.ifsc || "",
		// The beneficiary is the pay-to account's holder name, the name the bank has on record. A holder
		// name that is not a name is corrected on the Payee (and the record re-raised), not patched here.
		name: (payee?.account_name || "").trim(),
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
// that row only after upload, so a row with no account is left out here, not at the bank. A copy
// always holds a holder name, an account number and an IFSC (it is a Payee's).
function leftOutReason(row: BankFileRow): BankFileLeftOutReason | null {
	if (row.missing) return row.missing;
	if (row.account) return null;
	return row.kind === "vendor_payment" ? PAID_TO_MISSING.PAYMENT_HAS_NO_ACCOUNT : PAID_TO_MISSING.EXPENSE_HAS_NO_ACCOUNT;
}

/** Each left-out reason as the toast words it, for `count` rows, in the order the toast lists them. */
const LEFT_OUT_PHRASES: Record<BankFileLeftOutReason, (count: number) => string> = {
	[PAID_TO_MISSING.EXPENSE_HAS_NO_ACCOUNT]: (n) => `${n} expense${n > 1 ? "s" : ""} with no account`,
	[PAID_TO_MISSING.PAYMENT_HAS_NO_ACCOUNT]: (n) => `${n} payment${n > 1 ? "s" : ""} with no account`,
};

/**
 * The left-out rows as phrases for the export toast, one per reason, naming the first three, e.g.
 * "2 expenses with no account (PE-2026-00841, NPE-2026-00012)". The accountant must know the file is
 * shorter than their selection, and which rows still need paying by hand.
 */
export function describeLeftOut(leftOut: BankFileLeftOut[]): string[] {
	return (Object.keys(LEFT_OUT_PHRASES) as BankFileLeftOutReason[]).flatMap((reason) => {
		const names = leftOut.filter((l) => l.reason === reason).map((l) => l.row.documentName);
		if (names.length === 0) return [];
		const list = names.slice(0, 3).join(", ") + (names.length > 3 ? ", …" : "");
		return [`${LEFT_OUT_PHRASES[reason](names.length)} (${list})`];
	});
}
