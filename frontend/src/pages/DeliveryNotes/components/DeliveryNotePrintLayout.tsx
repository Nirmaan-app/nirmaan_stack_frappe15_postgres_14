import { forwardRef } from 'react';
import { MessageCircleMore } from 'lucide-react';
import { format } from 'date-fns';
import logo from "@/assets/logo-svg.svg";
import Seal from "@/assets/NIRMAAN-SEAL.jpeg";
import { AddressView } from '@/components/address-view';
import { safeJsonParse, COMPANY_ADDRESS_BY_GST, deriveDnIdFromPoId } from '../constants';
import { ProcurementOrder, PurchaseOrderItem } from '@/types/NirmaanStack/ProcurementOrders';

// ======================= TYPES & INTERFACES =======================

interface HistoricalDeliveryItem {
  item_name: string;
  unit: string;
  to: string;
  from: string; // Assuming 'from' is a string representing the quantity received
}

// --- FIX: A single, consistent interface for any item being rendered ---
interface NormalizedPrintItem {
  name: string;
  unit: string;
  quantity: number;
  comment: string | null;
}

interface PrintData extends ProcurementOrder {
  delivery_data?: { data: HistoricalDeliveryItem[] };
  delivery_date?: string; // The date key from delivery_data JSON (e.g., "2026-01-10")
}

interface DeliveryNotePrintLayoutProps {
  data: PrintData;
}

const getCompanyAddress = (gst: string | undefined): string => {
  return COMPANY_ADDRESS_BY_GST[gst || 'default'] || COMPANY_ADDRESS_BY_GST["default"];
}

// ======================= THE COMPONENT =======================

export const DeliveryNotePrintLayout = forwardRef<HTMLDivElement, DeliveryNotePrintLayoutProps>(
  ({ data, }, ref) => {
    // console.log("PrintOverallData", data);
    // --- FIX: Normalize both historical and current data into a single, type-safe structure ---
    // console.log("DeliveryNotePrintLayoutProps", data);

    const itemsToRender: NormalizedPrintItem[] = (() => {
      // Case 1: Printing a specific historical delivery.
      if (data.delivery_data?.data) {
        // console.log("DeliveryNotePrintLayoutProps22", data.delivery_data?.data)
        return data.delivery_data?.ldatamap(item => ({
          name: item.item_name,
          unit: item.unit,
          quantity: parseFloat(item.to) - parseFloat(item.from) || 0,
          comment: null,
        }));

      }


      // Case 2: Printing the current state.
      const currentOrderList = data.items || [];
      return currentOrderList.map(item => ({
        name: item.item_name,
        unit: item.unit,
        quantity: item.received_quantity || 0,
        comment: item.comment || null,
      }));
    })();

    const totalQuantity = itemsToRender.reduce((acc, item) => acc + item.quantity, 0);

    const PO_ID = deriveDnIdFromPoId(data.name).toUpperCase();
    const Note_no = data?.Note_no

    // console.log("Note_no",Note_no)
    const deliveryNoteNumber = Note_no ? `${PO_ID}/${Note_no}` : `${PO_ID}/M`;


    const companyAddress = getCompanyAddress(data.project_gst);
    const creationDate = data.creation ? format(new Date(data.creation.split(" ")[0]), 'dd-MMM-yyyy') : 'N/A';

    return (
      <div ref={ref} className="w-full p-4 bg-white text-black">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead className="border-b-2 border-black">
              <tr>
                <th colSpan={4} className="p-0">
                  <div className="flex justify-between items-start pb-1">
                    <div className="mt-2">
                      <img src={logo} alt="Nirmaan Logo" width="180" height="52" />
                      <div className="pt-1 text-base text-gray-600 font-semibold">Nirmaan (Stratos Infra Technologies Pvt. Ltd.)</div>
                    </div>
                    <div className="text-right mt-2">
                      <div className="text-lg text-gray-700 font-semibold">Delivery Note No.</div>
                      <div className="text-base font-bold text-black">{`${deliveryNoteNumber}`}</div>
                      {/* ${data?.note_no} */}
                    </div>
                  </div>
                  <div className="flex justify-between items-start text-xs text-gray-600 font-normal border-b-2 border-black py-1 mb-2">
                    <div className="max-w-[60%] text-left">{companyAddress}</div>
                    <div className="text-right">GST: {data.project_gst || "N/A"}</div>
                  </div>
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
                      <div>
                        <span className="text-gray-600">{Note_no ? 'Delivery Date:' : 'Date:'}</span>{' '}
                        <i>{Note_no && data.delivery_date ? format(new Date(data.delivery_date), 'dd-MMM-yyyy') : creationDate}</i>
                      </div>
                      <div><span className="text-gray-600">Project:</span> <i>{data.project_name || 'N/A'}</i></div>
                      <div><span className="text-gray-600">Against PO:</span> <i>{data.name}</i></div>
                    </div>
                  </div>
                </th>
              </tr>
              <tr className="border-t border-black">
                <th scope="col" className="py-2 pr-2 text-left text-xs font-bold w-[8%]">S.No.</th>
                <th scope="col" className="py-2 text-left text-xs font-bold w-[62%]">Item Description</th>
                <th scope="col" className="px-2 py-2 text-left text-xs font-bold w-[15%]">Unit</th>
                <th scope="col" className="px-2 py-2 text-right text-xs font-bold w-[15%]">Received Qty</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {itemsToRender.map((item, index) => (
                <tr key={index} className="border-b border-gray-200 page-break-inside-avoid">
                  <td className="py-1.5 pr-2 text-sm align-top">{index + 1}.</td>
                  <td className="py-1.5 text-sm align-top text-wrap break-words">
                    {/* --- FIX: Use the normalized 'name' property --- */}
                    {item.name}
                    {item.comment && (
                      <div className="flex gap-1 items-start mt-1 text-xs text-gray-500">
                        <MessageCircleMore className="w-3 h-3 flex-shrink-0 mt-0.5" />
                        <span>{item.comment}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-sm align-top">{item.unit}</td>
                  {/* --- FIX: Use the normalized 'quantity' property --- */}
                  <td className="px-2 py-1.5 text-sm align-top text-right">{item.quantity}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-black font-semibold page-break-inside-avoid">
                <td colSpan={2} className="py-2"></td>
                <td className="px-2 py-2 text-sm text-left">Total Quantity</td>
                <td className="px-2 py-2 text-sm text-right">{totalQuantity}</td>
              </tr>
              <tr className="page-break-inside-avoid">
                <td colSpan={4} className="pt-8 pb-4">
                  <div className="flex justify-between items-end">
                    <div>
                      <img src={Seal} alt="Company Seal" className="w-20 h-20 mb-1" />
                      <div className="text-sm text-gray-900">For, Stratos Infra Technologies Pvt. Ltd.</div>
                    </div>
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

DeliveryNotePrintLayout.displayName = 'DeliveryNotePrintLayout';