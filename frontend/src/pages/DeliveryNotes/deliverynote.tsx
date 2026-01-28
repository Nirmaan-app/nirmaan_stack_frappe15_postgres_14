// // --- IMPORTS ---
import React, { useMemo, useCallback, useRef } from 'react'; // Re-add useRef
import { useNavigate } from 'react-router-dom';
import { useReactToPrint } from 'react-to-print'; // Re-add useReactToPrint
import { Printer } from 'lucide-react';
import { TailSpin } from 'react-loader-spinner';
import { format } from "date-fns";
import { useToast } from '@/components/ui/use-toast'; // --- (Indicator) NEW: Import useToast ---

// UI Components
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from '@/components/ui/badge';
import { AddressView } from '@/components/address-view';

// Child Components
import DeliveryHistoryTable from './components/DeliveryHistory';
import { DeliveryNoteItemsDisplay } from './components/deliveryNoteItemsDisplay';
import { DeliveryNotePrintLayout } from './components/DeliveryNotePrintLayout';

// Hooks, Types, Constants
import { useDeliveryNoteData } from './hooks/useDeliveryNoteData';
import { usePrintHistory } from './hooks/usePrintHistroy'; // Corrected typo here

import { DeliveryDataType, ProcurementOrder } from '@/types/NirmaanStack/ProcurementOrders';
import {
  ROUTE_PATHS,
  STATUS_BADGE_VARIANT,
  DOCUMENT_PREFIX,
  encodeFrappeId,
  formatDisplayId,
  safeJsonParse,
  deriveDnIdFromPoId
} from './constants';

// --- HELPER COMPONENTS (no changes) ---
// ...
interface DetailRowProps {
  label: string;
  children?: React.ReactNode;
}
const DetailRow: React.FC<DetailRowProps> = ({ label, children }) => (
  <div className="flex flex-row gap-2 items-start text-sm mb-1">
    <strong className="text-gray-600 min-w-[60px]">{label}:</strong>
    <span className="text-gray-800">{children}</span>
  </div>
);

interface LinkRowProps extends DetailRowProps {
  onClick: () => void;
  value: string | undefined;
}
const LinkRow: React.FC<LinkRowProps> = ({ label, onClick, value }) => (
  <DetailRow label={label}>
    {value ? (
      <span className="underline cursor-pointer text-blue-600 hover:text-blue-800" onClick={onClick}>
        {value}
      </span>
    ) : (
      <span className="text-xs text-gray-500">N/A</span>
    )}
  </DetailRow>
);

interface DeliveryPersonDetailsProps {
  deliveryContact: string | undefined;
}
const DeliveryPersonDetails: React.FC<DeliveryPersonDetailsProps> = ({ deliveryContact }) => {
  const { name, mobile } = useMemo(() => {
    if (!deliveryContact || !deliveryContact.includes(':')) {
      return { name: null, mobile: null };
    }
    const parts = deliveryContact.split(':');
    return { name: parts[0]?.trim() || null, mobile: parts[1]?.trim() || null };
  }, [deliveryContact]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-semibold text-gray-700">Delivery Person</CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        <DetailRow label="Name">
          {name || <span className="text-xs text-gray-500">Not Provided</span>}
        </DetailRow>
        <DetailRow label="Mobile">
          {mobile || <span className="text-xs text-gray-500">Not Provided</span>}
        </DetailRow>
      </CardContent>
    </Card>
  );
};


interface OrderDetailsCardProps {
  data: ProcurementOrder;
}
const OrderDetailsCard: React.FC<OrderDetailsCardProps> = ({ data }) => {
  const navigate = useNavigate();

  const handleNavigate = useCallback((path: string | null) => {
    if (path) {
      navigate(path);
    }
  }, [navigate]);

  const prPath = data.procurement_request
    ? ROUTE_PATHS.PROCUREMENT_REQUEST_DETAILS(data.procurement_request)
    : null;

  const poPath = data.procurement_request && data.name
    ? ROUTE_PATHS.PROCUREMENT_ORDER_DETAILS(data.procurement_request, encodeFrappeId(data.name))
    : null;

  const badgeVariant = STATUS_BADGE_VARIANT[data.status] || STATUS_BADGE_VARIANT['default'];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex justify-between items-center">
          <CardTitle className="text-lg font-semibold text-gray-700">
            Order Details
          </CardTitle>
          <Badge variant={badgeVariant}>
            {data.status || 'Unknown Status'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <DetailRow label="Address">
          <AddressView id={data.project_address} className="text-sm" />
        </DetailRow>
        <LinkRow label="@PR" onClick={() => handleNavigate(prPath)} value={data.procurement_request} />
        <LinkRow label="@PO" onClick={() => handleNavigate(poPath)} value={data.name} />
        <DetailRow label="Dispatch Date">
          {data.dispatch_date ? new Date(data.dispatch_date).toLocaleDateString() : <span className="text-xs text-gray-500">Not Provided</span>}
        </DetailRow>
      </CardContent>
    </Card>
  );
};
// --- MAIN COMPONENT ---

export default function DeliveryNote() {
  const {
    deliveryNoteId,
    poId,
    data: deliveryNoteData,
    isLoading,
    error,
    mutate: refetchDeliveryNoteData
  } = useDeliveryNoteData();

  // --- FIX: Revert to the original local print setup since the hook doesn't exist ---
  const { toast } = useToast(); // --- (Indicator) NEW: Initialize toast ---
  const printComponentRef = useRef<HTMLDivElement>(null);
  const handlePrint = async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!poId) {
      toast({ title: "Error", description: "PO ID is missing", variant: "destructive" });
      return;
    }

    try {
      toast({ title: "Generating PDF", description: "Downloading overall delivery note..." });
      
      const formatname = "PO Delivery Histroy";
      const printUrl = `/api/method/frappe.utils.print_format.download_pdf?doctype=Procurement%20Orders&name=${poId}&format=${encodeURIComponent(formatname)}&no_letterhead=0`;
      
      const response = await fetch(printUrl);
      if (!response.ok) throw new Error("Failed to generate PDF");
      
      const blob = await response.blob();
      
      // Generate filename - you can customize this based on your needs
      const fileName = `PO_Delivery_Note_${poId}_Overall.pdf`;
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      
      // Cleanup
      link.remove();
      window.URL.revokeObjectURL(url);
      
      toast({ 
        title: "Success", 
        description: "Delivery note downloaded successfully.", 
        variant: "default" 
      });
    } catch (error) {
      console.error("Download error:", error);
      toast({ 
        title: "Error", 
        description: "Failed to download delivery note.", 
        variant: "destructive" 
      });
    }
  };

  // console.log("deliveryNoteData", deliveryNoteData)
  // Use the history printing hook (this is correct)
  const { triggerHistoryPrint, PrintableHistoryComponent } = usePrintHistory(deliveryNoteData);
  // console.log("deliveryNoteData", deliveryNoteData)

  // It's safe to call useMemo and useCallback even if deliveryNoteData is null initially.
  // They will simply return their initial values and re-calculate on the next render.
  const deliveryHistory = useMemo(() =>
    safeJsonParse<{ data: DeliveryDataType }>(deliveryNoteData?.delivery_data, { data: {} }),
    [deliveryNoteData?.delivery_data]
  );

  const displayDnId = useMemo(() =>
    formatDisplayId(deliveryNoteId, DOCUMENT_PREFIX.DELIVERY_NOTE),
    [deliveryNoteId]
  );

  const latestHistoryEntry = useMemo(() => {
    const historyData = deliveryHistory.data;
    if (!historyData || Object.keys(historyData).length === 0) {
      return null;
    }
    const sortedKeys = Object.keys(historyData).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    const latestKey = sortedKeys[0];
    return { date: latestKey, entry: historyData[latestKey] };
  }, [deliveryHistory.data]);

  const handlePrintLatest = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!latestHistoryEntry) {
       toast({
        title: "No History Available",
        description: "A delivery must be recorded before its note can be printed.",
      });
      return;
    }

    if (!poId) {
      toast({ title: "Error", description: "PO ID is missing", variant: "destructive" });
      return;
    }

    const date = latestHistoryEntry.date;

    try {
      toast({ title: "Generating PDF", description: `Downloading note for ${format(new Date(date), "dd MMM")}...` });

      // 1. Build Parameters
      const formatname = "PO Delivery Histroy"; // Keeping user's typo 'Histroy' if that's what backend expects, assuming matched from snippet
      const formattedDate = typeof date === 'string' 
      ? date 
      : format(date, "yyyy-MM-dd");

       const printUrl = `/api/method/frappe.utils.print_format.download_pdf?doctype=Procurement%20Orders&name=${poId}&format=${encodeURIComponent(formatname)}&no_letterhead=0&delivery_date=${encodeURIComponent(formattedDate)}`;
    
      // 2. Fetch Blob
      const response = await fetch(printUrl);
      if (!response.ok) throw new Error("Failed to generate PDF");

      const blob = await response.blob();

      // 3. Download
      const fileName = `${poId}_Delivery_Note_${date}.pdf`;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();

      // 4. Cleanup
      link.remove();
      window.URL.revokeObjectURL(url);

      toast({
        title: "Success",
        description: "Delivery note downloaded.",
        variant: "default" 
      });

    } catch (error) {
      console.error("Download error:", error);
      toast({
        title: "Error",
        description: "Failed to download delivery note.",
        variant: "destructive"
      });
    }
  };

  // --- (Indicator) STEP 2: Conditional rendering logic now comes AFTER all hooks ---
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <TailSpin height={50} width={50} color="red" />
        <span className="ml-2 text-gray-600">Loading Delivery Note...</span>
      </div>
    );
  }

  if (error || !deliveryNoteId || !poId) {
    console.error("Delivery Note Error:", error, "DN ID:", deliveryNoteId, "PO ID:", poId);
    return (
      <div className="flex items-center justify-center h-[80vh] text-red-600">
        Error: {error?.message || 'Failed to load Delivery Note data. The ID might be missing or invalid.'}
      </div>
    );
  }

  if (!deliveryNoteData) {
    return (
      <div className="flex items-center justify-center h-[80vh] text-orange-600">
        Delivery Note details not found for ID: {deliveryNoteId} (PO: {poId}).
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl space-y-6">
      {/* --- (Indicator) MODIFIED: Header with new button and responsive wrapper --- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-4">
        <h1 className="text-2xl font-bold text-gray-800">{`${displayDnId}/M`}</h1>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            onClick={handlePrintLatest}
            variant="outline"
            size="sm"
            disabled={!latestHistoryEntry} // Disable if no history exists
            className="w-full sm:w-auto"
          >
            <Printer className="h-4 w-4 mr-2" />
            Print Latest DN
          </Button>
          <Button
            onClick={handlePrint}
            variant="default"
            size="sm"
            className="w-full sm:w-auto"
          >
            <Printer className="h-4 w-4 mr-2" />
            Print Overall DN
          </Button>
        </div>
      </div>

      {/* --- (Indicator) MODIFIED: Main layout now responsive --- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <OrderDetailsCard data={deliveryNoteData} />
          <DeliveryPersonDetails deliveryContact={deliveryNoteData.delivery_contact} />
        </div>
        <div className="lg:col-span-2 space-y-6">
          <DeliveryNoteItemsDisplay
            data={deliveryNoteData}
            poMutate={refetchDeliveryNoteData}
          />
          <DeliveryHistoryTable
          poId={poId}
            deliveryData={deliveryHistory.data}
            onPrintHistory={triggerHistoryPrint}
          />
        </div>
      </div>

      {/* --- HIDDEN PRINTABLE COMPONENTS --- */}
      <div className="hidden print:block">
        <DeliveryNotePrintLayout ref={printComponentRef} data={deliveryNoteData} />
      </div>

      {/* 
        --- CRITICAL FIX: Render the variable directly, not as a component tag. ---
        This prevents the "Element type is invalid" crash.
      */}
      {PrintableHistoryComponent}
    </div>
  );
}




// // src/pages/DeliveryNote.tsx (or wherever your component resides)
// import React, { useRef, useState, useMemo, useCallback } from 'react';
// import { useNavigate } from 'react-router-dom';
// import { useReactToPrint } from 'react-to-print';
// import { Printer } from 'lucide-react';
// import { TailSpin } from 'react-loader-spinner';

// // UI Components
// import { Button } from "@/components/ui/button";
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// import { Badge } from '@/components/ui/badge';
// import { AddressView } from '@/components/address-view'; // Assuming this handles its own loading/error

// // Child Components specific to Delivery Note display
// import DeliveryHistoryTable from './components/DeliveryHistory'; // Adjust path
// import { DeliveryNoteItemsDisplay } from './components/deliveryNoteItemsDisplay'; // Adjust path
// import { DeliveryNotePrintLayout } from './components/DeliveryNotePrintLayout'; // Adjust path

// // Hooks, Types, Constants
// import { useDeliveryNoteData } from './hooks/useDeliveryNoteData'; // Adjust path
// import { DeliveryDataType, ProcurementOrder } from '@/types/NirmaanStack/ProcurementOrders';
// import {
//   ROUTE_PATHS,
//   STATUS_BADGE_VARIANT,
//   DOCUMENT_PREFIX,
//   encodeFrappeId,
//   formatDisplayId,
//   safeJsonParse,
//   deriveDnIdFromPoId
// } from './constants'; // Adjust path

// // --- Helper Components (can be moved to separate files if they grow) ---

// interface DetailRowProps {
//   label: string;
//   children?: React.ReactNode;
// }
// const DetailRow: React.FC<DetailRowProps> = ({ label, children }) => (
//   <div className="flex flex-row gap-2 items-start text-sm mb-1">
//     <strong className="text-gray-600 min-w-[60px]">{label}:</strong>
//     <span className="text-gray-800">{children}</span>
//   </div>
// );

// interface LinkRowProps extends DetailRowProps {
//   onClick: () => void;
//   value: string | undefined;
// }
// const LinkRow: React.FC<LinkRowProps> = ({ label, onClick, value }) => (
//   <DetailRow label={label}>
//     {value ? (
//       <span className="underline cursor-pointer text-blue-600 hover:text-blue-800" onClick={onClick}>
//         {value}
//       </span>
//     ) : (
//       <span className="text-xs text-gray-500">N/A</span>
//     )}
//   </DetailRow>
// );

// interface DeliveryPersonDetailsProps {
//   deliveryContact: string | undefined;
// }
// const DeliveryPersonDetails: React.FC<DeliveryPersonDetailsProps> = ({ deliveryContact }) => {
//   const { name, mobile } = useMemo(() => {
//     if (!deliveryContact || !deliveryContact.includes(':')) {
//       return { name: null, mobile: null };
//     }
//     const parts = deliveryContact.split(':');
//     return { name: parts[0]?.trim() || null, mobile: parts[1]?.trim() || null };
//   }, [deliveryContact]);

//   return (
//     <Card>
//       <CardHeader className="pb-2">
//         <CardTitle className="text-lg font-semibold text-gray-700">Delivery Person</CardTitle>
//       </CardHeader>
//       <CardContent className="pt-2">
//         <DetailRow label="Name">
//           {name || <span className="text-xs text-gray-500">Not Provided</span>}
//         </DetailRow>
//         <DetailRow label="Mobile">
//           {mobile || <span className="text-xs text-gray-500">Not Provided</span>}
//         </DetailRow>
//       </CardContent>
//     </Card>
//   );
// };


// interface OrderDetailsCardProps {
//   data: ProcurementOrder;
// }
// const OrderDetailsCard: React.FC<OrderDetailsCardProps> = ({ data }) => {
//   const navigate = useNavigate();

//   const handleNavigate = useCallback((path: string | null) => {
//     if (path) {
//       navigate(path);
//     }
//     // Optional: handle case where navigation is not possible (-1 behaviour?)
//     // else { navigate(-1); } // Be cautious with -1, explicit paths are safer
//   }, [navigate]);

//   const prPath = data.procurement_request
//     ? ROUTE_PATHS.PROCUREMENT_REQUEST_DETAILS(data.procurement_request)
//     : null;

//   const poPath = data.procurement_request && data.name
//     ? ROUTE_PATHS.PROCUREMENT_ORDER_DETAILS(data.procurement_request, encodeFrappeId(data.name))
//     : null;

//   const badgeVariant = STATUS_BADGE_VARIANT[data.status] || STATUS_BADGE_VARIANT['default'];

//   return (
//     <Card>
//       <CardHeader className="pb-2">
//         <div className="flex justify-between items-center">
//           <CardTitle className="text-lg font-semibold text-gray-700">
//             Order Details
//           </CardTitle>
//           <Badge variant={badgeVariant}>
//             {data.status || 'Unknown Status'}
//           </Badge>
//         </div>
//       </CardHeader>
//       <CardContent className="pt-2">
//         <DetailRow label="Address">
//           <AddressView id={data.project_address} className="text-sm" />
//         </DetailRow>
//         <LinkRow label="@PR" onClick={() => handleNavigate(prPath)} value={data.procurement_request} />
//         <LinkRow label="@PO" onClick={() => handleNavigate(poPath)} value={data.name} />
//       </CardContent>
//     </Card>
//   );
// };

// // --- Main Component ---

// export default function DeliveryNote() {
//   const {
//     deliveryNoteId,
//     poId,
//     data: deliveryNoteData, // Renamed for clarity within this component scope
//     isLoading,
//     error,
//     mutate: refetchDeliveryNoteData // Renamed mutate for clarity
//   } = useDeliveryNoteData();

//   // --- STATE FOR DYNAMIC PRINTING ---
//   const [historyEntryToPrint, setHistoryEntryToPrint] = useState<DeliveryDataType[string] | null>(null);
//   const historyPrintComponentRef = useRef<HTMLDivElement>(null);
//   ///

//   const printComponentRef = useRef<HTMLDivElement>(null);

//   const handlePrint = useReactToPrint({
//     content: () => printComponentRef.current,
//     documentTitle: deliveryNoteData
//       ? `${deriveDnIdFromPoId(deliveryNoteData.name).toUpperCase()}_${deliveryNoteData.vendor_name}`
//       : 'Delivery_Note',
//     // Optional: Add page styles if needed
//     // pageStyle: `@page { size: A4; margin: 20mm; } @media print { body { -webkit-print-color-adjust: exact; } }`
//   });

//   // --- NEW PRINT HOOK FOR HISTORY ---
//   // This hook is configured but not called directly by a button.
//   const handlePrintHistoryEntry = useReactToPrint({
//     content: () => historyPrintComponentRef.current,
//     documentTitle: `DN_History_${new Date(historyEntryToPrint?.timestamp || Date.now()).toISOString().split('T')[0]}`,
//   });

//   // --- FUNCTION TO TRIGGER THE HISTORY PRINT ---
//   // This is the function we will pass down to the history table.
//   const triggerHistoryPrint = useCallback((historyData: DeliveryDataType[string]) => {
//     // 1. Set the data for the printable component
//     setHistoryEntryToPrint(historyData);

//     // 2. Trigger the print dialog
//     // We use a short timeout to ensure React has updated the state and rendered
//     // the new data into the hidden component before the print dialog opens.
//     setTimeout(() => {
//       handlePrintHistoryEntry();
//     }, 50); // A 50ms delay is usually sufficient

//   }, [handlePrintHistoryEntry]);



//   // Loading State
//   if (isLoading) {
//     return (
//       <div className="flex items-center justify-center h-[80vh]">
//         <TailSpin height={50} width={50} color="red" />
//         <span className="ml-2 text-gray-600">Loading Delivery Note...</span>
//       </div>
//     );
//   }

//   // Error State (Hook Error or Missing ID)
//   if (error || !deliveryNoteId || !poId) {
//     console.error("Delivery Note Error:", error, "DN ID:", deliveryNoteId, "PO ID:", poId);
//     return (
//       <div className="flex items-center justify-center h-[80vh] text-red-600">
//         Error: {error?.message || 'Failed to load Delivery Note data. The ID might be missing or invalid.'}
//       </div>
//     );
//   }

//   // Data Not Found State (Query succeeded but returned no data)
//   if (!deliveryNoteData) {
//     return (
//       <div className="flex items-center justify-center h-[80vh] text-orange-600">
//         Delivery Note details not found for ID: {deliveryNoteId} (PO: {poId}).
//       </div>
//     );
//   }

//   // Parse delivery history data safely
//   const deliveryHistory = safeJsonParse<{ data: DeliveryDataType }>(deliveryNoteData.delivery_data, { data: {} });

//   const displayDnId = formatDisplayId(deliveryNoteId, DOCUMENT_PREFIX.DELIVERY_NOTE);

//   // Render Success State
//   return (
//     <div className="container mx-auto px-4 py-6 max-w-4xl space-y-6"> {/* Increased max-width slightly, added padding */}
//       {/* Header Bar */}
//       <div className="flex items-center justify-between mb-4">
//         <h1 className="text-2xl font-bold text-gray-800">
//           {displayDnId}
//         </h1>
//         <Button onClick={handlePrint} variant="default" size="sm"> {/* Use standard variants/sizes */}
//           <Printer className="h-4 w-4 mr-2" />
//           Print DN
//         </Button>
//       </div>

//       {/* Main Content Grid/Flex */}
//       <div className="grid grid-cols-1 gap-6">
//         {/* Left Column (Details) */}
//         <OrderDetailsCard data={deliveryNoteData} />
//         <DeliveryPersonDetails deliveryContact={deliveryNoteData.delivery_contact} />

//         {/* Right Column (Items & History) */}
//         <DeliveryNoteItemsDisplay
//           // Pass only necessary, parsed data if possible
//           data={deliveryNoteData}
//           poMutate={refetchDeliveryNoteData} // Pass refetch function
//         />

//         {/* Delivery History */}
//         <DeliveryHistoryTable deliveryData={deliveryHistory.data} onPrintHistory={triggerHistoryPrint} />
//       </div>


//       {/* Hidden Printable Component */}
//       {/* Keep this outside the main layout flow */}
//       <div className="hidden print:block"> {/* Use print:block utility */}
//         <DeliveryNotePrintLayout ref={printComponentRef} data={deliveryNoteData} />
//       </div>
//       {/* 2. For printing specific history entries */}

//       <div className="hidden">
//         {historyEntryToPrint && (
//           <DeliveryNotePrintLayout
//             ref={historyPrintComponentRef}
//             // Pass the current main PO data but override items with historical data
//             data={{ ...deliveryNoteData, delivery_list: { list: historyEntryToPrint.items } }}
//           />
//         )}
//       </div>
//     </div>
//   );
// }

