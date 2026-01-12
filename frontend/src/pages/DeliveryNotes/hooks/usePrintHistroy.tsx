// src/hooks/usePrintHistory.ts

import { useState, useRef, useCallback, useMemo } from 'react';
import { useReactToPrint } from 'react-to-print';

// Types and Components needed by the hook
import { DeliveryDataType, ProcurementOrder } from '@/types/NirmaanStack/ProcurementOrders'; // Adjust path
import { DeliveryNotePrintLayout } from "../components/DeliveryNotePrintLayout"; // Adjust path

/**
 * A reusable hook to manage the logic for printing a specific delivery history entry.
 *
 * @param baseDocumentData - The main document data (like a PO or DN) used to populate headers, addresses, etc., in the print layout.
 * @returns An object containing:
 *  - `triggerHistoryPrint`: A function to call with history data to initiate printing.
 *  - `PrintableHistoryComponent`: A React component to be rendered in your JSX. It's hidden by default.
 */
export const usePrintHistory = (baseDocumentData: ProcurementOrder | null) => {
  // State to hold the specific history entry data we want to print
  const [historyEntryToPrint, setHistoryEntryToPrint] = useState<DeliveryDataType[string] | null>(null);
  // State to hold the delivery date (the date key from delivery_data)
  const [deliveryDateToPrint, setDeliveryDateToPrint] = useState<string | null>(null);

  // Ref for the hidden component that will be printed
  const historyPrintComponentRef = useRef<HTMLDivElement>(null);

  // The react-to-print hook instance
  const handlePrintHistoryEntry = useReactToPrint({
    content: () => historyPrintComponentRef.current,
    documentTitle: `DN_History_${new Date(historyEntryToPrint?.timestamp || Date.now()).toISOString().split('T')[0]}`,
    // You can add more print options here if needed
  });

  /**
   * Function passed to child components (like DeliveryHistoryTable) to trigger a print.
   * @param date - The delivery date (the date key from delivery_data JSON)
   * @param historyData - The delivery history entry data
   */
  const triggerHistoryPrint = useCallback((date: string, historyData: DeliveryDataType[string]) => {
    // 1. Set the state with the data for the specific history entry
    setHistoryEntryToPrint(historyData);
    setDeliveryDateToPrint(date);

    // 2. Use a timeout to ensure React re-renders the hidden component with the new data
    //    before the browser's print dialog is triggered.
    setTimeout(() => {
      handlePrintHistoryEntry();
    }, 50);
  }, [handlePrintHistoryEntry]);

  /**
   * The memoized, hidden component that will be used for printing.
   * It renders only when there's an entry to print.
   */
  const PrintableHistoryComponent = useMemo(() => {
    if (!historyEntryToPrint || !baseDocumentData) {
      return null;
    }

    const historicalItemsForPrint = historyEntryToPrint.items.map(histItem => ({
      // These fields are required by the PurchaseOrderItem type and the print layout.
      name: histItem.item_id,         // Use the unique ID for the key
      item: histItem.item_name,       // The item name
      item_name: histItem.item_name,  // The item name
      unit: histItem.unit,

      // For a historical print, "Ordered" is not relevant, but we need the field.
      // "Received" should be the amount delivered IN THIS TRANSACTION.
      quantity: 0, // Or you could use the original quantity if you fetch it, but that's complex.
      received_quantity: histItem.to - histItem.from, // This is the key value for history print.

      // Add other optional fields from the type as null/undefined to satisfy TypeScript
      comment: undefined,
      // Add any other fields from PurchaseOrderItem if they are accessed by the print layout
    }));

    const printData = {
      ...baseDocumentData,
      Note_no: historyEntryToPrint.note_no,
      delivery_date: deliveryDateToPrint, // Pass the delivery date to the print layout
      items: historicalItemsForPrint, // <-- THE FIX: Overwrite `items` with our transformed history
    };

    // This component is hidden from the screen but visible to the print handler
    return (
      <div className="hidden">
        <DeliveryNotePrintLayout
          ref={historyPrintComponentRef}
          // We spread the base document data but override the item list
          // with the items from the specific historical entry.
          data={printData}
        />
      </div>
    );
  }, [historyEntryToPrint, baseDocumentData]);

  return {
    triggerHistoryPrint,
    PrintableHistoryComponent,
  };
};