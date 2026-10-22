/**
 * The TDS preview before approval (#1541): the Request Payment dialog's line and the Work Order payment
 * table's figures.
 *
 * ⚠️ "TDS" HERE IS **TAX DEDUCTED AT SOURCE**, not the Technical Data Sheet doctypes.
 *
 * ⚠️ THE SERVER WORKS THE FIGURES OUT (`services/tds_forecast.py`, from the vendor's rate today and the
 * rule approval uses). Nothing here computes a rate or a tax: it only labels the server's answer and,
 * for the table, adds a recorded deduction back onto the cut amount to show the full bill, as the
 * payments pop-up does (`paymentsDialogRows`).
 */

import { TDS_BORNE_BY, type TdsBorneBy } from "@/types/NirmaanStack/PaymentTDSDeduction";
import formatToIndianRupee from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import type { TdsForecast, TdsTotals } from "./tdsForecast";

/** One payment's forecast as the server answers it (`services/tds_forecast.figures`). */
export interface ServerTdsForecast {
	/** The vendor's rate today, as a percentage. */
	rate: number;
	/** Tax its approval will withhold. */
	tds: number;
	/** What the payment will be after approval: the full bill less the tax, or all of it when the company pays the tax. */
	vendor_gets: number;
	borne_by: TdsBorneBy;
}

/** The server's forecast in the shape the cheque fields read (`PaymentModeFields`). */
export const toTdsForecast = (forecast: ServerTdsForecast | null | undefined): TdsForecast | null =>
	forecast ? { ratePct: forecast.rate, tds: forecast.tds, net: forecast.vendor_gets } : null;

const toPaise = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * A bulk selection's tax, added up from the server's forecasts (`forecast_payments_tds`, story 59): only
 * the rows it forecasts tax on contribute, `gross` included, so the figures describe one subset and read
 * as one sentence. `amount` is each row's stored amount, the figure its approval taxes.
 */
export const forecastTotals = (
	rows: ReadonlyArray<{ name: string; amount?: number | string }>,
	forecasts: Readonly<Record<string, ServerTdsForecast>>
): TdsTotals =>
	rows.reduce<TdsTotals>(
		(totals, row) => {
			const forecast = forecasts[row.name];
			if (!forecast) return totals;
			return {
				count: totals.count + 1,
				tds: toPaise(totals.tds + forecast.tds),
				companyBorneTds: toPaise(
					totals.companyBorneTds + (forecast.borne_by === TDS_BORNE_BY.COMPANY ? forecast.tds : 0)
				),
				gross: toPaise(totals.gross + parseNumber(row.amount)),
				net: toPaise(totals.net + forecast.vendor_gets),
			};
		},
		{ count: 0, tds: 0, companyBorneTds: 0, gross: 0, net: 0 }
	);

/**
 * The Request Payment dialog's preview (owner ruling X1-A): "TDS 2%: ₹200 · Vendor gets ₹9,800", or on a
 * Misc / Transport Work Order "Vendor gets ₹10,000 · TDS ₹200 paid by company on top", and "Tax is cut now"
 * when the request is approved the moment it is made. Empty when nothing will be withheld.
 */
export const requestPreviewLines = (forecast: ServerTdsForecast | null | undefined, cutNow: boolean): string[] => {
	if (!forecast) return [];
	const tds = formatToIndianRupee(forecast.tds);
	const gets = formatToIndianRupee(forecast.vendor_gets);
	const line =
		forecast.borne_by === TDS_BORNE_BY.COMPANY
			? `Vendor gets ${gets} · TDS ${tds} paid by company on top`
			: `TDS ${forecast.rate}%: ${tds} · Vendor gets ${gets}`;
	return cutNow ? [line, "Tax is cut now"] : [line];
};

/** One Work Order payment's row in its page's payment table. */
export interface PaymentTableFigures {
	/** The full bill (Req. Amount): the stored amount plus any tax withheld from it. */
	requested: number;
	/** Its tax: recorded, or forecast for a waiting payment; undefined when it has none. */
	tds: number | undefined;
	/** What the vendor gets (To be paid). */
	toBePaid: number;
	/** The company pays the tax on top; the vendor gets the full bill. */
	companyOnTop: boolean;
	/** `tds` is a forecast: the payment is waiting for approval and no tax is recorded yet. */
	forecast: boolean;
}

/**
 * `amount` is the payment's stored amount; `deduction` its recorded tax (`get_work_order_tds` `payments`)
 * and `forecast` the server's forecast for a waiting payment (`forecasts`). A recorded deduction wins.
 */
export const paymentTableFigures = (
	amount: number | string | null | undefined,
	deduction: { tds_amount: number; borne_by: TdsBorneBy } | undefined,
	forecast: ServerTdsForecast | undefined
): PaymentTableFigures => {
	const stored = parseNumber(amount);
	if (deduction) {
		const companyOnTop = deduction.borne_by === TDS_BORNE_BY.COMPANY;
		const tds = parseNumber(deduction.tds_amount);
		return {
			requested: companyOnTop ? stored : Math.round((stored + tds) * 100) / 100,
			tds,
			toBePaid: stored,
			companyOnTop,
			forecast: false,
		};
	}
	if (forecast) {
		return {
			requested: stored,
			tds: forecast.tds,
			toBePaid: forecast.vendor_gets,
			companyOnTop: forecast.borne_by === TDS_BORNE_BY.COMPANY,
			forecast: true,
		};
	}
	return { requested: stored, tds: undefined, toBePaid: stored, companyOnTop: false, forecast: false };
};

/** The label under a company-borne tax in the Work Order payment table: the name of the #1537 action. */
export const TDS_PAID_BY_COMPANY_LABEL = "TDS paid by company";

/**
 * The note under a row's TDS in the Work Order payment table (#1543, owner ruling Q31-A): tax the company
 * pays on top, recorded or forecast, is labelled, so it doesn't read as a deduction from the vendor.
 * Tax withheld from the vendor, and a payment without tax, carry none.
 */
export const tdsColumnNote = (figures: PaymentTableFigures): string | undefined =>
	figures.tds !== undefined && figures.companyOnTop ? TDS_PAID_BY_COMPANY_LABEL : undefined;
