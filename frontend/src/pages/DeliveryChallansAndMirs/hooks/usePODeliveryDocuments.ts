import { useFrappePostCall } from "frappe-react-sdk";
import { useCallback, useEffect, useState } from "react";
import type { PODeliveryDocuments, PDDParentDoctype } from "@/types/NirmaanStack/PODeliveryDocuments";

interface UsePODeliveryDocumentsResult {
  data: PODeliveryDocuments[] | null;
  isLoading: boolean;
  error: any;
  mutate: () => void;
}

/**
 * Fetch all DC/MIR records for a given parent (PO or ITM).
 *
 * Back-compat: if `parentDoctype` is omitted, defaults to "Procurement Orders"
 * and passes the legacy `procurement_order` arg so existing PO callers keep working.
 */
export const usePODeliveryDocuments = (
  parentName: string | null,
  parentDoctype: PDDParentDoctype = "Procurement Orders"
): UsePODeliveryDocumentsResult => {
  const [data, setData] = useState<PODeliveryDocuments[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<any>(null);

  const { call } = useFrappePostCall(
    "nirmaan_stack.api.po_delivery_documentss.get_po_delivery_documents"
  );

  const fetchData = useCallback(async () => {
    if (!parentName) {
      setData(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await call({
        parent_doctype: parentDoctype,
        parent_docname: parentName,
        // Legacy field for back-compat with un-backfilled rows
        procurement_order: parentDoctype === "Procurement Orders" ? parentName : undefined,
      });
      setData(response?.message || []);
    } catch (err) {
      setError(err);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [parentName, parentDoctype]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, isLoading, error, mutate: fetchData };
};
