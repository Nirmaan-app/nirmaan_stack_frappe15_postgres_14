import { useFrappeGetCall } from "frappe-react-sdk";
import { useEffect, useState } from "react";

import type { ServerTdsForecast } from "../tdsPreview";

/** How long the amounts must rest before the server is asked: one call per pause, not per key. */
const SETTLE_MS = 300;

/** One payment to forecast: its name, and the amount being approved when it is not the stored one. */
export interface ForecastAsk {
  name: string;
  /** A partial approval's typed figure; the payment's stored amount when absent. */
  amount?: number;
}

const NO_FORECASTS: Record<string, ServerTdsForecast> = {};

/**
 * The TDS each payment's approval will withhold, as the server works it out
 * (`api/payments/tds_forecast.forecast_payments_tds`, spec #1528 story 59): the vendor's rate today and
 * the rule approval uses. The approve dialogs read it; nothing is computed here.
 *
 * A payment absent from `forecasts` withholds nothing (a PO payment, a GST payment, a vendor with no
 * rate). While the asks on screen have no answer yet, `forecasts` is empty: a forecast for an older
 * amount is never shown beside a new one.
 */
export const usePaymentTdsForecasts = (asks: readonly ForecastAsk[] | null) => {
  const payments = asks && asks.length
    ? JSON.stringify([...asks].sort((a, b) => a.name.localeCompare(b.name)))
    : "";
  const [settled, setSettled] = useState(payments);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(payments), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [payments]);

  const ask = !!settled && settled === payments;
  const { data, isLoading } = useFrappeGetCall<{ message: { forecasts: Record<string, ServerTdsForecast> } }>(
    "nirmaan_stack.api.payments.tds_forecast.forecast_payments_tds",
    { payments: settled },
    ask ? `PaymentTdsForecasts-${settled}` : null
  );

  return {
    forecasts: ask ? data?.message?.forecasts ?? NO_FORECASTS : NO_FORECASTS,
    /** No answer yet for the asks on screen. */
    isLoading: !!payments && (!ask || isLoading),
  };
};
