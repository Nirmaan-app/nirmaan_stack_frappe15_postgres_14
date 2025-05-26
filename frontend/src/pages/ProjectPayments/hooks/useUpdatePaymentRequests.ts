import useSWRMutation from "swr/mutation";
import { useFrappePostCall } from "frappe-react-sdk";

export type FulfilPayload = {
  action   : "fulfil";
  name     : string;
  utr      : string;
  tds?     : number;
  pay_date?: string;                      // yyyy-mm-dd
  file_url?    : string;
};

export type DeletePayload = { action:"delete"; name:string };

export type Payload = FulfilPayload | DeletePayload;

const PATH = "nirmaan_stack.api.payments.project_payments.update_payment_request";

export const useUpdatePaymentRequest = () => {
  const { call } = useFrappePostCall<{ message: string }>(PATH);

  const fetcher = async (_:string,{arg}:{arg:Payload})=>{
    const res  = await call({ data: JSON.stringify(arg) });
    const body = typeof res.message==="string" ? JSON.parse(res.message)
                                               : res.message;
    return body;                           // {status:"success"}
  };

  return useSWRMutation(PATH, fetcher);
};