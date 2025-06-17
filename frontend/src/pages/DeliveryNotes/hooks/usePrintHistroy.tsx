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
   */
  const triggerHistoryPrint = useCallback((historyData: DeliveryDataType[string]) => {
    // 1. Set the state with the data for the specific history entry
    setHistoryEntryToPrint(historyData);

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

    // This component is hidden from the screen but visible to the print handler
    return (
      <div className="hidden">
        <DeliveryNotePrintLayout
          ref={historyPrintComponentRef}
          // We spread the base document data but override the item list
          // with the items from the specific historical entry.
          data={{
            ...baseDocumentData,
            delivery_list: { list: historyEntryToPrint.items },
          }}
        />
      </div>
    );
  }, [historyEntryToPrint, baseDocumentData]);

  return {
    triggerHistoryPrint,
    PrintableHistoryComponent,
  };
};