import { unparse } from "papaparse";

import type { ShownSwitch, TakeVendorAccountsAnswer } from "@/components/payees/paidToApi";
import type { PayToAccount } from "@/types/NirmaanStack/Payee";
import { formatDate, formatDateToDDMMYYYY } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import {
	ELIGIBILITY_REASON,
	expenseTitle,
	leaveOutSkipped,
	rowEligibility,
	type IneligibleReason,
	type KeptOutReason,
	type PaidTo,
	type SkippedRow,
} from "@/utils/payees/paidTo";

/** Which bulk-transfer file to emit. ICICI's PAB_VENDOR layout and Cashfree's payout template share no columns. */
export type BankFileFormat = "icici" | "cashfree";

/** The account a row is paid into: its holder name, account number and IFSC. */
export type BankFileAccount = Pick<PayToAccount, "account_name" | "account_number" | "ifsc">;

/** One ticked row on "Payment need to paid", with the account it is paid into. */
export interface BankFileRow {
	kind: "vendor_payment" | "expense";
	/** The record's own ID (the payment's or the expense's): what `take_vendor_accounts` is sent. */
	name: string;
	/** PO / SR number, or the expense's ID: the ICICI remark and the tail of the Cashfree remark. */
	documentName: string;
	amount: number | string;
	projectLabel: string | undefined;
	/** An expense's description and type: how the toast names it when it is left out, since its ID
	 *  means nothing to an accountant. Unused on a PO / WO payment, named by its PO / SR. */
	description?: string;
	expenseType?: string;
	/** Who the server says the row is paid to, read at export (`get_paid_to`): its own pay-to account
	 *  (ADR-0033, #1438), or for a PO / WO payment whose vendor's account changed since it was raised,
	 *  or that was raised with none, its vendor's current account (`switch_to`, #1463), which the
	 *  export writes onto the payment (`take_vendor_accounts`, whose answer replaces this one:
	 *  `withTakenAccounts`). `rowEligibility` reads it to decide whether the row goes in the file (#1464). */
	paidTo: PaidTo | undefined;
	/** A PO / WO payment's vendor account the Paid to cell showed it is paid into (its `switch_to` as the
	 *  page loaded it), or null when the cell showed no switch: what `take_vendor_accounts` checks its
	 *  own decision against, since the payer must be told before a payment's account is replaced. */
	shownSwitchTo?: PayToAccount | null;
}

export interface BankFileOptions {
	format: BankFileFormat;
	paymentMode: string;
	/** ICICI only: Cashfree's source account is fixed on the Cashfree side. */
	debitAccountNumber: string;
	now: Date;
}

/** Why a ticked row is not in the bank file: it is Ineligible, or kept out of the bank file
 *  (`rowEligibility`, #1464). */
export type BankFileLeftOutReason = IneligibleReason | KeptOutReason;

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
	/** The ticked rows the file pays, in order (one per file row). */
	payable: BankFileRow[];
	leftOut: BankFileLeftOut[];
	/** The rows in the file paid into their vendor's current account (`switch_to`), in order. */
	switched: BankFileRow[];
	csv: string;
	fileName: string;
}

/** The account a row in the file is paid into: its vendor's current one when it switches, else its own. */
const paidInto = (row: BankFileRow): BankFileAccount | undefined => row.paidTo?.switch_to ?? row.paidTo?.account ?? undefined;

function iciciRow(row: BankFileRow, options: BankFileOptions): Record<string, BankFileCell> {
	const payee = paidInto(row);
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
	const payee = paidInto(row);
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
		const eligibility = rowEligibility(row.paidTo, row.expenseType ?? "");
		if (eligibility.kind === "payable") payable.push(row);
		else leftOut.push({ row, reason: eligibility.reason });
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
	return {
		rows: fileRows,
		payable,
		leftOut,
		switched: payable.filter((row) => row.paidTo?.switch_to),
		csv: unparse(fileRows),
		fileName,
	};
}

/** What Export for Payment sends `take_vendor_accounts`: every PO / WO payment the file pays, with the
 *  switch the payer was shown for it (`shownSwitchTo`). */
export function shownSwitches(file: BankFile): ShownSwitch[] {
	return file.payable
		.filter((row) => row.kind === "vendor_payment")
		.map((row) => ({ name: row.name, shown: row.shownSwitchTo ?? null }));
}

const isVendorPayment = (row: BankFileRow): boolean => row.kind === "vendor_payment";

/**
 * The rows with each PO / WO payment's answer replaced by the one `take_vendor_accounts` acted on (#1463),
 * so the file pays exactly the account each payment now records, and without each payment it skipped
 * as no longer Approved (`leaveOutSkipped`; `skipped`, for `describeSkipped` to name). A row the server
 * did not answer keeps its own.
 */
export function withTakenAccounts(
	rows: BankFileRow[],
	answer: TakeVendorAccountsAnswer,
): { rows: BankFileRow[]; skipped: SkippedRow<BankFileRow>[] } {
	const answers = new Map(answer.taken.map((t) => [t.name, t.paid_to]));
	const { kept, skipped } = leaveOutSkipped(rows, answer.skipped, isVendorPayment);
	return {
		rows: kept.map((row) => {
			const paidTo = isVendorPayment(row) ? answers.get(row.name) : undefined;
			return paidTo ? { ...row, paidTo } : row;
		}),
		skipped,
	};
}

/**
 * What the page does once `take_vendor_accounts` has answered: `refetch` the list when a payment was
 * switched (its Paid to cell now reads the new account) or skipped (it has left the tab), and
 * `clearTicks` whenever the file was saved or the list is refetched, even when every row was skipped.
 * Ticks are kept by row position (the table has no getRowId), so after a refetch they would sit on
 * other payments, which the bank file and Mark as Paid then act on.
 */
export function afterExport(file: BankFile, skipped: readonly unknown[]): { clearTicks: boolean; refetch: boolean } {
	const refetch = file.switched.length > 0 || skipped.length > 0;
	return { clearTicks: refetch || file.rows.length > 0, refetch };
}

// ICICI and Cashfree both accept a file holding a row with a blank account or IFSC, and reject
// that row only after upload, so a row with no account is left out here, not at the bank
// (`rowEligibility`: only a row with an account, or one to switch to, is payable). A copy always
// holds a holder name, an account number and an IFSC (it is a Payee's), and so does the vendor
// account a payment switches to. A cheque payment is left out whatever its account: putting it in
// the file would pay the vendor twice.

/** Each left-out reason as the toast words it, for `count` rows, in the order the toast lists them. */
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;
const LEFT_OUT_PHRASES: Record<BankFileLeftOutReason, (count: number) => string> = {
	[ELIGIBILITY_REASON.CHEQUE]: (n) => `${plural(n, "payment")} by cheque`,
	[ELIGIBILITY_REASON.CARD_OR_CASH]: (n) => `${plural(n, "expense")} with no account, paid by card or cash`,
	[ELIGIBILITY_REASON.REQUIRED_TYPE_HAS_NO_ACCOUNT]: (n) => `${plural(n, "expense")} with no account that ${n > 1 ? "need" : "needs"} one`,
	[ELIGIBILITY_REASON.VENDOR_HAS_NO_ACCOUNT]: (n) => `${plural(n, "payment")} with no account, whose vendor has none`,
};

/** How many rows of the file were paid into their vendor's current account, naming the first three by
 *  their PO / SR, e.g. "2 payments paid into their vendor's current account (PO/009; PO/010)"; null
 *  when none. The export toast says it: those payments' accounts were just changed. */
export function describeSwitched(switched: BankFileRow[]): string | null {
	const n = switched.length;
	if (n === 0) return null;
	const names = switched.slice(0, 3).map((row) => row.documentName).join("; ") + (n > 3 ? "; …" : "");
	return `${n} payment${n > 1 ? "s" : ""} paid into ${n > 1 ? "their" : "its"} vendor's current account (${names})`;
}

/** How the toast names a left-out row: a PO / WO payment by its PO / SR, an expense by its
 *  description (or type) and amount, short enough for three in a toast. */
const LEFT_OUT_NAME_MAX = 30;
const leftOutName = (row: BankFileRow): string =>
	row.kind === "expense"
		? `${expenseTitle(row.description, row.expenseType || "Expense", LEFT_OUT_NAME_MAX)} ${formatToRoundedIndianRupee(row.amount)}`
		: row.documentName;

/**
 * The left-out rows as phrases for the export toast, one per reason, naming the first three, e.g.
 * "2 expenses with no account, paid by card or cash (Hotel stay for site team ₹900; Travel ₹12,500)". The accountant must
 * know the file is shorter than their selection, and which rows still need paying by hand.
 */
export function describeLeftOut(leftOut: BankFileLeftOut[]): string[] {
	return (Object.keys(LEFT_OUT_PHRASES) as BankFileLeftOutReason[]).flatMap((reason) => {
		const names = leftOut.filter((l) => l.reason === reason).map((l) => leftOutName(l.row));
		if (names.length === 0) return [];
		const list = names.slice(0, 3).join("; ") + (names.length > 3 ? "; …" : "");
		return [`${LEFT_OUT_PHRASES[reason](names.length)} (${list})`];
	});
}
