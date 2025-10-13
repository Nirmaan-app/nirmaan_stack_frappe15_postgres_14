// // src/app/invoice-reconciliation/components/PoInvoices.tsx (or wherever you place it)

// import { DataTable } from "@/components/data-table/data-table";
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
// import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
// import { TableSkeleton } from "@/components/ui/skeleton";
// import SITEURL from "@/constants/siteURL";
// import { NirmaanAttachment } from "@/types/NirmaanStack/NirmaanAttachment";
// import { formatDate } from "@/utils/FormatDate";
// import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
// import { ColumnDef } from "@tanstack/react-table";
// import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
// import memoize from "lodash/memoize";
// import { Info } from "lucide-react";
// import React, { useMemo } from "react";
// import { useNavigate } from "react-router-dom";
// import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";
// import { Vendors } from "@/types/NirmaanStack/Vendors";



// interface Projects {
//   name: string;
//   project_name: string;
//   customer: string;
//   status: string;
// }


// // Updated Interface: Added 'project' field
// interface InvoiceItem {
//     amount: number;
//     invoice_no: string;
//     date: string;
//     updated_by: string;
//     invoice_attachment_id: string; // Frappe DocType 'name' of the Nirmaan Attachment
//     procurement_order: string;
//     project?: string; // Project ID, now returned by the new API
//     vendor: string;
//     vendor_name: string;
// }

// interface AllInvoicesDataCallResponse {
//     message: {
//         invoice_entries: InvoiceItem[];
//         total_invoices: number;
//         total_amount: number;
//     };
//     status: number;
// }

// // Renamed component
// export const PoInvoices: React.FC = () => { // Removed projectId prop
//     const navigate = useNavigate();

//     // --- API Call for ALL PO Invoices ---
//     // Updated API path and removed projectId argument
//     const { data: invoicesData, isLoading: invoicesDataLoading } = useFrappeGetCall<AllInvoicesDataCallResponse>(
//         "nirmaan_stack.api.invoices.po_wise_invoice_data.generate_all_po_invoice_data",
       
//     );

  

//     // --- Fetch Nirmaan Attachments based on extracted IDs ---
//     const { data: attachmentsData, isLoading: attachmentsDataLoading } = useFrappeGetDocList<NirmaanAttachment>(
//         "Nirmaan Attachments",
//         {
//             fields: ["name", "attachment"],
//             filters: [
//             ],
//             limit:0, // Set limit dynamically, at least 1 to avoid empty query
//         },
       
//     );


//         // --- Fetch all Projects data ---
//     const { data: projectdata, isLoading: projectloading, error: projecterror } = useFrappeGetDocList<Projects>("Projects", {
//         fields: ['name', 'project_name', 'customer', "status"],
//         limit: 1000, // Be cautious with large limits on many projects
//         orderBy: { field: 'creation', order: 'desc' },
//     });
//         const { data: vendors, isLoading: vendorsLoading, error: vendorsError } = useFrappeGetDocList<Vendors>("Vendors", {
//             fields: ["name", "vendor_name"],
//             limit: 0,
//         }, 'Vendors');

//   const projectValues = useMemo(() => projectdata?.map((item) => ({
//         label: item?.project_name,
//         value: item?.name,
//     })) || [], [projectdata])

//        const vendorValues = useMemo(() => vendors?.map((item) => ({
//             label: item?.vendor_name,
//             value: item?.name,
//         })) || [], [vendors])
    


//     // Memoized function to get attachment URL by its Frappe DocType 'name'
//     const getAttachmentUrl = useMemo(() => memoize((id: string) => {
//         const attachment = attachmentsData?.find((att) => att.name === id);
//         return attachment?.attachment;
//     }, (id: string) => id), [attachmentsData]);

//     const invoiceColumns = useMemo(() => [
//         {
//             accessorKey: "date",
//             header: ({ column }) => (
//                 <DataTableColumnHeader column={column} title="Invoice Date" />
//             ),
//             cell: ({ row }) => {
//                 const dateValue = row.original.date?.slice(0, 10);
//                 return (
//                     <div className="font-medium">
//                         {dateValue ? formatDate(dateValue) : '-'}
//                     </div>
//                 );
//             },
//         },
//         {
//             accessorKey: "invoice_no",
//             header: ({ column }) => (
//                 <DataTableColumnHeader column={column} title="Invoice No" />
//             ),
//             cell: ({ row }) => {
//                 const { invoice_no, invoice_attachment_id } = row.original;
//                 const attachmentUrl = getAttachmentUrl(invoice_attachment_id);
//                 return (
//                     <div className="font-medium">
//                         {invoice_attachment_id && attachmentUrl ? ( // Ensure both ID and URL are present
//                             <HoverCard>
//                                 <HoverCardTrigger>
//                                     <span onClick={() => {
//                                         window.open(SITEURL + attachmentUrl, "_blank")
//                                     }} className="text-blue-500 underline cursor-pointer">{invoice_no}</span>
//                                 </HoverCardTrigger>
//                                 <HoverCardContent className="w-auto rounded-md shadow-lg">
//                                     <img
//                                         src={`${SITEURL}${attachmentUrl}`}
//                                         alt={`Invoice ${invoice_no}`}
//                                         className="max-w-xs max-h-64 object-contain rounded-md shadow-md"
//                                     />
//                                 </HoverCardContent>
//                             </HoverCard>
//                         ) : (
//                             invoice_no
//                         )}
//                     </div>
//                 );
//             },
//         },
//         {
//             accessorKey: "amount",
//             header: ({ column }) => (
//                 <DataTableColumnHeader column={column} title="Amount" />
//             ),
//             cell: ({ row }) => {
//                 const amount = row.original.amount;
//                 return (
//                     <div className="font-medium text-green-600">
//                         {formatToRoundedIndianRupee(amount)}
//                     </div>
//                 );
//             },
//         },
//         {
//             accessorKey: "updated_by",
//             header: ({ column }) => (
//                 <DataTableColumnHeader column={column} title="Updated By" />
//             ),
//             cell: ({ row }) => {
//                 return (
//                     <div className="font-medium">
//                         {row.original.updated_by}
//                     </div>
//                 );
//             },
//         },
//         {
//             accessorKey: "procurement_order",
//             header: ({ column }) => (
//                 <DataTableColumnHeader column={column} title="PO ID" />
//             ),
//             cell: ({ row }) => {
//                 const po = row.original.procurement_order;
//                 return (
//                     <div className="font-medium flex items-center">
//                         {po}
//                         <HoverCard>
//                             <HoverCardTrigger>
//                                 <Info
//                                     onClick={() => navigate(`/project-payments/${po.replaceAll('/', "&=")}`)}
//                                     className="w-4 h-4 text-blue-600 cursor-pointer inline-block ml-1"
//                                 />
//                             </HoverCardTrigger>
//                             <HoverCardContent className="w-auto rounded-md shadow-lg">
//                                 Click to view Procurement Order details.
//                             </HoverCardContent>
//                         </HoverCard>
//                     </div>
//                 );
//             },
//         },
//         {
//             accessorKey: "project", // New column for Project ID
//             header: ({ column }) => (
//                 <DataTableColumnHeader column={column} title="Project" />
//             ),
//             cell: ({ row }) => {
//               console.log(row.original.project)
//                  const project = projectValues.find(
//                             (project) => project.value === row.getValue("project")
//                         );
//                 const po = row.original.procurement_order;

//                 return (
//                     <div className="font-medium">
//                         {project?.label || '-'} 
//                         <HoverCard>
//                             <HoverCardTrigger>
//                                 <Info
//                                     onClick={() => navigate(`/projects/${row.original.project}?page=overview`)}
//                                     className="w-4 h-4 text-blue-600 cursor-pointer inline-block ml-1"
//                                 />
//                             </HoverCardTrigger>
//                             <HoverCardContent className="w-auto rounded-md shadow-lg">
//                                 Click to view Procurement Order details.
//                             </HoverCardContent>
//                         </HoverCard>
//                     </div>
//                 );
//             },
//             filterFn: (row, id, value) => {
//                     return value.includes(row.getValue(id))
//                 }
            
//         },
       
//         {
//             accessorKey: "vendor",
//             header: ({ column }) => (
//                 <DataTableColumnHeader column={column} title="Vendor" />
//             ),
//             cell: ({ row }) => {
//               console.log(row.original.vendor)

//                   const vendor = vendorValues.find(
//                         (vendor) => vendor.value === row.getValue("vendor")
//                     );
//                 return (
//                     <div className="font-medium flex items-center">
//                         {vendor?.label}
//                         <HoverCard>
//                             <HoverCardTrigger>
//                                 <Info
//                                     onClick={() => navigate(`/vendors/${vendor?.value}`)}
//                                     className="w-4 h-4 text-blue-600 cursor-pointer inline-block ml-1"
//                                 />
//                             </HoverCardTrigger>
//                             <HoverCardContent className="w-auto rounded-md shadow-lg">
//                                 Click to navigate to Vendor details page.
//                             </HoverCardContent>
//                         </HoverCard>
//                     </div>
//                 );
//             },
//              filterFn: (row, id, value) => {
//                                 return value.includes(row.getValue(id))
//             }
//         },
       
//     ], [invoicesData, attachmentsData, getAttachmentUrl,projectValues,vendorValues]); // Re-evaluate columns if data or attachments change

//      const facetOptionsConfig = useMemo(() => ({
//             project: { title: "Project", options: projectdata?.map(p => ({ label: p.project_name, value: p.name })) || [] },
           
//         }), [projectdata]);

//         console.log("invoicesData?.message?.message?.invoice_entries",invoicesData?.message?.message?.invoice_entries)




//     return (
//         <div className="flex-1 space-y-4">
//             {invoicesDataLoading || attachmentsDataLoading ? (
//                 <TableSkeleton />
//             ) : (
//                 <DataTable columns={invoiceColumns} data={invoicesData?.message?.message?.invoice_entries || []}
//                 onExport={true}
                
//                   project_values={ projectValues } approvedQuotesVendors={ vendorValues }
//                 /> 
//             )}
//         </div>
//     );
// };

// export default PoInvoices;



import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { TableSkeleton } from "@/components/ui/skeleton";
import SITEURL from "@/constants/siteURL";
import { NirmaanAttachment } from "@/types/NirmaanStack/NirmaanAttachment";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { ColumnDef } from "@tanstack/react-table";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import memoize from "lodash/memoize";
import { Info, Download } from "lucide-react"; // Import Download icon
import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { Button } from "@/components/ui/button"; // Import Button component


interface Projects {
  name: string;
  project_name: string;
  customer: string;
  status: string;
}

interface InvoiceItem {
    amount: number;
    invoice_no: string;
    date: string;
    updated_by: string;
    invoice_attachment_id: string; // Frappe DocType 'name' of the Nirmaan Attachment
    procurement_order: string;
    project?: string; // Project ID, now returned by the new API
    vendor: string;
    vendor_name: string;
}

interface AllInvoicesDataCallResponse {
    message: {
        invoice_entries: InvoiceItem[];
        total_invoices: number;
        total_amount: number;
    };
    status: number;
}

// Renamed component
export const PoInvoices: React.FC = () => {
    const navigate = useNavigate();

    // --- API Call for ALL PO Invoices ---
    const { data: invoicesData, isLoading: invoicesDataLoading } = useFrappeGetCall<AllInvoicesDataCallResponse>(
        "nirmaan_stack.api.invoices.po_wise_invoice_data.generate_all_po_invoice_data",
    );

    // --- Fetch Nirmaan Attachments based on extracted IDs ---
    const { data: attachmentsData, isLoading: attachmentsDataLoading } = useFrappeGetDocList<NirmaanAttachment>(
        "Nirmaan Attachments",
        {
            fields: ["name", "attachment"],
            filters: [
            ],
            limit:0,
        },
    );

    // --- Fetch all Projects data ---
    const { data: projectdata, isLoading: projectloading, error: projecterror } = useFrappeGetDocList<Projects>("Projects", {
        fields: ['name', 'project_name', 'customer', "status"],
        limit: 1000,
        orderBy: { field: 'creation', order: 'desc' },
    });
    // --- Fetch all Vendors data ---
    const { data: vendors, isLoading: vendorsLoading, error: vendorsError } = useFrappeGetDocList<Vendors>("Vendors", {
        fields: ["name", "vendor_name"],
        limit: 0,
    }, 'Vendors');

    const projectValues = useMemo(() => projectdata?.map((item) => ({
        label: item?.project_name,
        value: item?.name,
    })) || [], [projectdata]);

    const vendorValues = useMemo(() => vendors?.map((item) => ({
        label: item?.vendor_name,
        value: item?.name,
    })) || [], [vendors]);

    // Memoized function to get attachment URL by its Frappe DocType 'name'
    const getAttachmentUrl = useMemo(() => memoize((id: string) => {
        const attachment = attachmentsData?.find((att) => att.name === id);
        return attachment?.attachment;
    }, (id: string) => id), [attachmentsData]);

    const invoiceColumns = useMemo<ColumnDef<InvoiceItem>[]>(() => [
        {
            accessorKey: "date",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Invoice Date" />
            ),
            cell: ({ row }) => {
                const dateValue = row.original.date?.slice(0, 10);
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
                        {invoice_attachment_id && attachmentUrl ? (
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
                <DataTableColumnHeader column={column} title="PO ID" />
            ),
            cell: ({ row }) => {
                const po = row.original.procurement_order;
                return (
                    <div className="font-medium flex items-center">
                        {po}
                        <HoverCard>
                            <HoverCardTrigger>
                                <Info
                                    onClick={() => navigate(`/project-payments/${po.replaceAll('/', "&=")}`)}
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
            accessorKey: "project",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Project" />
            ),
            cell: ({ row }) => {
                const project = projectValues.find(
                    (project) => project.value === row.getValue("project")
                );
                return (
                    <div className="font-medium">
                        {project?.label || '-'}
                        <HoverCard>
                            <HoverCardTrigger>
                                <Info
                                    onClick={() => navigate(`/projects/${row.original.project}?page=overview`)}
                                    className="w-4 h-4 text-blue-600 cursor-pointer inline-block ml-1"
                                />
                            </HoverCardTrigger>
                            <HoverCardContent className="w-auto rounded-md shadow-lg">
                                Click to view Project details.
                            </HoverCardContent>
                        </HoverCard>
                    </div>
                );
            },
            filterFn: (row, id, value) => {
                return value.includes(row.getValue(id))
            }
        },
        {
            accessorKey: "vendor",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Vendor" />
            ),
            cell: ({ row }) => {
                const vendor = vendorValues.find(
                    (vendor) => vendor.value === row.getValue("vendor")
                );
                return (
                    <div className="font-medium flex items-center">
                        {vendor?.label}
                        <HoverCard>
                            <HoverCardTrigger>
                                <Info
                                    onClick={() => navigate(`/vendors/${vendor?.value}`)}
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
            filterFn: (row, id, value) => {
                return value.includes(row.getValue(id))
            }
        },
    ], [getAttachmentUrl, projectValues, vendorValues, navigate]);

    // Helper function to export data to CSV
    const exportToCsv = (
        filename: string,
        data: InvoiceItem[],
        columns: ColumnDef<InvoiceItem, any>[],
        projectLookup: { label: string; value: string; }[],
        vendorLookup: { label: string; value: string; }[]
    ) => {
        if (!data || data.length === 0) {
            console.warn("No data to export.");
            return;
        }

        // Define a mapping from accessorKey to user-friendly header for CSV
        const headersMap: { [key: string]: string } = {
            "date": "Invoice Date",
            "invoice_no": "Invoice No",
            "amount": "Amount",
            "updated_by": "Updated By",
            "procurement_order": "PO ID",
            "project": "Project",
            "vendor": "Vendor",
        };

        // Filter and map columns to CSV headers based on headersMap
        const csvHeaders = columns
            .filter(column => column.accessorKey && headersMap[column.accessorKey as string])
            .map(column => headersMap[column.accessorKey as string]);

        const csvRows = data.map(item => {
            return columns
                .filter(column => column.accessorKey && headersMap[column.accessorKey as string])
                .map(column => {
                    const accessor = column.accessorKey as keyof InvoiceItem;
                    let value: any = item[accessor];

                    // Apply formatting similar to how it's displayed in the table
                    if (accessor === "date") {
                        value = value ? formatDate(value.slice(0, 10)) : '';
                    } else if (accessor === "amount") {
                        // For CSV, we typically want just the number, without currency symbols or grouping commas
                        value = parseFloat(item.amount.toFixed(2)).toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                            useGrouping: false // Ensure no thousands separators
                        });
                    } else if (accessor === "project") {
                        const project = projectLookup.find((p) => p.value === value);
                        value = project?.label || value;
                    } else if (accessor === "vendor") {
                        const vendor = vendorLookup.find((v) => v.value === value);
                        value = vendor?.label || value;
                    }

                    // Enclose values in double quotes and escape existing double quotes
                    return `"${String(value || '').replace(/"/g, '""')}"`;
                })
                .join(','); // Join cells with a comma
        });

        // Combine headers and rows
        const csvContent = [csvHeaders.join(','), ...csvRows].join('\n');

        // Create a Blob and initiate download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        if (link.download !== undefined) { // Feature detection for download attribute
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    const handleExport = (filteredData:InvoiceItem[]) => {
        if (filteredData) {
            exportToCsv(
                "po_invoices.csv",
                // invoicesData.message.message.invoice_entries,
                filteredData,
                invoiceColumns,
                projectValues,
                vendorValues
            );
        }
    };

    const facetOptionsConfig = useMemo(() => ({
        project: { title: "Project", options: projectdata?.map(p => ({ label: p.project_name, value: p.name })) || [] },
        vendor: { title: "Vendor", options: vendors?.map(v => ({ label: v.vendor_name, value: v.name })) || [] } // Add vendor facet options
    }), [projectdata, vendors]);


    return (
        <div className="flex-1 space-y-4 p-4"> {/* Added padding for better spacing */}
            {/* <div className="flex justify-between items-center mb-4">
                <Button onClick={handleExport} disabled={invoicesDataLoading || attachmentsDataLoading || !invoicesData?.message?.message?.invoice_entries?.length}>
                    <Download className="mr-2 h-4 w-4" /> Export CSV
                </Button>
            </div> */}

            {invoicesDataLoading || attachmentsDataLoading ? (
                <TableSkeleton />
            ) : (
                <DataTable
                    columns={invoiceColumns}
                    data={invoicesData?.message?.message?.invoice_entries || []}
                    project_values={ projectValues } // Still passing for other DataTable functionalities
                    onExport={handleExport}
                    approvedQuotesVendors={ vendorValues } // Still passing for other DataTable functionalities
                />
            )}
        </div>
    );
};

export default PoInvoices;