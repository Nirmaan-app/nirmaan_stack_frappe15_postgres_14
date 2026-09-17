/**
 * What TDS an approval is about to withhold — the forecast the approver sees before clicking.
 *
 * ⚠️ "TDS" HERE IS **TAX DEDUCTED AT SOURCE ON A VENDOR PAYMENT**, not the Technical Data Sheet
 * doctypes (`TDS Items`, `TDS Repository`, `Project TDS Setting`). Same three letters, unrelated.
 *
 * ⚠️ THIS IS A FORECAST, NEVER AN INSTRUCTION. `services/payment_tds.py` computes the real figure
 * at the moment of approval, from the vendor's rate as it stands then, and writes it. Nothing here
 * is ever sent to the server: a posted figure would be a second source of truth for a financial
 * value, and a page left open across a rate change would write a stale one. The screen's only job
 * is to stop an approver being surprised by an amount that changes under them.
 *
 * Kept OUT of the components for the reason `paymentSplit.ts` states beside it: this repo has no
 * DOM test environment, so anything living inside a React component is structurally untestable.
 * Two surfaces read this — the single-approve dialog and the bulk confirm — and two inline copies
 * of the arithmetic would drift. It is deliberately NOT shown in the table columns (owner ruling
 * 2026-09-10): the figure matters at the moment of deciding, not while scanning a list.
 */

import { parseNumber } from "@/utils/parseNumber";
import { safeJsonParse } from "@/utils/safeJsonParse";

/** The only ledger whose payments are deducted from. Mirrors `payment_tds.DEDUCTIBLE_PARENTS`. */
export const TDS_PARENT_DOCTYPE = "Service Requests";

/**
 * Work Order categories whose TDS the COMPANY pays on top (owner ruling 2026-09-17): a Work Order
 * whose categories are ALL in this set keeps its payment whole — ₹800 approved, ₹16 TDS, the
 * vendor still receives ₹800.
 *
 * ⚠️ MIRRORS `payment_tds.COMPANY_BORNE_CATEGORIES` ON THE SERVER. Change both or neither.
 */
export const COMPANY_BORNE_CATEGORIES: ReadonlySet<string> = new Set([
	"Miscellaneous Services",
	"Transportation Services",
]);

/**
 * Is this Work Order company-borne, from its `service_category_list`?
 *
 * Accepts the field as Frappe sends it (a JSON string) or already parsed (`{ list: [{ name }] }`).
 * ⚠️ "ALL", NOT "ANY", and an empty or unreadable list is NOT company-borne — the same answer
 * `payment_tds.is_company_borne` gives.
 */
export const isCompanyBorneWorkOrder = (serviceCategoryList: unknown): boolean => {
	const parsed = safeJsonParse<{ list?: unknown } | null>(
		serviceCategoryList as string | { list?: unknown } | null | undefined,
		null
	);
	const list = parsed?.list;
	if (!Array.isArray(list)) return false;
	const names = list
		.map((entry) => (entry && typeof entry === "object" ? String((entry as { name?: unknown }).name ?? "").trim() : ""))
		.filter(Boolean);
	return names.length > 0 && names.every((name) => COMPANY_BORNE_CATEGORIES.has(name));
};

export interface TdsForecast {
	/** The rate applied, as a percentage. */
	ratePct: number;
	/** Tax that will be withheld. */
	tds: number;
	/**
	 * What will actually reach the vendor — and what `Project Payments.amount` becomes. The full
	 * amount on a company-borne Work Order, where the tax is paid on top.
	 */
	net: number;
}

/**
 * Round the way the server does.
 *
 * ⚠️ IT MUST MATCH `flt(gross * rate / 100.0, 2)` IN `payment_tds.record_deduction`. A forecast
 * that rounds differently is off by paise against the figure that actually lands, which is the
 * one way a preview like this becomes worse than showing nothing at all.
 */
const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Is this payment one that will be deducted from at all?
 *
 * Three facts, and each maps to a `null` return from the server's own path: a non-SR parent is
 * outside `DEDUCTIBLE_PARENTS`, a blank or zero vendor rate makes `vendor_rate` answer `None`, and
 * a non-positive amount has nothing to withhold from (a refund is a real, common document here).
 */
export const isDeductible = (
	documentType: string | undefined | null,
	amount: number,
	ratePct: number
): boolean =>
	(documentType || "").trim() === TDS_PARENT_DOCTYPE && amount > 0 && ratePct > 0;

/**
 * The forecast for ONE payment, or `null` when nothing will be withheld.
 *
 * `null` rather than a zero-valued forecast, deliberately: the callers render nothing for it, and
 * a "₹0 TDS" chip on every Procurement Order row would be noise that trains people to ignore the
 * one place it matters.
 *
 * ⚠️ `amount` IS THE AMOUNT BEING APPROVED, WHICH IS NOT ALWAYS THE AMOUNT REQUESTED. A partial
 * CEO approval splits the payment first, so the tax is taken on the figure the CEO typed, not on
 * the original request. The single-approve dialog must therefore pass its live input, not
 * `paymentData.amount` — that is the case where a static forecast is wrong on exactly the row
 * somebody is looking hardest at.
 */
export const forecastTds = (
	documentType: string | undefined | null,
	amount: number | string | undefined | null,
	ratePct: number | string | undefined | null,
	/** The Work Order is company-borne (`isCompanyBorneWorkOrder`): the payment is not reduced. */
	companyBorne = false
): TdsForecast | null => {
	const gross = parseNumber(amount);
	const rate = parseNumber(ratePct);
	if (!isDeductible(documentType, gross, rate)) return null;

	const tds = round2((gross * rate) / 100);
	// The server refuses a deduction that swallows the whole payment, and so does this: a net of
	// zero or less is bad data rather than a deduction, and no row would be written for it.
	if (tds <= 0 || tds >= gross) return null;

	return { ratePct: rate, tds, net: companyBorne ? gross : round2(gross - tds) };
};

export interface TdsTotals {
	/** How many of the payments will actually be deducted from. */
	count: number;
	/** Total tax withheld across them. */
	tds: number;
	/** The part of `tds` the company pays on top (company-borne Work Orders) rather than deducts. */
	companyBorneTds: number;
	/** Sum of the amounts of the deducted payments, before tax. */
	gross: number;
	/** What reaches the vendors, across the deducted payments. */
	net: number;
}

/**
 * Roll a bulk selection up. Payments that are not deducted from contribute NOTHING — not even to
 * `gross` — so the three figures always describe the same subset and can be read as one sentence.
 */
export const forecastTdsTotals = <T extends { document_type?: string; amount?: number | string }>(
	rows: ReadonlyArray<T>,
	// Generic in the row so a caller can look the rate up from any field it holds (`vendor`,
	// today) without this module needing to know the shape of a payment.
	rateFor: (row: T) => number,
	companyBorneFor: (row: T) => boolean = () => false
): TdsTotals => {
	let count = 0;
	let tds = 0;
	let companyBorneTds = 0;
	let gross = 0;
	let net = 0;
	for (const row of rows) {
		const borne = companyBorneFor(row);
		const f = forecastTds(row.document_type, row.amount, rateFor(row), borne);
		if (!f) continue;
		count += 1;
		tds = round2(tds + f.tds);
		if (borne) companyBorneTds = round2(companyBorneTds + f.tds);
		gross = round2(gross + parseNumber(row.amount));
		net = round2(net + f.net);
	}
	return { count, tds, companyBorneTds, gross, net };
};
