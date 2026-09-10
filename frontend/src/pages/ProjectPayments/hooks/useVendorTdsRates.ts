/**
 * The TDS rate for each vendor on screen — the one input the approval screens are missing.
 *
 * `document_type` and `vendor` already ride every payments table (`DEFAULT_PP_FIELDS_TO_FETCH`),
 * so the only thing needed to forecast a deduction is the rate, and it lives on the vendor.
 *
 * ⚠️ THE SAME FIELD THE SERVER READS (`payment_tds.vendor_rate` ->
 * `Vendors.tds_deduction_percentage`). Read it anywhere else, or cache a copy, and the screen can
 * forecast a figure the approval will not produce.
 *
 * ⚠️ SCOPED TO THE VENDORS ON THE CURRENT PAGE, not to every vendor. A page holds at most a few
 * dozen rows, so the `in` filter stays far below the list size that has broken queries in this
 * codebase before — but the memo below is what keeps it that way, by refetching only when the
 * vendor SET changes rather than on every render. The whole page's rates are fetched, not just
 * the selected ones, because a bulk selection can span the page and is made before any dialog
 * opens.
 */

import { useFrappeGetDocList } from "frappe-react-sdk";
import { createContext, useContext, useMemo } from "react";

import { Vendors } from "@/types/NirmaanStack/Vendors";
import { parseNumber } from "@/utils/parseNumber";
import { TDS_PARENT_DOCTYPE } from "../tdsForecast";

interface DeductibleRow {
	vendor?: string;
	document_type?: string;
}

/**
 * `(vendorId) => rate %`, resolving to 0 for a vendor with no rate, an unknown vendor, or while
 * the fetch is still in flight.
 *
 * ⚠️ 0 IS THE SAFE DEFAULT AND THE DIRECTION MATTERS. `forecastTds` renders NOTHING at a zero
 * rate, so a slow or failed fetch shows no forecast — never a wrong one. The alternative default
 * (2%, "what most vendors are") would put a confident figure on screen for a vendor that may not
 * be deducted from at all.
 */
export const useVendorTdsRates = (rows: ReadonlyArray<DeductibleRow> | undefined) => {
	// Only vendors on a deductible row need a rate; a Procurement Order's vendor is never asked
	// for, which keeps the filter small on a mixed page.
	const vendorIds = useMemo(() => {
		const ids = new Set<string>();
		(rows || []).forEach((r) => {
			if ((r?.document_type || "").trim() === TDS_PARENT_DOCTYPE && r?.vendor) {
				ids.add(r.vendor);
			}
		});
		// Sorted so the array — and therefore the SWR key below — is stable for a given SET,
		// rather than changing with the row order and refetching for nothing.
		return Array.from(ids).sort();
	}, [rows]);

	const { data, isLoading } = useFrappeGetDocList<Vendors>(
		"Vendors",
		{
			fields: ["name", "tds_deduction_percentage"],
			filters: [["name", "in", vendorIds]],
			limit: vendorIds.length || 1,
		},
		// `null` disables the fetch outright when nothing on the page is deductible — a page of
		// Procurement Orders must not hit the Vendors table at all.
		vendorIds.length ? `vendor-tds-rates-${vendorIds.join(",")}` : null
	);

	const rateByVendor = useMemo(() => {
		const map: Record<string, number> = {};
		(data || []).forEach((v) => {
			map[v.name] = parseNumber(v.tds_deduction_percentage);
		});
		return map;
	}, [data]);

	const rateFor = useMemo(
		() => (vendor: string | undefined | null): number => (vendor && rateByVendor[vendor]) || 0,
		[rateByVendor]
	);

	return { rateByVendor, rateFor, isLoading };
};


/**
 * The rate lookup, shared with the approve dialogs.
 *
 * A CONTEXT rather than a prop threaded down: `BulkConfirmDialog` and `PaymentActionDialog` are
 * both rendered deep inside `ApprovePayments`' JSX, and the rates arrive asynchronously after the
 * page's rows do. A context lets both re-render when the rates land without either one growing a
 * parameter it would otherwise have to be handed by every caller.
 *
 * Defaults to a lookup returning 0, so a dialog rendered outside a provider forecasts nothing
 * rather than guessing a rate.
 */
export const VendorTdsRateContext = createContext<(vendor: string | undefined | null) => number>(
	() => 0
);

export const useVendorTdsRate = () => useContext(VendorTdsRateContext);
