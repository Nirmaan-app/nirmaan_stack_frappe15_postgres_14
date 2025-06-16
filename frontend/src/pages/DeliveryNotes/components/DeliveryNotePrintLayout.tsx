// src/components/DeliveryNotePrintLayout.tsx
import { forwardRef } from 'react';
import { MessageCircleMore } from 'lucide-react';
import logo from "@/assets/logo-svg.svg";
import Seal from "@/assets/NIRMAAN-SEAL.jpeg"; // Adjust path
import { AddressView } from '@/components/address-view';
import { safeJsonParse, COMPANY_ADDRESS_BY_GST, deriveDnIdFromPoId } from '../constants'; // Adjust path
import { format } from 'date-fns'; // For date formatting
import { ProcurementOrder, PurchaseOrderItem } from '@/types/NirmaanStack/ProcurementOrders';

// ======================= TYPES & INTERFACES =======================

interface PrintData extends ProcurementOrder {
  // This makes it clear that delivery_list is an optional property
  // used specifically for historical printing.
  delivery_list?: { list: { item_name: string; unit: string; to: string }[] };
}

interface DeliveryNotePrintLayoutProps {
  data: PrintData;
}
// Helper to calculate total received quantity safely
const calculateTotalReceived = (orderListJson: string | { list: PurchaseOrderItem[] }): number => {
  const parsedList = safeJsonParse<{ list: PurchaseOrderItem[] }>(orderListJson, { list: [] });
  return parsedList.list.reduce((acc, item) => acc + (item.received || 0), 0);
};

// Helper to get company address based on GST
const getCompanyAddress = (gst: string | undefined): string => {
  if (!gst) return COMPANY_ADDRESS_BY_GST["default"];
  return COMPANY_ADDRESS_BY_GST[gst] || COMPANY_ADDRESS_BY_GST["default"];
}

export const DeliveryNotePrintLayout = forwardRef<HTMLDivElement, DeliveryNotePrintLayoutProps>(
  ({ data }, ref) => {

    // --- THIS IS THE CORE LOGIC FIX ---
    // Check if we are printing a historical record (data.delivery_list exists)
    // or the current state (data.order_list).
    const isHistoricalPrint = !!data.delivery_list;
    // Use historical list if available, otherwise fall back to the current order list.
    const itemsToRender = isHistoricalPrint
      ? data.delivery_list!.list.map(item => ({
        item: item.item_name,
        unit: item.unit,
        received: parseFloat(item.to) || 0, // Convert historical 'to' value to 'received'
        comment: null // Historical data may not have comments
      }))
      : safeJsonParse<{ list: PurchaseOrderItem[] }>(data.order_list, { list: [] }).list;

    const totalReceivedQuantity = itemsToRender.reduce((acc, item) => acc + (item.received || 0), 0);

    // const orderList = safeJsonParse<{list : PurchaseOrderItem[]}>(data.order_list, { list: [] });
    const deliveryNoteNumber = deriveDnIdFromPoId(data.name).toUpperCase();
    const companyAddress = getCompanyAddress(data.project_gst);
    const creationDate = data.creation ? format(new Date(data.creation.split(" ")[0]), 'dd-MMM-yyyy') : 'N/A';

    // const totalReceivedQuantity = calculateTotalReceived(data.order_list);

    console.log("Printdata", data);
    // New History Printing Logic

    return (
      <div ref={ref} className="w-full p-4 bg-white text-black"> {/* Ensure background for printing */}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-gray-200 border-collapse"> {/* Use border-collapse */}
            <thead className="border-b-2 border-black"> {/* Thicker border */}
              <tr>
                <th colSpan={4} className="p-0"> {/* Remove padding for full control */}
                  {/* Header Section */}
                  <div className="flex justify-between items-start pb-1">
                    <div className="mt-2">
                      <img src={logo} alt="Nirmaan Logo" width="180" height="52" />
                      <div className="pt-1 text-base text-gray-600 font-semibold">
                        Nirmaan (Stratos Infra Technologies Pvt. Ltd.)
                      </div>
                    </div>
                    <div className="text-right mt-2">
                      <div className="text-lg text-gray-700 font-semibold">
                        Delivery Note No.
                      </div>
                      <div className="text-base font-bold text-black">
                        {deliveryNoteNumber}
                      </div>
                    </div>
                  </div>

                  {/* Company Address Section */}
                  <div className="flex justify-between items-start text-xs text-gray-600 font-normal border-b-2 border-black py-1 mb-2">
                    <div className="max-w-[60%] text-left">{companyAddress}</div>
                    <div className="text-right">GST: {data.project_gst || "N/A"}</div>
                  </div>

                  {/* Vendor/Delivery Address Section */}
                  <div className="flex justify-between text-sm mb-2">
                    <div className="w-[48%] text-left">
                      <div className="text-gray-600 font-medium pb-1">Vendor Address</div>
                      <div className="font-semibold text-gray-900 truncate">{data.vendor_name}</div>
                      <AddressView id={data.vendor_address} className="text-xs break-words" />
                      <div className="mt-1">GSTIN: {data.vendor_gst || 'N/A'}</div>
                    </div>
                    <div className="w-[48%] text-left">
                      <div className="text-gray-600 font-medium pb-1">Delivery Location</div>
                      <AddressView id={data.project_address} className="text-xs break-words mb-2" />
                      <div><span className="text-gray-600">Date:</span> <i>{creationDate}</i></div>
                      <div><span className="text-gray-600">Project:</span> <i>{data.project_name || 'N/A'}</i></div>
                      <div><span className="text-gray-600">Against PO:</span> <i>{data.name}</i></div>
                    </div>
                  </div>
                </th>
              </tr>
              {/* Table Headers Row */}
              <tr className="border-t border-black">
                <th scope="col" className="py-2 pr-2 text-left text-xs font-bold text-gray-800 w-[8%]">S.No.</th>
                <th scope="col" className="py-2 text-left text-xs font-bold text-gray-800 w-[62%]">Item Description</th>
                <th scope="col" className="px-2 py-2 text-left text-xs font-bold text-gray-800 w-[15%]">Unit</th>
                <th scope="col" className="px-2 py-2 text-right text-xs font-bold text-gray-800 w-[15%]">Received Qty</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {itemsToRender.map((item, index) => (
                // Applying page-break logic more carefully
                // Note: CSS page-break properties can be inconsistent across browsers. Test thoroughly.
                // 'page-break-inside-avoid' is a good start.
                <tr key={index} className="border-b border-gray-200 page-break-inside-avoid">
                  <td className="py-1.5 pr-2 text-sm align-top">{index + 1}.</td>
                  <td className="py-1.5 text-sm align-top text-wrap break-words"> {/* Allow wrapping */}
                    {item.item}
                    {item.comment && (
                      <div className="flex gap-1 items-start mt-1 text-xs text-gray-500">
                        <MessageCircleMore className="w-3 h-3 flex-shrink-0 mt-0.5" />
                        <span>{item.comment}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-sm align-top">{item.unit}</td>
                  <td className="px-2 py-1.5 text-sm align-top text-right">{item.received || 0}</td> {/* Align numbers right */}
                </tr>
              ))}
              {/* Spacer row before total if needed */}
              {/* <tr><td colSpan={4} className="py-2"></td></tr> */}
              {/* Total Row */}
              <tr className="border-t-2 border-black font-semibold page-break-inside-avoid">
                <td colSpan={2} className="py-2"></td> {/* Empty cells */}
                <td className="px-2 py-2 text-sm text-left">Total Quantity</td>
                <td className="px-2 py-2 text-sm text-right">{totalReceivedQuantity}</td>
              </tr>
              {/* Footer/Signature Section */}
              <tr className="page-break-inside-avoid">
                <td colSpan={4} className="pt-8 pb-4"> {/* Add padding */}
                  <div className="flex justify-between items-end">
                    <div>
                      <img src={Seal} alt="Company Seal" className="w-20 h-20 mb-1" />
                      <div className="text-sm text-gray-900">
                        For, Stratos Infra Technologies Pvt. Ltd.
                      </div>
                    </div>
                    {/* <div className="text-sm text-gray-600 border-t border-black w-1/4 mt-12 pt-1 text-center">
                        Receiver's Signature
                     </div> */}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }
);

DeliveryNotePrintLayout.displayName = 'DeliveryNotePrintLayout'; // For DevTools