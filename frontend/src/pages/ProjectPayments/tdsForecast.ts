/**
 * The TDS types the payments screens share, and two small rules beside them: when an approval click
 * withholds tax (`withholdsOnApproval`) and the Work Order page's Amount Paid hover (`amountPaidParts`).
 *
 * ⚠️ "TDS" HERE IS **TAX DEDUCTED AT SOURCE ON A VENDOR PAYMENT**, not the Technical Data Sheet
 * doctypes (`TDS Items`, `TDS Repository`, `Project TDS Setting`). Same three letters, unrelated.
 *
 * ⚠️ NO TAX IS WORKED OUT IN THE BROWSER (spec #1528 story 59). Every forecast -- the approve dialogs'
 * (`hooks/usePaymentTdsForecasts`), the Request Payment dialog's and the Work Order payment table's
 * (`hooks/useTdsForecast`, `get_work_order_tds`) -- is the server's (`services/tds_forecast.py`), from
 * the vendor's rate today and the rule approval uses. The browser copy of the rate and the
 * company-borne categories that the approve dialogs used to apply is gone.
 */

import type { TdsBorneBy } from "@/types/NirmaanStack/PaymentTDSDeduction";
import type { ServerTdsForecast } from "./tdsPreview";
import { statusAfterL1 } from "@/utils/approvalTiers";

/**
 * A Work Order's TDS as the server answers it (`api/payments/work_order_tds.get_work_order_tds`, #1451):
 * who bore its PAID tax, read off each deduction's `Payment TDS Deduction.borne_by` over the Paid
 * payments only (the same population as `amount_paid`, which the page's hover splits with it; with
 * nothing paid yet the server answers `kind` by the category rule), and each payment's own deduction.
 *
 * ⚠️ ASKED OF THE SERVER, NEVER READ OFF THE DEDUCTIONS HERE: that doctype is readable only by the
 * accountants, so a Procurement user's list read is refused with a 403.
 */
export type TdsBorneKind = "withheld" | "company" | "part";

export interface WorkOrderTds {
	/** Paid tax withheld from the vendor (`borne_by` Vendor). */
	withheld: number;
	/** Paid tax the company paid on top (`borne_by` Company). */
	company: number;
	kind: TdsBorneKind;
	/** Each payment's own deduction, whatever its status, keyed by payment name; a payment with none is absent. */
	payments: Record<string, { tds_amount: number; borne_by: TdsBorneBy }>;
	/** Each payment still waiting for approval, as its approval will tax it (#1541); one with no tax to come is absent. */
	forecasts?: Record<string, ServerTdsForecast>;
}

/** The Work Order page's Amount Paid hover (#1509). `total` + `companyOnTop` is what the WO cost in all. */
export interface AmountPaidParts {
	/** What reached the vendor's bank: Paid payments less Received refunds. */
	paidToVendor: number;
	/** Tax withheld from the vendor and paid to the tax office for them; part of Amount Paid. */
	tdsWithheld: number;
	/** The WO's stored Amount Paid. */
	total: number;
	/** Tax the company paid on top of a payment kept whole; NOT part of Amount Paid. */
	companyOnTop: number;
}

/**
 * Split a Work Order's stored `amount_paid` for its hover (ADR-0034 Amendment A): the stored figure
 * already holds the TDS withheld from the vendor, so what reached the vendor is Amount Paid less the
 * server's `withheld`. Nothing is added up here. Undefined until the server has answered.
 */
export const amountPaidParts = (amountPaid: number, answer: WorkOrderTds | undefined): AmountPaidParts | undefined =>
	answer && {
		paidToVendor: round2(amountPaid - answer.withheld),
		tdsWithheld: answer.withheld,
		total: amountPaid,
		companyOnTop: answer.company,
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

/** To the paisa, so a subtraction of stored figures never shows float dust. */
const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Does THIS approval click withhold the tax, or only forward the payment?
 *
 * Tax is withheld when an approval lands the payment at `Approved` (`payment_tds.
 * is_approval_from_an_earlier_step`). The CEO's click always does. An L1 click does only when it
 * FINISHES the approval -- the 15,000-50,000 band (`statusAfterL1`); above 50,000 it forwards to
 * the CEO and nothing is withheld yet.
 *
 * ⚠️ This used to be "CEO mode only", written before L1 could finish an approval, so the L1
 * dialogs told the approver the tax came later on exactly the payments where their click took it.
 */
export const withholdsOnApproval = (
	mode: "lead" | "ceo",
	amount: number | string | undefined | null
): boolean => mode === "ceo" || statusAfterL1(amount) === "Approved";

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
