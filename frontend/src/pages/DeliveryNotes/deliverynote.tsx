// import { Badge } from '@/components/ui/badge';  
// import { Button } from "@/components/ui/button";
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// import { useFrappeGetDoc } from 'frappe-react-sdk';
// import { MessageCircleMore, Printer } from "lucide-react";
// import { useRef } from 'react';
// import { useLocation, useNavigate, useParams } from 'react-router-dom';
// // import { z } from "zod";
// import logo from "@/assets/logo-svg.svg";
// import { AddressView } from '@/components/address-view';
// import { TailSpin } from 'react-loader-spinner';
// import { useReactToPrint } from 'react-to-print';
// import Seal from "../../assets/NIRMAAN-SEAL.jpeg";
// import DeliveryHistoryTable from './DeliveryHistory';
// import { DeliveryNoteItemsDisplay } from './deliveryNoteItemsDisplay';


// export default function DeliveryNote() {

//   const location = useLocation()
//   const { dnId: id } = useParams<{ dnId: string }>();

//   if(!id) return <div className="flex items-center justify-center h-[90vh]">Error: DN ID is missing.</div>

//   const deliveryNoteId = id.replaceAll("&=", "/");
//   const poId = deliveryNoteId?.replace("DN", "PO")

//   const { data, isLoading, mutate: poMutate } = useFrappeGetDoc("Procurement Orders", poId, `Procurement Orders ${poId}`);

//   const navigate = useNavigate();

//   const componentRef = useRef<HTMLDivElement>(null);

//   const handlePrint = useReactToPrint({
//     content: () => componentRef.current,
//     documentTitle: `${(data?.name)?.toUpperCase().replace("PO", "DN")}_${data?.vendor_name}`
//   });

//   if (isLoading) return <div className="flex items-center h-[90vh] w-full justify-center"><TailSpin color={"red"} /> </div>

//   return (
//     <div className="container mx-auto px-0 max-w-3xl space-y-4">
//       <div className="flex items-center justify-between">
//         <h1 className="text-2xl max-md:text-xl font-bold ml-2">
//           DN-{poId.split("/")[1]}
//         </h1>
//         <Button onClick={handlePrint} className="flex items-center gap-1">
//           <Printer className="h-4 w-4" />
//           Print
//         </Button>
//       </div>
//       <Card>
//         <CardHeader className="pb-2">
//           <div className="flex justify-between items-center">
//             <CardTitle className="text-xl max-md:text-lg font-semibold text-red-600">
//               Order Details
//             </CardTitle>
//             <Badge
//               variant={`${data?.status === "Dispatched" ? "orange" : "green"
//                 }`}
//               className=""
//             >
//               {data?.status}
//             </Badge>
//           </div>
//         </CardHeader>
//         <CardContent>
//           <div className="flex flex-row gap-2">
//             <strong>Addr:</strong> <AddressView id={data?.project_address} />
//           </div>
//           <div className="flex flex-row gap-2">
//             <strong>@PR:</strong>
//             <span
//               className="underline cursor-pointer"
//               onClick={() =>
//                 navigate(location.pathname.includes("delivery-notes")
//                 ? `/prs&milestones/procurement-requests/${data?.procurement_request}`
//                 : -1)
//               }
//             >
//               {data?.procurement_request}
//             </span>
//           </div>
//           <div className="flex flex-row gap-2">
//             <strong>@PO:</strong>
//             <span
//               className="underline cursor-pointer"
//               onClick={() =>
//                 navigate(
//                   location.pathname.includes("delivery-notes")
//                     ? `/prs&milestones/procurement-requests/${data?.procurement_request
//                     }/${data?.name.replaceAll("/", "&=")}`
//                     : -1
//                 )
//               }
//             >
//               {data?.name.replaceAll("&=", "/")}
//             </span>
//           </div>
//         </CardContent>
//         <CardHeader className="pb-2">
//           <CardTitle className="text-xl max-md:text-lg font-semibold text-red-600">
//             Delivery Person Details
//           </CardTitle>
//         </CardHeader>
//         <CardContent>
//           <p className="flex flex-row items-center gap-3.5">
//             <strong>Name:</strong> 
//             {!data?.delivery_contact ? (
//               <span className='text-xs'>Not Provided</span>
//               ) : (
//               <span>{data?.delivery_contact?.split(":")[0]}</span>
//             )}
//           </p>
//           <p className="flex flex-row items-center gap-2">
//             <strong>Mobile:</strong>
//             {!data?.delivery_contact ? (
//               <span className='text-xs'>Not Provided</span>
//               ) : (
//               <span>{data?.delivery_contact?.split(":")[1]}</span>
//             )} 
//           </p>
//         </CardContent>
//       </Card>

//       <DeliveryNoteItemsDisplay data={data} poMutate={poMutate} />

//       <DeliveryHistoryTable deliveryData={data?.delivery_data ? JSON.parse(data?.delivery_data)?.data : null} />

//       <div className="hidden">
//         <div ref={componentRef} className=" w-full p-4">
//           <div className="overflow-x-auto">
//             <table className="min-w-full divide-gray-200">
//               <thead className="border-b border-black">
//                 <tr>
//                   <th colSpan={8}>
//                     <div className="flex justify-between border-gray-600 pb-1">
//                       <div className="mt-2 flex justify-between">
//                         <div>
//                           <img
//                             src={logo}
//                             alt="Nirmaan"
//                             width="180"
//                             height="52"
//                           />
//                           <div className="pt-2 text-lg text-gray-500 font-semibold">
//                             Nirmaan(Stratos Infra Technologies Pvt. Ltd.)
//                           </div>
//                         </div>
//                       </div>
//                       <div>
//                         <div className="pt-2 text-xl text-gray-600 font-semibold">
//                           Delivery Note No.
//                         </div>
//                         <div className="text-lg font-semibold text-black">
//                           {data?.name?.toUpperCase().replace("PO", "DN")}
//                         </div>
//                       </div>
//                     </div>
//                     <div className="items-start text-start flex justify-between border-b-2 border-gray-600 pb-1 mb-1">
//                           <div className="text-xs text-gray-600 font-normal">
//                             {data?.project_gst
//                               ? data?.project_gst === "29ABFCS9095N1Z9"
//                                 ? "1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka"
//                                 : "7th Floor, MR1, ALTF Global Business Park Cowarking Space, Mehrauli Gurugram Rd, Tower D, Sikanderpur, Gurugram, Haryana - 122002"
//                               : "Please set company GST number in order to display the Address!"}
//                           </div>
//                           <div className="text-xs text-gray-600 font-normal">
//                             GST: {data?.project_gst || "N/A"}
//                           </div>
//                         </div>
//                     <div className="flex justify-between">
//                       <div>
//                         <div className="text-gray-500 text-sm pb-2 text-left">
//                           Vendor Address
//                         </div>
//                         <div className="text-sm font-medium text-gray-900 max-w-[280px] truncate text-left">
//                           {data?.vendor_name}
//                         </div>
//                         <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">
//                           <AddressView id={data?.vendor_address}/>
//                         </div>
//                         <div className="text-sm font-medium text-gray-900 text-left">
//                           GSTIN: {data?.vendor_gst}
//                         </div>
//                       </div>
//                       <div>
//                         <div>
//                           <h3 className="text-gray-500 text-sm pb-2 text-left">
//                             Delivery Location
//                           </h3>
//                           <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">
//                             <AddressView id={data?.project_address}/>
//                           </div>
//                         </div>
//                         <div className="pt-2">
//                           <div className="text-sm font-normal text-gray-900 text-left">
//                             <span className="text-gray-500 font-normal">
//                               Date:
//                             </span>
//                             &nbsp;&nbsp;&nbsp;
//                             <i>{data?.creation?.split(" ")[0]}</i>
//                           </div>
//                           <div className="text-sm font-normal text-gray-900 text-left">
//                             <span className="text-gray-500 font-normal">
//                               Project Name:
//                             </span>
//                             &nbsp;&nbsp;&nbsp;<i>{data?.project_name}</i>
//                           </div>
//                           <div className="text-sm font-normal text-gray-900 text-left">
//                             <span className="text-gray-500 font-normal">
//                               Against PO:
//                             </span>
//                             &nbsp;&nbsp;&nbsp;<i>{data?.name}</i>
//                           </div>
//                         </div>
//                       </div>
//                     </div>
//                   </th>
//                 </tr>
//                 <tr className="border-t border-black">
//                   <th
//                     scope="col"
//                     className="py-3 text-left text-xs font-bold text-gray-800 tracking-wider"
//                   >
//                     S. No.
//                   </th>
//                   <th
//                     scope="col"
//                     className="py-3 text-left text-xs font-bold text-gray-800 tracking-wider pr-48"
//                   >
//                     Items
//                   </th>
//                   <th
//                     scope="col"
//                     className="px-4 py-3 text-left text-xs font-bold text-gray-800 tracking-wider"
//                   >
//                     Unit
//                   </th>
//                   <th
//                     scope="col"
//                     className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider"
//                   >
//                     Qty
//                   </th>
//                 </tr>
//               </thead>
//               <tbody className={`bg-white`}>
//                 {data &&
//                   JSON.parse(data.order_list)?.list?.map(
//                     (item: any, index: number) => {
//                       return (
//                         <tr
//                           key={index}
//                           className={` page-break-inside-avoid ${index >= 14 ? "page-break-before" : ""
//                             }`}
//                         >
//                           <td className="py-2 text-sm whitespace-nowrap w-[7%]">
//                             {index + 1}.
//                           </td>
//                           <td className=" py-2 text-sm whitespace-nowrap text-wrap">
//                             {item.item}
//                             {item.comment && (
//                               <div className="flex gap-1 items-start block p-1">
//                                 <MessageCircleMore className="w-4 h-4 flex-shrink-0" />
//                                 <div className="text-xs text-gray-400">
//                                   {item.comment}
//                                 </div>
//                               </div>
//                             )}
//                           </td>
//                           <td className="px-4 py-2 text-sm whitespace-nowrap">
//                             {item.unit}
//                           </td>
//                           <td className="px-4 py-2 text-sm whitespace-nowrap">
//                             {item.received || 0}
//                           </td>
//                         </tr>
//                       );
//                     }
//                   )}
//                 <tr className="">
//                   <td className="py-2 text-sm whitespace-nowrap w-[7%]"></td>
//                   <td className=" py-2 whitespace-nowrap font-semibold flex justify-start w-[80%]"></td>
//                   <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">
//                     Total Quantity
//                   </td>
//                   <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">
//                     {data &&
//                       JSON.parse(data.order_list)?.list?.reduce(
//                         (acc, item) => acc + item.received || 0,
//                         0
//                       )}
//                   </td>
//                 </tr>
//                 <tr className="end-of-page page-break-inside-avoid">
//                   <td colSpan={6}>
//                     <img src={Seal} className="w-24 h-24" />
//                     <div className="text-sm text-gray-900 py-6">
//                       For, Stratos Infra Technologies Pvt. Ltd.
//                     </div>
//                   </td>
//                 </tr>
//               </tbody>
//             </table>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// }


// src/pages/DeliveryNote.tsx (or wherever your component resides)
import React, { useRef, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReactToPrint } from 'react-to-print';
import { Printer } from 'lucide-react';
import { TailSpin } from 'react-loader-spinner';

// UI Components
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from '@/components/ui/badge';
import { AddressView } from '@/components/address-view'; // Assuming this handles its own loading/error

// Child Components specific to Delivery Note display
import DeliveryHistoryTable from './components/DeliveryHistory'; // Adjust path
import { DeliveryNoteItemsDisplay } from './components/deliveryNoteItemsDisplay'; // Adjust path
import { DeliveryNotePrintLayout } from './components/DeliveryNotePrintLayout'; // Adjust path

// Hooks, Types, Constants
import { useDeliveryNoteData } from './hooks/useDeliveryNoteData'; // Adjust path
import { DeliveryDataType, ProcurementOrder } from '@/types/NirmaanStack/ProcurementOrders';
import {
  ROUTE_PATHS,
  STATUS_BADGE_VARIANT,
  DOCUMENT_PREFIX,
  encodeFrappeId,
  formatDisplayId,
  safeJsonParse,
  deriveDnIdFromPoId
} from './constants'; // Adjust path

// --- Helper Components (can be moved to separate files if they grow) ---

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
    // Optional: handle case where navigation is not possible (-1 behaviour?)
    // else { navigate(-1); } // Be cautious with -1, explicit paths are safer
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
      </CardContent>
    </Card>
  );
};

// --- Main Component ---

export default function DeliveryNote() {
  const {
    deliveryNoteId,
    poId,
    data: deliveryNoteData, // Renamed for clarity within this component scope
    isLoading,
    error,
    mutate: refetchDeliveryNoteData // Renamed mutate for clarity
  } = useDeliveryNoteData();

  // --- STATE FOR DYNAMIC PRINTING ---
  const [historyEntryToPrint, setHistoryEntryToPrint] = useState<DeliveryDataType[string] | null>(null);
  const historyPrintComponentRef = useRef<HTMLDivElement>(null);
  ///

  const printComponentRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    content: () => printComponentRef.current,
    documentTitle: deliveryNoteData
      ? `${deriveDnIdFromPoId(deliveryNoteData.name).toUpperCase()}_${deliveryNoteData.vendor_name}`
      : 'Delivery_Note',
    // Optional: Add page styles if needed
    // pageStyle: `@page { size: A4; margin: 20mm; } @media print { body { -webkit-print-color-adjust: exact; } }`
  });

  // --- NEW PRINT HOOK FOR HISTORY ---
  // This hook is configured but not called directly by a button.
  const handlePrintHistoryEntry = useReactToPrint({
    content: () => historyPrintComponentRef.current,
    documentTitle: `DN_History_${new Date(historyEntryToPrint?.timestamp || Date.now()).toISOString().split('T')[0]}`,
  });

  // --- FUNCTION TO TRIGGER THE HISTORY PRINT ---
  // This is the function we will pass down to the history table.
  const triggerHistoryPrint = useCallback((historyData: DeliveryDataType[string]) => {
    // 1. Set the data for the printable component
    setHistoryEntryToPrint(historyData);

    // 2. Trigger the print dialog
    // We use a short timeout to ensure React has updated the state and rendered
    // the new data into the hidden component before the print dialog opens.
    setTimeout(() => {
      handlePrintHistoryEntry();
    }, 50); // A 50ms delay is usually sufficient

  }, [handlePrintHistoryEntry]);



  // Loading State
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <TailSpin height={50} width={50} color="red" />
        <span className="ml-2 text-gray-600">Loading Delivery Note...</span>
      </div>
    );
  }

  // Error State (Hook Error or Missing ID)
  if (error || !deliveryNoteId || !poId) {
    console.error("Delivery Note Error:", error, "DN ID:", deliveryNoteId, "PO ID:", poId);
    return (
      <div className="flex items-center justify-center h-[80vh] text-red-600">
        Error: {error?.message || 'Failed to load Delivery Note data. The ID might be missing or invalid.'}
      </div>
    );
  }

  // Data Not Found State (Query succeeded but returned no data)
  if (!deliveryNoteData) {
    return (
      <div className="flex items-center justify-center h-[80vh] text-orange-600">
        Delivery Note details not found for ID: {deliveryNoteId} (PO: {poId}).
      </div>
    );
  }

  // Parse delivery history data safely
  const deliveryHistory = safeJsonParse<{ data: DeliveryDataType }>(deliveryNoteData.delivery_data, { data: {} });

  const displayDnId = formatDisplayId(deliveryNoteId, DOCUMENT_PREFIX.DELIVERY_NOTE);

  // Render Success State
  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl space-y-6"> {/* Increased max-width slightly, added padding */}
      {/* Header Bar */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-800">
          {displayDnId}
        </h1>
        <Button onClick={handlePrint} variant="default" size="sm"> {/* Use standard variants/sizes */}
          <Printer className="h-4 w-4 mr-2" />
          Print DN
        </Button>
      </div>

      {/* Main Content Grid/Flex */}
      <div className="grid grid-cols-1 gap-6">
        {/* Left Column (Details) */}
        <OrderDetailsCard data={deliveryNoteData} />
        <DeliveryPersonDetails deliveryContact={deliveryNoteData.delivery_contact} />

        {/* Right Column (Items & History) */}
        <DeliveryNoteItemsDisplay
          // Pass only necessary, parsed data if possible
          data={deliveryNoteData}
          poMutate={refetchDeliveryNoteData} // Pass refetch function
        />

        {/* Delivery History */}
        <DeliveryHistoryTable deliveryData={deliveryHistory.data} onPrintHistory={triggerHistoryPrint} />
      </div>


      {/* Hidden Printable Component */}
      {/* Keep this outside the main layout flow */}
      <div className="hidden print:block"> {/* Use print:block utility */}
        <DeliveryNotePrintLayout ref={printComponentRef} data={deliveryNoteData} />
      </div>
      {/* 2. For printing specific history entries */}

      <div className="hidden">
        {historyEntryToPrint && (
          <DeliveryNotePrintLayout
            ref={historyPrintComponentRef}
            // Pass the current main PO data but override items with historical data
            data={{ ...deliveryNoteData, delivery_list: { list: historyEntryToPrint.items } }}
          />
        )}
      </div>
    </div>
  );
}