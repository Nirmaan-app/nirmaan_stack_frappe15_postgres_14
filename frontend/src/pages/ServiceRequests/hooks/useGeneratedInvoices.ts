import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";

/**
 * Generated invoices on a GST-off Work Order (#1546, spec #1528; GLOSSARY *Generated invoice*).
 *
 * The server owns every figure and check (`nirmaan_stack/api/service_requests/generated_invoices.py`):
 * the RA number, the amount limit, FINAL, who may act. The screen shows what it is told.
 */
const API = "nirmaan_stack.api.service_requests.generated_invoices";
const DOCTYPE = "WO Generated Invoice";

export type GeneratedInvoiceType = "RA" | "FINAL";
export type GeneratedInvoiceStatus = "Generated" | "Signed" | "Approved" | "Voided";

export interface GeneratedInvoice {
  name: string;
  ra_number: number;
  invoice_type: GeneratedInvoiceType;
  invoice_no: string;
  invoice_date: string;
  amount: number;
  status: GeneratedInvoiceStatus;
  void_reason?: string | null;
  vendor_invoice?: string | null;
  signed_attachment?: string | null;
  owner: string;
  creation: string;
}

export interface GeneratedInvoicesState {
  /** Newest first. */
  invoices: GeneratedInvoice[];
  /** The user may generate and void. */
  can_generate: boolean;
  /** The user may delete a Voided one (Admin). */
  can_delete: boolean;
  /** Why nothing can be generated on this Work Order now, or null. */
  blocked: string | null;
  next_ra_number: number;
  /** The most an invoice may bill: Amount Paid (incl. TDS), up to the WO amount, less `billed`. */
  left: number;
  /** What already counts against the WO amount: Pending and Approved invoices, and generated ones not uploaded. */
  billed: number;
  fully_paid: boolean;
  has_final: boolean;
}

/** The PDF of one generated invoice. It reads the record, so nothing in this link sets a figure. */
export const generatedInvoicePdfUrl = (name: string): string =>
  `/api/method/frappe.utils.print_format.download_pdf?${new URLSearchParams({
    doctype: DOCTYPE,
    name,
    format: DOCTYPE,
    no_letterhead: "1",
    _lang: "en",
  }).toString()}`;

/** A generated invoice's RA column: "RA-3", or "—" for the FINAL, which shows no "FINAL" anywhere (owner, 2026-10-30). */
export const generatedInvoiceLabel = (row: Pick<GeneratedInvoice, "invoice_type" | "ra_number">): string =>
  row.invoice_type === "FINAL" ? "—" : `RA-${row.ra_number}`;

/** One Work Order's generated invoices and what Generate would do next. `null` skips the fetch. */
export const useGeneratedInvoices = (workOrder: string | null) => {
  const { data, isLoading, error, mutate } = useFrappeGetCall<{ message: GeneratedInvoicesState }>(
    `${API}.get_generated_invoices`,
    { work_order: workOrder },
    workOrder ? `wo_generated_invoices_${workOrder}` : null
  );
  return { state: data?.message, isLoading, error, mutate };
};

export interface GenerateArgs {
  work_order: string;
  invoice_date: string;
  /** The server saves it as an RA, or as the FINAL when it reaches the WO amount. */
  amount: number;
}

/** Generate, void and upload the signed copy. Each reply is the record after the action. */
export const useGeneratedInvoiceActions = () => {
  const { call: callGenerate, loading: generating } = useFrappePostCall<{ message: GeneratedInvoice }>(
    `${API}.generate_invoice`
  );
  const { call: callVoid, loading: voiding } = useFrappePostCall<{ message: GeneratedInvoice }>(
    `${API}.void_invoice`
  );
  const { call: callUpload, loading: uploading } = useFrappePostCall<{ message: GeneratedInvoice }>(
    `${API}.upload_signed_copy`
  );
  const { call: callDelete, loading: deleting } = useFrappePostCall<{ message: { name: string } }>(
    `${API}.delete_generated_invoice`
  );
  const generate = async (args: GenerateArgs) => (await callGenerate(args)).message;
  const voidInvoice = async (name: string, reason: string) => (await callVoid({ name, reason })).message;
  /** `fileUrl` is the already-uploaded scan; the server makes its Pending Vendor Invoice (#1547). */
  const uploadSignedCopy = async (name: string, fileUrl: string) =>
    (await callUpload({ name, file_url: fileUrl })).message;
  /** Admin, a Voided one only; its RA number is freed for the next invoice when no later one holds a higher one. */
  const deleteInvoice = async (name: string) => (await callDelete({ name })).message;
  return { generate, voidInvoice, uploadSignedCopy, deleteInvoice, generating, voiding, uploading, deleting };
};
