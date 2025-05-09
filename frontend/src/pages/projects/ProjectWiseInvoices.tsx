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
    amount: number,
    invoice_no: string,
    date: string,
    updated_by: string,
    invoice_attachment_id: string,
    procurement_order: string
    vendor: string
    vendor_name: string
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
        accessorKey: "date",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Invoice Date" />
        ),
        cell: ({ row }) => {
          const dateValue = row.original.date;
          return (
            <div className="font-medium">
              {formatDate(dateValue)}
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
        accessorKey: "amount",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Amount" />
        ),
        cell: ({ row }) => {
          const amount = row.original.amount;
          return (
            <div className="font-medium text-green-600">
              {formatToRoundedIndianRupee(amount)}
            </div>
          );
        },
      },
      {
        accessorKey: "updated_by",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Updated By" />
        ),
        cell: ({ row }) => {
          return (
            <div className="font-medium">
              {row.original.updated_by}
            </div>
          );
        },
      },
      {
        accessorKey: "procurement_order",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Procurement Order" />
        ),
        cell: ({ row }) => {
          const po = row.original.procurement_order;
          // Optionally, use a helper to transform or fetch PO details.
          return (
            <div className="font-medium flex items-center">
              {po}
              <HoverCard>
                <HoverCardTrigger>
                  <Info
                    onClick={() => navigate(`po/${po.replaceAll('/', "&=")}`)}
                    className="w-4 h-4 text-blue-600 cursor-pointer inline-block ml-1"
                  />
                </HoverCardTrigger>
                <HoverCardContent className="w-auto rounded-md shadow-lg">
                  Click to view Procurement Order details.
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
