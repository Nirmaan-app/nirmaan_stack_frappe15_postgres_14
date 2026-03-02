import { useState, useRef, useCallback, useMemo } from 'react';
import { useReactToPrint } from 'react-to-print';

import { ProcurementOrder } from '@/types/NirmaanStack/ProcurementOrders';
import { DeliveryNote } from '@/types/NirmaanStack/DeliveryNotes';
import { DeliveryNotePrintLayout, PrintData } from "../components/DeliveryNotePrintLayout";

/**
 * Hook to manage printing a specific delivery history entry.
 * Renders a hidden print layout that gets populated when triggerHistoryPrint is called.
 */
export const usePrintHistory = (baseDocumentData: ProcurementOrder | null) => {
  const [historyEntryToPrint, setHistoryEntryToPrint] = useState<DeliveryNote | null>(null);
  const [deliveryDateToPrint, setDeliveryDateToPrint] = useState<string | undefined>(undefined);
  const historyPrintComponentRef = useRef<HTMLDivElement>(null);

  const handlePrintHistoryEntry = useReactToPrint({
    content: () => historyPrintComponentRef.current,
    documentTitle: `DN_History_${historyEntryToPrint?.delivery_date || new Date().toISOString().split('T')[0]}`,
  });

  const triggerHistoryPrint = useCallback((date: string, dn: DeliveryNote) => {
    setHistoryEntryToPrint(dn);
    setDeliveryDateToPrint(date);
    setTimeout(() => {
      handlePrintHistoryEntry();
    }, 50);
  }, [handlePrintHistoryEntry]);

  const PrintableHistoryComponent = useMemo(() => {
    if (!historyEntryToPrint || !baseDocumentData) {
      return null;
    }

    // Transform DN items into PurchaseOrderItem-compatible shape for the print layout.
    // received_quantity = delivered_quantity (the delta for this transaction).
    const historicalItemsForPrint = historyEntryToPrint.items.map(dnItem => ({
      name: dnItem.item_id,
      item: dnItem.item_name,
      item_name: dnItem.item_name,
      unit: dnItem.unit,
      quantity: 0,
      received_quantity: dnItem.delivered_quantity,
      comment: undefined,
    }));

    const printData: PrintData = {
      ...baseDocumentData,
      Note_no: historyEntryToPrint.note_no,
      delivery_date: deliveryDateToPrint,
      items: historicalItemsForPrint,
    };

    return (
      <div className="hidden">
        <DeliveryNotePrintLayout
          ref={historyPrintComponentRef}
          data={printData}
        />
      </div>
    );
  }, [historyEntryToPrint, baseDocumentData, deliveryDateToPrint]);

  return {
    triggerHistoryPrint,
    PrintableHistoryComponent,
  };
};