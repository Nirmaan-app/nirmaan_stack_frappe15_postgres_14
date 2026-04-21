import { useMemo } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { DeliveryNote } from "@/types/NirmaanStack/DeliveryNotes";

interface UseProjectDeliveryNotesResult {
  dnsByPO: Record<string, DeliveryNote[]>;
  dnsByITM: Record<string, DeliveryNote[]>;
  allDns: DeliveryNote[];
  isLoading: boolean;
  error: any;
  refetch: () => void;
}

export function useProjectDeliveryNotes(
  projectId: string | null | undefined
): UseProjectDeliveryNotesResult {
  const { data, isLoading, error, mutate } = useFrappeGetCall<{
    message: DeliveryNote[];
  }>(
    "nirmaan_stack.api.delivery_notes.get_delivery_notes.get_project_delivery_notes",
    projectId ? { project_id: projectId } : undefined,
    projectId ? undefined : null
  );

  const allDns: DeliveryNote[] = useMemo(
    () => data?.message || [],
    [data]
  );

  const dnsByPO: Record<string, DeliveryNote[]> = useMemo(() => {
    const grouped: Record<string, DeliveryNote[]> = {};
    for (const dn of allDns) {
      if (!dn.procurement_order) continue;
      if (!grouped[dn.procurement_order]) {
        grouped[dn.procurement_order] = [];
      }
      grouped[dn.procurement_order].push(dn);
    }
    return grouped;
  }, [allDns]);

  const dnsByITM: Record<string, DeliveryNote[]> = useMemo(() => {
    const grouped: Record<string, DeliveryNote[]> = {};
    for (const dn of allDns) {
      const parentDoc = (dn as any).parent_docname;
      const parentType = (dn as any).parent_doctype;
      if (parentType !== "Internal Transfer Memo" || !parentDoc) continue;
      if (!grouped[parentDoc]) {
        grouped[parentDoc] = [];
      }
      grouped[parentDoc].push(dn);
    }
    return grouped;
  }, [allDns]);

  return {
    dnsByPO,
    dnsByITM,
    allDns,
    isLoading,
    error,
    refetch: mutate,
  };
}
