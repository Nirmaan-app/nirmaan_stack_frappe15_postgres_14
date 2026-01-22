import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { TableSkeleton } from "@/components/ui/skeleton";
import SITEURL from "@/constants/siteURL";
import { NirmaanAttachment } from "@/types/NirmaanStack/NirmaanAttachment";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee, {formatToRoundedIndianRupee} from "@/utils/FormatPrice";
import { ColumnDef } from "@tanstack/react-table";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import memoize from "lodash/memoize";
import { Info } from "lucide-react";
import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";

interface InvoiceItem {
    // New Vendor Invoice fields
    name: string;
    invoice_amount: number;
    invoice_no: string;
    invoice_date: string;
    uploaded_by: string;
    invoice_attachment_id: string;
    document_name: string; // PO or SR ID
    document_type: "Procurement Orders" | "Service Requests";
    vendor: string;
    vendor_name: string;
    // Legacy field mappings (for backward compatibility)
    amount?: number;
    date?: string;
    updated_by?: string;
    procurement_order?: string;
}

interface InvoicesDataCallResponse {
    message: {
        invoice_entries: InvoiceItem[];
        total_invoices: number;
        total_amount: number;
    },
    status: number;
}

export const ProjectWiseInvoices: React.FC<{ projectId?: string }> = ({ projectId }) => {
//   const call = useFrappePrefetchCall(
//     "nirmaan_stack.api.projects.project_wise_invoice_data.generate_project_wise_invoice_data",
//     { project_id: projectId }
//   );

//   console.log("cal", call)

//   const [invoiceResponse, setInvoiceResponse] = useState<any>(null);

//   useEffect(() => {
//     async function fetchData() {
//       try {
//         const data = await call();
//         console.log("Fetched data:", data, projectId);
//         setInvoiceResponse(data);
//       } catch (error) {
//         console.error("Error fetching invoice data:", error);
//       }
//     }
//     if (projectId) fetchData();
//   }, [call, projectId]);

//   // Use useMemo to extract the invoice entries once the data is available.
//   const invoiceData = useMemo(() => {
//     return invoiceResponse?.message?.message?.invoice_entries;
//   }, [invoiceResponse]);

//   console.log("invoiceData", invoiceData);

const navigate = useNavigate();
const {data: invoicesData, isLoading: invoicesDataLoading} = useFrappeGetCall<{message : InvoicesDataCallResponse}>("nirmaan_stack.api.projects.project_wise_invoice_data.generate_project_wise_invoice_data", {project_id: projectId}, projectId ? undefined : null)

const {data : attachmentsData, isLoading: attachmentsDataLoading} = useFrappeGetDocList<NirmaanAttachment>("Nirmaan Attachments", {
    fields: ["name", "attachment"],
    filters: [["project", "=", projectId]],
    limit: 100
}, projectId ? `Nirmaan Attachments ${projectId}` : null)

const getAttachmentUrl = useMemo(() => memoize((id: string) => {
    const attachment = attachmentsData?.find((att) => att.name === id);
    return attachment?.attachment;
}, (id: string) => id), [attachmentsData])

const invoiceColumns: ColumnDef<InvoiceItem>[] =
    useMemo(() => [
      {
        accessorKey: "invoice_date",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Invoice Date" />
        ),
        cell: ({ row }) => {
          // Use new field with fallback to legacy field
          const dateValue = (row.original.invoice_date || row.original.date)?.slice(0, 10);
          return (
            <div className="font-medium">
              {dateValue ? formatDate(dateValue) : '-'}
            </div>
          );
        },
      },
      {
        accessorKey: "invoice_no",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Invoice No" />
        ),
        cell: ({ row }) => {
          const { invoice_no, invoice_attachment_id } = row.original;
          const attachmentUrl = getAttachmentUrl(invoice_attachment_id);
          return (
            <div className="font-medium">
              {invoice_attachment_id ? (
                <HoverCard>
                  <HoverCardTrigger>
                    <span onClick={() => {
                        window.open(SITEURL + attachmentUrl, "_blank")
                    }} className="text-blue-500 underline cursor-pointer">{invoice_no}</span>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-auto rounded-md shadow-lg">
                    <img
                      src={`${SITEURL}${attachmentUrl}`}
                      alt={`Invoice ${invoice_no}`}
                      className="max-w-xs max-h-64 object-contain rounded-md shadow-md"
                    />
                  </HoverCardContent>
                </HoverCard>
              ) : (
                invoice_no
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "invoice_amount",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Amount" />
        ),
        cell: ({ row }) => {
          // Use new field with fallback to legacy field
          const amount = row.original.invoice_amount ?? row.original.amount ?? 0;
          return (
            <div className="font-medium text-green-600">
              {formatToRoundedIndianRupee(amount)}
            </div>
          );
        },
      },
      {
        accessorKey: "uploaded_by",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Uploaded By" />
        ),
        cell: ({ row }) => {
          // Use new field with fallback to legacy field
          return (
            <div className="font-medium">
              {row.original.uploaded_by || row.original.updated_by || "-"}
            </div>
          );
        },
      },
      {
        accessorKey: "document_name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Document" />
        ),
        cell: ({ row }) => {
          // Use new field with fallback to legacy field
          const docName = row.original.document_name || row.original.procurement_order;
          const docType = row.original.document_type;
          const isPO = docType === "Procurement Orders" || row.original.procurement_order;

          if (!docName) return <div className="font-medium">-</div>;

          // Navigate to appropriate page based on document type
          const navigatePath = isPO
            ? `po/${docName.replace(/\//g, "&=")}`
            : `/service-requests/${docName}`;

          return (
            <div className="font-medium flex items-center">
              {docName}
              <HoverCard>
                <HoverCardTrigger>
                  <Info
                    onClick={() => navigate(navigatePath)}
                    className="w-4 h-4 text-blue-600 cursor-pointer inline-block ml-1"
                  />
                </HoverCardTrigger>
                <HoverCardContent className="w-auto rounded-md shadow-lg">
                  Click to view {isPO ? "Procurement Order" : "Service Request"} details.
                </HoverCardContent>
              </HoverCard>
            </div>
          );
        },
      },
      {
        accessorKey: "vendor_name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Vendor" />
        ),
        cell: ({ row }) => {
          const navigate = useNavigate();
          const vendor_name = row.original.vendor_name;
          const vendor_id = row.original.vendor;
          return (
            <div className="font-medium flex items-center">
              {vendor_name}
              <HoverCard>
                <HoverCardTrigger>
                  <Info
                    onClick={() => navigate(`/vendors/${vendor_id}`)}
                    className="w-4 h-4 text-blue-600 cursor-pointer inline-block ml-1"
                  />
                </HoverCardTrigger>
                <HoverCardContent className="w-auto rounded-md shadow-lg">
                  Click to navigate to Vendor details page.
                </HoverCardContent>
              </HoverCard>
            </div>
          );
        },
      },
    ], [invoicesData, attachmentsData, getAttachmentUrl]);


  return (
    <div className="flex-1 space-y-4">
            {invoicesDataLoading || attachmentsDataLoading ? (
                <TableSkeleton />
            ) : (
                <DataTable columns={invoiceColumns} data={invoicesData?.message?.message?.invoice_entries || []} />
            )}
    </div>
  )
};

export default ProjectWiseInvoices;
