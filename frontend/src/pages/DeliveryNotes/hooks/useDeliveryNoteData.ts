// src/hooks/useDeliveryNoteData.ts
import { FrappeDoc, useFrappeGetDoc, useFrappePostCall } from 'frappe-react-sdk';
import { useParams } from 'react-router-dom';
import { useMemo, useCallback } from 'react';
import { decodeFrappeId, derivePoIdFromDnId } from '../constants';
import { ProcurementOrder } from '@/types/NirmaanStack/ProcurementOrders';
import { DeliveryNote } from '@/types/NirmaanStack/DeliveryNotes';
import { KeyedMutator } from 'swr';

interface UseDeliveryNoteDataResult {
  deliveryNoteId: string | null;
  poId: string | null;
  data: ProcurementOrder | null;
  dnRecords: DeliveryNote[];
  isLoading: boolean;
  error: Error | null;
  mutate: KeyedMutator<FrappeDoc<ProcurementOrder>>;
  refetchDNs: () => void;
}

export function useDeliveryNoteData(): UseDeliveryNoteDataResult {
  const { dnId: encodedDnId } = useParams<{ dnId: string }>();
  const { id: encodedDnId2 } = useParams<{ id: string }>();

  const deliveryNoteId = useMemo(() => {
    if (!encodedDnId && !encodedDnId2) return null;
    try {
      if (encodedDnId) return decodeFrappeId(encodedDnId);
      if (encodedDnId2) return decodeFrappeId(encodedDnId2);
    } catch (e) {
      console.error("Error decoding DN ID:", e);
      return null;
    }
  }, [encodedDnId, encodedDnId2]);

  const poId = useMemo(() => {
    if (!deliveryNoteId) return null;
    try {
      return derivePoIdFromDnId(deliveryNoteId);
    } catch (e) {
      console.error("Error deriving PO ID:", e);
      return null;
    }
  }, [deliveryNoteId]);

  // Fetch PO document (for items, status, amounts — used by 37+ linkage points)
  const {
    data,
    error: poError,
    isLoading: poLoading,
    mutate,
  } = useFrappeGetDoc<ProcurementOrder>(
    "Procurement Orders",
    poId!,
    poId ? `procurement_order_${poId}` : null
  );

  // Fetch DN records via new API
  const {
    call: fetchDNs,
    result: dnResult,
    loading: dnLoading,
    error: dnError,
  } = useFrappePostCall(
    'nirmaan_stack.api.delivery_notes.get_delivery_notes.get_delivery_notes'
  );

  // Fetch DNs when poId is available
  useMemo(() => {
    if (poId) {
      fetchDNs({ procurement_order: poId });
    }
  }, [poId]);

  const dnRecords: DeliveryNote[] = useMemo(
    () => (dnResult?.message as DeliveryNote[]) || [],
    [dnResult]
  );

  const refetchDNs = useCallback(() => {
    if (poId) {
      fetchDNs({ procurement_order: poId });
    }
  }, [poId, fetchDNs]);

  const safeData = data || null;
  const rawError = poError || dnError;
  const typedError = rawError instanceof Error ? rawError : rawError ? new Error(String(rawError)) : null;

  return {
    deliveryNoteId: deliveryNoteId ?? null,
    poId: poId ?? null,
    data: safeData,
    dnRecords,
    isLoading: poLoading || dnLoading,
    error: typedError,
    mutate,
    refetchDNs,
  };
}
