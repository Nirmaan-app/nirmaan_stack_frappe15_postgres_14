import { useFrappeGetCall } from "frappe-react-sdk";
import { useEffect, useState } from "react";

import type { ServerTdsForecast } from "../tdsPreview";

/** How long the typed figures must rest before the server is asked: one call per pause, not per key. */
const SETTLE_MS = 300;

interface Answer {
	forecast: ServerTdsForecast | null;
	cut_now: boolean;
	/** What the server was asked, echoed back. */
	asked: { amount: number; is_gst_payment: number; cheque_amount: number };
}

/**
 * The TDS a Work Order payment of `amount` will have withheld at approval, as the server works it out
 * (`api/payments/tds_forecast.forecast_work_order_tds`, #1541): the vendor's rate today and the rule
 * approval uses, on the amount the request will store. Nothing is computed here.
 *
 * `workOrder` null (a PO, or the dialog closed) or a non-positive amount sends nothing. An answer is
 * used only while it is for the figures on screen (the server echoes what it was asked): the previous
 * answer is kept while the next loads, so a cheque amount being typed does not blank the forecast, but
 * a forecast for an older amount is never shown beside a new one.
 */
export const useTdsForecast = (
	workOrder: string | null | undefined,
	amount: number,
	gstPayment: boolean,
	chequeAmount?: number
) => {
	const cheque = chequeAmount && chequeAmount > 0 ? chequeAmount : 0;
	const gst = gstPayment ? 1 : 0;
	const [settled, setSettled] = useState({ amount, cheque });
	useEffect(() => {
		const timer = setTimeout(() => setSettled({ amount, cheque }), SETTLE_MS);
		return () => clearTimeout(timer);
	}, [amount, cheque]);

	const ask = !!workOrder && settled.amount > 0;
	const { data } = useFrappeGetCall<{ message: Answer }>(
		"nirmaan_stack.api.payments.tds_forecast.forecast_work_order_tds",
		{
			work_order: workOrder,
			amount: settled.amount,
			is_gst_payment: gst,
			...(settled.cheque ? { cheque_amount: settled.cheque } : {}),
		},
		ask ? `TdsForecast-${workOrder}-${settled.amount}-${gst}-${settled.cheque}` : null,
		{ keepPreviousData: true }
	);

	const answer = data?.message;
	const forAmount = !!workOrder && amount > 0 && answer?.asked.amount === amount && answer.asked.is_gst_payment === gst;
	return {
		forecast: forAmount ? answer.forecast : null,
		cutNow: forAmount && answer.asked.cheque_amount === cheque ? answer.cut_now : false,
		/** No answer yet for the amount on screen. */
		isLoading: !!workOrder && amount > 0 && !forAmount,
	};
};
