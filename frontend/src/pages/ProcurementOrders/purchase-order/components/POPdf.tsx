import logo from "@/assets/logo-svg.svg";
import Seal from "@/assets/NIRMAAN-SEAL.jpeg";
import {
  ProcurementOrder,
  PurchaseOrderItem,
  PaymentTerm,
} from "@/types/NirmaanStack/ProcurementOrders";
import { parseNumber } from "@/utils/parseNumber";
import { formatDate } from "@/utils/FormatDate";
import { Download } from "lucide-react";
import { useUserData } from "@/hooks/useUserData";
import { useEffect, useRef, useState, useMemo } from "react";
import { AddressView } from "@/components/address-view";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useGstOptions } from "@/hooks/useGstOptions";

interface POPdfProps {
  po: ProcurementOrder | null;
  orderData?: PurchaseOrderItem[];
  paymentTerms?: PaymentTerm[];
  includeComments: boolean;
  poPdfSheet: boolean;
  togglePoPdfSheet: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Helpers — mirror the Frappe "PO Orders" print format primitives           */
/* -------------------------------------------------------------------------- */

// Indian-grouped money WITHOUT the currency symbol — mirrors frappe.utils.fmt_money.
// (0 renders as "0.00", not "--", to match the print format.)
const fmtMoney = (val: number | string | undefined, precision = 2) =>
  parseNumber(val).toLocaleString("en-IN", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });

// Amount in words (Indian numbering system) — mirrors frappe.utils.money_in_words.
const A_ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const A_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const twoDigitWords = (n: number): string => {
  if (n < 20) return A_ONES[n];
  const t = A_TENS[Math.floor(n / 10)];
  const o = n % 10;
  return o ? `${t} ${A_ONES[o]}` : t;
};

const threeDigitWords = (n: number): string => {
  let str = "";
  if (n > 99) {
    str += `${A_ONES[Math.floor(n / 100)]} Hundred`;
    n %= 100;
    if (n) str += " ";
  }
  if (n) str += twoDigitWords(n);
  return str;
};

const amountInWords = (value: number): string => {
  let num = Math.round(parseNumber(value));
  if (num === 0) return "INR Zero Only";
  let words = "";
  const crore = Math.floor(num / 10000000);
  num %= 10000000;
  const lakh = Math.floor(num / 100000);
  num %= 100000;
  const thousand = Math.floor(num / 1000);
  num %= 1000;
  if (crore) words += `${threeDigitWords(crore)} Crore `;
  if (lakh) words += `${twoDigitWords(lakh)} Lakh `;
  if (thousand) words += `${twoDigitWords(thousand)} Thousand `;
  if (num) words += threeDigitWords(num);
  return `INR ${words.trim().replace(/\s+/g, " ")} Only`;
};

// Scoped styles — adapted 1:1 from the "PO Orders" print format CSS, namespaced
// under .po-print-preview so nothing leaks into the rest of the app.
const POPDF_STYLES = `
.po-print-preview { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 11px; color: #333; background: #fff; }
.po-print-preview p { margin: 2px 0; line-height: 1.4; }

.po-print-preview .pf-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 4px solid #000; padding-bottom: 8px; margin-bottom: 15px; }
.po-print-preview .pf-header .logo { max-width: 140px; max-height: 40px; }
.po-print-preview .pf-header .company { text-align: right; font-size: 11px; }
.po-print-preview .pf-header .company .name { font-weight: bold; }

.po-print-preview .po-title-row { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 15px; }
.po-print-preview .po-title { font-size: 22px; font-weight: bold; color: #1a1a1a; text-transform: uppercase; padding-top: 5px; }
.po-print-preview .po-meta { text-align: right; font-size: 11px; }

.po-print-preview .address-block { display: flex; justify-content: space-between; margin-bottom: 15px; }
.po-print-preview .address-block .addr-col { width: 48%; font-size: 11px; }
.po-print-preview .address-block h4 { font-size: 11px; font-weight: bold; text-transform: uppercase; color: #555; margin: 0 0 6px 0; }

.po-print-preview .items-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
.po-print-preview .items-table th, .po-print-preview .items-table td { border: 1px solid #ddd; padding: 5px 7px; text-align: left; font-size: 11px; vertical-align: top; }
.po-print-preview .items-table th { background: #f0f0f0; font-weight: bold; text-transform: uppercase; }
.po-print-preview .items-table .note { margin-top: 3px; color: #666; font-size: 10px; font-style: italic; }
.po-print-preview .text-right { text-align: right; }
.po-print-preview .text-center { text-align: center; }

.po-print-preview .totals-section { display: flex; justify-content: space-between; margin-top: 15px; }
.po-print-preview .totals-section .notes-terms { width: 58%; font-size: 11px; }
.po-print-preview .totals-section .summary { width: 40%; }
.po-print-preview .totals-section .summary table { width: 100%; font-size: 11px; }
.po-print-preview .totals-section .summary td { padding: 3px 0; }
.po-print-preview .totals-section .summary .grand-total td { font-weight: bold; font-size: 12px; border-top: 1px solid #333; border-bottom: 1px solid #333; padding-top: 6px; padding-bottom: 6px; }
.po-print-preview .notes-terms .notes-head { font-size: 11px; font-weight: bold; margin: 10px 0 3px; }
.po-print-preview .notes-terms .notes-body { font-size: 10px; }
.po-print-preview .notes-terms ol { padding-left: 18px; margin: 0; }

.po-print-preview .payment-row { margin-top: 20px; font-size: 11px; border-top: 1px dashed #ccc; padding-top: 8px; }
.po-print-preview .payment-row .payment-label { font-weight: bold; color: #555; }

.po-print-preview .signature-area { margin-top: 40px; text-align: right; }
.po-print-preview .signature-area .seal { max-width: 90px; max-height: 90px; display: block; margin-left: auto; margin-bottom: 5px; }
.po-print-preview .signature-area .sign-line { width: 180px; border-top: 1px solid #333; margin-left: auto; margin-bottom: 5px; }
.po-print-preview .signature-area p { font-size: 11px; margin: 0; }

.po-print-preview .tc-container { margin-top: 30px; border-top: 2px dashed #bbb; padding-top: 20px; }
.po-print-preview .tc-content h1 { font-size: 16px; font-weight: bold; text-transform: uppercase; margin: 20px 0 15px; text-align: center; text-decoration: underline; }
.po-print-preview .tc-content h2 { font-size: 12px; font-weight: bold; margin: 20px 0 10px; color: #222; text-transform: uppercase; }
.po-print-preview .tc-content ol { padding-left: 25px; margin: 0; }
.po-print-preview .tc-content li { font-size: 11.5px; line-height: 1.6; margin-bottom: 8px; text-align: justify; }

.po-print-preview .footer-notes { margin-top: 25px; font-size: 9px; color: #777; border-top: 1px dashed #ccc; padding-top: 8px; text-align: center; }

.po-print-preview .attachments img { width: 100%; margin: 20px 0; }
`;

export const POPdf: React.FC<POPdfProps> = ({
  po,
  orderData,
  includeComments,
  paymentTerms,
  poPdfSheet,
  togglePoPdfSheet,
}) => {
  if (!po) return <div>No PO ID Provided</div>;
  const componentRef = useRef<HTMLDivElement>(null);
  const { role } = useUserData();
  const { gstOptions } = useGstOptions();

  const resolvedAddress = useMemo(() => {
    // 1. Try to find by PO's project_gst
    const match = gstOptions.find((opt) => opt.gst === po?.project_gst);
    if (match?.address) return match.address;

    // 2. Fallback to Bengaluru
    const bengaluru = gstOptions.find((opt) => opt.location === "Bengaluru");
    return (
      bengaluru?.address ||
      "1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka"
    );
  }, [gstOptions, po?.project_gst]);

  const finalPaymentTerms =
    paymentTerms && paymentTerms.length > 0 ? paymentTerms : po?.payment_terms;

  const [images, setImages] = useState([]);
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
        // DISABLED: PDF preview in browser - pdfjs-dist removed
        // PDF attachments are now handled via backend download (handleDownloadPdf)
        // which merges PDFs server-side and provides a single download
        console.log("PDF preview disabled - use Download button for PDF with attachments");
        return [];
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
      const results = await Promise.all(allAttachments.map((att) => getImagesFromAttachment(att)));

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

      const url = `/api/method/nirmaan_stack.api.pdf_helper.po_print.attachment_merged_pdf?${params.toString()}`;

      const response = await fetch(url);
      if (!response.ok) throw new Error("Network response was not ok");

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);

      // Create temporary link to trigger download with custom filename
      const link = document.createElement("a");
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
      window.open(url, "_blank");
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

  /* ---- Totals computed from items (mirrors the print format math) ---- */
  const items = orderData || [];
  const subTotal = items.reduce(
    (acc, it) => acc + parseNumber(it.quote) * parseNumber(it.quantity),
    0
  );
  const totalTax = items.reduce(
    (acc, it) =>
      acc + (parseNumber(it.quote) * parseNumber(it.quantity) * parseNumber(it.tax)) / 100,
    0
  );
  const freight = parseNumber(po?.freight_charges);
  const loading = parseNumber(po?.loading_charges);
  const exactGrandTotal = subTotal + totalTax + freight + loading;
  const roundedGrandTotal = Math.round(exactGrandTotal);
  const roundOff = roundedGrandTotal - exactGrandTotal;
  const totalQty = items.reduce((acc, it) => acc + parseNumber(it.quantity), 0);

  // Project Managers may not see rates — render the rate-hidden preview for them
  // (mirrors the "PO Orders Without Rate" print format / Download Without Rate).
  const withoutRate = role === "Nirmaan Project Manager Profile";

  const companyName = "Nirmaan (Stratos Infra Technologies Pvt. Ltd.)";

  // Reused on both the PO page and the Terms & Conditions page.
  const headerBlock = (
    <div className="pf-header">
      <img src={logo} alt="Nirmaan" className="logo" />
      <div className="company">
        <div className="name">{companyName}</div>
        <div>{resolvedAddress}</div>
        {po?.project_gst && (
          <div>
            <strong>GSTIN:</strong> {po.project_gst}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <Sheet open={poPdfSheet} onOpenChange={togglePoPdfSheet}>
      <SheetContent className="overflow-y-auto w-[95vw] sm:max-w-[95vw] md:max-w-[1000px] p-4 sm:p-6">
        <div className="flex flex-wrap gap-2 pr-12">
          {/* Hide Print and Download buttons for Project Manager role */}
          {role !== "Nirmaan Project Manager Profile" && (
            <>
              <Button
                onClick={() => handleDownloadPdf("PO Orders")}
                disabled={!!downloadingFormat}
                className="flex items-center gap-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download
                  className={`h-4 w-4 ${downloadingFormat === "PO Invoice" ? "animate-bounce" : ""}`}
                />
                {downloadingFormat === "PO Invoice" ? "Downloading..." : "Download"}
              </Button>
            </>
          )}
          <Button
            onClick={() => handleDownloadPdf("PO Orders Without Rate")}
            disabled={!!downloadingFormat}
            className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download
              className={`h-4 w-4 ${
                downloadingFormat === "PO Orders Without Rate" ? "animate-bounce" : ""
              }`}
            />
            {downloadingFormat === "PO Orders Without Rate" ? "Downloading..." : "Download Without Rate"}
          </Button>
        </div>

        {/* PO render/preview — full for most roles, rate-hidden for Project Manager */}
        {(
          <div className="w-full border mt-6">
            <style>{POPDF_STYLES}</style>
            <div ref={componentRef} className="po-print-preview w-full p-6">
              {/* ============================ PAGE 1 ============================ */}
              {headerBlock}

              {/* Title + PO meta */}
              <div className="po-title-row">
                <div className="po-title">Purchase Order</div>
                <div className="po-meta">
                  <p>
                    <strong>PO Number:</strong> {po?.name}
                  </p>
                  <p>
                    <strong>PO Date:</strong> {po?.creation ? formatDate(po.creation) : "N/A"}
                  </p>
                </div>
              </div>

              {/* Vendor / Ship-to */}
              <div className="address-block">
                <div className="addr-col">
                  <h4>Vendor Details</h4>
                  <p>
                    <strong>{po?.vendor_name}</strong>
                  </p>
                  <div>
                    <AddressView id={po?.vendor_address || ""} />
                  </div>
                  {po?.vendor_gst && (
                    <p>
                      <strong>GSTIN:</strong> {po.vendor_gst}
                    </p>
                  )}
                </div>
                <div className="addr-col">
                  <h4>Ship-To / Project Details</h4>
                  <p>
                    <strong>{po?.project_name}</strong>
                  </p>
                  <div>
                    <AddressView id={po?.project_address || ""} />
                  </div>
                  {po?.delivery_contact && (
                    <p>
                      <strong>Site Contact:</strong> {po.delivery_contact}
                    </p>
                  )}
                </div>
              </div>

              {/* Items */}
              <table className="items-table">
                <thead>
                  <tr>
                    <th style={{ width: "5%" }}>Sr.</th>
                    <th style={{ width: withoutRate ? "55%" : "33%" }}>Item Description</th>
                    <th style={{ width: withoutRate ? "20%" : "10%" }} className="text-center">
                      Make
                    </th>
                    <th style={{ width: withoutRate ? "10%" : "8%" }} className="text-center">
                      Qty
                    </th>
                    <th style={{ width: withoutRate ? "10%" : "8%" }} className="text-center">
                      Unit
                    </th>
                    {!withoutRate && (
                      <>
                        <th style={{ width: "12%" }} className="text-right">
                          Rate
                        </th>
                        <th style={{ width: "10%" }} className="text-right">
                          Tax %
                        </th>
                        <th style={{ width: "14%" }} className="text-right">
                          Amount
                        </th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {items.length > 0 ? (
                    items.map((item, index) => (
                      <tr key={index}>
                        <td className="text-center">{index + 1}</td>
                        <td>
                          {item.item_name}
                          {item.comment && (
                            <div className="note">Note: {item.comment}</div>
                          )}
                        </td>
                        <td className="text-center">{item.make || "-"}</td>
                        <td className="text-center">{parseNumber(item.quantity)}</td>
                        <td className="text-center">{item.unit || "N/A"}</td>
                        {!withoutRate && (
                          <>
                            <td className="text-right">{fmtMoney(item.quote)}</td>
                            <td className="text-right">{parseNumber(item.tax)}%</td>
                            <td className="text-right">
                              {fmtMoney(parseNumber(item.quote) * parseNumber(item.quantity))}
                            </td>
                          </>
                        )}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={withoutRate ? 5 : 8} style={{ textAlign: "center", padding: "20px" }}>
                        No items found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Totals — full financials hidden in the rate-less view */}
              {withoutRate ? (
                parsedNotes.length > 0 && (
                  <div className="notes-terms" style={{ width: "100%", marginTop: 15 }}>
                    <div className="notes-head">Notes &amp; Terms:</div>
                    <ol className="notes-body">
                      {parsedNotes.map((note, idx) => (
                        <li key={idx}>{note}</li>
                      ))}
                    </ol>
                  </div>
                )
              ) : (
                <div className="totals-section">
                  <div className="notes-terms">
                    <p>
                      <strong>Total Quantity:</strong> {totalQty}
                    </p>
                    <br />
                    <p>
                      <strong>Amount in Words:</strong>
                      <br />
                      {amountInWords(roundedGrandTotal)}
                    </p>
                    {parsedNotes.length > 0 && (
                      <div>
                        <div className="notes-head">Notes &amp; Terms:</div>
                        <ol className="notes-body">
                          {parsedNotes.map((note, idx) => (
                            <li key={idx}>{note}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </div>

                  <div className="summary">
                    <table>
                      <tbody>
                        <tr>
                          <td>Sub-Total:</td>
                          <td className="text-right">₹ {fmtMoney(subTotal)}</td>
                        </tr>
                        <tr>
                          <td>Total Tax(GST):</td>
                          <td className="text-right">₹ {fmtMoney(totalTax)}</td>
                        </tr>
                        <tr>
                          <td>Round Off:</td>
                          <td className="text-right">₹ {fmtMoney(roundOff)}</td>
                        </tr>
                        <tr className="grand-total">
                          <td>Grand Total:</td>
                          <td className="text-right">₹ {fmtMoney(roundedGrandTotal, 0)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Payment — hidden in the rate-less view */}
              {!withoutRate && finalPaymentTerms && finalPaymentTerms.length > 0 && (
                <div className="payment-row">
                  <span className="payment-label">PAYMENT:</span>
                  <div style={{ marginTop: 3 }}>
                    {finalPaymentTerms
                      .filter((term) => parseFloat(String(term.percentage)) > 0)
                      .map(
                        (term) =>
                          `${parseFloat(String(term.percentage)).toFixed(2)}% -- ${term.label}`
                      )
                      .join(", ")}
                  </div>
                </div>
              )}

              {/* Signature */}
              <div className="signature-area">
                <img src={Seal} className="seal" alt="Seal" />
                <div className="sign-line" />
                <p>
                  For <strong>{companyName}</strong>
                </p>
                <p>(Authorized Signatory)</p>
              </div>

              {/* ============= TERMS & CONDITIONS (hidden in rate-less view) ============= */}
              {!withoutRate && (
              <div className="tc-container">
                {headerBlock}
                <div className="tc-content">
                  <h1>Terms and Conditions</h1>

                  <h2>1. Invoicing:</h2>
                  <ol>
                    <li>
                      All invoices shall be submitted in original and shall be tax invoices showing
                      the breakup of tax structure/value payable at the prevailing rate and a clear
                      description of goods.
                    </li>
                    <li>
                      All invoices submitted shall have Delivery Challan/E-waybill for supply items.
                    </li>
                    <li>
                      All Invoices shall have the tax registration numbers mentioned thereon. The
                      invoices shall be raised in the name of "Stratos Infra Technologies Pvt Ltd,
                      Bangalore".
                    </li>
                    <li>Payments shall be only entertained after receipt of the correct invoice.</li>
                    <li>
                      In case of advance request, Advance payment shall be paid after the submission
                      of an advance receipt (as suggested under GST law).
                    </li>
                  </ol>

                  <h2>2. Payment:</h2>
                  <ol>
                    <li>Payment shall be done through RTGS/NEFT.</li>
                    <li>
                      A retention amount shall be deducted as per PO payment terms and:
                      <ol type="a" style={{ marginTop: 2 }}>
                        <li>
                          In case the vendor is not completing the task assigned by Nirmaan a
                          suitable amount, as decided by Nirmaan, shall be deducted from the retention
                          amount.
                        </li>
                        <li>
                          The adjusted amount shall be paid on completion of the defect liability
                          period.
                        </li>
                        <li>
                          Vendors are expected to pay GST as per the prevailing rules. In case the
                          vendor is not making GST payments to the tax authority, Nirmaan shall deduct
                          the appropriated amount from the invoice payment of the vendor.
                        </li>
                        <li>
                          Nirmaan shall deduct the following amounts from the final bills:
                          <ol type="i">
                            <li>Amount pertaining to unfinished supply.</li>
                            <li>
                              Amount pertaining to Liquidated damages and other fines, as mentioned in
                              the documents.
                            </li>
                            <li>Any agreed amount between the vendor and Nirmaan.</li>
                          </ol>
                        </li>
                      </ol>
                    </li>
                  </ol>

                  <h2>3. Technical Specifications of the Work:</h2>
                  <ol>
                    <li>
                      All goods delivered shall conform to the technical specifications mentioned in
                      the vendor's quote referred to in this PO or as detailed in Annexure 1 to this
                      PO.
                    </li>
                    <li>
                      Supply of goods or services shall be strictly as per Annexure - 1 or the
                      Vendor's quote/PI in case of the absence of Annexure - I.
                    </li>
                    <li>
                      Any change in line items or quantities shall be duly approved by Nirmaan with
                      rate approval prior to supply. Any goods supplied by the agency without
                      obtaining due approvals shall be subject to the acceptance or rejection from
                      Nirmaan.
                    </li>
                    <li>
                      Any damaged/faulty material supplied needs to be replaced with a new item free
                      of cost, without extending the completion dates.
                    </li>
                    <li>
                      Material supplied in excess and not required by the project shall be taken back
                      by the vendor at no cost to Nirmaan.
                    </li>
                  </ol>

                  <h1 style={{ marginTop: 20 }}>General Terms &amp; Conditions for Purchase Order</h1>
                  <ol>
                    <li>
                      <div style={{ fontWeight: "bold", marginBottom: 2 }}>Liquidity Damages:</div>
                      Liquidity damages shall be applied at 2.5% of the order value for every day of
                      delay.
                    </li>
                    <li>
                      <div style={{ fontWeight: "bold", marginBottom: 2 }}>
                        Termination/Cancellation:
                      </div>
                      If Nirmaan reasonably determines that it can no longer continue business with
                      the vendor in accordance with applicable legal, regulatory, or professional
                      obligations, Nirmaan shall have the right to terminate/cancel this PO
                      immediately.
                    </li>
                    <li>
                      <div style={{ fontWeight: "bold", marginBottom: 2 }}>
                        Other General Conditions:
                      </div>
                      <ol type="a">
                        <li>
                          Insurance: All required insurance including, but not limited to,
                          Contractors' All Risk (CAR) Policy, FLEXA cover, and Workmen's Compensation
                          (WC) policy are in the vendor's scope. Nirmaan in any case shall not be made
                          liable for providing these insurance. All required insurances are required
                          prior to the commencement of the work at the site.
                        </li>
                        <li>
                          Safety: The safety and security of all men deployed and materials placed by
                          the Vendor or its agents for the project shall be at the risk and
                          responsibility of the Vendor. Vendor shall ensure compliance with all safety
                          norms at the site. Nirmaan shall have no obligation or responsibility on any
                          safety, security &amp; compensation related matters for the resources &amp;
                          material deployed by the Vendor or its agent.
                        </li>
                        <li>
                          Notice: Any notice or other communication required or authorized under this
                          PO shall be in writing and given to the party for whom it is intended at the
                          address given in this PO or such other address as shall have been notified to
                          the other party for that purpose, through registered post, courier,
                          facsimile or electronic mail.
                        </li>
                        <li>
                          Force Majeure: Neither party shall be liable for any delay or failure to
                          perform if such delay or failure arises from an act of God or of the public
                          enemy, an act of civil disobedience, epidemic, war, insurrection, labor
                          action, or governmental action.
                        </li>
                        <li>
                          Name use: Vendor shall not use, or permit the use of, the name, trade name,
                          service marks, trademarks, or logo of Nirmaan in any form of publicity, press
                          release, advertisement, or otherwise without Nirmaan's prior written consent.
                        </li>
                        <li>
                          Arbitration: Any dispute arising out of or in connection with the order shall
                          be settled by Arbitration in accordance with the Arbitration and Conciliation
                          Act,1996 (As amended in 2015). The arbitration proceedings shall be conducted
                          in English in Bangalore by the sole arbitrator appointed by the Purchaser.
                        </li>
                        <li>
                          The law governing: All disputes shall be governed as per the laws of India
                          and subject to the exclusive jurisdiction of the court in Karnataka.
                        </li>
                      </ol>
                    </li>
                  </ol>
                </div>
              </div>
              )}

              <div className="footer-notes">This is a computer-generated Purchase Order.</div>

              {/* Attachments */}
              {po?.custom === "true" && images?.length > 0 && (
                <div className="attachments">
                  {images?.map((imgSrc, index) => (
                    <img key={index} src={imgSrc} alt={`Attachment ${index + 1}`} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};
