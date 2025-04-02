import { Badge } from '@/components/ui/badge';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFrappeGetDoc } from 'frappe-react-sdk';
import { MessageCircleMore, Printer } from "lucide-react";
import { useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
// import { z } from "zod";
import logo from "@/assets/logo-svg.svg";
import { AddressView } from '@/components/address-view';
import { TailSpin } from 'react-loader-spinner';
import { useReactToPrint } from 'react-to-print';
import Seal from "../../assets/NIRMAAN-SEAL.jpeg";
import DeliveryHistoryTable from './DeliveryHistory';
import { DeliveryNoteItemsDisplay } from './deliveryNoteItemsDisplay';


export default function DeliveryNote() {

  const location = useLocation()
  const { dnId: id } = useParams<{ dnId: string }>();
  
  const deliveryNoteId = id?.replaceAll("&=", "/");
  const poId = deliveryNoteId?.replace("DN", "PO")

  const { data, isLoading, mutate: poMutate } = useFrappeGetDoc("Procurement Orders", poId, `Procurement Orders ${poId}`);
  
  const navigate = useNavigate();

  const componentRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    content: () => componentRef.current,
    documentTitle: `${(data?.name)?.toUpperCase().replace("PO", "DN")}_${data?.vendor_name}`
  });

  if (isLoading) return <div className="flex items-center h-[90vh] w-full justify-center"><TailSpin color={"red"} /> </div>

  return (
    <div className="container mx-auto px-0 max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl max-md:text-xl font-bold ml-2">
          DN-{poId.split("/")[1]}
        </h1>
        <Button onClick={handlePrint} className="flex items-center gap-1">
          <Printer className="h-4 w-4" />
          Print
        </Button>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex justify-between items-center">
            <CardTitle className="text-xl max-md:text-lg font-semibold text-red-600">
              Order Details
            </CardTitle>
            <Badge
              variant={`${data?.status === "Dispatched" ? "orange" : "green"
                }`}
              className=""
            >
              {data?.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-row gap-2">
            <strong>Addr:</strong> <AddressView id={data?.project_address} />
          </div>
          <div className="flex flex-row gap-2">
            <strong>@PR:</strong>
            <span
              className="underline cursor-pointer"
              onClick={() =>
                navigate(location.pathname.includes("delivery-notes")
                ? `/prs&milestones/procurement-requests/${data?.procurement_request}`
                : -1)
              }
            >
              {data?.procurement_request}
            </span>
          </div>
          <div className="flex flex-row gap-2">
            <strong>@PO:</strong>
            <span
              className="underline cursor-pointer"
              onClick={() =>
                navigate(
                  location.pathname.includes("delivery-notes")
                    ? `/prs&milestones/procurement-requests/${data?.procurement_request
                    }/${data?.name.replaceAll("/", "&=")}`
                    : -1
                )
              }
            >
              {data?.name.replaceAll("&=", "/")}
            </span>
          </div>
        </CardContent>
        <CardHeader className="pb-2">
          <CardTitle className="text-xl max-md:text-lg font-semibold text-red-600">
            Delivery Person Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="flex flex-row gap-3.5">
            <strong>Name:</strong> 
            {data?.delivery_contact==="" ? (
              <span>Not Provided</span>
              ) : (
              <span>{data?.delivery_contact?.split(":")[0]}</span>
            )}
          </p>
          <p className="flex flex-row gap-2">
            <strong>Mobile:</strong>
            {data?.delivery_contact==="" ? (
              <span>Not Provided</span>
              ) : (
              <span>{data?.delivery_contact?.split(":")[1]}</span>
            )} 
          </p>
        </CardContent>
      </Card>

      <DeliveryNoteItemsDisplay data={data} poMutate={poMutate} />

      <DeliveryHistoryTable deliveryData={data?.delivery_data ? JSON.parse(data?.delivery_data)?.data : null} />

      <div className="hidden">
        <div ref={componentRef} className=" w-full p-4">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-gray-200">
              <thead className="border-b border-black">
                <tr>
                  <th colSpan={8}>
                    <div className="flex justify-between border-gray-600 pb-1">
                      <div className="mt-2 flex justify-between">
                        <div>
                          <img
                            src={logo}
                            alt="Nirmaan"
                            width="180"
                            height="52"
                          />
                          <div className="pt-2 text-lg text-gray-500 font-semibold">
                            Nirmaan(Stratos Infra Technologies Pvt. Ltd.)
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="pt-2 text-xl text-gray-600 font-semibold">
                          Delivery Note No.
                        </div>
                        <div className="text-lg font-semibold text-black">
                          {data?.name?.toUpperCase().replace("PO", "DN")}
                        </div>
                      </div>
                    </div>
                    <div className="items-start text-start flex justify-between border-b-2 border-gray-600 pb-1 mb-1">
                          <div className="text-xs text-gray-600 font-normal">
                            {data?.project_gst
                              ? data?.project_gst === "29ABFCS9095N1Z9"
                                ? "1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka"
                                : "7th Floor, MR1, ALTF Global Business Park Cowarking Space, Mehrauli Gurugram Rd, Tower D, Sikanderpur, Gurugram, Haryana - 122002"
                              : "Please set company GST number in order to display the Address!"}
                          </div>
                          <div className="text-xs text-gray-600 font-normal">
                            GST: {data?.project_gst || "N/A"}
                          </div>
                        </div>
                    <div className="flex justify-between">
                      <div>
                        <div className="text-gray-500 text-sm pb-2 text-left">
                          Vendor Address
                        </div>
                        <div className="text-sm font-medium text-gray-900 max-w-[280px] truncate text-left">
                          {data?.vendor_name}
                        </div>
                        <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">
                          <AddressView id={data?.vendor_address}/>
                        </div>
                        <div className="text-sm font-medium text-gray-900 text-left">
                          GSTIN: {data?.vendor_gst}
                        </div>
                      </div>
                      <div>
                        <div>
                          <h3 className="text-gray-500 text-sm pb-2 text-left">
                            Delivery Location
                          </h3>
                          <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">
                            <AddressView id={data?.project_address}/>
                          </div>
                        </div>
                        <div className="pt-2">
                          <div className="text-sm font-normal text-gray-900 text-left">
                            <span className="text-gray-500 font-normal">
                              Date:
                            </span>
                            &nbsp;&nbsp;&nbsp;
                            <i>{data?.creation?.split(" ")[0]}</i>
                          </div>
                          <div className="text-sm font-normal text-gray-900 text-left">
                            <span className="text-gray-500 font-normal">
                              Project Name:
                            </span>
                            &nbsp;&nbsp;&nbsp;<i>{data?.project_name}</i>
                          </div>
                          <div className="text-sm font-normal text-gray-900 text-left">
                            <span className="text-gray-500 font-normal">
                              Against PO:
                            </span>
                            &nbsp;&nbsp;&nbsp;<i>{data?.name}</i>
                          </div>
                        </div>
                      </div>
                    </div>
                  </th>
                </tr>
                <tr className="border-t border-black">
                  <th
                    scope="col"
                    className="py-3 text-left text-xs font-bold text-gray-800 tracking-wider"
                  >
                    S. No.
                  </th>
                  <th
                    scope="col"
                    className="py-3 text-left text-xs font-bold text-gray-800 tracking-wider pr-48"
                  >
                    Items
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-bold text-gray-800 tracking-wider"
                  >
                    Unit
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider"
                  >
                    Qty
                  </th>
                </tr>
              </thead>
              <tbody className={`bg-white`}>
                {data &&
                  JSON.parse(data.order_list)?.list?.map(
                    (item: any, index: number) => {
                      return (
                        <tr
                          key={index}
                          className={` page-break-inside-avoid ${index >= 14 ? "page-break-before" : ""
                            }`}
                        >
                          <td className="py-2 text-sm whitespace-nowrap w-[7%]">
                            {index + 1}.
                          </td>
                          <td className=" py-2 text-sm whitespace-nowrap text-wrap">
                            {item.item}
                            {item.comment && (
                              <div className="flex gap-1 items-start block p-1">
                                <MessageCircleMore className="w-4 h-4 flex-shrink-0" />
                                <div className="text-xs text-gray-400">
                                  {item.comment}
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2 text-sm whitespace-nowrap">
                            {item.unit}
                          </td>
                          <td className="px-4 py-2 text-sm whitespace-nowrap">
                            {item.received || 0}
                          </td>
                        </tr>
                      );
                    }
                  )}
                <tr className="">
                  <td className="py-2 text-sm whitespace-nowrap w-[7%]"></td>
                  <td className=" py-2 whitespace-nowrap font-semibold flex justify-start w-[80%]"></td>
                  <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">
                    Total Quantity
                  </td>
                  <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">
                    {data &&
                      JSON.parse(data.order_list)?.list?.reduce(
                        (acc, item) => acc + item.received || 0,
                        0
                      )}
                  </td>
                </tr>
                <tr className="end-of-page page-break-inside-avoid">
                  <td colSpan={6}>
                    <img src={Seal} className="w-24 h-24" />
                    <div className="text-sm text-gray-900 py-6">
                      For, Stratos Infra Technologies Pvt. Ltd.
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}