// import logo from "@/assets/logo-svg.svg";
// import Seal from "@/assets/NIRMAAN-SEAL.jpeg";
// import {
//   ProcurementOrder,
//   PurchaseOrderItem,
//   PaymentTerm, POTotals
// } from "@/types/NirmaanStack/ProcurementOrders";
// import formatToIndianRupee from "@/utils/FormatPrice";
// import { parseNumber } from "@/utils/parseNumber";
// import { useFrappeGetDocList } from "frappe-react-sdk";
// import { MessageCircleMore, Printer } from "lucide-react";
// import * as pdfjsLib from "pdfjs-dist";
// import { useEffect, useRef, useState, useMemo } from "react";
// import { useReactToPrint } from "react-to-print";
// import { AddressView } from "@/components/address-view";
// import { Button } from "@/components/ui/button";

// import { Sheet, SheetContent } from "@/components/ui/sheet";

// interface POPdfProps {
//   po: ProcurementOrder | null;
//   orderData?: PurchaseOrderItem[];
//   paymentTerms?: PaymentTerm[];
//   includeComments: boolean
//   POTotals?: POTotals;
//   // advance: number
//   // materialReadiness: number
//   // afterDelivery: number
//   // xDaysAfterDelivery: number
//   // xDays: number
//   poPdfSheet: boolean;
//   togglePoPdfSheet: () => void;
// }

// pdfjsLib.GlobalWorkerOptions.workerSrc =
//   "https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js";


// const gstAddressMap = {
//   "29ABFCS9095N1Z9": "1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka",
//   "06ABFCS9095N1ZH": "7th Floor, MR1, ALTF Global Business Park Cowarking Space, Mehrauli Gurugram Rd, Tower D, Sikanderpur, Gurugram - 122002, Haryana",
//   "09ABFCS9095N1ZB": "MR1, Plot no. 21 & 21A, AltF 142 Noida, Sector 142, Noida - 201305, Uttar Pradesh"
// }

// export const POPdf: React.FC<POPdfProps> = ({
//   po,
//   orderData,
//   includeComments,
//   POTotals,
//   paymentTerms,
//   poPdfSheet,
//   togglePoPdfSheet,
// }) => {
//   if (!po) return <div>No PO ID Provided</div>;
//   const componentRef = useRef<HTMLDivElement>(null);

//   const finalPaymentTerms = paymentTerms && paymentTerms.length > 0 ? paymentTerms : po?.payment_terms;

//   const { data: attachmentsData } = useFrappeGetDocList(
//     "Nirmaan Attachments",
//     {
//       fields: ["*"],
//       filters: [
//         ["associated_doctype", "=", "Procurement Requests"],
//         ["associated_docname", "=", po?.procurement_request!],
//         ["attachment_type", "=", "custom pr attachment"],
//       ],
//     },
//     po?.procurement_request ? undefined : null
//   );

//   const [images, setImages] = useState([]);

//   // const loadPdfAsImages = async (pdfData) => {
//   //   try {

//   //     const response = await fetch(pdfData, {
//   //       method: 'GET',
//   //       headers: {
//   //         'Content-Type': 'application/pdf',
//   //       },
//   //     });

//   //     if (!response.ok) {
//   //       throw new Error(`Failed to fetch PDF: ${response.statusText}`);
//   //     }

//   //     const pdfArrayBuffer = await response.arrayBuffer();

//   //     const loadingTask = pdfjsLib.getDocument({ data: pdfArrayBuffer });
//   //     const pdf = await loadingTask.promise;

//   //     const pages = [];

//   //     for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
//   //       const page = await pdf.getPage(pageNum);

//   //       const viewport = page.getViewport({ scale: 1.5 });
//   //       const canvas = document.createElement('canvas');
//   //       const context = canvas.getContext('2d');
//   //       canvas.height = viewport.height;
//   //       canvas.width = viewport.width;

//   //       await page.render({ canvasContext: context, viewport }).promise;
//   //       const imgData = canvas.toDataURL();
//   //       pages.push(imgData);
//   //     }

//   //     setPdfImages(pages);
//   //   } catch (error) {
//   //     console.error('Failed to load PDF as images:', error);
//   //   }
//   // };

//   const loadFileAsImage = async (att) => {
//     try {
//       const baseURL = window.location.origin;
//       const fileUrl = `${baseURL}${att.attachment}`;
//       const fileType = att.attachment.split(".").pop().toLowerCase();

//       if (["pdf"].includes(fileType)) {
//         // Handle PDF files
//         const response = await fetch(fileUrl, {
//           method: "GET",
//           headers: {
//             "Content-Type": "application/pdf",
//           },
//         });

//         if (!response.ok) {
//           throw new Error(`Failed to fetch PDF: ${response.statusText}`);
//         }

//         const pdfArrayBuffer = await response.arrayBuffer();

//         const loadingTask = pdfjsLib.getDocument({ data: pdfArrayBuffer });
//         const pdf = await loadingTask.promise;

//         const pages = [];

//         for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
//           const page = await pdf.getPage(pageNum);

//           const viewport = page.getViewport({ scale: 1.5 });
//           const canvas = document.createElement("canvas");
//           const context = canvas.getContext("2d");
//           canvas.height = viewport.height;
//           canvas.width = viewport.width;

//           await page.render({ canvasContext: context, viewport }).promise;
//           const imgData = canvas.toDataURL();
//           pages.push(imgData);
//         }

//         setImages((prevImages) => [...prevImages, ...pages]);
//       } else if (["png", "jpg", "jpeg", "gif", "webp"].includes(fileType)) {
//         // Handle image files
//         setImages((prevImages) => [...prevImages, fileUrl]);
//       } else {
//         console.warn(`Unsupported file type: ${fileType}`);
//       }
//     } catch (error) {
//       console.error("Failed to load file as image:", error);
//     }
//   };

//   useEffect(() => {
//     if (attachmentsData) {
//       attachmentsData.forEach(loadFileAsImage);
//     }
//   }, [attachmentsData]);

//   const handlePrint = useReactToPrint({
//     content: () => componentRef.current || null,
//     documentTitle: `${po?.name}_${po?.vendor_name}`,
//   });


//   const parsedNotes = useMemo(() => {
//     if (!po?.note_points) {
//       return []; // Return an empty array if there are no notes
//     }
//     try {
//       const parsedObject = JSON.parse(po?.note_points);
//       const notesList = parsedObject.list;
//       if (Array.isArray(notesList)) {
//         // Return a clean array of strings, filtering out any empty notes
//         return notesList.map((item) => item.note).filter(Boolean);
//       }
//     } catch (error) {
//       console.error("Could not parse po.note_points as JSON:", error);
//     }
//     // Return an empty array in case of errors or invalid data structure
//     return [];
//   }, [po.note_points]); // Dependency: this logic only re-runs if note_points changes.


//   return (
//     <Sheet open={poPdfSheet} onOpenChange={togglePoPdfSheet}>
//       <SheetContent className="overflow-y-auto md:min-w-[900px]">
//         <Button onClick={handlePrint} className="flex items-center gap-1">
//           <Printer className="h-4 w-4" />
//           Print
//         </Button>
//         <div className={`w-full border mt-6`}>
//           <div ref={componentRef} className="w-full p-4">
//             <div className="overflow-x-auto p-4">
//               <table className="min-w-full divide-gray-200">
//                 <thead className="border-b border-black">
//                   <tr>
//                     <th colSpan={8}>
//                       <div className="flex justify-between border-gray-600 pb-1">
//                         <div className="mt-2 flex justify-between">
//                           <div>
//                             {/* <img className="w-44" src={redlogo} alt="Nirmaan" /> */}
//                             <img
//                               src={logo}
//                               alt="Nirmaan"
//                               width="180"
//                               height="52"
//                             />
//                             <div className="pt-2 text-lg text-gray-600 font-semibold">
//                               Nirmaan(Stratos Infra Technologies Pvt. Ltd.)
//                             </div>
//                           </div>
//                         </div>
//                         <div>
//                           <div className="pt-2 text-xl text-gray-600 font-semibold">
//                             Purchase Order No.
//                           </div>
//                           <div className="text-lg font-light italic text-black">
//                             {po?.name?.toUpperCase()}
//                           </div>
//                         </div>
//                       </div>

//                       <div className="items-start text-start flex justify-between border-b-2 border-gray-600 pb-1 mb-1">
//                         <div className="text-xs text-gray-600 font-normal">
//                           {po?.project_gst
//                             ? po?.project_gst === "29ABFCS9095N1Z9"
//                               ? "1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka"
//                               : "7th Floor, MR1, ALTF Global Business Park Cowarking Space, Mehrauli Gurugram Rd, Tower D, Sikanderpur, Gurugram, Haryana - 122002"
//                             : "Please set company GST number in order to display the Address!"}
//                         </div>
//                         <div className="text-xs text-gray-600 font-normal">
//                           GST: {po?.project_gst || "N/A"}
//                         </div>
//                       </div>

//                       <div className="flex justify-between">
//                         <div>
//                           <div className="text-gray-600 text-sm pb-2 text-left">
//                             Vendor Address
//                           </div>
//                           <div className="text-sm font-medium text-gray-900 max-w-[280px] truncate text-left">
//                             {po?.vendor_name}
//                           </div>
//                           <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">
//                             <AddressView id={po?.vendor_address || ""} />
//                           </div>
//                           <div className="text-sm font-medium text-gray-900 text-left">
//                             GSTIN: {po?.vendor_gst}
//                           </div>
//                         </div>
//                         <div>
//                           <div>
//                             <h3 className="text-gray-600 text-sm pb-2 text-left">
//                               Delivery Location
//                             </h3>
//                             <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">
//                               <AddressView id={po?.project_address} />
//                             </div>
//                           </div>
//                           <div className="pt-2">
//                             <div className="text-sm font-normal text-gray-900 text-left">
//                               <span className="text-gray-600 font-normal">
//                                 Date:
//                               </span>
//                               &nbsp;&nbsp;&nbsp;
//                               <i>{po?.creation?.split(" ")[0]}</i>
//                             </div>
//                             <div className="text-sm font-normal text-gray-900 text-left">
//                               <span className="text-gray-600 font-normal">
//                                 Project Name:
//                               </span>
//                               &nbsp;&nbsp;&nbsp;
//                               <i>{po?.project_name}</i>
//                             </div>
//                           </div>
//                         </div>
//                       </div>
//                     </th>
//                   </tr>
//                   <tr className="border-t border-black">
//                     <th
//                       scope="col"
//                       className="py-3 px-2 text-left text-xs font-bold text-gray-800 tracking-wider"
//                     >
//                       S. No.
//                     </th>
//                     <th
//                       scope="col"
//                       className="py-3 text-left text-xs font-bold text-gray-800 tracking-wider pr-48"
//                     >
//                       Items
//                     </th>
//                     <th
//                       scope="col"
//                       className="px-4 py-3 text-left text-xs font-bold text-gray-800 tracking-wider"
//                     >
//                       Unit
//                     </th>
//                     <th
//                       scope="col"
//                       className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider"
//                     >
//                       Qty
//                     </th>
//                     <th
//                       scope="col"
//                       className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider"
//                     >
//                       Rate
//                     </th>
//                     <th
//                       scope="col"
//                       className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider"
//                     >
//                       Tax
//                     </th>
//                     <th
//                       scope="col"
//                       className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider"
//                     >
//                       Amount
//                     </th>
//                   </tr>
//                 </thead>
//                 <tbody className={`bg-white`}>
//                   {orderData?.map((item, index) => {
//                     return (
//                       <tr
//                         key={index}
//                         className={`${!parseNumber(po?.loading_charges) &&
//                           !parseNumber(po?.freight_charges) &&
//                           index === length - 1 &&
//                           "border-b border-black"
//                           } page-break-inside-avoid ${index === 15 ? "page-break-before" : ""
//                           }`}
//                       >
//                         <td className="py-2 px-2 text-sm whitespace-nowrap w-[7%]">
//                           {index + 1}.
//                         </td>
//                         <td className="py-2 text-xs whitespace-nowrap text-wrap">
//                           {item.item_name?.toUpperCase()}
//                           {item.make && (
//                             <p className="text-xs italic font-semibold text-gray-500">
//                               -{" "}{item.make?.toUpperCase()}
//                             </p>
//                           )}
//                           {item.comment && includeComments && (
//                             <div className="flex gap-1 items-start block p-1">
//                               <MessageCircleMore className="w-4 h-4 flex-shrink-0" />
//                               <div className="text-xs text-gray-400">
//                                 {item.comment}
//                               </div>
//                             </div>
//                           )}
//                         </td>
//                         <td className="px-4 py-2 text-sm whitespace-nowrap">
//                           {item.unit}
//                         </td>
//                         <td className="px-4 py-2 text-sm whitespace-nowrap">
//                           {item.quantity}
//                         </td>
//                         <td className="px-4 py-2 text-sm whitespace-nowrap">
//                           {formatToIndianRupee(item.quote)}
//                         </td>
//                         <td className="px-4 py-2 text-sm whitespace-nowrap">
//                           {item.tax}%
//                         </td>
//                         <td className="px-4 py-2 text-sm whitespace-nowrap">
//                           {formatToIndianRupee(item.quote * item.quantity)}
//                         </td>
//                       </tr>
//                     );
//                   })}

//                   {/* <tr className="border-t border-black">
//                     <td className="py-2 text-sm whitespace-nowrap w-[7%]"></td> 
//                     <td className=" py-2 whitespace-nowrap font-semibold flex justify-start w-[80%]"></td>
//                     <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
//                     <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
//                     <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
//                     <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">
//                       Sub-Total
//                     </td>
//                     <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">
//                       {formatToIndianRupee(po?.amount)}
//                     </td>
//                   </tr> */}

//                   <tr className="border-b border-t border-black">
//                     <td></td>
//                     <td></td>
//                     <td></td>
//                     <td></td>
//                     <td></td>
//                     <td className="space-y-4 w-[110px] py-4 flex flex-col items-end text-sm font-bold page-break-inside-avoid">
//                       <div>Sub-Total:</div>
//                       <div>Total Tax(GST):</div>
//                       <div>Round Off:</div>
//                       <div>Total:</div>
//                     </td>

//                     <td className="space-y-4 py-4 text-sm font-bold whitespace-nowrap">
//                       <div className="ml-4">
//                         {formatToIndianRupee(POTotals?.totalBase)}
//                       </div>
//                       <div className="ml-4">
//                         {formatToIndianRupee(POTotals?.totalTax)}
//                       </div>
//                       <div className="ml-4">
//                         {" "}
//                         {formatToIndianRupee(
//                           (POTotals?.grandTotal -
//                             Math.round(POTotals?.grandTotal)) *
//                           -1
//                         )}
//                       </div>
//                       <div className="ml-4">
//                         {formatToIndianRupee(Math.round(POTotals?.grandTotal))}
//                       </div>
//                     </td>
//                   </tr>
//                   <tr className="">
//                     <td colSpan={6}>
//                       {finalPaymentTerms.length > 0 && (
//                         <div className="mb-4">
//                           <div className="text-gray-600 font-bold text-sm py-2">
//                             Payment
//                           </div>
//                           <ul className="list-disc list-inside space-y-1 text-sm text-gray-900">
//                             <li>
//                               {finalPaymentTerms
//                                 // 1. (Optional but Recommended) Filter out terms with no value
//                                 .filter(
//                                   (term) => parseFloat(term.percentage) > 0
//                                 )

//                                 // 2. Map the array of objects to an array of strings in the desired format
//                                 .map(
//                                   (term) =>
//                                     `${parseFloat(term.percentage).toFixed(
//                                       2
//                                     )}% -- ${term.label}`
//                                 )

//                                 // 3. Join the array of strings into a single string, separated by ", "
//                                 .join(", ")}
//                             </li>
//                           </ul>
//                         </div>
//                       )}
//                     </td>
//                   </tr>
//                   <tr className="end-of-page page-break-inside-avoid">
//                     <td colSpan={6}>
//                       {parsedNotes.length > 0 && (
//                         <div className="mb-4">
//                           <div className="text-gray-600 font-bold text-sm py-2">
//                             Note
//                           </div>
//                           <ol className="list-decimal list-inside space-y-1 text-sm text-gray-900">
//                             {parsedNotes.map((note, index) => (
//                               <li key={index}>{note}</li>
//                             ))}
//                           </ol>
//                         </div>
//                       )}

//                       <img src={Seal} className="w-24 h-24" />
//                       <div className="text-sm text-gray-900 py-6">
//                         For, Stratos Infra Technologies Pvt. Ltd.
//                       </div>
//                     </td>
//                   </tr>
//                 </tbody>
//               </table>
//             </div>
//             <div style={{ display: "block", pageBreakBefore: "always" }}></div>
//             <div className="overflow-x-auto">
//               <table className="min-w-full divide-gray-200">
//                 <thead className="border-b border-black">
//                   <tr>
//                     <th colSpan={6}>
//                       <div className="flex justify-between border-gray-600 pb-1">
//                         <div className="mt-2 flex justify-between">
//                           <div>
//                             {/* <img className="w-44" src={redlogo} alt="Nirmaan" /> */}
//                             <img
//                               src={logo}
//                               alt="Nirmaan"
//                               width="180"
//                               height="52"
//                             />
//                             <div className="pt-2 text-lg text-gray-600 font-semibold">
//                               Nirmaan(Stratos Infra Technologies Pvt. Ltd.)
//                             </div>
//                           </div>
//                         </div>
//                         <div>
//                           <div className="pt-2 text-xl text-gray-600 font-semibold">
//                             Purchase Order No. :
//                           </div>
//                           <div className="text-lg font-light italic text-black">
//                             {po?.name?.toUpperCase()}
//                           </div>
//                         </div>
//                       </div>

//                       <div className="items-start text-start flex justify-between border-b-2 border-gray-600 pb-1 mb-1">
//                         <div className="text-xs text-gray-600 font-normal">
//                           {gstAddressMap[po?.project_gst]}
//                         </div>
//                         <div className="text-xs text-gray-600 font-normal">
//                           GST: {po?.project_gst || "N/A"}
//                         </div>
//                       </div>
//                     </th>
//                   </tr>
//                 </thead>
//                 <tbody>
//                   <div className="max-w-4xl mx-auto p-6 text-gray-800">
//                     <h1 className="text-xl font-bold mb-4">
//                       Terms and Conditions
//                     </h1>
//                     <h2 className="text-lg font-semibold mt-6">
//                       1. Invoicing:
//                     </h2>
//                     <ol className="list-decimal pl-6 space-y-2 text-sm">
//                       <li className="pl-2">
//                         All invoices shall be submitted in original and shall be
//                         tax invoices showing the breakup of tax structure/value
//                         payable at the prevailing rate and a clear description
//                         of goods.
//                       </li>
//                       <li className="pl-2">
//                         All invoices submitted shall have Delivery
//                         Challan/E-waybill for supply items.
//                       </li>
//                       <li className="pl-2">
//                         All Invoices shall have the tax registration numbers
//                         mentioned thereon. The invoices shall be raised in the
//                         name of “Stratos Infra Technologies Pvt Ltd, Bangalore”.
//                       </li>
//                       <li className="pl-2">
//                         Payments shall be only entertained after receipt of the
//                         correct invoice.
//                       </li>
//                       <li className="pl-2">
//                         In case of advance request, Advance payment shall be
//                         paid after the submission of an advance receipt (as
//                         suggested under GST law).
//                       </li>
//                     </ol>

//                     <h2 className="text-lg font-semibold mt-6">2. Payment:</h2>
//                     <ol className="list-decimal pl-6 space-y-2 text-sm">
//                       <li className="pl-2">
//                         Payment shall be done through RTGS/NEFT.
//                       </li>
//                       <li className="pl-2">
//                         A retention amount shall be deducted as per PO payment
//                         terms and:
//                       </li>
//                       <ol className="list-decimal pl-6 space-y-1 text-sm">
//                         <li className="pl-2">
//                           In case the vendor is not completing the task assigned
//                           by Nirmaan a suitable amount, as decided by Nirmaan,
//                           shall be deducted from the retention amount.
//                         </li>
//                         <li className="pl-2">
//                           The adjusted amount shall be paid on completion of the
//                           defect liability period.
//                         </li>
//                         <li className="pl-2">
//                           Vendors are expected to pay GST as per the prevailing
//                           rules. In case the vendor is not making GST payments
//                           to the tax authority, Nirmaan shall deduct the
//                           appropriated amount from the invoice payment of the
//                           vendor.
//                         </li>
//                         <li className="pl-2">
//                           Nirmaan shall deduct the following amounts from the
//                           final bills:
//                         </li>
//                         <ol className="list-decimal pl-6 space-y-1 text-sm">
//                           <li className="pl-2">
//                             Amount pertaining to unfinished supply.
//                           </li>
//                           <li className="pl-2">
//                             Amount pertaining to Liquidated damages and other
//                             fines, as mentioned in the documents.
//                           </li>
//                           <li className="pl-2">
//                             Any agreed amount between the vendor and Nirmaan.
//                           </li>
//                         </ol>
//                       </ol>
//                     </ol>

//                     <h2 className="text-lg font-semibold mt-6">
//                       3. Technical Specifications of the Work:
//                     </h2>
//                     <ol className="list-decimal pl-6 space-y-2 text-sm">
//                       <li className="pl-2">
//                         All goods delivered shall conform to the technical
//                         specifications mentioned in the vendor’s quote referred
//                         to in this PO or as detailed in Annexure 1 to this PO.
//                       </li>
//                       <li className="pl-2">
//                         Supply of goods or services shall be strictly as per
//                         Annexure - 1 or the Vendor’s quote/PI in case of the
//                         absence of Annexure - I.
//                       </li>
//                       <li className="pl-2">
//                         Any change in line items or quantities shall be duly
//                         approved by Nirmaan with rate approval prior to supply.
//                         Any goods supplied by the agency without obtaining due
//                         approvals shall be subject to the acceptance or
//                         rejection from Nirmaan.
//                       </li>
//                       <li className="pl-2">
//                         Any damaged/faulty material supplied needs to be
//                         replaced with a new item free of cost, without extending
//                         the completion dates.
//                       </li>
//                       <li className="pl-2">
//                         Material supplied in excess and not required by the
//                         project shall be taken back by the vendor at no cost to
//                         Nirmaan.
//                       </li>
//                     </ol>
//                     <br />
//                     <br />
//                     <br />
//                     <br />
//                     <br />

//                     <h1 className="text-xl font-bold mb-4">
//                       General Terms & Conditions for Purchase Order
//                     </h1>
//                     <ol className="list-decimal pl-6 space-y-2 text-sm">
//                       <li className="pl-2">
//                         <div className="font-semibold">Liquidity Damages:</div>{" "}
//                         Liquidity damages shall be applied at 2.5% of the order
//                         value for every day of delay.
//                       </li>
//                       <li className="pl-2">
//                         <div className="font-semibold">
//                           Termination/Cancellation:
//                         </div>{" "}
//                         If Nirmaan reasonably determines that it can no longer
//                         continue business with the vendor in accordance with
//                         applicable legal, regulatory, or professional
//                         obligations, Nirmaan shall have the right to
//                         terminate/cancel this PO immediately.
//                       </li>
//                       <li className="pl-2">
//                         <div className="font-semibold">
//                           Other General Conditions:
//                         </div>
//                       </li>
//                       <ol className="list-decimal pl-6 space-y-1 text-sm">
//                         <li className="pl-2">
//                           Insurance: All required insurance including, but not
//                           limited to, Contractors’ All Risk (CAR) Policy, FLEXA
//                           cover, and Workmen’s Compensation (WC) policy are in
//                           the vendor’s scope. Nirmaan in any case shall not be
//                           made liable for providing these insurance. All
//                           required insurances are required prior to the
//                           commencement of the work at the site.
//                         </li>
//                         <li className="pl-2">
//                           Safety: The safety and security of all men deployed
//                           and materials placed by the Vendor or its agents for
//                           the project shall be at the risk and responsibility of
//                           the Vendor. Vendor shall ensure compliance with all
//                           safety norms at the site. Nirmaan shall have no
//                           obligation or responsibility on any safety, security &
//                           compensation related matters for the resources &
//                           material deployed by the Vendor or its agent.
//                         </li>
//                         <li className="pl-2">
//                           Notice: Any notice or other communication required or
//                           authorized under this PO shall be in writing and given
//                           to the party for whom it is intended at the address
//                           given in this PO or such other address as shall have
//                           been notified to the other party for that purpose,
//                           through registered post, courier, facsimile or
//                           electronic mail.
//                         </li>
//                         <li className="pl-2">
//                           Force Majeure: Neither party shall be liable for any
//                           delay or failure to perform if such delay or failure
//                           arises from an act of God or of the public enemy, an
//                           act of civil disobedience, epidemic, war,
//                           insurrection, labor action, or governmental action.
//                         </li>
//                         <li className="pl-2">
//                           Name use: Vendor shall not use, or permit the use of,
//                           the name, trade name, service marks, trademarks, or
//                           logo of Nirmaan in any form of publicity, press
//                           release, advertisement, or otherwise without Nirmaan's
//                           prior written consent.
//                         </li>
//                         <li className="pl-2">
//                           Arbitration: Any dispute arising out of or in
//                           connection with the order shall be settled by
//                           Arbitration in accordance with the Arbitration and
//                           Conciliation Act,1996 (As amended in 2015). The
//                           arbitration proceedings shall be conducted in English
//                           in Bangalore by the sole arbitrator appointed by the
//                           Purchaser.
//                         </li>
//                         <li className="pl-2">
//                           The law governing: All disputes shall be governed as
//                           per the laws of India and subject to the exclusive
//                           jurisdiction of the court in Karnataka.
//                         </li>
//                       </ol>
//                     </ol>
//                   </div>
//                 </tbody>
//               </table>
//             </div>
//             {po?.custom === "true" && images?.length > 0 && (
//               <div>
//                 {images?.map((imgSrc, index) => (
//                   <img
//                     key={index}
//                     src={imgSrc}
//                     alt={`Attachment ${index + 1}`}
//                     style={{
//                       width: "100%",
//                       marginBottom: "20px",
//                       marginTop: "20px",
//                     }}
//                   />
//                 ))}
//               </div>
//             )}
//           </div>
//         </div>
//       </SheetContent>
//     </Sheet>
//   );
// };

// {# --- ATTACHMENT SECTION --- #}
  
//     {% if doc.attachment %}
//         {% set image_list = frappe.call("nirmaan_stack.api.pdf_to_image.get_attachments_for_print", file_url=doc.attachment) %}
//         {% if image_list and image_list | length > 0 %}
//             <div style="page-break-before: always;"></div>

//             <!--<div class="section-title">ATTACHMENT</div>-->
//             <div style="width:100%; text-align:center; margin: -10mm -12mm -15mm -12mm !important; position: relative;">
//                 {% for img_data in image_list %}
//                     <div class="converted-image-container">
//                         <img src="{{ img_data }}" alt="Attachment Page {{ loop.index }}">
//                     </div>
//                     {% if not loop.last %}<div style="page-break-after: always;"></div>{% endif %}
//                 {% endfor %}
//             </div>
//         {% endif %}
//     {% endif %}

// //-------Popdf will custom item also there make dynamically ---

import logo from "@/assets/logo-svg.svg";
import Seal from "@/assets/NIRMAAN-SEAL.jpeg";
import {
  ProcurementOrder,
  PurchaseOrderItem,
  PaymentTerm, POTotals
} from "@/types/NirmaanStack/ProcurementOrders";
import formatToIndianRupee from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { MessageCircleMore, Printer, Download } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import { useEffect, useRef, useState, useMemo } from "react";
import { useReactToPrint } from "react-to-print";
import { AddressView } from "@/components/address-view";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";

interface POPdfProps {
  po: ProcurementOrder | null;
  orderData?: PurchaseOrderItem[];
  paymentTerms?: PaymentTerm[];
  includeComments: boolean
  POTotals?: POTotals;
  poPdfSheet: boolean;
  togglePoPdfSheet: () => void;
}

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

const gstAddressMap = {
  "29ABFCS9095N1Z9": "1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka",
  "06ABFCS9095N1ZH": "7th Floor, MR1, ALTF Global Business Park Cowarking Space, Mehrauli Gurugram Rd, Tower D, Sikanderpur, Gurugram - 122002, Haryana",
  "09ABFCS9095N1ZB": "MR1, Plot no. 21 & 21A, AltF 142 Noida, Sector 142, Noida - 201305, Uttar Pradesh"
}

// Header Component for reuse
const POHeader: React.FC<{ po: ProcurementOrder; showVendorInfo?: boolean }> = ({ po, showVendorInfo = true }) => (
  <thead className="border-b border-black">
    <tr>
      <th colSpan={7}>
        <div className="flex justify-between border-gray-600 pb-1">
          <div className="mt-2 flex justify-between">
            <div>
              <img
                src={logo}
                alt="Nirmaan"
                width="180"
                height="52"
              />
              <div className="pt-2 text-lg text-gray-600 font-semibold">
                Nirmaan(Stratos Infra Technologies Pvt. Ltd.)
              </div>
            </div>
          </div>
          <div>
            <div className="pt-2 text-xl text-gray-600 font-semibold">
              Purchase Order No.
            </div>
            <div className="text-lg font-light italic text-black">
              {po?.name?.toUpperCase()}
            </div>
          </div>
        </div>

        <div className="items-start text-start flex justify-between border-b-2 border-gray-600 pb-1 mb-1">
          <div className="text-xs text-gray-600 font-normal">
            {gstAddressMap[po?.project_gst]}
              
          </div>
          <div className="text-xs text-gray-600 font-normal">
            GST: {po?.project_gst || "N/A"}
          </div>
        </div>

        {showVendorInfo && (
          <div className="flex justify-between">
            <div>
              <div className="text-gray-600 text-sm pb-2 text-left">
                Vendor Address
              </div>
              <div className="text-sm font-medium text-gray-900 max-w-[280px] truncate text-left">
                {po?.vendor_name}
              </div>
              <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">
                <AddressView id={po?.vendor_address || ""} />
              </div>
              <div className="text-sm font-medium text-gray-900 text-left">
                GSTIN: {po?.vendor_gst}
              </div>
            </div>
            <div>
              <div>
                <h3 className="text-gray-600 text-sm pb-2 text-left">
                  Delivery Location
                </h3>
                <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">
                  <AddressView id={po?.project_address} />
                </div>
              </div>
              <div className="pt-2">
                <div className="text-sm font-normal text-gray-900 text-left">
                  <span className="text-gray-600 font-normal">
                    Date:
                  </span>
                  &nbsp;&nbsp;&nbsp;
                  <i>{po?.creation?.split(" ")[0]}</i>
                </div>
                <div className="text-sm font-normal text-gray-900 text-left">
                  <span className="text-gray-600 font-normal">
                    Project Name:
                  </span>
                  &nbsp;&nbsp;&nbsp;
                  <i>{po?.project_name}</i>
                </div>
              </div>
            </div>
          </div>
        )}
      </th>
    </tr>
    <tr className="border-t border-black">
      <th
        scope="col"
        className="py-3 px-2 text-left text-xs font-bold text-gray-800 tracking-wider w-[8%]"
      >
        S. No.
      </th>
      <th
        scope="col"
        className="py-3 px-2 text-left text-xs font-bold text-gray-800 tracking-wider w-[35%]"
      >
        Items
      </th>
      <th
        scope="col"
        className="py-3 px-2 text-left text-xs font-bold text-gray-800 tracking-wider w-[10%]"
      >
        Unit
      </th>
      <th
        scope="col"
        className="py-3 px-2 text-left text-xs font-bold text-gray-800 tracking-wider w-[10%]"
      >
        Qty
      </th>
      <th
        scope="col"
        className="py-3 px-2 text-left text-xs font-bold text-gray-800 tracking-wider w-[12%]"
      >
        Rate
      </th>
      <th
        scope="col"
        className="py-3 px-2 text-left text-xs font-bold text-gray-800 tracking-wider w-[10%]"
      >
        Tax
      </th>
      <th
        scope="col"
        className="py-3 px-2 text-left text-xs font-bold text-gray-800 tracking-wider w-[15%]"
      >
        Amount
      </th>
    </tr>
  </thead>
);

// Function to estimate item height based on content
const estimateItemHeight = (item: PurchaseOrderItem, includeComments: boolean) => {
  const baseHeight = 40; // Base height for a simple item
  let estimatedHeight = baseHeight;
  
  // Estimate height based on item name length (assume ~35 characters per line)
  const itemNameLines = Math.ceil((item.item_name?.length || 0) / 35);
  if (itemNameLines > 1) {
    estimatedHeight += (itemNameLines - 1) * 16; // 16px per additional line
  }
  
  // Add height for make if present
  if (item.make) {
    const makeLines = Math.ceil(item.make.length / 35);
    estimatedHeight += makeLines * 16;
  }
  
  // Add height for comments if present and included
  if (item.comment && includeComments) {
    const commentLines = Math.ceil(item.comment.length / 30); // Comments are usually smaller text
    estimatedHeight += commentLines * 14 + 20; // Extra padding for comment box
  }
  
  return estimatedHeight;
};

// Item Row Component
const ItemRow: React.FC<{
  item: PurchaseOrderItem;
  index: number;
  includeComments: boolean;
}> = ({ item, index, includeComments }) => (
  <tr className="page-break-inside-avoid border-b border-gray-200">
    <td className="py-2 px-2 text-sm align-top w-[8%]">
      {index + 1}.
    </td>
    <td className="py-2 px-2 text-xs align-top w-[35%]">
      <div className="break-words">
        <div className="font-medium leading-tight">
          {item.item_name?.toUpperCase()}
        </div>
        {item.make && (
          <div className="text-xs italic font-semibold text-gray-500 mt-1 leading-tight">
            - {item.make?.toUpperCase()}
          </div>
        )}
        {item.comment && includeComments && (
          <div className="flex gap-1 items-start mt-2 p-2 bg-gray-50 rounded">
            <MessageCircleMore className="w-3 h-3 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-gray-600 break-words leading-tight">
              {item.comment}
            </div>
          </div>
        )}
      </div>
    </td>
    <td className="py-2 px-2 text-sm align-top w-[10%]">
      {item.unit}
    </td>
    <td className="py-2 px-2 text-sm align-top w-[10%]">
      {item.quantity}
    </td>
    <td className="py-2 px-2 text-sm align-top w-[12%]">
      {formatToIndianRupee(item.quote)}
    </td>
    <td className="py-2 px-2 text-sm align-top w-[10%]">
      {item.tax}%
    </td>
    <td className="py-2 px-2 text-sm align-top w-[15%]">
      {formatToIndianRupee(item.quote * item.quantity)}
    </td>
  </tr>
);

export const POPdf: React.FC<POPdfProps> = ({
  po,
  orderData,
  includeComments,
  POTotals,
  paymentTerms,
  poPdfSheet,
  togglePoPdfSheet,
}) => {
  if (!po) return <div>No PO ID Provided</div>;
  const componentRef = useRef<HTMLDivElement>(null);
  
  // Dynamic page height calculation (approximate print page height in pixels)
  const PAGE_HEIGHT = 1000; // Adjust based on your print settings
  const HEADER_HEIGHT = 200; // Approximate header height
  const AVAILABLE_HEIGHT = PAGE_HEIGHT - HEADER_HEIGHT;
  
  const finalPaymentTerms = paymentTerms && paymentTerms.length > 0 ? paymentTerms : po?.payment_terms;

  // const { data: attachmentsData } = useFrappeGetDocList(
  //   "Nirmaan Attachments",
  //   {
  //     fields: ["*"],
  //     filters: [
  //       ["associated_doctype", "=", "Procurement Requests"],
  //       ["associated_docname", "=", po?.procurement_request!],
  //       ["attachment_type", "=", "custom pr attachment"],
  //     ],
  //   },
  //   po?.procurement_request ? undefined : null
  // );

  const [images, setImages] = useState([]);
  const [isPrinting, setIsPrinting] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState<string | null>(null);

  // Helper to process a single attachment and return list of image URLs (or data URLs for PDF pages)
  const getImagesFromAttachment = async (att) => {
    try {
      console.log("Processing attachment:", att);
      let fileUrl = att.attachment;
      if (!fileUrl.startsWith("http")) {
         const baseURL = window.location.origin;
         const path = att.attachment.startsWith("/") ? att.attachment : `/${att.attachment}`;
         fileUrl = `${baseURL}${path}`;
      }
      console.log("File URL:", fileUrl);
      
      let fileType = "unknown";
      try {
          const urlObj = new URL(fileUrl);
          const fileNameParam = urlObj.searchParams.get("file_name");
          if (fileNameParam) {
             fileType = fileNameParam.split(".").pop().toLowerCase();
          } else {
             fileType = urlObj.pathname.split(".").pop().toLowerCase();
          }
      } catch (e) {
          console.warn("URL parsing failed, falling back to string split", e);
          fileType = att.attachment.split(".").pop().toLowerCase();
      }
      
      console.log("Detected File Type:", fileType);

      if (["pdf"].includes(fileType)) {
        // Handle PDF files
        console.log("Fetching PDF...");
        const response = await fetch(fileUrl, { method: "GET" });

        if (!response.ok) {
           const errText = await response.text();
           throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText} - ${errText}`);
        }

        const pdfArrayBuffer = await response.arrayBuffer();
        console.log("PDF fetched, size:", pdfArrayBuffer.byteLength);

        const loadingTask = pdfjsLib.getDocument({ data: pdfArrayBuffer });
        const pdf = await loadingTask.promise;
        
        const pages = [];
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          await page.render({ canvasContext: context, viewport }).promise;
          const imgData = canvas.toDataURL();
          pages.push(imgData);
        }
        return pages;
      } else if (["png", "jpg", "jpeg", "gif", "webp"].includes(fileType)) {
        return [fileUrl];
      } else {
        console.warn(`Unsupported file type: ${fileType}`);
        return [];
      }
    } catch (error) {
      console.error("Failed to load file as image:", error);
      return [];
    }
  };

  useEffect(() => {
    let isActive = true;

    const fetchAllAttachments = async () => {
        // Direct PO Attachment
        const allAttachments = [];
        if (po?.attachment) {
            allAttachments.push({ attachment: po.attachment });
        }

        console.log("Processing Attachments list:", allAttachments);

        if (allAttachments.length === 0) {
            if (isActive) setImages([]);
            return;
        }

        // Process concurrently
        const results = await Promise.all(allAttachments.map(att => getImagesFromAttachment(att)));
        
        // Flatten results
        const flattenedImages = results.flat();
        
        if (isActive) {
            setImages(flattenedImages);
        }
    };

    fetchAllAttachments();

    return () => {
        isActive = false;
    };
  }, [po?.attachment]);


  const handlePrint = useReactToPrint({
    content: () => componentRef.current || null,
    documentTitle: `${po?.name}_${po?.vendor_name}`,
    onBeforeGetContent: () => {
      setIsPrinting(true);
    },
    onAfterPrint: () => {
      setIsPrinting(false);
    },
  });

  const handleDownloadPdf = async (formatName: string) => {
    if (!po?.name) return;
    setDownloadingFormat(formatName);
    try {
      // Use custom API to download merged PDF (PO + Attachments)
      const params = new URLSearchParams({
        doctype: "Procurement Orders",
        docname: po.name,
        print_format: formatName, // Dynamic format
      });

      const url = `/api/method/nirmaan_stack.api.pdf_helper.print_integration.download_merged_pdf?${params.toString()}`;
      
      const response = await fetch(url);
      if (!response.ok) throw new Error("Network response was not ok");
      
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      
      // Create temporary link to trigger download with custom filename
      const link = document.createElement('a');
      link.href = downloadUrl;
      // Custom Filename: [PO Number]_[Project Name]_[Format].pdf
      const safeName = po.name.replace(/\//g, "_");
      const safeProjectName = (po.project_name || "Project").replace(/\//g, "_");
      const suffix = formatName === "PO Orders Without rate" ? "_NoRate" : "";
      link.download = `${safeName}_${safeProjectName}${suffix}.pdf`;
      
      document.body.appendChild(link);
      link.click();
      
      // Cleanup
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error("Download failed:", error);
      // Fallback -> Standard Print
      const url = `/api/method/frappe.utils.print_format.download_pdf?doctype=Procurement Orders&name=${po?.name}&format=${formatName}&no_letterhead=0`;
      window.open(url, '_blank');
    } finally {
      setDownloadingFormat(null);
    }
  };

  const parsedNotes = useMemo(() => {
    if (!po?.note_points) {
      return [];
    }
    try {
      const parsedObject = JSON.parse(po?.note_points);
      const notesList = parsedObject.list;
      if (Array.isArray(notesList)) {
        return notesList.map((item) => item.note).filter(Boolean);
      }
    } catch (error) {
      console.error("Could not parse po.note_points as JSON:", error);
    }
    return [];
  }, [po.note_points]);

  // Smart pagination function that considers item height
  const smartPagination = (items: PurchaseOrderItem[]) => {
    if (!items || items.length === 0) return [];
    
    const pages = [];
    let currentPage = [];
    let currentPageHeight = 0;
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const itemHeight = estimateItemHeight(item, includeComments);
      
      // Check if adding this item would exceed page height
      if (currentPageHeight + itemHeight > AVAILABLE_HEIGHT && currentPage.length > 0) {
        // Start a new page
        pages.push(currentPage);
        currentPage = [item];
        currentPageHeight = itemHeight;
      } else {
        // Add item to current page
        currentPage.push(item);
        currentPageHeight += itemHeight;
      }
    }
    
    // Add the last page if it has items
    if (currentPage.length > 0) {
      pages.push(currentPage);
    }
    
    return pages;
  };

  const itemPages = smartPagination(orderData || []);

  return (
    <Sheet open={poPdfSheet} onOpenChange={togglePoPdfSheet}>
      <SheetContent className="overflow-y-auto md:min-w-[900px]">
        <div className="flex gap-2">
          <Button onClick={handlePrint} className="flex items-center gap-1">
            <Printer className="h-4 w-4" />
            Print
          </Button>
          <Button
            onClick={() => handleDownloadPdf("PO Invoice")}
            disabled={!!downloadingFormat}
            className="flex items-center gap-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className={`h-4 w-4 ${downloadingFormat === "PO Invoice" ? "animate-bounce" : ""}`} />
            {downloadingFormat === "PO Invoice" ? "Downloading..." : "Download"}
          </Button>
          <Button
            onClick={() => handleDownloadPdf("PO Orders Without Rate")}
            disabled={!!downloadingFormat}
            className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className={`h-4 w-4 ${downloadingFormat === "PO Orders Without Rate" ? "animate-bounce" : ""}`} />
            {downloadingFormat === "PO Orders Without Rate" ? "Downloading..." : "Download Without Rate"}
          </Button>
        </div>
        <div className={`w-full border mt-6`}>
          <div ref={componentRef} className="w-full p-4">
            <style>
              {`
                @media print {
                  .page-break {
                    page-break-before: always;
                  }
                  .page-break-inside-avoid {
        page-break-inside: avoid !important;
    }
                  .no-break-after {
                    page-break-after: avoid;
                  }
                }
                thead {
                  display: table-header-group !important;
                    }
                @media screen {
                  .page-break {
                    margin-top: 2rem;
                    border-top: 2px solid #e5e7eb;
                    padding-top: 1rem;
                  }
                }
              `}
            </style>
            
            {/* Render all item pages with smart pagination */}
            {itemPages.map((pageItems, pageIndex) => (
              <div key={pageIndex} className={pageIndex > 0 ? "page-break" : ""}>
                <div className="overflow-x-auto p-4">
                  <table className="min-w-full table-fixed divide-gray-200">
                    <POHeader po={po} showVendorInfo={pageIndex === 0} />
                    <tbody className="bg-white divide-y divide-gray-200">
                      {pageItems.map((item, itemIndex) => {
                        // Calculate global index across all pages
                        const globalIndex = itemPages.slice(0, pageIndex).reduce((acc, page) => acc + page.length, 0) + itemIndex + 1;
                        return (
                          <ItemRow 
                            key={globalIndex}
                            item={item}
                            index={globalIndex - 1}
                            includeComments={includeComments}
                          />
                        );
                      })}
                         {pageIndex === itemPages.length - 1 && (
                        <>
                          <tr className="border-b border-t border-black page-break-inside-avoid">
                            <td className="py-4 w-[8%]"></td>
                            <td className="py-4 w-[35%]"></td>
                            <td className="py-4 w-[10%]"></td>
                            <td className="py-4 w-[10%]"></td>
                           <td className="py-4 w-[10%]"></td>
                            <td className="py-4 text-sm font-bold text-right pr-2 page-break-inside-avoid w-[30%]">
                              <div className="space-y-2">
                                <div>Sub-Total:</div>
                                <div>Total Tax(GST):</div>
                                <div>Round Off:</div>
                                <div>Total:</div>
                              </div>
                            </td>
                            <td className="py-4 text-sm font-bold text-right pr-4 w-[15%]">
                              <div className="space-y-2">
                                <div>
                                  {formatToIndianRupee(POTotals?.totalBase)}
                                </div>
                                <div>
                                  {formatToIndianRupee(POTotals?.totalTax)}
                                </div>
                                <div>
                                  {formatToIndianRupee(
                                    (POTotals?.grandTotal -
                                      Math.round(POTotals?.grandTotal)) *
                                    -1
                                  )}
                                </div>
                                <div>
                                  {formatToIndianRupee(Math.round(POTotals?.grandTotal))}
                                </div>
                              </div>
                            </td>
                          </tr>
                          
                        
                          <tr>
                            <td colSpan={7}>
                              {finalPaymentTerms && finalPaymentTerms.length > 0 && (
                                <div className="mb-4">
                                  <div className="text-gray-600 font-bold text-sm py-2">
                                    Payment
                                  </div>
                                  <ul className="list-disc list-inside space-y-1 text-sm text-gray-900">
                                    <li>
                                      {finalPaymentTerms
                                        .filter(
                                          (term) => parseFloat(term.percentage) > 0
                                        )
                                        .map(
                                          (term) =>
                                            `${parseFloat(term.percentage).toFixed(
                                              2
                                            )}% -- ${term.label}`
                                        )
                                        .join(", ")}
                                    </li>
                                  </ul>
                                </div>
                              )}
                            </td>
                          </tr>
                          
                          {/* Notes and signature */}
                          <tr className="page-break-inside-avoid">
                            <td colSpan={7}>
                              {parsedNotes.length > 0 && (
                                <div className="mb-4">
                                  <div className="text-gray-600 font-bold text-sm py-2">
                                    Note
                                  </div>
                                  <ol className="list-decimal list-inside space-y-1 text-sm text-gray-900">
                                    {parsedNotes.map((note, index) => (
                                      <li key={index}>{note}</li>
                                    ))}
                                  </ol>
                                </div>
                              )}
                              <img src={Seal} className="w-24 h-24" />
                              <div className="text-sm text-gray-900 py-6">
                                For, Stratos Infra Technologies Pvt. Ltd.
                              </div>
                            </td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
                {/* RENDER THE SUMMARY AND TOTALS SECTION ONLY ON THE LAST PAGE */}
  
              </div>
            ))}

            {/* Summary and totals section
            <div className="overflow-x-auto p-4 page-break-inside-avoid">
              <table className="min-w-full table-fixed divide-gray-200">
                <POHeader po={po} showVendorInfo={false} />
                <tbody>
                  <tr className="border-b border-t border-black page-break-inside-avoid">
                    <td className="py-4 w-[8%]"></td>
                    <td className="py-4 w-[35%]"></td>
                    <td className="py-4 w-[10%]"></td>
                    <td className="py-4 w-[10%]"></td>
                   
                    <td className="py-4 text-sm font-bold text-right pr-2 page-break-inside-avoid w-[30%]">
                      <div className="space-y-2">
                        <div>Sub-Total:</div>
                        <div>Total Tax(GST):</div>
                        <div>Round Off:</div>
                        <div>Total:</div>
                      </div>
                    </td>
                    <td className="py-4 text-sm font-bold text-right pr-4 w-[15%]">
                      <div className="space-y-2">
                        <div>
                          {formatToIndianRupee(POTotals?.totalBase)}
                        </div>
                        <div>
                          {formatToIndianRupee(POTotals?.totalTax)}
                        </div>
                        <div>
                          {formatToIndianRupee(
                            (POTotals?.grandTotal -
                              Math.round(POTotals?.grandTotal)) *
                            -1
                          )}
                        </div>
                        <div>
                          {formatToIndianRupee(Math.round(POTotals?.grandTotal))}
                        </div>
                      </div>
                    </td>
                  </tr>
                  
                 
                  <tr>
                    <td colSpan={7}>
                      {finalPaymentTerms && finalPaymentTerms.length > 0 && (
                        <div className="mb-4">
                          <div className="text-gray-600 font-bold text-sm py-2">
                            Payment
                          </div>
                          <ul className="list-disc list-inside space-y-1 text-sm text-gray-900">
                            <li>
                              {finalPaymentTerms
                                .filter(
                                  (term) => parseFloat(term.percentage) > 0
                                )
                                .map(
                                  (term) =>
                                    `${parseFloat(term.percentage).toFixed(
                                      2
                                    )}% -- ${term.label}`
                                )
                                .join(", ")}
                            </li>
                          </ul>
                        </div>
                      )}
                    </td>
                  </tr>
                  
         
                  <tr className="page-break-inside-avoid">
                    <td colSpan={7}>
                      {parsedNotes.length > 0 && (
                        <div className="mb-4">
                          <div className="text-gray-600 font-bold text-sm py-2">
                            Note
                          </div>
                          <ol className="list-decimal list-inside space-y-1 text-sm text-gray-900">
                            {parsedNotes.map((note, index) => (
                              <li key={index}>{note}</li>
                            ))}
                          </ol>
                        </div>
                      )}
                      <img src={Seal} className="w-24 h-24" />
                      <div className="text-sm text-gray-900 py-6">
                        For, Stratos Infra Technologies Pvt. Ltd.
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div> */}

            {/* Terms and Conditions Page */}
            <div className="page-break ">
              <div className="overflow-x-auto px-4">
                <table className="min-w-full divide-gray-200">
                  <thead className="border-b border-black mt-2">
                    <tr>
                      <th colSpan={6}>
                        <div className="flex justify-between border-gray-600 pb-1 pt-2 mt-4">
                          <div className=" flex justify-between">
                            <div>
                              <img
                                src={logo}
                                alt="Nirmaan"
                                width="180"
                                height="52"
                              />
                              <div className="pt-2 text-lg text-gray-600 font-semibold">
                                Nirmaan(Stratos Infra Technologies Pvt. Ltd.)
                              </div>
                            </div>
                          </div>
                          <div>
                            <div className="pt-2 text-xl text-gray-600 font-semibold">
                              Purchase Order No. :
                            </div>
                            <div className="text-lg font-light italic text-black">
                              {po?.name?.toUpperCase()}
                            </div>
                          </div>
                        </div>

                        <div className="items-start text-start flex justify-between border-b-2 border-gray-600 pb-1 mb-1">
                          <div className="text-xs text-gray-600 font-normal">
                            {gstAddressMap[po?.project_gst]}
                          </div>
                          <div className="text-xs text-gray-600 font-normal">
                            GST: {po?.project_gst || "N/A"}
                          </div>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={6}>
                        <div className="max-w-4xl mx-auto p-6 text-gray-800">
                          <h1 className="text-xl font-bold mb-4">
                            Terms and Conditions
                          </h1>
                          <h2 className="text-lg font-semibold mt-6">
                            1. Invoicing:
                          </h2>
                          <ol className="list-decimal pl-6 space-y-2 text-sm">
                            <li className="pl-2">
                              All invoices shall be submitted in original and shall be
                              tax invoices showing the breakup of tax structure/value
                              payable at the prevailing rate and a clear description
                              of goods.
                            </li>
                            <li className="pl-2">
                              All invoices submitted shall have Delivery
                              Challan/E-waybill for supply items.
                            </li>
                            <li className="pl-2">
                              All Invoices shall have the tax registration numbers
                              mentioned thereon. The invoices shall be raised in the
                              name of "Stratos Infra Technologies Pvt Ltd, Bangalore".
                            </li>
                            <li className="pl-2">
                              Payments shall be only entertained after receipt of the
                              correct invoice.
                            </li>
                            <li className="pl-2">
                              In case of advance request, Advance payment shall be
                              paid after the submission of an advance receipt (as
                              suggested under GST law).
                            </li>
                          </ol>

                          <h2 className="text-lg font-semibold mt-6">2. Payment:</h2>
                          <ol className="list-decimal pl-6 space-y-2 text-sm">
                            <li className="pl-2">
                              Payment shall be done through RTGS/NEFT.
                            </li>
                            <li className="pl-2">
                              A retention amount shall be deducted as per PO payment
                              terms and:
                            </li>
                            <li className="pl-2">
                              In case the vendor is not completing the task assigned
                              by Nirmaan a suitable amount, as decided by Nirmaan,
                              shall be deducted from the retention amount.
                            </li>
                            <li className="pl-2">
                              The adjusted amount shall be paid on completion of the
                              defect liability period.
                            </li>
                            <li className="pl-2">
                              Vendors are expected to pay GST as per the prevailing
                              rules. In case the vendor is not making GST payments
                              to the tax authority, Nirmaan shall deduct the
                              appropriated amount from the invoice payment of the
                              vendor.
                            </li>
                            <li className="pl-2">
                              Nirmaan shall deduct the following amounts from the
                              final bills:
                            </li>
                            <li className="pl-2">
                              Amount pertaining to unfinished supply.
                            </li>
                            <li className="pl-2">
                              Amount pertaining to Liquidated damages and other
                              fines, as mentioned in the documents.
                            </li>
                            <li className="pl-2">
                              Any agreed amount between the vendor and Nirmaan.
                            </li>
                          </ol>
                          
                          <h2 className="text-lg font-semibold mt-6">
                            3. Technical Specifications of the Work:
                          </h2>
                          <ol className="list-decimal pl-6 space-y-2 text-sm">
                            <li className="pl-2">
                              All goods delivered shall conform to the technical
                              specifications mentioned in the vendor's quote referred
                              to in this PO or as detailed in Annexure 1 to this PO.
                            </li>
                            <li className="pl-2">
                              Supply of goods or services shall be strictly as per
                              Annexure - 1 or the Vendor's quote/PI in case of the
                              absence of Annexure - I.
                            </li>
                            <li className="pl-2">
                              Any change in line items or quantities shall be duly
                              approved by Nirmaan with rate approval prior to supply.
                              Any goods supplied by the agency without obtaining due
                              approvals shall be subject to the acceptance or
                              rejection from Nirmaan.
                            </li>
                            <li className="pl-2">
                              Any damaged/faulty material supplied needs to be
                              replaced with a new item free of cost, without extending
                              the completion dates.
                            </li>
                            <li className="pl-2">
                              Material supplied in excess and not required by the
                              project shall be taken back by the vendor at no cost to
                              Nirmaan.
                            </li>
                          </ol>
                          
                          <h1 className="text-xl font-bold mb-4 mt-8">
                            General Terms & Conditions for Purchase Order
                          </h1>
                          <ol className="list-decimal pl-6 space-y-2 text-sm">
                            <li className="pl-2">
                              <div className="font-semibold">Liquidity Damages:</div>{" "}
                              Liquidity damages shall be applied at 2.5% of the order
                              value for every day of delay.
                            </li>
                            <li className="pl-2">
                              <div className="font-semibold">
                                Termination/Cancellation:
                              </div>{" "}
                              If Nirmaan reasonably determines that it can no longer
                              continue business with the vendor in accordance with
                              applicable legal, regulatory, or professional
                              obligations, Nirmaan shall have the right to
                              terminate/cancel this PO immediately.
                            </li>
                            <li className="pl-2">
                              <div className="font-semibold">
                                Other General Conditions:
                              </div>
                            </li>
                            <li className="pl-2">
                              Insurance: All required insurance including, but not
                              limited to, Contractors' All Risk (CAR) Policy, FLEXA
                              cover, and Workmen's Compensation (WC) policy are in
                              the vendor's scope. Nirmaan in any case shall not be
                              made liable for providing these insurance. All
                              required insurances are required prior to the
                              commencement of the work at the site.
                            </li>
                            <li className="pl-2">
                              Safety: The safety and security of all men deployed
                              and materials placed by the Vendor or its agents for
                              the project shall be at the risk and responsibility of
                              the Vendor. Vendor shall ensure compliance with all
                              safety norms at the site. Nirmaan shall have no
                              obligation or responsibility on any safety, security &
                              compensation related matters for the resources &
                              material deployed by the Vendor or its agent.
                            </li>
                            <li className="pl-2">
                              Notice: Any notice or other communication required or
                              authorized under this PO shall be in writing and given
                              to the party for whom it is intended at the address
                              given in this PO or such other address as shall have
                              been notified to the other party for that purpose,
                              through registered post, courier, facsimile or
                              electronic mail.
                            </li>
                            <li className="pl-2">
                              Force Majeure: Neither party shall be liable for any
                              delay or failure to perform if such delay or failure
                              arises from an act of God or of the public enemy, an
                              act of civil disobedience, epidemic, war,
                              insurrection, labor action, or governmental action.
                            </li>
                            <li className="pl-2">
                              Name use: Vendor shall not use, or permit the use of,
                              the name, trade name, service marks, trademarks, or
                              logo of Nirmaan in any form of publicity, press
                              release, advertisement, or otherwise without Nirmaan's
                              prior written consent.
                            </li>
                            <li className="pl-2">
                              Arbitration: Any dispute arising out of or in
                              connection with the order shall be settled by
                              Arbitration in accordance with the Arbitration and
                              Conciliation Act,1996 (As amended in 2015). The
                              arbitration proceedings shall be conducted in English
                              in Bangalore by the sole arbitrator appointed by the
                              Purchaser.
                            </li>
                            <li className="pl-2">
                              The law governing: All disputes shall be governed as
                              per the laws of India and subject to the exclusive
                              jurisdiction of the court in Karnataka.
                            </li>
                          </ol>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Attachments */}
            {po?.custom === "true" && images?.length > 0 && (
              <div>
                {images?.map((imgSrc, index) => (
                  <img
                    key={index}
                    src={imgSrc}
                    alt={`Attachment ${index + 1}`}
                    style={{
                      width: "100%",
                      marginBottom: "20px",
                      marginTop: "20px",
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};