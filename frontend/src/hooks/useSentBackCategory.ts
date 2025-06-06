import { useFrappeGetDoc } from "frappe-react-sdk";
import { queryKeys } from "@/config/queryKeys";
import { SentBackCategory } from "@/types/NirmaanStack/SentBackCategory";

export const useSentBackCategory = (orderId: string | undefined) => {
  const queryKey = orderId ? queryKeys.sentBackCategory.doc(orderId) : undefined;

  const returnOptions = useFrappeGetDoc<SentBackCategory>("Sent Back Category", orderId, queryKey ? JSON.stringify(queryKey) : undefined)


  return returnOptions
}