import { useFrappeGetDoc } from "frappe-react-sdk";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { queryKeys } from "@/config/queryKeys";

export const useProcurementRequest = (orderId: string | undefined) => {
  const queryKey = orderId ? queryKeys.procurementRequests.doc(orderId) : undefined;

	return useFrappeGetDoc<ProcurementRequest>("Procurement Requests", orderId, queryKey ? JSON.stringify(queryKey) : undefined)

}