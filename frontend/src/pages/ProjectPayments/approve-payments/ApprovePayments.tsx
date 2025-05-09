// import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
// import { Link, useNavigate } from "react-router-dom";
// import { ColumnDef } from "@tanstack/react-table"; // Keep ColumnDef
// import {
//     FrappeConfig,
//     FrappeContext,
//     useFrappeDocTypeEventListener,
//     useFrappeGetDocList,
//     useFrappeUpdateDoc
// } from "frappe-react-sdk";
// import { CircleCheck, CircleX, Info, SquarePen } from "lucide-react";

// // UI Components
// import { DataTable } from "@/components/data-table/data-table";
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
// import { Button } from "@/components/ui/button"; // Keep Button if needed elsewhere
// import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
// import { TableSkeleton } from "@/components/ui/skeleton";
// import { useToast } from "@/components/ui/use-toast";

// // Dialog Component
// import { PaymentActionDialog } from "./components/PaymentActionDialog"; // Adjust path

// // Types and Constants
// import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
// import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
// import { Projects } from "@/types/NirmaanStack/Projects";
// import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
// import { Vendors } from "@/types/NirmaanStack/Vendors";
// import { DOC_TYPES, PAYMENT_STATUS, DIALOG_ACTION_TYPES, DialogActionType } from './constants'; // Adjust path


// import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
// import { getPOTotal, getSRTotal, getTotalAmountPaid } from "@/utils/getAmounts";
// import { parseNumber } from "@/utils/parseNumber";

// // Zustand Store
// import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
// import { formatDate } from "date-fns";
// import { memoize } from "lodash";

// // Helper Type for simplified value/label pairs
// interface SelectOption {
//     label: string;
//     value: string;
// }

// export const ApprovePayments: React.FC = () => {
//     const navigate = useNavigate();
//     const { toast } = useToast();
//     const { db } = useContext(FrappeContext) as FrappeConfig; // Assume db is always available

//     // --- State ---
//     const [selectedPayment, setSelectedPayment] = useState<ProjectPayments | null>(null);
//     const [dialogActionType, setDialogActionType] = useState<DialogActionType>(DIALOG_ACTION_TYPES.APPROVE);
//     const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);

//     // --- Data Fetching ---
//     const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
//         DOC_TYPES.PROJECTS, { fields: ["name", "project_name"], limit: 1000 }, 'Projects'
//     );
//     const { data: vendors, isLoading: vendorsLoading, error: vendorsError } = useFrappeGetDocList<Vendors>(
//         DOC_TYPES.VENDORS, { fields: ["name", "vendor_name"], limit: 10000 }, 'Vendors'
//     );
//     // Fetch BOTH Requested and Paid payments (or remove filter entirely if safe)
//     const { data: allProjectPayments, isLoading: projectPaymentsLoading, error: projectPaymentsError, mutate: projectPaymentsMutate } = useFrappeGetDocList<ProjectPayments>(
//         DOC_TYPES.PROJECT_PAYMENTS, {
//         fields: ["*"], // Still consider specifying fields: name, status, amount, document_name, document_type
//         // Option A: Filter for relevant statuses
//         filters: [["status", "in", [PAYMENT_STATUS.REQUESTED, PAYMENT_STATUS.PAID]]],
//         // Option B: No status filter (if other statuses are few or also needed)
//         // filters: [],
//         limit: 100000, // Keep being mindful of this limit
//         orderBy: { field: "creation", order: "desc" }
//     },
//         // Add a unique query key suffix if needed, though often not necessary if filters change
//         // 'ProjectPayments_AllRelevant'
//     );
//     const { data: purchaseOrders, isLoading: poLoading, error: poError } = useFrappeGetDocList<ProcurementOrder>(
//         DOC_TYPES.PROCUREMENT_ORDERS, {
//         fields: ["*"], // Specify fields needed for getPOTotal and navigation logic
//         filters: [["status", "not in", ["Cancelled", "Merged"]]],
//         limit: 100000,
//         orderBy: { field: "modified", order: "desc" },
//     });
//     const { data: serviceOrders, isLoading: srLoading, error: srError } = useFrappeGetDocList<ServiceRequests>(
//         DOC_TYPES.SERVICE_REQUESTS, {
//         fields: ["*"], // Specify fields needed for getSRTotal and navigation logic
//         filters: [["status", "=", "Approved"]], // Assuming only approved SRs have payments
//         limit: 10000,
//         orderBy: { field: "modified", order: "desc" },
//     });

//     // --- Combined Loading and Error State ---
//     const isLoading = projectsLoading || vendorsLoading || projectPaymentsLoading || poLoading || srLoading;
//     const combinedError = projectsError || vendorsError || projectPaymentsError || poError || srError;

//     // Display errors via toast (could be enhanced with a dedicated error component)
//     useEffect(() => {
//         if (projectsError) toast({ title: "Error loading Projects", description: projectsError.message, variant: "destructive" });
//         if (vendorsError) toast({ title: "Error loading Vendors", description: vendorsError.message, variant: "destructive" });
//         if (projectPaymentsError) toast({ title: "Error loading Payments", description: projectPaymentsError.message, variant: "destructive" });
//         if (poError) toast({ title: "Error loading Purchase Orders", description: poError.message, variant: "destructive" });
//         if (srError) toast({ title: "Error loading Service Requests", description: srError.message, variant: "destructive" });
//     }, [projectsError, vendorsError, projectPaymentsError, poError, srError, toast]);


//     // --- Document Event Listener ---
//     useFrappeDocTypeEventListener(DOC_TYPES.PROJECT_PAYMENTS, async (d) => {
//         console.log("Project Payment Event:", d); // Log for debugging
//         await projectPaymentsMutate();
//     });

//     // --- Zustand Store Integration ---
//     const { notifications, mark_seen_notification } = useNotificationStore();

//     // --- Memoized Lookups ---
//     const projectValues = useMemo<SelectOption[]>(() => projects?.map(p => ({ label: p.project_name, value: p.name })) || [], [projects]);
//     const vendorValues = useMemo<SelectOption[]>(() => vendors?.map(v => ({ label: v.vendor_name, value: v.name })) || [], [vendors]);

//     // Filtered list for the DataTable display
//     const requestedPaymentsForTable = useMemo(() => {
//         return allProjectPayments?.filter(p => p.status === PAYMENT_STATUS.REQUESTED) || [];
//     }, [allProjectPayments]);

//     // --- Calculation for "Amt Paid" ---
//     // This needs to operate on the FULL list containing "Paid" entries
//     const getAmountPaid = useMemo(() => memoize((documentName: string) => {
//         const paymentsForDocument = allProjectPayments?.filter(
//             (payment) => payment?.document_name === documentName && payment?.status === PAYMENT_STATUS.PAID
//         ) || [];
//         return getTotalAmountPaid(paymentsForDocument);
//         // Depend on the full list
//     }, (documentName: string) => documentName), [allProjectPayments]);


//     // --- Callbacks ---
//     const handleNewPRSeen = useCallback((notification: NotificationType | undefined) => {
//         if (notification) {
//             mark_seen_notification(db, notification);
//         }
//     }, [db, mark_seen_notification]);

//     const openDialog = useCallback((payment: ProjectPayments, type: DialogActionType) => {
//         setSelectedPayment(payment);
//         setDialogActionType(type);
//         setIsDialogOpen(true);
//     }, []);

//     const closeDialog = useCallback(() => {
//         setIsDialogOpen(false);
//         // Optional: Delay clearing selectedPayment slightly for smoother transition
//         // setTimeout(() => setSelectedPayment(null), 150);
//         setSelectedPayment(null);
//     }, []);

//     // --- Update Logic ---
//     const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();

//     const handlePaymentUpdate = useCallback(async (actionType: DialogActionType, amount: number) => {
//         if (!selectedPayment) return;

//         const newStatus = (actionType === DIALOG_ACTION_TYPES.APPROVE || actionType === DIALOG_ACTION_TYPES.EDIT)
//             ? PAYMENT_STATUS.APPROVED
//             : PAYMENT_STATUS.REJECTED;

//         try {
//             await updateDoc(DOC_TYPES.PROJECT_PAYMENTS, selectedPayment.name, {
//                 status: newStatus,
//                 amount: amount // Amount is already parsed correctly before passing here
//             });

//             await projectPaymentsMutate(); // Refresh list
//             closeDialog(); // Close dialog on success

//             const successActionText = actionType === DIALOG_ACTION_TYPES.EDIT ? "edited and approved" : actionType;
//             toast({
//                 title: "Success!",
//                 description: `Payment ${successActionText} successfully!`,
//                 variant: "success",
//             });

//         } catch (error: any) {
//             console.error("Failed to update payment:", error);
//             toast({
//                 title: "Update Failed!",
//                 description: error.message || "Could not update the payment status.",
//                 variant: "destructive",
//             });
//             // Keep dialog open on error? Decide based on UX preference.
//             // closeDialog();
//         }
//     }, [selectedPayment, updateDoc, projectPaymentsMutate, closeDialog, toast]);


//     // --- Column Definitions (Passed through as requested) ---
//     const columns = useMemo<ColumnDef<ProjectPayments>[]>(
//         () => [
//             {
//                 accessorKey: "document_name",
//                 header: "#PO / #SR", // Clarify header
//                 cell: ({ row }) => {
//                     const data = row.original;
//                     const paymentId = data.name;
//                     const isNew = notifications.find(
//                         (item) => item.docname === paymentId && item.seen === "false" && item.event_id === "payment:new"
//                     ); // Check boolean false

//                     // const handleNavigate = () => {
//                     //     if (!data.document_name) return;
//                     //     if (data.document_type === DOC_TYPES.PROCUREMENT_ORDERS) {
//                     //         const po = purchaseOrders?.find(i => i.name === data.document_name);
//                     //         // Simplified tab logic (example, adjust as needed)
//                     //         const tabMap: { [key: string]: string } = {
//                     //             "PO Approved": "Approved PO",
//                     //             "Dispatched": "Dispatched PO",
//                     //             "Delivered": "Delivered PO"
//                     //         };
//                     //         const tab = po?.status ? tabMap[po.status] || "Approved PO" : "Approved PO";
//                     //         navigate(`/purchase-orders/${data.document_name.replaceAll("/", "&=")}?tab=${tab}`);
//                     //     } else if (data.document_type === DOC_TYPES.SERVICE_REQUESTS) {
//                     //         navigate(`/service-requests/${data.document_name}?tab=approved-sr`);
//                     //     }
//                     // }

//                     return (
//                         <div onClick={() => handleNewPRSeen(isNew)} className="font-medium relative flex items-center gap-1.5 min-w-[170px] cursor-default group">
//                             {isNew && (
//                                 <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-5 animate-pulse" title="New Payment Request" />
//                             )}
//                             <span className="max-w-[150px]">{data.document_name}</span>
//                             <HoverCard>
//                                 <HoverCardTrigger asChild>
//                                     <Link to={data.document_type === DOC_TYPES.PROCUREMENT_ORDERS ? `${data.document_name.replaceAll("/", "&=")}` : `${data.document_name.replaceAll("/", "&=")}`} >
//                                         <Info
//                                             className="w-4 h-4 text-blue-600 cursor-pointer flex-shrink-0 opacity-70 group-hover:opacity-100 transition-opacity"
//                                         />
//                                     </Link>
//                                 </HoverCardTrigger>
//                                 <HoverCardContent className="text-xs w-auto p-2">
//                                     View linked {data.document_type === DOC_TYPES.PROCUREMENT_ORDERS ? "PO" : "SR"} details
//                                 </HoverCardContent>
//                             </HoverCard>
//                         </div>
//                     );
//                 }
//             },
//             // {
//             //     accessorKey: "creation", // or payment_date if preferred
//             //     header: ({ column }) => <DataTableColumnHeader column={column} title="Date Req." />,
//             //     cell: ({ row }) => {
//             //         const dateValue = row.original.creation || row.original.payment_date;
//             //         return <div className="font-medium min-w-[90px]">{formatDate(new Date(dateValue!), 'dd-MMM-yyyy')}</div>;
//             //     },
//             // },
//             {
//                 accessorKey: "vendor",
//                 header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
//                 cell: ({ row }) => {
//                     const vendor = vendorValues.find(v => v.value === row.getValue("vendor"));
//                     return <div className="font-medium truncate max-w-[150px]">{vendor?.label || row.getValue("vendor")}</div>;
//                 },
//                 filterFn: (row, id, value) => value.includes(row.getValue(id)),
//             },
//             {
//                 accessorKey: "project",
//                 header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
//                 cell: ({ row }) => {
//                     const project = projectValues.find(p => p.value === row.getValue("project"));
//                     return <div className="font-medium truncate max-w-[150px]">{project?.label || row.getValue("project")}</div>;
//                 },
//                 filterFn: (row, id, value) => value.includes(row.getValue(id)),
//             },
//             {
//                 id: "po_value", // Renamed ID for clarity
//                 header: ({ column }) => <DataTableColumnHeader column={column} title="PO Value" />,
//                 cell: ({ row }) => {
//                     const data = row.original;
//                     let totalValue: number | null = null;

//                     if (data.document_type === DOC_TYPES.SERVICE_REQUESTS) {
//                         const order = serviceOrders?.find(i => i.name === data.document_name);
//                         if (order) {
//                             const srTotal = getSRTotal(order); // Assume getSRTotal returns number
//                             totalValue = order.gst === "true" ? srTotal * 1.18 : srTotal;
//                         }
//                     } else if (data.document_type === DOC_TYPES.PROCUREMENT_ORDERS) {
//                         const order = purchaseOrders?.find(i => i.name === data.document_name);
//                         if (order) {
//                             // Ensure charges are numbers before passing
//                             const loading = parseNumber(order.loading_charges);
//                             const freight = parseNumber(order.freight_charges);
//                             totalValue = getPOTotal(order, loading, freight)?.totalAmt ?? null;
//                         }
//                     }

//                     return <div className="font-medium min-w-[100px]">{totalValue !== null ? formatToRoundedIndianRupee(totalValue) : "N/A"}</div>;
//                 },
//             },
//             {
//                 id: "Amount_paid",
//                 header: "Amt Paid",
//                 cell: ({ row }) => {
//                     const data = row.original;
//                     // IMPORTANT: Use document_name (PO/SR ID) for the calculation
//                     const amountPaid = getAmountPaid(data?.document_name);
//                     // Decide what setCurrentPaymentsDialog should do. Does it show the details
//                     // of the *request* (data) or the *past paid* amounts?
//                     // If it's for past paid amounts, you'll need a different function/state.
//                     // const handleClick = () => {
//                     //     if (amountPaid > 0) {
//                     //         // TODO: Implement logic to show details of PAST paid payments
//                     //         // for data.document_name. This might involve fetching them again
//                     //         // or filtering `allProjectPayments`.
//                     //         console.log("Show paid history for:", data.document_name);
//                     //         // Example: Find paid payments and open a different dialog/modal
//                     //         const paidHistory = allProjectPayments?.filter(p => p.document_name === data.document_name && p.status === PAYMENT_STATUS.PAID);
//                     //         // openPaidHistoryDialog(paidHistory); // A hypothetical function
//                     //     }
//                     // };
//                     return (
//                         <div
//                             className={`font-medium min-w-[100px]}`}
//                         >
//                             {formatToRoundedIndianRupee(amountPaid || 0)} {/* Default to 0 if null/undefined */}
//                         </div>
//                     );
//                 },
//             },
//             {
//                 accessorKey: "amount",
//                 header: ({ column }) => <DataTableColumnHeader column={column} title="Req. Amt" />, // Shortened
//                 cell: ({ row }) => {
//                     const amount = parseNumber(row.getValue("amount"))
//                     return <div className="font-medium min-w-[100px]">{formatToRoundedIndianRupee(amount)}</div>;
//                 },
//             },
//             {
//                 id: "actions", // Combined actions
//                 header: "Actions",
//                 cell: ({ row }) => {
//                     const data = row.original;
//                     return (
//                         <div className="flex items-center gap-3 min-w-[100px]">
//                             <HoverCard>
//                                 <HoverCardTrigger asChild>
//                                     <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600 hover:text-green-700" onClick={() => openDialog(data, DIALOG_ACTION_TYPES.APPROVE)}>
//                                         <CircleCheck className="h-5 w-5" />
//                                     </Button>
//                                 </HoverCardTrigger>
//                                 <HoverCardContent className="text-xs w-auto p-1.5">Approve</HoverCardContent>
//                             </HoverCard>
//                             <HoverCard>
//                                 <HoverCardTrigger asChild>
//                                     <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:text-red-700" onClick={() => openDialog(data, DIALOG_ACTION_TYPES.REJECT)}>
//                                         <CircleX className="h-5 w-5" />
//                                     </Button>
//                                 </HoverCardTrigger>
//                                 <HoverCardContent className="text-xs w-auto p-1.5">Reject</HoverCardContent>
//                             </HoverCard>
//                             <HoverCard>
//                                 <HoverCardTrigger asChild>
//                                     <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:text-blue-700" onClick={() => openDialog(data, DIALOG_ACTION_TYPES.EDIT)}>
//                                         <SquarePen className="h-4 w-4" />
//                                     </Button>
//                                 </HoverCardTrigger>
//                                 <HoverCardContent className="text-xs w-auto p-1.5">Edit & Approve</HoverCardContent>
//                             </HoverCard>
//                         </div>
//                     );
//                 },
//             },
//             // Removed separate editOption column as it's combined into 'actions'
//         ],
//         // Ensure all *stable* dependencies used inside columns are listed
//         [
//             // Dependencies updated
//             projectValues, vendorValues, notifications, purchaseOrders, serviceOrders, handleNewPRSeen, navigate, openDialog, getAmountPaid, allProjectPayments /* Add dependency */
//         ]
//     );


//     // --- Render Logic ---
//     if (isLoading) {
//         return <div className="p-4"><TableSkeleton /></div>;
//     }

//     // Optional: Display a more specific error message if needed
//     if (combinedError && !allProjectPayments) {
//         return <div className="p-4 text-red-600">Failed to load essential payment data. Please try again later.</div>;
//     }

//     return (
//         <div className="flex-1 space-y-4">
//             {/* Dialog Component */}
//             <PaymentActionDialog
//                 isOpen={isDialogOpen}
//                 onOpenChange={setIsDialogOpen} // Let dialog handle its own close via cancel/overlay
//                 type={dialogActionType}
//                 paymentData={selectedPayment}
//                 vendorName={selectedPayment ? vendorValues.find(v => v.value === selectedPayment.vendor)?.label : undefined}
//                 onSubmit={handlePaymentUpdate}
//                 isLoading={updateLoading}
//             />

//             {/* Data Table */}
//             <DataTable
//                 columns={columns}
//                 data={requestedPaymentsForTable || []} // Provide empty array fallback
//                 project_values={projectValues} // Pass lookup data if needed by DataTable (e.g., for filters)
//                 approvedQuotesVendors={vendorValues} // Pass lookup data if needed by DataTable
//             // Add other necessary props to DataTable
//             />
//         </div>
//     );
// };

// export default ApprovePayments;




import React, { useCallback, useContext, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ColumnDef } from "@tanstack/react-table";
import { FrappeConfig, FrappeContext, useFrappeGetDocList, useFrappeUpdateDoc, useFrappeDocTypeEventListener, FrappeDoc, GetDocListArgs } from "frappe-react-sdk";
import { CircleCheck, CircleX, Info, SquarePen } from "lucide-react";

// --- UI Components ---
import { DataTable } from '@/components/data-table/new-data-table'; // Use NEW DataTable
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { Checkbox } from "@/components/ui/checkbox"; // For selection column

// --- Dialog Component ---
import { PaymentActionDialog } from "./components/PaymentActionDialog";

// --- Types and Constants ---
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { DOC_TYPES, PAYMENT_STATUS, DIALOG_ACTION_TYPES, DialogActionType } from './constants';


// --- Hooks & Utils ---
import { useServerDataTable } from '@/hooks/useServerDataTable'; // NEW Hook
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { getPOTotal, getSRTotal, getTotalAmountPaid } from "@/utils/getAmounts";
import { parseNumber } from "@/utils/parseNumber";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import { formatDate } from "@/utils/FormatDate"; // Use your formatDate
import { memoize } from "lodash";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { useVendorsList } from "@/pages/ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";


// --- Constants ---
const DOCTYPE = DOC_TYPES.PROJECT_PAYMENTS;
const URL_SYNC_KEY = 'approve_pay'; // Unique key for this table instance

interface SelectOption { label: string; value: string; }

// --- Component ---
export const ApprovePayments: React.FC = () => {
    const { toast } = useToast();
    const { db } = useContext(FrappeContext) as FrappeConfig;

    // --- State for Dialogs ---
    const [selectedPayment, setSelectedPayment] = useState<ProjectPayments | null>(null);
    const [dialogActionType, setDialogActionType] = useState<DialogActionType>(DIALOG_ACTION_TYPES.APPROVE);
    const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);

    // --- Supporting Data Fetches (Keep these for lookups/calculations) ---
    const projectsFetchOptions = getProjectListOptions();
        
    // --- Generate Query Keys ---
    const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);

    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
        DOC_TYPES.PROJECTS, projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>, projectQueryKey
    );
    const { data: vendors, isLoading: vendorsLoading, error: vendorsError } = useVendorsList({vendorTypes: ["Service", "Material", "Material & Service"]});
    const { data: userList, isLoading: userListLoading, error: userError } = useUsersList();

    const { data: purchaseOrders, isLoading: poLoading, error: poError } = useFrappeGetDocList<ProcurementOrder>(
        DOC_TYPES.PROCUREMENT_ORDERS, { fields: ["name", "status", "order_list", "loading_charges", "freight_charges"], limit: 100000 }, 'POs_ApprovePay'
    );
    const { data: serviceOrders, isLoading: srLoading, error: srError } = useFrappeGetDocList<ServiceRequests>(
        DOC_TYPES.SERVICE_REQUESTS, { fields: ["name", "status", "service_order_list", "gst"], filters: [["status", "in", ["Approved", "Amendment"]]], limit: 10000 }, 'SRs_ApprovePay'
    );
    // For "Amt Paid" - fetch all paid payments for relevant documents
    const { data: allPaidPayments, isLoading: paidPaymentsLoading, error: paidPaymentsError } = useFrappeGetDocList<ProjectPayments>(
        DOC_TYPES.PROJECT_PAYMENTS, {
            fields: ["name", "document_name", "amount"],
            filters: [["status", "=", PAYMENT_STATUS.PAID]],
            limit: 100000
        }, 'AllPaidPayments_ApprovePay'
    );


    // --- Zustand Store & Memoized Lookups ---
    const { notifications, mark_seen_notification } = useNotificationStore();
    const projectOptions = useMemo<SelectOption[]>(() => projects?.map(p => ({ label: p.project_name, value: p.name })) || [], [projects]);
    const vendorOptions = useMemo<SelectOption[]>(() => vendors?.map(v => ({ label: v.vendor_name, value: v.name })) || [], [vendors]);

    const getAmountPaid = useMemo(() => {
        if (!allPaidPayments) return () => 0;
        const paymentsMap = new Map<string, number>();
        allPaidPayments.forEach(p => {
            if (p.document_name) {
                paymentsMap.set(p.document_name, (paymentsMap.get(p.document_name) || 0) + parseNumber(p.amount));
            }
        });
        return memoize((documentName: string) => paymentsMap.get(documentName) || 0);
    }, [allPaidPayments]);

    const getDocumentTotal = useMemo(() => memoize((docName: string, docType: string) => {
        if (docType === DOC_TYPES.PROCUREMENT_ORDERS) {
            const order = purchaseOrders?.find(po => po.name === docName);
            return order ? getPOTotal(order, parseNumber(order.loading_charges), parseNumber(order.freight_charges))?.totalAmt : 0;
        } else if (docType === DOC_TYPES.SERVICE_REQUESTS) {
            const order = serviceOrders?.find(sr => sr.name === docName);
            if (!order || !order.service_order_list?.list) return 0;
            
            const srTotal = order.service_order_list.list.reduce((acc, item) => acc + (parseNumber(item.rate) * parseNumber(item.quantity)), 0);
            return order.gst === "true" ? srTotal * 1.18 : srTotal;
        }
        return 0;
    }), [purchaseOrders, serviceOrders]);


    // --- Callbacks ---
    const handleNewPaymentSeen = useCallback((notification: NotificationType | undefined) => {
        if (notification && notification.seen === "false") {
            mark_seen_notification(db, notification);
        }
    }, [db, mark_seen_notification]);

    const openDialog = useCallback((payment: ProjectPayments, type: DialogActionType) => {
        setSelectedPayment(payment);
        setDialogActionType(type);
        setIsDialogOpen(true);
    }, []);

    const closeDialog = useCallback(() => setIsDialogOpen(false), []);

    // --- Static Filters for This View ---
    const staticFilters = useMemo(() => [
        ["status", "=", PAYMENT_STATUS.REQUESTED] // Only show payments with status "Requested"
    ], []);

    // --- Fields to Fetch for the Main DataTable ---
    const fieldsToFetch: (keyof ProjectPayments | 'name')[] = useMemo(() => [
        "name", "creation", "modified", "owner", "project", "vendor",
        "document_name", "document_type", "status", "amount", "payment_date" // Add payment_date if needed
    ], []);

    // --- Global Search Fields ---
    const globalSearchFields = useMemo(() => [
        "name", "project", "vendor", "document_name", "document_type", "status", "owner"
    ], []);

    // --- Date Filter Columns ---
    const dateColumns = useMemo(() => ["creation", "modified", "payment_date"], []);


    // --- Column Definitions ---
    const columns = useMemo<ColumnDef<ProjectPayments>[]>(() => [
        {
            id: 'select',
            header: ({ table }) => (
                <Checkbox
                    checked={table.getIsAllPageRowsSelected()}
                    onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                    aria-label="Select all rows"
                    className="data_table_select-all"
                />
            ),
            cell: ({ row }) => (
                <Checkbox
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
        {
            accessorKey: "document_name", header: ({ column }) => <DataTableColumnHeader column={column} title="#PO / #SR" />,
            cell: ({ row }) => {
                const payment = row.original;
                const isNew = notifications.find(n => n.docname === payment.name && n.seen === "false" && n.event_id === "payment:new");
                const docLink = payment.document_name?.replaceAll("/", "&=");
                return (
                    <div role="button" tabIndex={0} onClick={() => handleNewPaymentSeen(isNew)} className="font-medium relative flex items-center gap-1.5 group">
                        {isNew && <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 animate-pulse" title="New Payment Request" />}
                        <span className="max-w-[150px] truncate" title={payment.document_name}>{payment.document_name}</span>
                        <HoverCard>
                            <HoverCardTrigger asChild>
                                <Link to={docLink} target="_blank" rel="noopener noreferrer">
                                    <Info className="w-4 h-4 text-blue-600 cursor-pointer flex-shrink-0 opacity-70 group-hover:opacity-100" />
                                </Link>
                            </HoverCardTrigger>
                            <HoverCardContent className="text-xs w-auto p-1.5">View linked {payment.document_type === DOC_TYPES.PROCUREMENT_ORDERS ? "PO" : "SR"}</HoverCardContent>
                        </HoverCard>
                    </div>
                );
            }, size: 200,
        },
        {
            accessorKey: "creation", header: ({ column }) => <DataTableColumnHeader column={column} title="Req. On" />,
            cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.getValue("creation"))}</div>,
            size: 150,
        },
        {
            accessorKey: "vendor", header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
            cell: ({ row }) => {
                const vendor = vendorOptions.find(v => v.value === row.original.vendor);
                return <div className="font-medium truncate" title={vendor?.label}>{vendor?.label || row.original.vendor}</div>;
            },
            enableColumnFilter: true, size: 200,
        },
        {
            accessorKey: "project", header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
            cell: ({ row }) => {
                const project = projectOptions.find(p => p.value === row.original.project);
                return <div className="font-medium truncate" title={project?.label}>{project?.label || row.original.project}</div>;
            },
            enableColumnFilter: true, size: 200,
        },
        {
            id: "doc_value", header: ({ column }) => <DataTableColumnHeader column={column} title="Doc Value" />,
            cell: ({ row }) => {
                const totalValue = getDocumentTotal(row.original.document_name, row.original.document_type);
                return <div className="font-medium pr-2">{formatToRoundedIndianRupee(totalValue)}</div>;
            }, size: 150, enableSorting: false,
        },
        {
            id: "total_paid_for_doc", header: ({ column }) => <DataTableColumnHeader column={column} title="Total Paid" />,
            cell: ({ row }) => {
                const amountPaid = getAmountPaid(row.original.document_name);
                return <div className="font-medium pr-2">{formatToRoundedIndianRupee(amountPaid)}</div>;
            }, size: 150, enableSorting: false,
        },
        {
            accessorKey: "amount", header: ({ column }) => <DataTableColumnHeader column={column} title="Req. Amt" />,
            cell: ({ row }) => <div className="font-medium pr-2">{formatToRoundedIndianRupee(parseNumber(row.getValue("amount")))}</div>,
            size: 150,
        },
        {
            accessorKey: "owner", header: ({ column }) => <DataTableColumnHeader column={column} title="Requested By" />,
            cell: ({ row }) => {
                const ownerUser = userList?.find((user) => user.name === row.original.owner);
                return <div className="font-medium truncate">{ownerUser?.full_name || row.original.owner}</div>;
            }, size: 180,
        },
        {
            id: "actions", header: "Actions",
            cell: ({ row }) => (
                <div className="flex items-center gap-1"> {/* Reduced gap */}
                    <HoverCard><HoverCardTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 text-green-600 hover:text-green-700" onClick={() => openDialog(row.original, DIALOG_ACTION_TYPES.APPROVE)}><CircleCheck className="h-5 w-5" /></Button></HoverCardTrigger><HoverCardContent className="text-xs w-auto p-1.5">Approve</HoverCardContent></HoverCard>
                    <HoverCard><HoverCardTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:text-red-700" onClick={() => openDialog(row.original, DIALOG_ACTION_TYPES.REJECT)}><CircleX className="h-5 w-5" /></Button></HoverCardTrigger><HoverCardContent className="text-xs w-auto p-1.5">Reject</HoverCardContent></HoverCard>
                    <HoverCard><HoverCardTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:text-blue-700" onClick={() => openDialog(row.original, DIALOG_ACTION_TYPES.EDIT)}><SquarePen className="h-4 w-4" /></Button></HoverCardTrigger><HoverCardContent className="text-xs w-auto p-1.5">Edit & Approve</HoverCardContent></HoverCard>
                </div>
            ), size: 120,
        },
    ], [notifications, projectOptions, vendorOptions, userList, handleNewPaymentSeen, openDialog, getDocumentTotal, getAmountPaid, allPaidPayments]);


    // --- Faceted Filter Options ---
    const facetFilterOptions = useMemo(() => ({
        project: { title: "Project", options: projectOptions },
        vendor: { title: "Vendor", options: vendorOptions },
        // Add document_type if needed:
        // document_type: { title: "Doc Type", options: [{label: "PO", value:"Procurement Orders"}, {label:"SR", value:"Service Requests"}]}
    }), [projectOptions, vendorOptions]);

    // --- Update Logic using useFrappeUpdateDoc ---
    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();
    const handlePaymentUpdate = useCallback(async (actionType: DialogActionType, amount: number, payment_details?: any) => {
        if (!selectedPayment) return;
        const newStatus = (actionType === DIALOG_ACTION_TYPES.APPROVE || actionType === DIALOG_ACTION_TYPES.EDIT)
            ? PAYMENT_STATUS.APPROVED : PAYMENT_STATUS.REJECTED;
        try {
            await updateDoc(DOCTYPE, selectedPayment.name, {
                status: newStatus,
                amount: amount, // Already a number
                ...(payment_details && {payment_details: JSON.stringify(payment_details)}) // Add UTR, Date etc.
            });
            closeDialog();
            toast({ title: "Success!", description: `Payment ${actionType} successfully!`, variant: "success" });
            // Refetch is handled by useServerDataTable on data change (via useFrappeDocTypeEventListener)
        } catch (error: any) {
            console.error("Failed to update payment:", error);
            toast({ title: "Update Failed!", description: error.message || "Could not update payment.", variant: "destructive" });
        }
    }, [selectedPayment, updateDoc, closeDialog, toast]);


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
        enableItemSearch: false, // Item search not applicable to ProjectPayments main doc
        urlSyncKey: URL_SYNC_KEY,
        defaultSort: 'creation desc',
        enableRowSelection: true, // No bulk actions defined yet for payment requests
        additionalFilters: staticFilters,
    });

    // --- Realtime Update Handling ---
    useFrappeDocTypeEventListener(DOCTYPE, (event) => {
        console.log(`Realtime event for ${DOCTYPE} (ApprovePayments):`, event);
        refetch();
        toast({ title: "Payments list updated.", duration: 2000 });
        // Refetch if a payment is created/updated and its status becomes "Requested"
        // or if a payment we were showing changed status
        // if (event.doc && (event.doc.status === PAYMENT_STATUS.REQUESTED || data.find(p => p.name === event.doc.name))) {
        //      refetch();
        //      toast({ title: "Payments list updated.", duration: 2000 });
        // } else if (event.doctype === DOCTYPE && !event.doc?.status) { // e.g. delete
        //     refetch();
        // }
    });

    // --- Combined Loading & Error States ---
    const isPageLoading = projectsLoading || vendorsLoading || userListLoading || poLoading || srLoading || paidPaymentsLoading;
    const combinedError = projectsError || vendorsError || userError || poError || srError || listError;

    if (combinedError && !data) { // Show error prominently if main data fails to load
        toast({ title: "Error loading data", description: combinedError.message, variant: "destructive" });
        return <div className="p-4 text-red-500 text-center">Failed to load payment requests. Please try again.</div>;
    }

    return (
        <div className="flex-1 space-y-4">
            {isPageLoading && !data?.length ? ( // Show skeleton if all supporting data is loading and no data yet
                <TableSkeleton />
            ) : (
                <DataTable<ProjectPayments>
                    table={table}
                    columns={columns}
                    isLoading={listIsLoading} // Loading state specifically for the payment list
                    error={listError}     // Error state specifically for the payment list
                    totalCount={totalCount}
                    globalFilterValue={globalFilter}
                    onGlobalFilterChange={setGlobalFilter}
                    searchPlaceholder="Search Payment Requests..."
                    showItemSearchToggle={showItemSearchToggle} // Will be false as enableItemSearch is false
                    itemSearchConfig={{
                        isEnabled: isItemSearchEnabled,
                        toggle: toggleItemSearch,
                        label: "Item Search"
                    }}
                    facetFilterOptions={facetFilterOptions}
                    dateFilterColumns={dateColumns}
                    showExport={true} // Optional
                    // toolbarActions={...} // Optional
                />
            )}

            {selectedPayment && (
                 <PaymentActionDialog
                    isOpen={isDialogOpen}
                    onOpenChange={setIsDialogOpen}
                    type={dialogActionType}
                    paymentData={selectedPayment}
                    vendorName={vendors?.find(v => v.name === selectedPayment.vendor)?.vendor_name}
                    onSubmit={handlePaymentUpdate}
                    isLoading={updateLoading}
                />
            )}
        </div>
    );
};

export default ApprovePayments;