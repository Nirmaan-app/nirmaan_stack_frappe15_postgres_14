import { useFrappeGetDoc } from "frappe-react-sdk";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { queryKeys } from "@/config/queryKeys";

export const useProcurementRequest = (orderId: string) => {
  const queryKey = queryKeys.procurementRequests.doc(orderId);

	const returnOptions = useFrappeGetDoc<ProcurementRequest>("Procurement Requests", orderId, orderId ? queryKey : undefined)


	return returnOptions
}