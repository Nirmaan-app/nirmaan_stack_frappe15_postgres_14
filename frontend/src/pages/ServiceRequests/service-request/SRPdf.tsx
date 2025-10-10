import React, { useMemo } from 'react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { AddressView } from "@/components/address-view";


interface SRPdfProps {
  srPdfSheet: boolean;
  toggleSrPdfSheet: () => void;
  handlePrint: () => void;
  componentRef: React.RefObject<HTMLDivElement>;
  orderData: any;
  service_vendor: any;
  project: any;
  gstEnabled: boolean;
  getTotal: number;
  notes: any[];
  logo: string;
  Seal: string;
  formatToIndianRupee: (amount: number) => string;
  parseNumber: (value: any) => number;
  // AddressView: React.ComponentType<{ id: string }>;
}

const gstAddressMap = {
  "29ABFCS9095N1Z9": "1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka",
  "06ABFCS9095N1ZH": "7th Floor, MR1, ALTF Global Business Park Cowarking Space, Mehrauli Gurugram Rd, Tower D, Sikanderpur, Gurugram - 122002, Haryana",
  "09ABFCS9095N1ZB": "MR1, Plot no. 21 & 21A, AltF 142 Noida, Sector 142, Noida - 201305, Uttar Pradesh"
}

// Header Component for reuse
const SRHeader: React.FC<{ orderData: any; service_vendor: any; project: any; logo: string; showVendorInfo?: boolean; gstEnabled: boolean }> = ({ 
  orderData, 
  service_vendor, 
  project, 
  logo, 
  showVendorInfo = true,
  gstEnabled 
}) => (
  <thead className="border-b border-black">
    <tr>
      <th colSpan={gstEnabled ? 7 : 6}>
        <div className="flex justify-between border-gray-600 pb-1">
          <div className="mt-2 flex justify-between">
            <div>
              <img src={logo} alt="Nirmaan" width="180" height="52" />
              <div className="pt-2 text-lg text-gray-500 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
            </div>
          </div>
          <div>
            <div className="pt-2 text-xl text-gray-600 font-semibold">Purchase Order No.</div>
            <div className="text-lg font-semibold text-black">{(orderData?.name)?.toUpperCase()}</div>
          </div>
        </div>

        <div className="items-start text-start flex justify-between border-b-2 border-gray-600 pb-1 mb-1">
          <div className="text-xs text-gray-600 font-normal">
            {gstAddressMap[orderData?.project_gst]}
              {/* ? orderData?.project_gst === "29ABFCS9095N1Z9"
                ? "1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka"
                : "7th Floor, MR1, ALTF Global Business Park Cowarking Space, Mehrauli Gurugram Rd, Tower D, Sikanderpur, Gurugram, Haryana - 122002"
              : "Please set company GST number in order to display the Address!"} */}
          </div>
          <div className="text-xs text-gray-600 font-normal">
            GST: {orderData?.project_gst || "N/A"}
          </div>
        </div>

        {showVendorInfo && (
          <div className="flex justify-between">
            <div>
              <div className="text-gray-500 text-sm pb-2 text-left">Vendor Address</div>
              <div className="text-sm font-medium text-gray-900 max-w-[280px] truncate text-left">{service_vendor?.vendor_name}</div>
              <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left"><AddressView id={service_vendor?.vendor_address} /></div>
              <div className="text-sm font-medium text-gray-900 text-left">GSTIN: {service_vendor?.vendor_gst || "N/A"}</div>
            </div>
            <div>
              <div>
                <h3 className="text-gray-500 text-sm pb-2 text-left">Service Location</h3>
                <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left"><AddressView id={project?.project_address} /></div>
              </div>
              <div className="pt-2">
                <div className="text-sm font-normal text-gray-900 text-left"><span className="text-gray-500 font-normal">Date:</span>&nbsp;&nbsp;&nbsp;<i>{orderData?.modified?.split(" ")[0]}</i></div>
                <div className="text-sm font-normal text-gray-900 text-left"><span className="text-gray-500 font-normal">Project Name:</span>&nbsp;&nbsp;&nbsp;<i>{orderData?.project}</i></div>
              </div>
            </div>
          </div>
        )}
      </th>
    </tr>
    <tr className="border-t border-black">
      <th scope="col" className="py-3 text-left text-xs font-bold text-gray-800 tracking-wider">No.</th>
      <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Service Description</th>
      <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Unit</th>
      <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Qty</th>
      <th scope="col" className="px-2 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Rate</th>
      {gstEnabled && <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Tax</th>}
      <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Amount</th>
    </tr>
  </thead>
);

// Function to estimate item height based on content
const estimateItemHeight = (item: any) => {
  const baseHeight = 60; // Base height for a service item
  let estimatedHeight = baseHeight;
  
  // Estimate height based on category and description length
  const categoryLines = Math.ceil((item?.category?.length || 0) / 35);
  const descriptionLines = Math.ceil((item?.description?.length || 0) / 30);
  
  if (categoryLines > 1) {
    estimatedHeight += (categoryLines - 1) * 16;
  }
  
  if (descriptionLines > 1) {
    estimatedHeight += (descriptionLines - 1) * 14;
  }
  
  return estimatedHeight;
};

// Service Item Row Component
const ServiceItemRow: React.FC<{
  item: any;
  index: number;
  gstEnabled: boolean;
  formatToIndianRupee: (amount: number) => string;
  parseNumber: (value: any) => number;
}> = ({ item, index, gstEnabled, formatToIndianRupee, parseNumber }) => (
  <tr key={item.id} className="page-break-inside-avoid border-b border-gray-200">
    <td className="py-2 text-sm whitespace-nowrap flex items-start">{index + 1}.</td>
    <td className="px-4 py-2 text-sm whitespace-nowrap text-wrap w-[95%]">
      <p className="font-semibold">{item?.category}</p>
      <span className="whitespace-pre-wrap text-xs">{item?.description}</span>
    </td>
    <td className="px-2 py-2 text-sm whitespace-nowrap text-wrap w-[5%]">{item?.uom}</td>
    <td className="px-4 py-2 text-sm whitespace-nowrap text-wrap w-[5%]">{item?.quantity}</td>
    <td className="py-2 text-sm whitespace-nowrap">{formatToIndianRupee(item.rate)}</td>
    {gstEnabled && <td className="px-4 py-2 text-sm whitespace-nowrap">18%</td>}
    <td className="px-2 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(parseNumber(item.rate) * parseNumber(item.quantity))}</td>
  </tr>
);

const SRPdf: React.FC<SRPdfProps> = ({
  srPdfSheet,
  toggleSrPdfSheet,
  handlePrint,
  componentRef,
  orderData,
  service_vendor,
  project,
  gstEnabled,
  getTotal,
  notes,
  logo,
  Seal,
  formatToIndianRupee,
  parseNumber,
  AddressView
}) => {
  // Dynamic page height calculation
  const PAGE_HEIGHT = 1000;
  const HEADER_HEIGHT = 200;
  const AVAILABLE_HEIGHT = PAGE_HEIGHT - HEADER_HEIGHT;

  // Smart pagination function
  const smartPagination = (items: any[]) => {
    if (!items || items.length === 0) return [];
    
    const pages = [];
    let currentPage = [];
    let currentPageHeight = 0;
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const itemHeight = estimateItemHeight(item);
      
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

  const serviceItemPages = useMemo(() => {
    return smartPagination(orderData?.service_order_list?.list || []);
  }, [orderData?.service_order_list?.list]);

  return (
    <Sheet open={srPdfSheet} onOpenChange={toggleSrPdfSheet}>
      <SheetContent className="overflow-y-auto md:min-w-[900px]">
        <Button onClick={handlePrint} className="flex items-center gap-1">
          <Printer className="h-4 w-4" />
          Print
        </Button>
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

            {/* Render all service item pages with smart pagination */}
            {serviceItemPages.map((pageItems, pageIndex) => (
              <div key={pageIndex} className={pageIndex > 0 ? "page-break" : ""}>
                <div className="overflow-x-auto p-4">
                  <table className="min-w-full divide-gray-200">
                    <SRHeader 
                      orderData={orderData} 
                      service_vendor={service_vendor} 
                      project={project} 
                      logo={logo} 
                      showVendorInfo={pageIndex === 0}
                      gstEnabled={gstEnabled}
                    />
                    <tbody className={`bg-white`}>
                      {pageItems.map((item, itemIndex) => {
                        // Calculate global index across all pages
                        const globalIndex = serviceItemPages.slice(0, pageIndex).reduce((acc, page) => acc + page.length, 0) + itemIndex;
                        return (
                          <ServiceItemRow
                            key={item.id}
                            item={item}
                            index={globalIndex}
                            gstEnabled={gstEnabled}
                            formatToIndianRupee={formatToIndianRupee}
                            parseNumber={parseNumber}
                          />
                        );
                      })}

                      {/* Render totals and other sections only on the last page */}
                      {pageIndex === serviceItemPages.length - 1 && (
                        <>
                          <tr className="">
                            <td className="py-2 text-sm whitespace-nowrap w-[7%]"></td>
                            <td className=" py-2 whitespace-nowrap font-semibold flex justify-start w-[80%]"></td>
                            <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                            <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                            {gstEnabled && <td className="px-4 py-2 text-sm whitespace-nowrap"></td>}
                            <td className="pl-4 py-2 text-sm whitespace-nowrap font-semibold">Sub-Total:</td>
                            <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">{formatToIndianRupee(getTotal)}</td>
                          </tr>
                          <tr className="border-none">
                            <td></td>
                            <td></td>
                            <td></td>
                            {gstEnabled && <td></td>}
                            <td></td>
                            <td className="space-y-4 w-[110px] py-4 flex flex-col items-end text-sm font-semibold page-break-inside-avoid">
                              {gstEnabled && <div>Total Tax(GST):</div>}
                              <div>Round Off:</div>
                              <div>Total:</div>
                            </td>
                            <td className="space-y-4 py-4 text-sm whitespace-nowrap font-semibold">
                              {gstEnabled && <div className="ml-4">{formatToIndianRupee(getTotal * 1.18 - getTotal)}</div>}
                              <div className="ml-4">- {formatToIndianRupee((getTotal * (gstEnabled ? 1.18 : 1)) - Math.floor(getTotal * (gstEnabled ? 1.18 : 1)))}</div>
                              <div className="ml-4">{formatToIndianRupee(Math.floor(getTotal * (gstEnabled ? 1.18 : 1)))}</div>
                            </td>
                          </tr>

                          <tr className="end-of-page page-break-inside-avoid" >
                            <td colSpan={gstEnabled ? 7 : 6}>
                              {notes?.length > 0 && (
                                <div className="mb-2">
                                  <div className="text-gray-400 text-sm py-2">Notes</div>
                                  <ul className="list-[number]">
                                    {notes?.map((note) => (
                                      <li key={note?.id} className="text-sm text-gray-900 ml-4">{note?.note}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              <img src={Seal} className="w-24 h-24" />
                              <div className="text-sm text-gray-900 py-6">For, Stratos Infra Technologies Pvt. Ltd.</div>
                            </td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            {/* Terms and Conditions Page */}
            <div className="page-break">
              <div className="overflow-x-auto px-4">
                <table className="min-w-full divide-gray-200">
                  <thead className="border-b border-black mt-2">
                    <tr>
                      <th colSpan={6}>
                        <div className="flex justify-between border-gray-600 pb-1 pt-2 mt-4">
                          <div className="mt-2 flex justify-between">
                            <div>
                              <img src={logo} alt="Nirmaan" width="180" height="52" />
                              <div className="pt-2 text-lg text-gray-500 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
                            </div>
                          </div>
                          <div>
                            <div className="pt-2 text-xl text-gray-600 font-semibold">Purchase Order No. :</div>
                            <div className="text-lg font-semibold text-black">{(orderData?.name)?.toUpperCase()}</div>
                          </div>
                        </div>

                        <div className="items-start text-start flex justify-between border-b-2 border-gray-600 pb-1 mb-1">
                          <div className="text-xs text-gray-600 font-normal">
                            {orderData?.project_gst
                              ? orderData?.project_gst === "29ABFCS9095N1Z9"
                                ? "1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka"
                                : "7th Floor, MR1, ALTF Global Business Park Cowarking Space, Mehrauli Gurugram Rd, Tower D, Sikanderpur, Gurugram, Haryana - 122002"
                              : "Please set company GST number in order to display the Address!"}
                          </div>
                          <div className="text-xs text-gray-600 font-normal">
                            GST: {orderData?.project_gst || "N/A"}
                          </div>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={6}>
                        <div className="max-w-4xl mx-auto p-6 text-gray-800">
                          <h1 className="text-xl font-bold mb-4">Terms and Conditions</h1>
                          <h2 className="text-lg font-semibold mt-6">1. Invoicing:</h2>
                          <ol className="list-decimal pl-6 space-y-2 text-sm">
                            <li className="pl-2">All invoices shall be submitted in original and shall be tax invoices showing the breakup of tax structure/value payable at the prevailing rate and a clear description of goods.</li>
                            <li className="pl-2">All invoices submitted shall have Delivery Challan/E-waybill for supply items.</li>
                            <li className="pl-2">All Invoices shall have the tax registration numbers mentioned thereon. The invoices shall be raised in the name of "Stratos Infra Technologies Pvt Ltd, Bangalore".</li>
                            <li className="pl-2">Payments shall be only entertained after receipt of the correct invoice.</li>
                            <li className="pl-2">In case of advance request, Advance payment shall be paid after the submission of an advance receipt (as suggested under GST law).</li>
                          </ol>

                          <h2 className="text-lg font-semibold mt-6">2. Payment:</h2>
                          <ol className="list-decimal pl-6 space-y-2 text-sm">
                            <li className="pl-2">Payment shall be done through RTGS/NEFT.</li>
                            <li className="pl-2">A retention amount shall be deducted as per PO payment terms and:</li>
                            <ol className="list-decimal pl-6 space-y-1 text-sm">
                              <li className="pl-2">In case the vendor is not completing the task assigned by Nirmaan a suitable amount, as decided by Nirmaan, shall be deducted from the retention amount.</li>
                              <li className="pl-2">The adjusted amount shall be paid on completion of the defect liability period.</li>
                              <li className="pl-2">Vendors are expected to pay GST as per the prevailing rules. In case the vendor is not making GST payments to the tax authority, Nirmaan shall deduct the appropriated amount from the invoice payment of the vendor.</li>
                              <li className="pl-2">Nirmaan shall deduct the following amounts from the final bills:</li>
                              <ol className="list-decimal pl-6 space-y-1 text-sm">
                                <li className="pl-2">Amount pertaining to unfinished supply.</li>
                                <li className="pl-2">Amount pertaining to Liquidated damages and other fines, as mentioned in the documents.</li>
                                <li className="pl-2">Any agreed amount between the vendor and Nirmaan.</li>
                              </ol>
                            </ol>
                          </ol>

                          <h2 className="text-lg font-semibold mt-6">3. Technical Specifications of the Work:</h2>
                          <ol className="list-decimal pl-6 space-y-2 text-sm">
                            <li className="pl-2">All goods delivered shall conform to the technical specifications mentioned in the vendor's quote referred to in this PO or as detailed in Annexure 1 to this PO.</li>
                            <li className="pl-2">Supply of goods or services shall be strictly as per Annexure - 1 or the Vendor's quote/PI in case of the absence of Annexure - I.</li>
                            <li className="pl-2">Any change in line items or quantities shall be duly approved by Nirmaan with rate approval prior to supply. Any goods supplied by the agency without obtaining due approvals shall be subject to the acceptance or rejection from Nirmaan.</li>
                            <li className="pl-2">Any damaged/faulty material supplied needs to be replaced with a new item free of cost, without extending the completion dates.</li>
                            <li className="pl-2">Material supplied in excess and not required by the project shall be taken back by the vendor at no cost to Nirmaan.</li>
                          </ol>
                          

                          <h1 className="text-xl font-bold mb-4 mt-8">General Terms & Conditions for Purchase Order</h1>
                          <ol className="list-decimal pl-6 space-y-2 text-sm">
                            <li className="pl-2"><div className="font-semibold">Liquidity Damages:</div> Liquidity damages shall be applied at 2.5% of the order value for every day of delay.</li>
                            <li className="pl-2"><div className="font-semibold">Termination/Cancellation:</div> If Nirmaan reasonably determines that it can no longer continue business with the vendor in accordance with applicable legal, regulatory, or professional obligations, Nirmaan shall have the right to terminate/cancel this PO immediately.</li>
                            <li className="pl-2"><div className="font-semibold">Other General Conditions:</div></li>
                            <ol className="list-decimal pl-6 space-y-1 text-sm">
                              <li className="pl-2">Insurance: All required insurance including, but not limited to, Contractors' All Risk (CAR) Policy, FLEXA cover, and Workmen's Compensation (WC) policy are in the vendor's scope. Nirmaan in any case shall not be made liable for providing these insurance. All required insurances are required prior to the commencement of the work at the site.</li>
                              <li className="pl-2">Safety: The safety and security of all men deployed and materials placed by the Vendor or its agents for the project shall be at the risk and responsibility of the Vendor. Vendor shall ensure compliance with all safety norms at the site. Nirmaan shall have no obligation or responsibility on any safety, security & compensation related matters for the resources & material deployed by the Vendor or its agent.</li>
                              <li className="pl-2">Notice: Any notice or other communication required or authorized under this PO shall be in writing and given to the party for whom it is intended at the address given in this PO or such other address as shall have been notified to the other party for that purpose, through registered post, courier, facsimile or electronic mail.</li>
                              <li className="pl-2">Force Majeure: Neither party shall be liable for any delay or failure to perform if such delay or failure arises from an act of God or of the public enemy, an act of civil disobedience, epidemic, war, insurrection, labor action, or governmental action.</li>
                              <li className="pl-2">Name use: Vendor shall not use, or permit the use of, the name, trade name, service marks, trademarks, or logo of Nirmaan in any form of publicity, press release, advertisement, or otherwise without Nirmaan's prior written consent.</li>
                              <li className="pl-2">Arbitration: Any dispute arising out of or in connection with the order shall be settled by Arbitration in accordance with the Arbitration and Conciliation Act,1996 (As amended in 2015). The arbitration proceedings shall be conducted in English in Bangalore by the sole arbitrator appointed by the Purchaser.</li>
                              <li className="pl-2">The law governing: All disputes shall be governed as per the laws of India and subject to the exclusive jurisdiction of the court in Karnataka.</li>
                            </ol>
                          </ol>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default SRPdf;



// import React from 'react';
// import { Sheet, SheetContent } from '@/components/ui/sheet';
// import { Button } from '@/components/ui/button';
// import { Printer } from 'lucide-react';

// interface SRPdfProps {
//   srPdfSheet: boolean;
//   toggleSrPdfSheet: () => void;
//   handlePrint: () => void;
//   componentRef: React.RefObject<HTMLDivElement>;
//   orderData: any;
//   service_vendor: any;
//   project: any;
//   gstEnabled: boolean;
//   getTotal: number;
//   notes: any[];
//   logo: string;
//   Seal: string;
//   formatToIndianRupee: (amount: number) => string;
//   parseNumber: (value: any) => number;
//   AddressView: React.ComponentType<{ id: string }>;
// }

// const SRPdf: React.FC<SRPdfProps> = ({
//   srPdfSheet,
//   toggleSrPdfSheet,
//   handlePrint,
//   componentRef,
//   orderData,
//   service_vendor,
//   project,
//   gstEnabled,
//   getTotal,
//   notes,
//   logo,
//   Seal,
//   formatToIndianRupee,
//   parseNumber,
//   AddressView
// }) => {
//   return (
//     <Sheet open={srPdfSheet} onOpenChange={toggleSrPdfSheet}>
//       <SheetContent className="overflow-y-auto md:min-w-[700px]">
//         <Button onClick={handlePrint} className="flex items-center gap-1">
//           <Printer className="h-4 w-4" />
//           Print
//         </Button>
//         <div className={`w-full border mt-6`}>
//           <div ref={componentRef} className="w-full p-2">
//             <div className="overflow-x-auto">
//               <table className="min-w-full divide-gray-200">
//                 <thead className="border-b border-black">
//                   <tr>
//                     <th colSpan={8}>
//                       <div className="flex justify-between border-gray-600 pb-1">
//                         <div className="mt-2 flex justify-between">
//                           <div>
//                             <img src={logo} alt="Nirmaan" width="180" height="52" />
//                             <div className="pt-2 text-lg text-gray-500 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
//                           </div>
//                         </div>
//                         <div>
//                           <div className="pt-2 text-xl text-gray-600 font-semibold">Purchase Order No.</div>
//                           <div className="text-lg font-semibold text-black">{(orderData?.name)?.toUpperCase()}</div>
//                         </div>
//                       </div>

//                       <div className="items-start text-start flex justify-between border-b-2 border-gray-600 pb-1 mb-1">
//                         <div className="text-xs text-gray-600 font-normal">
//                           {orderData?.project_gst
//                             ? orderData?.project_gst === "29ABFCS9095N1Z9"
//                               ? "1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka"
//                               : "7th Floor, MR1, ALTF Global Business Park Cowarking Space, Mehrauli Gurugram Rd, Tower D, Sikanderpur, Gurugram, Haryana - 122002"
//                             : "Please set company GST number in order to display the Address!"}
//                         </div>
//                         <div className="text-xs text-gray-600 font-normal">
//                           GST: {orderData?.project_gst || "N/A"}
//                         </div>
//                       </div>

//                       <div className="flex justify-between">
//                         <div>
//                           <div className="text-gray-500 text-sm pb-2 text-left">Vendor Address</div>
//                           <div className="text-sm font-medium text-gray-900 max-w-[280px] truncate text-left">{service_vendor?.vendor_name}</div>
//                           <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left"><AddressView id={service_vendor?.vendor_address} /></div>
//                           <div className="text-sm font-medium text-gray-900 text-left">GSTIN: {service_vendor?.vendor_gst || "N/A"}</div>
//                         </div>
//                         <div>
//                           <div>
//                             <h3 className="text-gray-500 text-sm pb-2 text-left">Service Location</h3>
//                             <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left"><AddressView id={project?.project_address} /></div>
//                           </div>
//                           <div className="pt-2">
//                             <div className="text-sm font-normal text-gray-900 text-left"><span className="text-gray-500 font-normal">Date:</span>&nbsp;&nbsp;&nbsp;<i>{orderData?.modified?.split(" ")[0]}</i></div>
//                             <div className="text-sm font-normal text-gray-900 text-left"><span className="text-gray-500 font-normal">Project Name:</span>&nbsp;&nbsp;&nbsp;<i>{orderData?.project}</i></div>
//                           </div>
//                         </div>
//                       </div>
//                     </th>
//                   </tr>
//                   <tr className="border-t border-black">
//                     <th scope="col" className="py-3 text-left text-xs font-bold text-gray-800 tracking-wider">No.</th>
//                     <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Service Description</th>
//                     <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Unit</th>
//                     <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Qty</th>
//                     <th scope="col" className="px-2 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Rate</th>
//                     {gstEnabled && <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Tax</th>}
//                     <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Amount</th>
//                   </tr>
//                 </thead>
//                 <tbody className={`bg-white`}>
//                   {orderData && orderData?.service_order_list?.list?.map((item, index) => (
//                     <tr key={item.id} className={`${index === (orderData && orderData?.service_order_list)?.list?.length - 1 && "border-b border-black"} page-break-inside-avoid`}>
//                       <td className="py-2 text-sm whitespace-nowrap flex items-start">{index + 1}.</td>
//                       <td className="px-4 py-2 text-sm whitespace-nowrap text-wrap w-[95%]">
//                         <p className="font-semibold">{item?.category}</p>
//                         <span className="whitespace-pre-wrap">{item?.description}</span>
//                       </td>
//                       <td className="px-2 py-2 text-sm whitespace-nowrap text-wrap w-[5%]">{item?.uom}</td>
//                       <td className="px-4 py-2 text-sm whitespace-nowrap text-wrap w-[5%]">{item?.quantity}</td>
//                       <td className=" py-2 text-sm whitespace-nowrap">{formatToIndianRupee(item.rate)}</td>
//                       {gstEnabled && <td className="px-4 py-2 text-sm whitespace-nowrap">18%</td>}
//                       <td className="px-2 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(parseNumber(item.rate) * parseNumber(item.quantity))}</td>
//                     </tr>
//                   ))}
                  
//                   <tr className="">
//                     <td className="py-2 text-sm whitespace-nowrap w-[7%]"></td>
//                     <td className=" py-2 whitespace-nowrap font-semibold flex justify-start w-[80%]"></td>
//                     <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
//                     <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
//                     {gstEnabled && <td className="px-4 py-2 text-sm whitespace-nowrap"></td>}
//                     <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">Sub-Total</td>
//                     <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">{formatToIndianRupee(getTotal)}</td>
//                   </tr>
//                   <tr className="border-none">
//                     <td></td>
//                     <td></td>
//                     <td></td>
//                     {gstEnabled && <td></td>}
//                     <td></td>
//                     <td className="space-y-4 w-[110px] py-4 flex flex-col items-end text-sm font-semibold page-break-inside-avoid">
//                       {gstEnabled && <div>Total Tax(GST):</div>}
//                       <div>Round Off:</div>
//                       <div>Total:</div>
//                     </td>

//                     <td className="space-y-4 py-4 text-sm whitespace-nowrap">
//                       {gstEnabled && <div className="ml-4">{formatToIndianRupee(getTotal * 1.18 - getTotal)}</div>}
//                       <div className="ml-4">- {formatToIndianRupee((getTotal * (gstEnabled ? 1.18 : 1)) - Math.floor(getTotal * (gstEnabled ? 1.18 : 1)))}</div>
//                       <div className="ml-4">{formatToIndianRupee(Math.floor(getTotal * (gstEnabled ? 1.18 : 1)))}</div>
//                     </td>
//                   </tr>

//                   <tr className="end-of-page page-break-inside-avoid" >
//                     <td colSpan={6}>
//                       {notes?.length > 0 && (
//                         <div className="mb-2">
//                           <div className="text-gray-400 text-sm py-2">Notes</div>
//                           <ul className="list-[number]">
//                             {notes?.map((note) => (
//                               <li key={note?.id} className="text-sm text-gray-900 ml-4">{note?.note}</li>
//                             ))}
//                           </ul>
//                         </div>
//                       )}

//                       <img src={Seal} className="w-24 h-24" />
//                       <div className="text-sm text-gray-900 py-6">For, Stratos Infra Technologies Pvt. Ltd.</div>
//                     </td>
//                   </tr>
//                 </tbody>
//               </table>
//             </div>
//             <div style={{ display: 'block', pageBreakBefore: 'always', }}></div>
//             <div className="overflow-x-auto">
//               <table className="min-w-full divide-gray-200">
//                 <thead className="border-b border-black">
//                   <tr>
//                     <th colSpan={6}>
//                       <div className="flex justify-between border-gray-600 pb-1">
//                         <div className="mt-2 flex justify-between">
//                           <div>
//                             <img src={logo} alt="Nirmaan" width="180" height="52" />
//                             <div className="pt-2 text-lg text-gray-500 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
//                           </div>
//                         </div>
//                         <div>
//                           <div className="pt-2 text-xl text-gray-600 font-semibold">Purchase Order No. :</div>
//                           <div className="text-lg font-semibold text-black">{(orderData?.name)?.toUpperCase()}</div>
//                         </div>
//                       </div>

//                       <div className="items-start text-start flex justify-between border-b-2 border-gray-600 pb-1 mb-1">
//                         <div className="text-xs text-gray-600 font-normal">
//                           {orderData?.project_gst
//                             ? orderData?.project_gst === "29ABFCS9095N1Z9"
//                               ? "1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka"
//                               : "7th Floor, MR1, ALTF Global Business Park Cowarking Space, Mehrauli Gurugram Rd, Tower D, Sikanderpur, Gurugram, Haryana - 122002"
//                             : "Please set company GST number in order to display the Address!"}
//                         </div>
//                         <div className="text-xs text-gray-600 font-normal">
//                           GST: {orderData?.project_gst || "N/A"}
//                         </div>
//                       </div>
//                     </th>
//                   </tr>
//                 </thead>
//                 <tbody>
//                   <div className="max-w-4xl mx-auto p-6 text-gray-800">
//                     <h1 className="text-xl font-bold mb-4">Terms and Conditions</h1>
//                     <h2 className="text-lg font-semibold mt-6">1. Invoicing:</h2>
//                     <ol className="list-decimal pl-6 space-y-2 text-sm">
//                       <li className="pl-2">All invoices shall be submitted in original and shall be tax invoices showing the breakup of tax structure/value payable at the prevailing rate and a clear description of goods.</li>
//                       <li className="pl-2">All invoices submitted shall have Delivery Challan/E-waybill for supply items.</li>
//                       <li className="pl-2">All Invoices shall have the tax registration numbers mentioned thereon. The invoices shall be raised in the name of "Stratos Infra Technologies Pvt Ltd, Bangalore".</li>
//                       <li className="pl-2">Payments shall be only entertained after receipt of the correct invoice.</li>
//                       <li className="pl-2">In case of advance request, Advance payment shall be paid after the submission of an advance receipt (as suggested under GST law).</li>
//                     </ol>

//                     <h2 className="text-lg font-semibold mt-6">2. Payment:</h2>
//                     <ol className="list-decimal pl-6 space-y-2 text-sm">
//                       <li className="pl-2">Payment shall be done through RTGS/NEFT.</li>
//                       <li className="pl-2">A retention amount shall be deducted as per PO payment terms and:</li>
//                       <ol className="list-decimal pl-6 space-y-1 text-sm">
//                         <li className="pl-2">In case the vendor is not completing the task assigned by Nirmaan a suitable amount, as decided by Nirmaan, shall be deducted from the retention amount.</li>
//                         <li className="pl-2">The adjusted amount shall be paid on completion of the defect liability period.</li>
//                         <li className="pl-2">Vendors are expected to pay GST as per the prevailing rules. In case the vendor is not making GST payments to the tax authority, Nirmaan shall deduct the appropriated amount from the invoice payment of the vendor.</li>
//                         <li className="pl-2">Nirmaan shall deduct the following amounts from the final bills:</li>
//                         <ol className="list-decimal pl-6 space-y-1 text-sm">
//                           <li className="pl-2">Amount pertaining to unfinished supply.</li>
//                           <li className="pl-2">Amount pertaining to Liquidated damages and other fines, as mentioned in the documents.</li>
//                           <li className="pl-2">Any agreed amount between the vendor and Nirmaan.</li>
//                         </ol>
//                       </ol>
//                     </ol>

//                     <h2 className="text-lg font-semibold mt-6">3. Technical Specifications of the Work:</h2>
//                     <ol className="list-decimal pl-6 space-y-2 text-sm">
//                       <li className="pl-2">All goods delivered shall conform to the technical specifications mentioned in the vendor's quote referred to in this PO or as detailed in Annexure 1 to this PO.</li>
//                       <li className="pl-2">Supply of goods or services shall be strictly as per Annexure - 1 or the Vendor's quote/PI in case of the absence of Annexure - I.</li>
//                       <li className="pl-2">Any change in line items or quantities shall be duly approved by Nirmaan with rate approval prior to supply. Any goods supplied by the agency without obtaining due approvals shall be subject to the acceptance or rejection from Nirmaan.</li>
//                       <li className="pl-2">Any damaged/faulty material supplied needs to be replaced with a new item free of cost, without extending the completion dates.</li>
//                       <li className="pl-2">Material supplied in excess and not required by the project shall be taken back by the vendor at no cost to Nirmaan.</li>
//                     </ol>
//                     <br />
//                     <br />
//                     <br />
//                     <br />
//                     <br />

//                     <h1 className="text-xl font-bold mb-4">General Terms & Conditions for Purchase Order</h1>
//                     <ol className="list-decimal pl-6 space-y-2 text-sm">
//                       <li className="pl-2"><div className="font-semibold">Liquidity Damages:</div> Liquidity damages shall be applied at 2.5% of the order value for every day of delay.</li>
//                       <li className="pl-2"><div className="font-semibold">Termination/Cancellation:</div> If Nirmaan reasonably determines that it can no longer continue business with the vendor in accordance with applicable legal, regulatory, or professional obligations, Nirmaan shall have the right to terminate/cancel this PO immediately.</li>
//                       <li className="pl-2"><div className="font-semibold">Other General Conditions:</div></li>
//                       <ol className="list-decimal pl-6 space-y-1 text-sm">
//                         <li className="pl-2">Insurance: All required insurance including, but not limited to, Contractors' All Risk (CAR) Policy, FLEXA cover, and Workmen's Compensation (WC) policy are in the vendor's scope. Nirmaan in any case shall not be made liable for providing these insurance. All required insurances are required prior to the commencement of the work at the site.</li>
//                         <li className="pl-2">Safety: The safety and security of all men deployed and materials placed by the Vendor or its agents for the project shall be at the risk and responsibility of the Vendor. Vendor shall ensure compliance with all safety norms at the site. Nirmaan shall have no obligation or responsibility on any safety, security & compensation related matters for the resources & material deployed by the Vendor or its agent.</li>
//                         <li className="pl-2">Notice: Any notice or other communication required or authorized under this PO shall be in writing and given to the party for whom it is intended at the address given in this PO or such other address as shall have been notified to the other party for that purpose, through registered post, courier, facsimile or electronic mail.</li>
//                         <li className="pl-2">Force Majeure: Neither party shall be liable for any delay or failure to perform if such delay or failure arises from an act of God or of the public enemy, an act of civil disobedience, epidemic, war, insurrection, labor action, or governmental action.</li>
//                         <li className="pl-2">Name use: Vendor shall not use, or permit the use of, the name, trade name, service marks, trademarks, or logo of Nirmaan in any form of publicity, press release, advertisement, or otherwise without Nirmaan's prior written consent.</li>
//                         <li className="pl-2">Arbitration: Any dispute arising out of or in connection with the order shall be settled by Arbitration in accordance with the Arbitration and Conciliation Act,1996 (As amended in 2015). The arbitration proceedings shall be conducted in English in Bangalore by the sole arbitrator appointed by the Purchaser.</li>
//                         <li className="pl-2">The law governing: All disputes shall be governed as per the laws of India and subject to the exclusive jurisdiction of the court in Karnataka.</li>
//                       </ol>
//                     </ol>
//                   </div>
//                 </tbody>
//               </table>
//             </div>
//           </div>
//         </div>
//       </SheetContent>
//     </Sheet>
//   );
// };

// export default SRPdf;