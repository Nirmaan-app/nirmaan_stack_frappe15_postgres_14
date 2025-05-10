// import { DataTable } from "@/components/data-table/data-table";
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
// import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
// import { TableSkeleton } from "@/components/ui/skeleton";
// import SITEURL from "@/constants/siteURL";
// import { useOrderTotals } from "@/hooks/useOrderTotals";
// import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
// import { Projects } from "@/types/NirmaanStack/Projects";
// import { Vendors } from "@/types/NirmaanStack/Vendors";
// import { formatDate } from "@/utils/FormatDate";
// import formatToIndianRupee, {formatToRoundedIndianRupee} from "@/utils/FormatPrice";
// import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
// import { ColumnDef } from "@tanstack/react-table";
// import { Filter, FrappeConfig, FrappeContext, FrappeDoc, useFrappeGetDocList } from "frappe-react-sdk";
// import { Download, Info } from "lucide-react";
// import { useCallback, useContext, useMemo } from "react";
// import { useNavigate } from "react-router-dom";
// import { AmountPaidHoverCard } from "./AmountPaidHoverCard";

// export const AllPayments: React.FC<{ tab?: string, projectId?: string, customerId?: string }> = ({ tab = "Payments Pending", projectId, customerId }) => {

//   const projectFilters: Filter<FrappeDoc<Projects>>[] | undefined = useMemo(() =>
//     customerId ? [["customer", "=", customerId]] : [], [customerId])

//   const { data: projects, isLoading: projectsLoading } = useFrappeGetDocList<Projects>("Projects", {
//     fields: ["name", "project_name"],
//     filters: projectFilters,
//     limit: 1000,
//   }, customerId ? `Projects ${customerId}` : "Projects");

//   const paymentFilters: Filter<FrappeDoc<ProjectPayments>>[] | undefined = useMemo(() => [["status", "in", tab === "Payments Done" ? ["Paid"] : ["Requested", "Approved"]], ...(projectId ? [["project", "=", projectId]] : []), ...(customerId ? [["project", "in", projects?.map(i => i?.name)]] : [])], [projectId, customerId, tab])

//   const navigate = useNavigate()

//   const { data: projectPayments, isLoading: projectPaymentsLoading } = useFrappeGetDocList<ProjectPayments>("Project Payments", {
//     fields: ["*"],
//     filters: paymentFilters,
//     limit: 100000,
//     orderBy: { field: "payment_date", order: "desc" },
//   },
//     tab ? undefined : null
//   );

//   const { data: vendors, isLoading: vendorsLoading } = useFrappeGetDocList<Vendors>("Vendors", {
//     fields: ["name", "vendor_name", "vendor_mobile"],
//     limit: 10000,
//   }, 'Vendors');

//   const projectValues = useMemo(() => projects?.map((item) => ({
//     label: item.project_name,
//     value: item.name,
//   })) || [], [projects])

//   const vendorValues = useMemo(() => vendors?.map((item) => ({
//     label: item.vendor_name,
//     value: item.name,
//   })) || [], [vendors])

//   const { getTotalAmount } = useOrderTotals()

//   // const [phoneNumber, setPhoneNumber] = useState("");
//   // const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);

//   // const { toggleShareDialog, shareDialog } = useDialogStore();

//   // const handleOpenWhatsApp = () => {
//   //   if (phoneNumber) {
//   //     window.open(`https://wa.me/${phoneNumber}`, '_blank');
//   //   }
//   // };

//   // const handleShareClick = (data : ProjectPayments) => {
//   //   const vendorNumber = vendors?.find((i) => i?.name === data?.vendor)?.vendor_mobile || '';
//   //   setPhoneNumber(vendorNumber);
//   //   setScreenshotUrl(data?.payment_attachment || null); // Set screenshot URL
//   //   toggleShareDialog();
//   // };

//   const { notifications, mark_seen_notification } = useNotificationStore();

//   const { db } = useContext(FrappeContext) as FrappeConfig;

//   const handleSeenNotification = useCallback((notification: NotificationType | undefined) => {
//     if (notification) {
//       mark_seen_notification(db, notification)
//     }
//   }, [db, mark_seen_notification])

//   const columns: ColumnDef<ProjectPayments>[] = useMemo(
//     () => [
//       ...(tab === "Payments Done" ? [
//         {
//           accessorKey: "payment_date",
//           header: ({ column }) => {
//             return (
//               <DataTableColumnHeader column={column} title="Payment Date" />
//             )
//           },
//           cell: ({ row }) => {
//             const data = row.original
//             const isNew = notifications.find(
//               (item) => item.docname === data?.name && item.seen === "false" && item.event_id === "payment:fulfilled"
//             )
//             return <div onClick={() => handleSeenNotification(isNew)} className="font-medium flex items-center gap-2 relative">
//               {isNew && (
//                 <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
//               )}
//               {formatDate(data?.payment_date || data?.creation)}
//             </div>;
//           },
//         },
//       ] : []),
//       ...(tab === "Payments Pending" ? [
//         {
//           accessorKey: "creation",
//           header: ({ column }) => {
//             return (
//               <DataTableColumnHeader column={column} title="Date Created" />
//             )
//           },
//           cell: ({ row }) => {
//             const data = row.original
//             return <div className="font-medium flex items-center gap-2 relative">
//               {formatDate(data?.creation)}
//             </div>;
//           },
//         },
//       ] : []),
//       {
//         accessorKey: "document_name",
//         header: "#PO",
//         cell: ({ row }) => {
//           const data: ProjectPayments = row.original;
//           let id;
//           if (data?.document_type === "Procurement Orders") {
//             id = data?.document_name.replaceAll("/", "&=")
//           } else {
//             id = data?.document_name
//           }
//           return <div className="font-medium flex items-center gap-1 min-w-[170px]">
//             {data?.document_name}
//             <HoverCard>
//               <HoverCardTrigger>
//                 <Info onClick={() => navigate(`/project-payments/${id}`)} className="w-4 h-4 text-blue-600 cursor-pointer" />
//               </HoverCardTrigger>
//               <HoverCardContent>
//                 Click on to navigate to the PO screen!
//               </HoverCardContent>
//             </HoverCard>
//           </div>;
//         }
//       },
//       {
//         accessorKey: "vendor",
//         header: "Vendor",
//         cell: ({ row }) => {
//           const vendor = vendorValues.find(
//             (vendor) => vendor.value === row.getValue("vendor")
//           );
//           return <div className="font-medium items-baseline min-w-[170px]">
//             {vendor?.label || ""}
//             <HoverCard>
//               <HoverCardTrigger>
//                 <Info onClick={() => navigate(`/vendors/${vendor?.value}`)} className="w-4 h-4 text-blue-600 cursor-pointer inline-block ml-1" />
//               </HoverCardTrigger>
//               <HoverCardContent>
//                 Click on to navigate to the Vendor screen!
//               </HoverCardContent>
//             </HoverCard>
//           </div>;
//         },
//         filterFn: (row, id, value) => {
//           return value.includes(row.getValue(id))
//         }
//       },
//       ...(projectId ? [] : [
//         {
//           accessorKey: "project",
//           header: "Project",
//           cell: ({ row }) => {
//             const project = projectValues.find(
//               (project) => project.value === row.getValue("project")
//             );
//             return project ? <div className="font-medium">{project.label}</div> : null;
//           },
//           filterFn: (row, id, value) => {
//             return value.includes(row.getValue(id))
//           },
//         },
//       ]),
//       ...(tab === "Payments Pending" ? [
//         {
//           id: "status",
//           header: ({ column }) => {
//             return (
//               <DataTableColumnHeader column={column} title="Status" />
//             )
//           },
//           cell: ({ row }) => {
//             const data = row.original
//             return <div className="font-medium">{data?.status}</div>;
//           },
//         },
//       ] : []),
//       {
//         id: "po_amount_including_gst",
//         header: ({ column }) => {
//           return (
//             <DataTableColumnHeader column={column} title="PO Amt" />
//           )
//         },
//         cell: ({ row }) => {
//           return <div className="font-medium">
//             {formatToRoundedIndianRupee(getTotalAmount(row.original.document_name, row.original.document_type)?.totalWithTax)}
//           </div>
//         },
//       },
//       {
//         accessorKey: "amount",
//         header: ({ column }) => {
//           return (
//             <DataTableColumnHeader column={column} title={tab === "Payments Done" ? "Amount Paid" : "Amount To Pay"} />
//           )
//         },
//         cell: ({ row }) => {
//           return <div className="font-medium">
//             {tab === "Payments Done" ? <AmountPaidHoverCard paymentInfo={row.original} /> : formatToRoundedIndianRupee(row.original?.amount)}
//           </div>
//         },
//       },
//       // {
//       //   accessorKey: "status",
//       //   header: "Status",
//       //   cell: ({ row }) => {
//       //       return <div className="font-medium">{row.original?.status}</div>;
//       //   }
//       // },
//       ...(tab === "Payments Done" ? [
//         {
//           id: "download",
//           header: "Download",
//           cell: ({ row }) => {
//             const data = row.original
//             return (
//               data?.payment_attachment && (
//                 <a
//                   href={`${SITEURL}${data?.payment_attachment}`}
//                   target="_blank"
//                   rel="noreferrer"
//                 >
//                   <Download className="text-blue-500" />
//                 </a>
//               )
//             )
//           }
//         },

//       ] : []),
//     ],
//     [projectValues, vendorValues, projectPayments, tab, getTotalAmount, projectId]
//   );


//   return (
//     <div>
//       {projectsLoading || vendorsLoading || projectPaymentsLoading ? (
//         <TableSkeleton />
//       ) : (
//         <DataTable columns={columns} data={projectPayments || []} project_values={projectId ? undefined : projectValues} vendorData={vendors} approvedQuotesVendors={vendorValues} />
//       )}

//       {/* <Dialog open={shareDialog} onOpenChange={toggleShareDialog}>
//                         <DialogContent>
//                           <DialogHeader>
//                             <DialogTitle className="text-center">Share Payment Screenshot via WhatsApp</DialogTitle>
//                             <DialogDescription className="text-center">
//                               {screenshotUrl && (
//                                 <div className="flex items-center flex-col mb-4">
//                                   <img
//                                     src={import.meta.env.MODE === "development" ? `http://localhost:8000${screenshotUrl}` : `${SITEURL}${screenshotUrl}`}
//                                     alt="Payment Screenshot"
//                                     className="max-w-xs max-h-64 object-contain rounded-md shadow-md"
//                                   />
//                                   <p className="mt-2 text-sm text-gray-600 text-center">
//                                     To download, right-click on the image and select "Save Image As..."
//                                   </p>
//                                 </div>
//                               )}
//                               Download the Payment Screenshot and send it via WhatsApp to
//                               <div className="ml-4 flex items-center gap-2 my-2">
//                                 <Label>Mobile: </Label>
//                                 <Input
//                                   className=""
//                                   type="text"
//                                   value={phoneNumber}
//                                   onChange={(e) => setPhoneNumber(e.target.value)}
//                                   placeholder="Enter phone number"
//                                 />
//                               </div>
//                             </DialogDescription>
//                           </DialogHeader>
//                           <div className="flex justify-center space-x-4">
//                             <Button
//                               disabled={!phoneNumber}
//                               onClick={handleOpenWhatsApp}
//                               className="bg-green-600 hover:bg-green-700"
//                             >
//                               <CheckCheck className="h-4 w-4 mr-2" />
//                               Open WhatsApp
//                             </Button>
//                           </div>
//                         </DialogContent>
//                     </Dialog> */}
//     </div>

//   );
// }

// export default AllPayments;



import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ColumnDef } from "@tanstack/react-table";
import { FrappeConfig, FrappeContext, useFrappeGetDocList, useFrappeDocTypeEventListener, Filter, FrappeDoc } from "frappe-react-sdk";
import { Download, Info } from "lucide-react";
import { useToast } from "@/components/ui/use-toast"; // Assuming toast is used for errors
import memoize from 'lodash/memoize';

// --- UI Components ---
import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge"; // Assuming Badge might be used for status
import { Checkbox } from "@/components/ui/checkbox"; // For optional selection
import { TableSkeleton } from "@/components/ui/skeleton";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";

// --- Hooks & Utils ---
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { getTotalAmountPaid, getPOTotal } from "@/utils/getAmounts"; // getSRTotal can be added if needed
import { parseNumber } from "@/utils/parseNumber";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import SITEURL from "@/constants/siteURL"; // For download links

// --- Types ---
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { Projects } from "@/types/NirmaanStack/Projects";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { DOC_TYPES, PAYMENT_STATUS } from "./approve-payments/constants"; // Adjust path if needed
import { useUsersList } from "../ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { AmountPaidHoverCard } from "./AmountPaidHoverCard";

// --- Helper Components ---
// import { AmountPaidHoverCard } from "./AmountPaidHoverCard"; // If used

interface SelectOption { label: string; value: string; }

interface AllPaymentsProps {
    tab?: string; // "Payments Pending" or "Payments Done"
    projectId?: string;
    customerId?: string;
    // Additional prop to distinguish URL state contexts if this component is used multiple times
    // on the same page with different projectId/customerId props.
    contextKey?: string;
}

// --- Constants ---
const DOCTYPE = DOC_TYPES.PROJECT_PAYMENTS;

// --- Component ---
export const AllPayments: React.FC<AllPaymentsProps> = ({
    tab = "Payments Pending", // Default tab
    projectId,
    customerId,
    contextKey = "all" // Default context for URL key
}) => {
    const navigate = useNavigate();
    const { toast } = useToast();
    const { db } = useContext(FrappeContext) as FrappeConfig;

    // --- Dynamic URL Sync Key based on context and tab ---
    const urlSyncKey = useMemo(() =>
        `all_pay_${contextKey}_${tab.toLowerCase().replace(/\s+/g, '_')}`,
    [contextKey, tab]);


    // --- Supporting Data Fetches (for lookups, calculations, and initial filtering if customerId is present) ---
    const projectFiltersForLookup = useMemo(() =>
        customerId ? [["customer", "=", customerId]] : (projectId ? [["name", "=", projectId]] : []),
    [customerId, projectId]);

    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
        "Projects", { fields: ["name", "project_name"], filters: projectFiltersForLookup as Filter<FrappeDoc<Projects>>[], limit: 1000 },
        `Projects_AllPay_${customerId || projectId || 'all'}`
    );
    const { data: vendors, isLoading: vendorsLoading, error: vendorsError } = useFrappeGetDocList<Vendors>(
        "Vendors", { fields: ["name", "vendor_name"], limit: 10000 }, 'Vendors_AllPay'
    );
    // Fetch related POs and SRs for "PO Value" calculation
    const { data: purchaseOrders, isLoading: poLoading, error: poError } = useFrappeGetDocList<ProcurementOrder>(
        DOC_TYPES.PROCUREMENT_ORDERS, { fields: ["name", "order_list", "loading_charges", "freight_charges"], limit: 100000 }, 'POs_AllPay'
    );
    const { data: serviceOrders, isLoading: srLoading, error: srError } = useFrappeGetDocList<ServiceRequests>(
        DOC_TYPES.SERVICE_REQUESTS, { fields: ["name", "service_order_list", "gst"], limit: 10000 }, 'SRs_AllPay'
    );
    const { data: userList, isLoading: userListLoading, error: userError } = useUsersList();


    // --- Memoized Lookups & Calculations ---
    const projectOptions = useMemo<SelectOption[]>(() => projects?.map(p => ({ label: p.project_name, value: p.name })) || [], [projects]);
    const vendorOptions = useMemo<SelectOption[]>(() => vendors?.map(v => ({ label: v.vendor_name, value: v.name })) || [], [vendors]);
    const getVendorName = useCallback(memoize((vendorId?: string) => vendors?.find(v => v.name === vendorId)?.vendor_name || vendorId || "--"), [vendors]);

    const getDocumentTotal = useMemo(() => memoize((docName?: string, docType?: string): number => {
        if (!docName || !docType) return 0;
        if (docType === DOC_TYPES.PROCUREMENT_ORDERS) {
            const order = purchaseOrders?.find(po => po.name === docName);
            return order ? getPOTotal(order, parseNumber(order.loading_charges), parseNumber(order.freight_charges))?.totalAmt || 0 : 0;
        } else if (docType === DOC_TYPES.SERVICE_REQUESTS) {
            const order = serviceOrders?.find(sr => sr.name === docName);
            if (!order || !order.service_order_list?.list) return 0;
            const srTotal = order.service_order_list.list.reduce((acc, item) => acc + (parseNumber(item.rate) * parseNumber(item.quantity)), 0);
            return order.gst === "true" ? srTotal * 1.18 : srTotal;
        }
        return 0;
    }), [purchaseOrders, serviceOrders]);


    // --- Notification Handling ---
    const { notifications, mark_seen_notification } = useNotificationStore();
    const handleSeenNotification = useCallback((notification: NotificationType | undefined) => {
        if (notification && notification.seen === "false") mark_seen_notification(db, notification);
    }, [db, mark_seen_notification]);


    // --- Static Filters for `useServerDataTable` ---
    const staticFilters = useMemo(() => {
        const filters: Array<[string, string, any]> = [];
        if (tab === "Payments Done") {
            filters.push(["status", "=", PAYMENT_STATUS.PAID]);
        } else if (tab === "Payments Pending") {
            filters.push(["status", "in", [PAYMENT_STATUS.REQUESTED, PAYMENT_STATUS.APPROVED]]);
        }

        if (projectId) {
            filters.push(["project", "=", projectId]);
        } else if (customerId && projects && projects.length > 0) {
            filters.push(["project", "in", projects.map(p => p.name)]);
        } else if (customerId && !projectsLoading && (!projects || projects.length === 0)) {
            // If customerId is provided but no projects found for them, ensure no payments are fetched
            filters.push(["project", "in", ["__NON_EXISTENT_PROJECT__"]]);
        }
        return filters;
    }, [tab, projectId, customerId, projects, projectsLoading]);


    // --- Fields to Fetch for the Main DataTable ---
    const fieldsToFetch: (keyof ProjectPayments | 'name')[] = useMemo(() => [
        "name", "creation", "modified", "owner", "project", "vendor",
        "document_name", "document_type", "status", "amount", "payment_date",
        "utr", "tds", "payment_attachment" // For "Payments Done" tab
    ], []);

    // --- Global Search Fields ---
    const globalSearchFields = useMemo(() => [
        "name", "project", "vendor", "document_name", "document_type", "status", "utr", "owner"
    ], []);

    // --- Date Filter Columns ---
    const dateColumns = useMemo(() => ["creation", "modified", "payment_date"], []);


    // --- Column Definitions ---
    const columns = useMemo<ColumnDef<ProjectPayments>[]>(() => [
        {
            id: 'select',
            header: ({ table }) => (
                <Checkbox
                    disabled={true}
                    checked={table.getIsAllPageRowsSelected()}
                    onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                    aria-label="Select all rows"
                    className="data_table_select-all"
                />
            ),
            cell: ({ row }) => (
                <Checkbox
                    disabled={true}
                    checked={row.getIsSelected()}
                    onCheckedChange={(value) => row.toggleSelected(!!value)}
                    aria-label="Select row"
                    className="data_table_select-row"
                />
            ),
            enableSorting: false,
            enableHiding: false,
            size: 40,
        },
        { // Date column varies based on tab
            accessorKey: tab === "Payments Done" ? "payment_date" : "creation",
            header: ({ column }) => <DataTableColumnHeader column={column} title={tab === "Payments Done" ? "Paid On" : "Created On"} />,
            cell: ({ row }) => {
                const payment = row.original;
                const dateValue = tab === "Payments Done" ? payment.payment_date : payment.creation;
                const eventId = tab === "Payments Done" ? "payment:fulfilled" : null;
                const isNew = notifications.find(n => n.docname === payment.name && n.seen === "false" && n.event_id === eventId);
                return (
                    <div role="button" tabIndex={0} onClick={() => handleSeenNotification(isNew)} className="font-medium relative whitespace-nowrap">
                        {isNew && <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-5 animate-pulse" />}
                        {formatDate(dateValue || payment.creation)}
                    </div>
                );
            }, size: 150,
        },
        {
            accessorKey: "document_name", header: "#PO / #SR",
            cell: ({ row }) => { /* ... (Doc # link logic as before) ... */
                 const data = row.original;
                const docLink = data.document_name.replaceAll("/", "&=")
                 return (<div className="font-medium flex items-center gap-1.5 group min-w-[170px]">
                    <span className="max-w-[150px] truncate" title={data.document_name}>{data.document_name}</span>
                    <HoverCard><HoverCardTrigger asChild><Link to={`/project-payments/${docLink}`} target="_blank" rel="noopener noreferrer"><Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100"/></Link></HoverCardTrigger><HoverCardContent className="text-xs w-auto p-1.5">View linked {data.document_type === DOC_TYPES.PROCUREMENT_ORDERS ? "PO" : "SR"}</HoverCardContent></HoverCard>
                </div>);
            }, size: 200,
        },
        {
            accessorKey: "vendor", header: "Vendor",
            cell: ({ row }) => {
                const vendorName = getVendorName(row.original.vendor);
                    return (<div className="font-medium flex items-center gap-1.5 group min-w-[170px]">
                        <span className="max-w-[150px] truncate" title={vendorName}>{vendorName}</span>
                        <HoverCard><HoverCardTrigger asChild><Link to={`/vendors/${row.original.vendor}`} target="_blank" rel="noopener noreferrer"><Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100"/></Link></HoverCardTrigger><HoverCardContent className="text-xs w-auto p-1.5">View linked vendor</HoverCardContent></HoverCard>
                    </div>);
            },
            enableColumnFilter: true, size: 200,
        },
        ...(!projectId ? [{ // Conditionally show Project column
            accessorKey: "project", header: "Project",
            cell: ({ row }) => {
                const projectLabel = projects?.find(p => p.name === row.original.project)?.project_name;
                return <div className="font-medium truncate max-w-[150px]" title={projectLabel}>{projectLabel || row.original.project}</div>;
            },
            enableColumnFilter: true, size: 180,
        } as ColumnDef<ProjectPayments>] : []),
        {
            id: "doc_value_col", header: ({ column }) => <DataTableColumnHeader column={column} title="PO Value" />,
            cell: ({ row }) => <div className="font-medium pr-2">{formatToRoundedIndianRupee(getDocumentTotal(row.original.document_name, row.original.document_type))}</div>,
            size: 130, enableSorting: false,
        },
        { // Requested/Paid Amount
            accessorKey: "amount",
            header: ({ column }) => <DataTableColumnHeader column={column} title={tab === "Payments Done" ? "Amt. Paid" : "Amt. To Pay"} />,
            cell: ({ row }) => {
                const payment = row.original;
                const displayAmount = parseNumber(payment.amount);
                return tab === "Payments Done" ? <AmountPaidHoverCard paymentInfo={payment} /> : <div className="font-medium pr-2">{formatToRoundedIndianRupee(displayAmount)}</div>;
            },
            size: 130,
        },
        ...(tab === "Payments Done" ? [ // Columns only for "Payments Done"
            {
                accessorKey: "utr", header: "UTR",
                cell: ({ row }) => ( row.original.payment_attachment ? (<a href={SITEURL + row.original.payment_attachment} target="_blank" rel="noreferrer" className="font-medium text-blue-600 underline">{row.original.utr || "View Proof"}</a>) : <div className="font-medium">{row.original.utr || '--'}</div> ),
                size: 150,
            },
            // {
            //     accessorKey: "tds", header: ({ column }) => <DataTableColumnHeader column={column} title="TDS" />,
            //     cell: ({ row }) => <div className="font-medium pr-2">{row.original.tds ? formatToRoundedIndianRupee(parseNumber(row.original.tds)) : "--"}</div>,
            //     size: 100,
            // },
            {
                id: "download_action", header: "Proof",
                cell: ({ row }) => row.original.payment_attachment ? (<a href={SITEURL + row.original.payment_attachment} target="_blank" rel="noreferrer"><Download className="h-4 w-4 text-blue-500" /></a>) : null,
                size: 80,
            }
        ] as ColumnDef<ProjectPayments>[] : []),
        ...(tab === "Payments Pending" ? [{
            accessorKey: "status", header: "Status",
            cell: ({row}) => <Badge variant={row.original.status === PAYMENT_STATUS.APPROVED ? "default" : "outline"}>{row.original.status}</Badge>,
            enableColumnFilter: true, size: 120
        } as ColumnDef<ProjectPayments>] : []),
    ], [tab, projectId, notifications, projectOptions, vendorOptions, userList, getVendorName, getDocumentTotal, handleSeenNotification]);

    // --- Faceted Filter Options ---
    const facetFilterOptions = useMemo(() => {
        const opts: any = {
            vendor: { title: "Vendor", options: vendorOptions },
        };
        if (!projectId) { // Only show project facet if not already filtered by a specific project
            opts.project = { title: "Project", options: projectOptions };
        }
        if (tab === "Payments Pending") {
            opts.status = { title: "Status", options: [{value: PAYMENT_STATUS.REQUESTED, label: "Requested"}, {value: PAYMENT_STATUS.APPROVED, label: "Approved"}] };
        }
        return opts;
    }, [projectOptions, vendorOptions, projectId, tab]);


    // --- useServerDataTable Hook Instantiation ---
    const {
        table, data, totalCount, isLoading: listIsLoading, error: listError,
        globalFilter, setGlobalFilter,
        isItemSearchEnabled, toggleItemSearch, showItemSearchToggle,
        refetch,
    } = useServerDataTable<ProjectPayments>({
        doctype: DOCTYPE,
        columns: columns,
        fetchFields: fieldsToFetch,
        globalSearchFieldList: globalSearchFields,
        enableItemSearch: false, // Item search not applicable
        urlSyncKey: urlSyncKey,
        defaultSort: tab === "Payments Done" ? 'payment_date desc' : 'creation desc',
        enableRowSelection: false, // No bulk actions currently
        additionalFilters: staticFilters,
    });

    // --- Realtime Update Handling ---
    useFrappeDocTypeEventListener(DOCTYPE, (event) => {
        console.log(`Realtime event for ${DOCTYPE} (AllPayments - tab: ${tab}):`, event);
        refetch();
        toast({ title: "Payments list updated.", duration: 2000 });
        // const relevantStatuses = tab === "Payments Done" ? [PAYMENT_STATUS.PAID] : [PAYMENT_STATUS.REQUESTED, PAYMENT_STATUS.APPROVED];
        // if (event.doc && relevantStatuses.includes(event.doc.status)) {
        //     refetch();
        //     toast({ title: "Payments list updated.", duration: 2000 });
        // } else if (event.doctype === DOCTYPE && !event.doc?.status) {
        //      refetch(); // For deletes
        // }
    });

    // --- Combined Loading & Error States ---
    const isLoadingOverall = projectsLoading || vendorsLoading || userListLoading || poLoading || srLoading;
    const combinedErrorOverall = projectsError || vendorsError || poError || srError || listError;

    if (combinedErrorOverall && !data?.length) {
        toast({ title: "Error loading data", description: combinedErrorOverall.message, variant: "destructive" });
    }


    return (
        <div className="flex-1 space-y-4">

            {isLoadingOverall && !data?.length ? (
                <TableSkeleton />
            ) : (
                <DataTable<ProjectPayments>
                    table={table}
                    columns={columns}
                    isLoading={listIsLoading}
                    error={listError}
                    totalCount={totalCount}
                    globalFilterValue={globalFilter}
                    onGlobalFilterChange={setGlobalFilter}
                    searchPlaceholder={`Search ${tab}...`}
                    showItemSearchToggle={showItemSearchToggle} // Will be false
                    itemSearchConfig={{ isEnabled: isItemSearchEnabled, toggle: toggleItemSearch, label: "Item Search"}}
                    facetFilterOptions={facetFilterOptions}
                    dateFilterColumns={dateColumns}
                />
            )}
        </div>
    );
};

export default AllPayments;