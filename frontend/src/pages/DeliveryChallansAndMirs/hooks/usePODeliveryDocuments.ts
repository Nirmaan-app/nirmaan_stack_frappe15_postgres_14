import { useFrappePostCall } from "frappe-react-sdk";
import { useCallback, useEffect, useState } from "react";
import type { PODeliveryDocuments } from "@/types/NirmaanStack/PODeliveryDocuments";

interface UsePODeliveryDocumentsResult {
  data: PODeliveryDocuments[] | null;
  isLoading: boolean;
  error: any;
  mutate: () => void;
}

export const usePODeliveryDocuments = (
  procurementOrder: string | null
): UsePODeliveryDocumentsResult => {
  const [data, setData] = useState<PODeliveryDocuments[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<any>(null);

  const { call } = useFrappePostCall(
    "nirmaan_stack.api.po_delivery_documentss.get_po_delivery_documents"
  );

  const fetchData = useCallback(async () => {
    if (!procurementOrder) {
      setData(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await call({ procurement_order: procurementOrder });
      setData(response?.message || []);
    } catch (err) {
      setError(err);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [procurementOrder]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, isLoading, error, mutate: fetchData };
};
