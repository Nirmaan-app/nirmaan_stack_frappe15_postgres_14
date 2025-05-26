import useSWRMutation from "swr/mutation";
import { useFrappePostCall } from "frappe-react-sdk";

const API_PATH =
  "nirmaan_stack.api.payments.project_payments.create_payment_request";

/** Envelope your back-end returns on success */
export interface PaymentRequestResponse {
  name: string;                // the new Project Payments docname
}

/** Payload expected by the API */
export type PaymentRequestArgs = {
  doctype : "Procurement Orders" | "Service Requests";
  docname : string;
  amount  : number;
};

/* ---------- SWR mutation hook ----------------------------------- */
export const useRequestPayment = () => {
  /* frappe-react-sdk helper prepares the POST call and handles auth */
  const { call } = useFrappePostCall<{ message: string }>(API_PATH);

  /* SWR fetcher for the mutation */
  const fetcher = async (
    _key: string,
    { arg }: { arg: PaymentRequestArgs }
  ): Promise<PaymentRequestResponse> => {
    const res = await call({ data: JSON.stringify(arg) });

    const body = typeof res.message === "string"
      ? JSON.parse(res.message)
      : res.message;

    return body as PaymentRequestResponse;
  };

  /* key is the API path so SWR can dedupe by URL */
  return useSWRMutation<PaymentRequestResponse, Error, string, PaymentRequestArgs>(
    API_PATH,
    fetcher
  );
};