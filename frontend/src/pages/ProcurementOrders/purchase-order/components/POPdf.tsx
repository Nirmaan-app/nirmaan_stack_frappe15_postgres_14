import logo from "@/assets/logo-svg.svg";
import Seal from "@/assets/NIRMAAN-SEAL.jpeg";
import { ProcurementOrder, PurchaseOrderItem } from "@/types/NirmaanStack/ProcurementOrders";
import formatToIndianRupee from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { MessageCircleMore, Printer } from "lucide-react";
import * as pdfjsLib from 'pdfjs-dist';
import { useEffect, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { AddressView } from "@/components/address-view";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent
} from "@/components/ui/sheet";

interface POPdfProps {
  po: ProcurementOrder | null
  orderData: {
    list: PurchaseOrderItem[]
  }
  includeComments: boolean
  getTotal: {
    total: number
    totalAmt: number
    totalGst: number
  }
  advance: number
  materialReadiness: number
  afterDelivery: number
  xDaysAfterDelivery: number
  xDays: number
  poPdfSheet: boolean
  togglePoPdfSheet: () => void
}

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js"

export const POPdf: React.FC<POPdfProps> = ({
  po, orderData,
  includeComments, getTotal, advance, materialReadiness, afterDelivery, xDaysAfterDelivery, xDays,
  poPdfSheet, togglePoPdfSheet
}) => {

  if(!po) return <div>No PO ID Provided</div>`  `
  const componentRef = useRef<HTMLDivElement>(null);

  const { data: attachmentsData } = useFrappeGetDocList("Nirmaan Attachments", {
    fields: ["*"],
    filters: [["associated_doctype", "=", "Procurement Requests"], ["associated_docname", "=", po?.procurement_request!], ["attachment_type", "=", "custom pr attachment"]]
  },
    po?.procurement_request ? undefined : null
  )

  const [images, setImages] = useState([]);

  // const loadPdfAsImages = async (pdfData) => {
  //   try {

  //     const response = await fetch(pdfData, {
  //       method: 'GET',
  //       headers: {
  //         'Content-Type': 'application/pdf',
  //       },
  //     });

  //     if (!response.ok) {
  //       throw new Error(`Failed to fetch PDF: ${response.statusText}`);
  //     }

  //     const pdfArrayBuffer = await response.arrayBuffer();

  //     const loadingTask = pdfjsLib.getDocument({ data: pdfArrayBuffer });
  //     const pdf = await loadingTask.promise;

  //     const pages = [];

  //     for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
  //       const page = await pdf.getPage(pageNum);

  //       const viewport = page.getViewport({ scale: 1.5 });
  //       const canvas = document.createElement('canvas');
  //       const context = canvas.getContext('2d');
  //       canvas.height = viewport.height;
  //       canvas.width = viewport.width;

  //       await page.render({ canvasContext: context, viewport }).promise;
  //       const imgData = canvas.toDataURL();
  //       pages.push(imgData);
  //     }

  //     setPdfImages(pages);
  //   } catch (error) {
  //     console.error('Failed to load PDF as images:', error);
  //   }
  // };

  const loadFileAsImage = async (att) => {
    try {
      const baseURL = window.location.origin;
      const fileUrl = `${baseURL}${att.attachment}`;
      const fileType = att.attachment.split('.').pop().toLowerCase();

      if (['pdf'].includes(fileType)) {
        // Handle PDF files
        const response = await fetch(fileUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/pdf',
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch PDF: ${response.statusText}`);
        }

        const pdfArrayBuffer = await response.arrayBuffer();

        const loadingTask = pdfjsLib.getDocument({ data: pdfArrayBuffer });
        const pdf = await loadingTask.promise;

        const pages = [];

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);

          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          await page.render({ canvasContext: context, viewport }).promise;
          const imgData = canvas.toDataURL();
          pages.push(imgData);
        }

        setImages(prevImages => [...prevImages, ...pages]);
      } else if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(fileType)) {
        // Handle image files
        setImages(prevImages => [...prevImages, fileUrl]);
      } else {
        console.warn(`Unsupported file type: ${fileType}`);
      }
    } catch (error) {
      console.error('Failed to load file as image:', error);
    }
  };

  useEffect(() => {
    if (attachmentsData) {
      attachmentsData.forEach(loadFileAsImage);
    }
  }, [attachmentsData]);


  const handlePrint = useReactToPrint({
    content: () => componentRef.current || null,
    documentTitle: `${po?.name}_${po?.vendor_name}`,
  });

  return (
    <Sheet open={poPdfSheet} onOpenChange={togglePoPdfSheet}>
      <SheetContent className="overflow-y-auto md:min-w-[700px]">
        <Button onClick={handlePrint} className="flex items-center gap-1">
          <Printer className="h-4 w-4" />
          Print
        </Button>
        <div className={`w-full border mt-6`}>
          <div ref={componentRef} className="w-full p-2">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-gray-200">
                <thead className="border-b border-black">
                  <tr>
                    <th colSpan={8}>
                      <div className="flex justify-between border-gray-600 pb-1">
                        <div className="mt-2 flex justify-between">
                          <div>
                            {/* <img className="w-44" src={redlogo} alt="Nirmaan" /> */}
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
                          {po?.project_gst
                            ? po?.project_gst === "29ABFCS9095N1Z9"
                              ? "1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka"
                              : "7th Floor, MR1, ALTF Global Business Park Cowarking Space, Mehrauli Gurugram Rd, Tower D, Sikanderpur, Gurugram, Haryana - 122002"
                            : "Please set company GST number in order to display the Address!"}
                        </div>
                        <div className="text-xs text-gray-600 font-normal">
                          GST: {po?.project_gst || "N/A"}
                        </div>
                      </div>

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
                    </th>
                  </tr>
                  <tr className="border-t border-black">
                    <th
                      scope="col"
                      className="py-3 px-2 text-left text-xs font-bold text-gray-800 tracking-wider"
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
                    <th
                      scope="col"
                      className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider"
                    >
                      Rate
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider"
                    >
                      Tax
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider"
                    >
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody className={`bg-white`}>
                  {[
                    ...new Map(
                      orderData?.list?.map((item) => [
                        item.item,
                        {
                          ...item,
                          quantity: orderData?.list
                            ?.filter(
                              ({ item: itemName }) => itemName === item.item
                            )
                            ?.reduce(
                              (total, curr) => total + curr.quantity,
                              0
                            ),
                        },
                      ])
                    )?.values(),
                  ]?.map((item, index) => {
                    const length = [
                      ...new Map(
                        orderData?.list?.map((item) => [
                          item.item,
                          {
                            ...item,
                            quantity: orderData?.list
                              ?.filter(
                                ({ item: itemName }) => itemName === item.item
                              )
                              ?.reduce(
                                (total, curr) => total + curr.quantity,
                                0
                              ),
                          },
                        ])
                      ).values(),
                    ].length;
                    return (
                      <tr
                        key={index}
                        className={`${!parseNumber(po?.loading_charges) &&
                          !parseNumber(po?.freight_charges) &&
                          index === length - 1 &&
                          "border-b border-black"
                          } page-break-inside-avoid ${index === 15 ? "page-break-before" : ""
                          }`}
                      >
                        <td className="py-2 px-2 text-sm whitespace-nowrap w-[7%]">
                          {index + 1}.
                        </td>
                        <td className="py-2 text-xs whitespace-nowrap text-wrap">
                          {item.item?.toUpperCase()}
                          {item?.makes?.list?.length > 0 && (
                            <p className="text-xs italic font-semibold text-gray-500">
                              -{" "}
                              {item.makes.list
                                .find((i) => i?.enabled === "true")
                                ?.make?.toLowerCase()
                                ?.replace(/\b\w/g, (char) =>
                                  char.toUpperCase()
                                ) || "No Make Specified"}
                            </p>
                          )}
                          {item.comment && includeComments && (
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
                          {item.quantity}
                        </td>
                        <td className="px-4 py-2 text-sm whitespace-nowrap">
                          {formatToIndianRupee(item.quote)}
                        </td>
                        <td className="px-4 py-2 text-sm whitespace-nowrap">
                          {item.tax}%
                        </td>
                        <td className="px-4 py-2 text-sm whitespace-nowrap">
                          {formatToIndianRupee(item.quote * item.quantity)}
                        </td>
                      </tr>
                    );
                  })}
                  {parseNumber(po?.loading_charges) ? (
                    <tr
                      className={`${!po?.freight_charges && "border-b border-black"
                        }`}
                    >
                      <td className="py-2 text-sm whitespace-nowrap w-[7%]">
                        -
                      </td>
                      <td className=" py-2 text-xs whitespace-nowrap">
                        LOADING CHARGES
                      </td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">
                        NOS
                      </td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">
                        1
                      </td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">
                        {formatToIndianRupee(po?.loading_charges)}
                      </td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">
                        18%
                      </td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">
                        {formatToIndianRupee(po?.loading_charges)}
                      </td>
                    </tr>
                  ) : (
                    <></>
                  )}
                  {parseNumber(po?.freight_charges) ? (
                    <tr className={`border-b border-black`}>
                      <td className="py-2 text-sm whitespace-nowrap w-[7%]">
                        -
                      </td>
                      <td className=" py-2 text-xs whitespace-nowrap">
                        FREIGHT CHARGES
                      </td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">
                        NOS
                      </td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">
                        1
                      </td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">
                        {formatToIndianRupee(po?.freight_charges)}
                      </td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">
                        18%
                      </td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">
                        {formatToIndianRupee(po?.freight_charges)}
                      </td>
                    </tr>
                  ) : (
                    <></>
                  )}
                  <tr className="">
                    <td className="py-2 text-sm whitespace-nowrap w-[7%]"></td>
                    <td className=" py-2 whitespace-nowrap font-semibold flex justify-start w-[80%]"></td>
                    <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                    <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                    <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                    <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">
                      Sub-Total
                    </td>
                    <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">
                      {formatToIndianRupee(getTotal?.total)}
                    </td>
                  </tr>
                  <tr className="border-none">
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td className="space-y-4 w-[110px] py-4 flex flex-col items-end text-sm font-semibold page-break-inside-avoid">
                      <div>Total Tax(GST):</div>
                      <div>Round Off:</div>
                      <div>Total:</div>
                    </td>

                    <td className="space-y-4 py-4 text-sm whitespace-nowrap">
                      <div className="ml-4">
                        {formatToIndianRupee(getTotal?.totalGst)}
                      </div>
                      <div className="ml-4">
                        {" "}
                        {formatToIndianRupee(
                          (getTotal?.totalAmt -
                            Math.round(getTotal?.totalAmt)) * -1
                        )}
                      </div>
                      <div className="ml-4">
                        {formatToIndianRupee(Math.round(getTotal?.totalAmt))}
                      </div>
                    </td>
                  </tr>
                  <tr className="end-of-page page-break-inside-avoid">
                    <td colSpan={6}>
                      {po?.notes !== "" && (
                        <>
                          <div className="text-gray-600 font-bold text-sm py-2">
                            Note
                          </div>
                          <div className="text-sm text-gray-900">{po?.notes}</div>
                        </>
                      )}
                      {advance ||
                        materialReadiness ||
                        afterDelivery ||
                        xDaysAfterDelivery ? (
                        <>
                          <div className="text-gray-600 font-bold text-sm py-2">
                            Payment Terms
                          </div>
                          <div className="text-sm text-gray-900">
                            {(() => {
                              // Check if any of the variables is 100
                              if (advance === 100) {
                                return `${advance}% advance`;
                              } else if (materialReadiness === 100) {
                                return `${materialReadiness}% on material readiness`;
                              } else if (afterDelivery === 100) {
                                return `${afterDelivery}% after delivery to the site`;
                              } else if (xDaysAfterDelivery === 100) {
                                return `${xDaysAfterDelivery}% after ${xDays} days of delivering the material(s)`;
                              }

                              // If none of the variables is 100, render non-zero values
                              const parts = [];
                              if (advance > 0) {
                                parts.push(`${advance}% advance`);
                              }
                              if (materialReadiness > 0) {
                                parts.push(
                                  `${materialReadiness}% on material readiness`
                                );
                              }
                              if (afterDelivery > 0) {
                                parts.push(
                                  `${afterDelivery}% after delivery to the site`
                                );
                              }
                              if (xDaysAfterDelivery > 0) {
                                parts.push(
                                  `${xDaysAfterDelivery}% after ${xDays} days of delivering the material(s)`
                                );
                              }

                              // Join the parts with commas and return
                              return parts.join(", ");
                            })()}
                          </div>
                        </>
                      ) : (
                        ""
                      )}

                      <img src={Seal} className="w-24 h-24" />
                      <div className="text-sm text-gray-900 py-6">
                        For, Stratos Infra Technologies Pvt. Ltd.
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div
              style={{ display: "block", pageBreakBefore: "always" }}
            ></div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-gray-200">
                <thead className="border-b border-black">
                  <tr>
                    <th colSpan={6}>
                      <div className="flex justify-between border-gray-600 pb-1">
                        <div className="mt-2 flex justify-between">
                          <div>
                            {/* <img className="w-44" src={redlogo} alt="Nirmaan" /> */}
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
                          {po?.project_gst
                            ? po?.project_gst === "29ABFCS9095N1Z9"
                              ? "1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka"
                              : "7th Floor, MR1, ALTF Global Business Park Cowarking Space, Mehrauli Gurugram Rd, Tower D, Sikanderpur, Gurugram, Haryana - 122002"
                            : "Please set company GST number in order to display the Address!"}
                        </div>
                        <div className="text-xs text-gray-600 font-normal">
                          GST: {po?.project_gst || "N/A"}
                        </div>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <div className="max-w-4xl mx-auto p-6 text-gray-800">
                    <h1 className="text-xl font-bold mb-4">
                      Terms and Conditions
                    </h1>
                    <h2 className="text-lg font-semibold mt-6">
                      1. Invoicing:
                    </h2>
                    <ol className="list-decimal pl-6 space-y-2 text-sm">
                      <li className="pl-2">
                        All invoices shall be submitted in original and shall
                        be tax invoices showing the breakup of tax
                        structure/value payable at the prevailing rate and a
                        clear description of goods.
                      </li>
                      <li className="pl-2">
                        All invoices submitted shall have Delivery
                        Challan/E-waybill for supply items.
                      </li>
                      <li className="pl-2">
                        All Invoices shall have the tax registration numbers
                        mentioned thereon. The invoices shall be raised in the
                        name of “Stratos Infra Technologies Pvt Ltd,
                        Bangalore”.
                      </li>
                      <li className="pl-2">
                        Payments shall be only entertained after receipt of
                        the correct invoice.
                      </li>
                      <li className="pl-2">
                        In case of advance request, Advance payment shall be
                        paid after the submission of an advance receipt (as
                        suggested under GST law).
                      </li>
                    </ol>

                    <h2 className="text-lg font-semibold mt-6">
                      2. Payment:
                    </h2>
                    <ol className="list-decimal pl-6 space-y-2 text-sm">
                      <li className="pl-2">
                        Payment shall be done through RTGS/NEFT.
                      </li>
                      <li className="pl-2">
                        A retention amount shall be deducted as per PO payment
                        terms and:
                      </li>
                      <ol className="list-decimal pl-6 space-y-1 text-sm">
                        <li className="pl-2">
                          In case the vendor is not completing the task
                          assigned by Nirmaan a suitable amount, as decided by
                          Nirmaan, shall be deducted from the retention
                          amount.
                        </li>
                        <li className="pl-2">
                          The adjusted amount shall be paid on completion of
                          the defect liability period.
                        </li>
                        <li className="pl-2">
                          Vendors are expected to pay GST as per the
                          prevailing rules. In case the vendor is not making
                          GST payments to the tax authority, Nirmaan shall
                          deduct the appropriated amount from the invoice
                          payment of the vendor.
                        </li>
                        <li className="pl-2">
                          Nirmaan shall deduct the following amounts from the
                          final bills:
                        </li>
                        <ol className="list-decimal pl-6 space-y-1 text-sm">
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
                      </ol>
                    </ol>

                    <h2 className="text-lg font-semibold mt-6">
                      3. Technical Specifications of the Work:
                    </h2>
                    <ol className="list-decimal pl-6 space-y-2 text-sm">
                      <li className="pl-2">
                        All goods delivered shall conform to the technical
                        specifications mentioned in the vendor’s quote
                        referred to in this PO or as detailed in Annexure 1 to
                        this PO.
                      </li>
                      <li className="pl-2">
                        Supply of goods or services shall be strictly as per
                        Annexure - 1 or the Vendor’s quote/PI in case of the
                        absence of Annexure - I.
                      </li>
                      <li className="pl-2">
                        Any change in line items or quantities shall be duly
                        approved by Nirmaan with rate approval prior to
                        supply. Any goods supplied by the agency without
                        obtaining due approvals shall be subject to the
                        acceptance or rejection from Nirmaan.
                      </li>
                      <li className="pl-2">
                        Any damaged/faulty material supplied needs to be
                        replaced with a new item free of cost, without
                        extending the completion dates.
                      </li>
                      <li className="pl-2">
                        Material supplied in excess and not required by the
                        project shall be taken back by the vendor at no cost
                        to Nirmaan.
                      </li>
                    </ol>
                    <br />
                    <br />
                    <br />
                    <br />
                    <br />

                    <h1 className="text-xl font-bold mb-4">
                      General Terms & Conditions for Purchase Order
                    </h1>
                    <ol className="list-decimal pl-6 space-y-2 text-sm">
                      <li className="pl-2">
                        <div className="font-semibold">
                          Liquidity Damages:
                        </div>{" "}
                        Liquidity damages shall be applied at 2.5% of the
                        order value for every day of delay.
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
                      <ol className="list-decimal pl-6 space-y-1 text-sm">
                        <li className="pl-2">
                          Insurance: All required insurance including, but not
                          limited to, Contractors’ All Risk (CAR) Policy,
                          FLEXA cover, and Workmen’s Compensation (WC) policy
                          are in the vendor’s scope. Nirmaan in any case shall
                          not be made liable for providing these insurance.
                          All required insurances are required prior to the
                          commencement of the work at the site.
                        </li>
                        <li className="pl-2">
                          Safety: The safety and security of all men deployed
                          and materials placed by the Vendor or its agents for
                          the project shall be at the risk and responsibility
                          of the Vendor. Vendor shall ensure compliance with
                          all safety norms at the site. Nirmaan shall have no
                          obligation or responsibility on any safety, security
                          & compensation related matters for the resources &
                          material deployed by the Vendor or its agent.
                        </li>
                        <li className="pl-2">
                          Notice: Any notice or other communication required
                          or authorized under this PO shall be in writing and
                          given to the party for whom it is intended at the
                          address given in this PO or such other address as
                          shall have been notified to the other party for that
                          purpose, through registered post, courier, facsimile
                          or electronic mail.
                        </li>
                        <li className="pl-2">
                          Force Majeure: Neither party shall be liable for any
                          delay or failure to perform if such delay or failure
                          arises from an act of God or of the public enemy, an
                          act of civil disobedience, epidemic, war,
                          insurrection, labor action, or governmental action.
                        </li>
                        <li className="pl-2">
                          Name use: Vendor shall not use, or permit the use
                          of, the name, trade name, service marks, trademarks,
                          or logo of Nirmaan in any form of publicity, press
                          release, advertisement, or otherwise without
                          Nirmaan's prior written consent.
                        </li>
                        <li className="pl-2">
                          Arbitration: Any dispute arising out of or in
                          connection with the order shall be settled by
                          Arbitration in accordance with the Arbitration and
                          Conciliation Act,1996 (As amended in 2015). The
                          arbitration proceedings shall be conducted in
                          English in Bangalore by the sole arbitrator
                          appointed by the Purchaser.
                        </li>
                        <li className="pl-2">
                          The law governing: All disputes shall be governed as
                          per the laws of India and subject to the exclusive
                          jurisdiction of the court in Karnataka.
                        </li>
                      </ol>
                    </ol>
                  </div>
                </tbody>
              </table>
            </div>
            {po?.custom === "true" && images?.length > 0 && (
              <div>
                {images?.map((imgSrc, index) => (
                  <img key={index} src={imgSrc} alt={`Attachment ${index + 1}`} style={{ width: '100%', marginBottom: '20px', marginTop: "20px" }} />
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}