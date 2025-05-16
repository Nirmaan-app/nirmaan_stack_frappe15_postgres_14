// import { DataTable } from "@/components/data-table/data-table";
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
// import { Badge } from "@/components/ui/badge";
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// import { TableSkeleton } from "@/components/ui/skeleton";
// import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
// import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
// import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows";
// import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
// import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
// import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
// import { formatDate } from "@/utils/FormatDate";
// import { formatToRoundedIndianRupee as formatToIndianRupee } from "@/utils/FormatPrice";
// import { getTotalInflowAmount } from "@/utils/getAmounts";
// import { parseNumber } from "@/utils/parseNumber";
// import { ColumnDef } from "@tanstack/react-table";
// import { Filter, FrappeDoc, useFrappeGetDocList } from "frappe-react-sdk";
// import memoize from 'lodash/memoize';
// import { HardHat } from "lucide-react";
// import { useEffect, useMemo, useState } from "react";
// import { TailSpin } from "react-loader-spinner";
// import { Link } from "react-router-dom";

// interface ProjectsProps {
//   customersView?: boolean;
//   customerId?: string;
// }

// export const Projects: React.FC<ProjectsProps> = ({ customersView = false, customerId = undefined }) => {
//   const project_filters: Filter<FrappeDoc<ServiceRequests>>[] | undefined = []
//   if (customerId) {
//     project_filters.push(["customer", "=", customerId])
//   }

//   const { data: data, isLoading: isLoading } = useFrappeGetDocList<ProjectsType>("Projects", {
//     fields: [
//       "name",
//       "customer",
//       "project_name",
//       "project_type",
//       "project_city",
//       "project_state",
//       "creation",
//       "status",
//     ],
//     limit: 1000,
//     filters: project_filters,
//     orderBy: { field: "creation", order: "desc" },
//   });

//   const { data: projectTypesList, isLoading: projectTypesListLoading } = useFrappeGetDocList("Project Types",
//     {
//       fields: ["*"],
//       limit: 1000,
//     },
//     "Project Types"
//   );

//   const [projectStatusCounts, setProjectStatusCounts] = useState({});

//   const { data: pr_data, isLoading: prData_loading } = useFrappeGetDocList<ProcurementRequest>(
//     "Procurement Requests",
//     {
//       fields: ["*"],
//       limit: 10000,
//     }
//   );

//   const { data: po_item_data } = useFrappeGetDocList<ProcurementOrder>("Procurement Orders",
//     {
//       fields: ["*"],
//       filters: [["status", "!=", "Merged"]],
//       limit: 100000,
//       orderBy: { field: "creation", order: "desc" },
//     }
//   );

//   const { data: serviceRequestsData, isLoading: sRloading } = useFrappeGetDocList<ServiceRequests>("Service Requests", {
//     fields: ["*"],
//     filters: [
//       ["status", "=", "Approved"],
//     ],
//     limit: 10000,
//   });

//   const { data: projectInflows, isLoading: projectInflowsLoading } = useFrappeGetDocList<ProjectInflows>("Project Inflows", {
//     fields: ["*"],
//     limit: 10000
//   })

//   const getProjectWiseInflowAmount = useMemo(() => memoize((projectId: string): number => {
//     const filteredInflows = projectInflows?.filter(i => i?.project === projectId)
//     return getTotalInflowAmount(filteredInflows || [])
//   }, (projectId: string) => projectId), [projectInflows])



//   const getSRTotal = useMemo(() => memoize((projectId: string) => {
//     return serviceRequestsData
//       ?.filter((item) => item.project === projectId)
//       ?.reduce((total, item) => {
//         const gstMultiplier = item.gst === "true" ? 1.18 : 1;
//         return (
//           total +
//           (item?.service_order_list?.list?.reduce(
//             (srTotal, i) => srTotal + parseNumber(i.rate) * parseNumber(i.quantity) * gstMultiplier,
//             0
//           ) || 0)
//         );
//       }, 0) || 0;
//   }, (projectId: string) => projectId), [serviceRequestsData]);

//   const getPOTotalWithGST = useMemo(() => memoize((projectId: string) => {
//     if (!po_item_data?.length) return 0;

//     return po_item_data
//       .filter((order) => order.project === projectId)
//       .reduce((total, order) => {
//         return (
//           total +
//           (order.order_list?.list?.reduce((orderSum, item) => {
//             const itemTotal = parseNumber(item.quantity) * parseNumber(item.quote);
//             const taxAmount = (parseNumber(item.tax) / 100) * itemTotal;
//             return orderSum + itemTotal + taxAmount;
//           }, 0) || 0)
//         );
//       }, 0);
//   }, (projectId: string) => projectId), [po_item_data]);


//   const { data: po_data, isLoading: po_loading } = useFrappeGetDocList<ProcurementOrder>("Procurement Orders",
//     {
//       fields: ["*"],
//       filters: [["status", "!=", "PO Approved"]],
//       limit: 10000,
//       orderBy: { field: "creation", order: "desc" },
//     }
//   );

//   const { data: projectPayments, isLoading: projectPaymentsLoading } = useFrappeGetDocList<ProjectPayments>("Project Payments", {
//     fields: ["*"],
//     filters: [["status", "=", "Paid"]],
//     limit: 100000
//   })

//   const getTotalAmountPaid = useMemo(() => memoize((projectId: string) => {
//     return projectPayments
//       ?.filter((payment) => payment.project === projectId)
//       ?.reduce((total, payment) => total + parseNumber(payment.amount), 0) || 0;
//   }, (projectId: string) => projectId), [projectPayments]);

//   const { data: project_estimates, isLoading: project_estimates_loading } = useFrappeGetDocList("Project Estimates", {
//     fields: ["*"],
//     limit: 100000,
//   });

//   const getItemStatus = useMemo(() => memoize((item: any, filteredPOs: ProcurementOrder[]) => {
//     return filteredPOs.some((po) =>
//       po?.order_list?.list.some((poItem) => poItem?.name === item.name)
//     );
//   }, (item: any, filteredPOs: ProcurementOrder[]) => JSON.stringify(item) + JSON.stringify(filteredPOs)), []);

//   const statusRender = useMemo(() => memoize((status: string, procurementRequest: ProcurementRequest) => {
//     const itemList = procurementRequest?.procurement_list?.list || [];

//     if (["Pending", "Approved", "Rejected"].includes(status)) {
//       return "New PR";
//     }

//     const filteredPOs = po_data?.filter((po) => po?.procurement_request === procurementRequest?.name) || [];
//     const allItemsApproved = itemList.every((item) => {
//       return getItemStatus(item, filteredPOs);
//     });

//     return allItemsApproved ? "Approved PO" : "Open PR";
//   }, (status: string, procurementRequest: ProcurementRequest) => status + JSON.stringify(procurementRequest)), [getItemStatus, po_data]);

//   const prToProjectData = useMemo(() => pr_data?.reduce((acc: Record<string, ProcurementRequest[]>, pr) => {
//     if (pr?.project) {
//       acc[pr.project] = acc[pr.project] || [];
//       acc[pr.project].push(pr);
//     }
//     return acc;
//   }, {}), [pr_data]);

//   useEffect(() => {
//     if (prToProjectData && po_data) {
//       const statusCounts: Record<string, Record<string, number>> = {};

//       for (const [project, prs] of Object.entries(prToProjectData)) {
//         statusCounts[project] = { "New PR": 0, "Open PR": 0, "Approved PO": 0 };

//         prs?.forEach((pr) => {
//           const status = statusRender(pr?.workflow_state, pr);
//           statusCounts[project][status] += 1;
//         });
//       }

//       setProjectStatusCounts(statusCounts);
//     }
//   }, [prToProjectData, po_data]);

//   const projectTypeOptions = useMemo(
//     () =>
//       projectTypesList?.map((pt) => ({
//         label: pt.name,
//         value: pt.name,
//       })) || [],
//     [projectTypesList]
//   );

//   // console.log("projecttype", projectTypeOptions)

//   const columns: ColumnDef<ProjectsType>[] = useMemo(
//     () => [
//       {
//         accessorKey: "name",
//         header: ({ column }) => {
//           return <DataTableColumnHeader column={column} title="ID" />;
//         },
//         cell: ({ row }) => {
//           return (
//             <div className="font-medium">
//               <Link
//                 className="underline hover:underline-offset-2"
//                 to={`/projects/${row.getValue("name")}?page=overview`}
//               >
//                 {row.getValue("name")?.slice(-4)}
//               </Link>
//             </div>
//           );
//         },
//       },
//       {
//         accessorKey: "status",
//         header: ({ column }) => {
//           return <DataTableColumnHeader column={column} title="Status" />;
//         },
//         cell: ({ row }) => {
//           return (
//             <div className="font-medium">
//               <Badge>{row.getValue("status")}</Badge>
//             </div>
//           );
//         },
//         filterFn: (row, id, value) => {
//           return value.includes(row.getValue(id));
//         },
//       },
//       {
//         accessorKey: "project_name",
//         header: ({ column }) => {
//           return <DataTableColumnHeader column={column} title="Project Name" />;
//         },
//         cell: ({ row }) => {
//           return (
//             <Link
//               className="underline hover:underline-offset-2"
//               to={`/projects/${row.getValue("name")}`}
//             >
//               <div className="font-medium">{row.getValue("project_name")}</div>
//             </Link>
//           );
//         },
//       },
//       {
//         accessorKey: "creation",
//         header: ({ column }) => {
//           return <DataTableColumnHeader column={column} title="Date Created" />;
//         },
//         cell: ({ row }) => {
//           return (
//             <div className="font-medium">
//               {formatDate(row.getValue("creation")?.split(" ")[0])}
//             </div>
//           );
//         },
//       },
//       {
//         accessorKey: "project_type",
//         header: ({ column }) => {
//           return (
//             <DataTableColumnHeader column={column} title="Projects Type" />
//           );
//         },
//         cell: ({ row }) => {
//           return (
//             <div className="font-medium">
//               {row.getValue("project_type") || (
//                 <p className="flex items-center justify-center">--</p>
//               )}
//             </div>
//           );
//         },
//         filterFn: (row, id, value) => {
//           return value.includes(row.getValue(id));
//         },
//       },
//       {
//         id: "location",
//         accessorFn: (row) => `${row.project_city},${row.project_state}`,
//         header: ({ column }) => {
//           return <DataTableColumnHeader column={column} title="Location" />;
//         },
//       },
//       // {
//       //   accessorKey: "name",
//       //   id: "statusCount",
//       //   header: ({ column }) => {
//       //     return <DataTableColumnHeader column={column} title="Status Count" />;
//       //   },
//       //   cell: ({ row }) => {
//       //     const projectName = row.getValue("name");
//       //     const statusCounts = projectStatusCounts[projectName] || {};

//       //     return (
//       //       <div className="font-medium flex flex-col gap-1">
//       //         {/* {Object.entries(statusCounts).map(([status, count]) => ( */}
//       //         <Badge
//       //           onClick={() =>
//       //             navigate(`${projectName}?page=prsummary&Status=New+PR`)
//       //           }
//       //           className="flex justify-between cursor-pointer"
//       //         >
//       //           <span>New PR:</span> <span>{statusCounts["New PR"] || 0}</span>
//       //         </Badge>
//       //         <Badge
//       //           onClick={() =>
//       //             navigate(`${projectName}?page=prsummary&Status=Open+PR`)
//       //           }
//       //           variant={"yellow"}
//       //           className="flex justify-between cursor-pointer"
//       //         >
//       //           <span>Open PR:</span>{" "}
//       //           <span>{statusCounts["Open PR"] || 0}</span>
//       //         </Badge>
//       //         <Badge
//       //           onClick={() =>
//       //             navigate(`${projectName}?page=prsummary&Status=Approved+PO`)
//       //           }
//       //           variant={"green"}
//       //           className="flex justify-between cursor-pointer"
//       //         >
//       //           <span>Apprd PO:</span>{" "}
//       //           <span>{statusCounts["Approved PO"] || 0}</span>
//       //         </Badge>
//       //         {/* ))} */}
//       //       </div>
//       //     );
//       //   },
//       // },
//       {
//         id: "project_financials",
//         header: ({ column }) => {
//           return <DataTableColumnHeader column={column} title="Project Financials" />;
//         },
//         cell: ({ row }) => {
//           const data = row.original

//           const totalPOAmt = getPOTotalWithGST(data?.name) + getSRTotal(data?.name)
//           const amountPaid = getTotalAmountPaid(data?.name);
//           // const totalEstimateAmt = getTotalEstimateAmt(data?.name)
//           const totalInflowAmt = getProjectWiseInflowAmount(data?.name)

//           return (
//             <div className="font-medium flex flex-col gap-1 min-w-[180px]">
//               <Badge
//                 className="flex justify-between"
//               >
//                 <span>Total PO Amt inc. GST:</span> <span>{formatToIndianRupee(totalPOAmt)}</span>
//               </Badge>
//               {/* <Badge
//              variant={"yellow"}
//              className="flex justify-between"
//            >
//              <span>Total Estimates Amt:</span>{" "}
//              <span>{formatToIndianRupee(totalEstimateAmt)}</span>
//            </Badge> */}
//               <Badge
//                 variant={"yellow"}
//                 className="flex justify-between"
//               >
//                 <span>Total Amt Paid:</span>{" "}
//                 <span>{formatToIndianRupee(amountPaid)}</span>
//               </Badge>
//               <Badge
//                 variant={"green"}
//                 className="flex justify-between"
//               >
//                 <span>Total Inflow Amt:</span>{" "}
//                 <span>{formatToIndianRupee(totalInflowAmt)}</span>
//               </Badge>
//             </div>
//           );
//         },

//       }
//     ],
//     [data, projectStatusCounts, project_estimates, projectPayments, po_item_data, serviceRequestsData]
//   );

//   const statusOptions = useMemo(() => [{ value: "Created", label: "Created" },
//   { value: "WIP", label: "WIP" },
//   { value: "Completed", label: "Completed" },
//   { value: "Halted", label: "Halted" },
//   ], [])

//   return (
//     <div className="flex-1 space-y-4">
//       {!customersView && (
//         <Card className="hover:animate-shadow-drop-center max-md:w-full my-2 w-[60%]">
//           <CardHeader className="flex flex-row items-center justify-between">
//             <CardTitle className="text-sm font-medium">
//               Total Projects
//             </CardTitle>
//             <HardHat className="h-4 w-4 text-muted-foreground" />
//           </CardHeader>
//           <CardContent className="flex justify-between items-center">
//             <div className="text-2xl font-bold">
//               {isLoading ? (
//                 <TailSpin
//                   visible={true}
//                   height="30"
//                   width="30"
//                   color="#D03B45"
//                   ariaLabel="tail-spin-loading"
//                   radius="1"
//                   wrapperStyle={{}}
//                   wrapperClass=""
//                 />
//               ) : (
//                 data?.length
//               )}
//             </div>
//             <div className="flex flex-col gap-1 text-xs font-semibold">
//               <div className="min-w-[100px] flex items-center justify-between px-2 py-0.5 bg-yellow-100 rounded-md">
//                 <span className="">WIP</span>
//                 <i>{data?.filter(i => i?.status === "WIP").length}</i>
//               </div>
//               <div className="min-w-[100px] flex items-center justify-between px-2 py-0.5 bg-green-100 rounded-md">
//                 <span className="">Completed</span>
//                 <i>{data?.filter(i => i?.status === "Completed").length}</i>
//               </div>
//               <div className="min-w-[100px] flex items-center justify-between px-2 py-0.5 bg-red-100 rounded-md">
//                 <span className="">Halted</span>
//                 <i>{data?.filter(i => i?.status === "Halted").length}</i>
//               </div>
//             </div>
//           </CardContent>
//         </Card>
//       )}
//       {isLoading || projectTypesListLoading || project_estimates_loading ||
//         projectPaymentsLoading || po_loading || sRloading || prData_loading || projectInflowsLoading ? (
//         <TableSkeleton />
//       ) : (
//         <DataTable
//           columns={columns}
//           data={data || []}
//           projectStatusOptions={statusOptions}
//           projectTypeOptions={projectTypeOptions}
//         />
//       )}
//     </div>
//   );
// }

// export default Projects;



import React, { useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList, useFrappeDocTypeEventListener, useFrappeGetDocCount } from "frappe-react-sdk";
import memoize from 'lodash/memoize';
import { CircleCheckBig, CirclePlus, HardHat, OctagonMinus } from "lucide-react";
import { TailSpin } from "react-loader-spinner";

// --- UI Components ---
import { DataTable, SearchFieldOption } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TableSkeleton } from "@/components/ui/skeleton";

// --- Hooks & Utils ---
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { getTotalInflowAmount, getPOTotal, getSRTotal, getTotalAmountPaid } from "@/utils/getAmounts";
import { parseNumber } from "@/utils/parseNumber";

// --- Types ---
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { ProjectTypes } from "@/types/NirmaanStack/ProjectTypes"; 
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal } from "lucide-react";

// --- Config ---
import {
    DEFAULT_PROJECT_FIELDS_TO_FETCH,
    PROJECT_SEARCHABLE_FIELDS,
    PROJECT_DATE_COLUMNS,
    getProjectStaticFilters
} from './config/projectTable.config';

// --- Constants ---
const DOCTYPE = 'Projects';

interface ProjectsProps {
  customersView?: boolean; // To hide summary card
  customerId?: string;    // To filter projects by customer
  urlContext?: string;    // For unique URL state if multiple instances
}

// ProcessedProject type for the table, including calculated financials
export interface ProcessedProjectForTable extends ProjectsType {
    calculatedTotalInvoiced: number;
    calculatedTotalInflow: number;
    calculatedTotalOutflow: number;
    // prStatusCounts?: Record<string, number>; // For the status count badge display
}

// --- Component ---
export const Projects: React.FC<ProjectsProps> = ({
    customersView = false,
    customerId,
    urlContext = "main" // Default context for URL key
}) => {
    const urlSyncKey = useMemo(() => `projects_list_${urlContext}${customerId ? `_cust_${customerId}` : ''}`, [urlContext, customerId]);

    const { data: all_projects_count } = useFrappeGetDocCount("Projects", 
      undefined,
    true, false, "all_projects_count")

    const { data: wip_projects_count } = useFrappeGetDocCount("Projects", 
        [["status", "in", ["WIP"]]],
    true, false, "wip_projects_count")

    const { data: completed_projects_count } = useFrappeGetDocCount("Projects", 
        [["status", "in", ["Completed"]]],
        true, false, "completed_projects_count")

    const { data: halted_projects_count } = useFrappeGetDocCount("Projects", 
        [["status", "in", ["Halted"]]],
        true, false, "halted_projects_count")

    const newProjectsCount = useMemo(() => parseNumber(all_projects_count) - (parseNumber(wip_projects_count) + parseNumber(completed_projects_count) + parseNumber(halted_projects_count)), [all_projects_count, wip_projects_count, completed_projects_count, halted_projects_count])
    
    const countsOArray = useMemo(() => {
      return [
        {label: "Created", value: newProjectsCount, color: "bg-blue-100", icon: CirclePlus},
        {label: "WIP", value: wip_projects_count, color: "bg-yellow-100", icon: HardHat},
        {label: "Completed", value: completed_projects_count, color: "bg-green-100", icon: CircleCheckBig},
        {label: "Halted", value: halted_projects_count, color: "bg-red-100", icon: OctagonMinus}
      ]
    },[])

    // --- Supporting Data Fetches (for calculations in columns) ---
    // These fetch broader data sets, then we'll map them to projects client-side.
    const { data: projectTypesList, isLoading: projectTypesLoading, error: projectTypesError } = useFrappeGetDocList<ProjectTypes>(
        "Project Types", { fields: ["name"], limit: 1000 }, "ProjectTypes_For_ProjectsList"
    );


    // const { data: prData, isLoading: prDataLoading, error: prDataError } = useFrappeGetDocList<ProcurementRequest>(
    //     "Procurement Requests", { fields: ["name", "project", "workflow_state", "procurement_list"], limit: 100000 }, "PRs_For_ProjectsList" // Fetch all for counts
    // );

    const { data: poData, isLoading: poDataLoading, error: poDataError } = useFrappeGetDocList<ProcurementOrder>(
        "Procurement Orders", { fields: ["name", "project", "status", "order_list", "invoice_data", "loading_charges", "freight_charges"], filters:[["status", "!=", "Merged"]], limit: 100000 }, "POs_For_ProjectsList"
    );
    const { data: srData, isLoading: srDataLoading, error: srDataError } = useFrappeGetDocList<ServiceRequests>(
        "Service Requests", { fields: ["name", "project", "status", "service_order_list", "gst"], filters: [["status", "=", "Approved"]], limit: 100000 }, "SRs_For_ProjectsList"
    );
    const { data: projectInflows, isLoading: projectInflowsLoading, error: projectInflowsError } = useFrappeGetDocList<ProjectInflows>(
        "Project Inflows", { fields: ["project", "amount"], limit: 100000 }, "Inflows_For_ProjectsList"
    );
    const { data: projectPayments, isLoading: projectPaymentsLoading, error: projectPaymentsError } = useFrappeGetDocList<ProjectPayments>(
        "Project Payments", { fields: ["project", "amount", "status"], filters: [["status", "=", "Paid"]], limit: 100000 }, "Payments_For_ProjectsList"
    );

    // --- Memoized Lookups & Pre-processing for Column Calculations ---
    const projectTypeOptions = useMemo(() => projectTypesList?.map(pt => ({ label: pt.name, value: pt.name })) || [], [projectTypesList]);

    const statusOptions = useMemo(() => ["Created", "WIP", "Completed", "Halted"].map(s => ({label: s, value: s})), []); // Example static status options

    const getProjectFinancials = useMemo(() => {
        if (!poData || !srData || !projectInflows || !projectPayments) return () => ({ calculatedTotalInvoiced: 0, calculatedTotalInflow: 0, calculatedTotalOutflow: 0 });

        // Pre-group data for efficiency
        const posByProject = memoize((projId: string) => poData.filter(po => po.project === projId));
        const srsByProject = memoize((projId: string) => srData.filter(sr => sr.project === projId));
        const inflowsByProject = memoize((projId: string) => projectInflows.filter(pi => pi.project === projId));
        const paymentsByProject = memoize((projId: string) => projectPayments.filter(pp => pp.project === projId));

        return memoize((projectId: string) => {
            const relatedPOs = posByProject(projectId);
            const relatedSRs = srsByProject(projectId);
            const relatedInflows = inflowsByProject(projectId);
            const relatedPayments = paymentsByProject(projectId);

            let totalInvoiced = 0;
            relatedPOs.forEach(po => totalInvoiced += getPOTotal(po, parseNumber(po.loading_charges), parseNumber(po.freight_charges))?.totalAmt || 0);
            relatedSRs.forEach(sr => {
                const srVal = getSRTotal(sr); // Assuming getSRTotal returns value without GST
                totalInvoiced += sr.gst === "true" ? srVal * 1.18 : srVal;
            });

            const totalInflow = getTotalInflowAmount(relatedInflows);
            const totalOutflow = getTotalAmountPaid(relatedPayments); // Already filtered for "Paid"

            return {
                calculatedTotalInvoiced: totalInvoiced,
                calculatedTotalInflow: totalInflow,
                calculatedTotalOutflow: totalOutflow,
            };
        });
    }, [poData, srData, projectInflows, projectPayments]);


    // const prStatusCountsByProject = useMemo(() => {
    //     if (!prData || !poData) return {};
    //     const counts: Record<string, Record<string, number>> = {};
    //     // Simplified status logic - adjust if statusRender was more complex
    //     prData.forEach(pr => {
    //         if (!pr.project) return;
    //         if (!counts[pr.project]) counts[pr.project] = { "New PR": 0, "Open PR": 0, "Approved PO": 0 };
            
    //         let statusCategory = "New PR"; // Default for "Pending"
    //         if (pr.workflow_state === "Approved") { // Or "Vendor Selected" etc.
    //              // Check if all items have corresponding POs
    //             const prItems = pr.procurement_list?.list || [];
    //             const poForThisPR = poData.filter(po => po.procurement_request === pr.name);
    //             const allItemsInPO = prItems.every(prItem =>
    //                 poForThisPR.some(po =>
    //                     po.order_list?.list.some(poItem => poItem.item === prItem.item) // Assuming item_code links them
    //                 )
    //             );
    //             if (allItemsInPO && poForThisPR.length > 0) statusCategory = "Approved PO";
    //             else if (poForThisPR.length > 0) statusCategory = "Open PR"; // Some items in PO
    //             // else stays "New PR" if no PO created yet from this PR
    //         } else if (pr.workflow_state !== "Pending") { // Other states might be Open PR
    //             statusCategory = "Open PR";
    //         }
    //         counts[pr.project][statusCategory] = (counts[pr.project][statusCategory] || 0) + 1;
    //     });
    //     return counts;
    // }, [prData, poData]);


    // --- Column Definitions for the Combined DataTable ---
    const columns = useMemo<ColumnDef<ProjectsType>[]>(() => [
      {
        accessorKey: "name", header: "ID",
        cell: ({ row }) => <Link to={`/projects/${row.original.name}?page=overview`} className="text-blue-600 hover:underline font-medium">{row.original.name?.slice(-5)}</Link>,
        size: 100,
    },
      {
          accessorKey: "project_name", header: "Project",
          cell: ({ row }) => <Link to={`/projects/${row.original.name}?page=overview`} className="text-blue-600 hover:underline font-medium">{row.original.project_name || row.original.name}</Link>,
          size: 200,
      },
      {
          accessorKey: "creation", header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
          cell: ({ row }) => formatDate(row.original.creation),
      },
      {
          accessorKey: "status", header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
          cell: ({ row }) => <Badge variant={row.original.status === "Completed" ? "default" : (row.original.status === "Halted" ? "destructive" : "secondary")}>{row.original.status}</Badge>,
          enableColumnFilter: true,
      },
      {
          accessorKey: "project_type", header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
          cell: ({ row }) => <div>{row.original.project_type || "--"}</div>,
          enableColumnFilter: true,
      },
      {
          id: "location", header: "Location",
          accessorFn: row => `${row.project_city || ''}, ${row.project_state || ''}`.replace(/^, |, $/g, ''), // Clean leading/trailing commas
      },
      // {
      //     id: "pr_status_counts", header: "PR Status",
      //     cell: ({ row }) => {
      //         const counts = row.original.prStatusCounts;
      //         return (
      //             <div className="font-medium flex flex-col gap-1 text-xs">
      //                 {counts && Object.entries(counts).map(([status, count]) => (
      //                     count > 0 && <Badge key={status} variant={status === "New PR" ? "default" : (status === "Open PR" ? "warning" : "success")} className="flex justify-between w-full max-w-[120px]"><span>{status}:</span> <span>{count}</span></Badge>
      //                 ))}
      //             </div>
      //         );
      //     },
      // },
      {
          id: "project_financials", header: "Financials (Lakhs)",
          cell: ({ row }) => {
            const financials = getProjectFinancials(row.original.name); // Calculate for current project row
              return (
                  <div className="font-medium flex flex-col gap-1 text-xs min-w-[180px]">
                      <div className="flex justify-between"><span>Value:</span> <span className="tabular-nums">{formatToRoundedIndianRupee(parseNumber(row.original.project_value) / 100000)} L</span></div>
                      <div className="flex justify-between"><span>PO Amt:</span> <span className="tabular-nums">{formatToRoundedIndianRupee(financials.calculatedTotalInvoiced / 100000)} L</span></div>
                      <div className="flex justify-between"><span>Inflow:</span> <span className="text-green-600 tabular-nums">{formatToRoundedIndianRupee(financials.calculatedTotalInflow / 100000)} L</span></div>
                      <div className="flex justify-between"><span>Outflow:</span> <span className="text-red-600 tabular-nums">{formatToRoundedIndianRupee(financials.calculatedTotalOutflow / 100000)} L</span></div>
                  </div>
              );
          }, 
          meta: {
            excludeFromExport: true
          }
      },
  ], [getProjectFinancials,
    // processedTableData
    // prStatusCountsByProject
  ]); // Dependencies for columns


    // --- Static Filters for `useServerDataTable` ---
    const staticFilters = useMemo(() => getProjectStaticFilters(customerId), [customerId]);

    // --- useServerDataTable Hook for the main Projects list ---
    const {
        table, data: projectsDataForTable, totalCount, isLoading: listIsLoading, error: listError,
        searchTerm, setSearchTerm, selectedSearchField, setSelectedSearchField,
        isRowSelectionActive, refetch,
    } = useServerDataTable<ProjectsType>({ // Fetches ProjectsType
        doctype: DOCTYPE,
        columns: columns, // Columns defined below and passed to DataTable component
        fetchFields: DEFAULT_PROJECT_FIELDS_TO_FETCH,
        searchableFields: PROJECT_SEARCHABLE_FIELDS,
        urlSyncKey: urlSyncKey,
        defaultSort: 'creation desc',
        enableRowSelection: false, // No selection needed for this overview table
        additionalFilters: staticFilters,
        shouldCache: true,
    });

    // // --- Transform fetched project data to include calculated financials and PR counts ---
    // const processedTableData = useMemo<ProcessedProjectForTable[]>(() => {
    //     if (!projectsDataForTable) return [];
    //     return projectsDataForTable.map(project => ({
    //         ...project,
    //         // ...getProjectFinancials(project.name),
    //         calculatedTotalInvoiced : getProjectFinancials(project.name).calculatedTotalInvoiced,
    //         calculatedTotalInflow : getProjectFinancials(project.name).calculatedTotalInflow,
    //         calculatedTotalOutflow : getProjectFinancials(project.name).calculatedTotalOutflow,
    //         // prStatusCounts: prStatusCountsByProject[project.name] || { "New PR": 0, "Open PR": 0, "Approved PO": 0 },
    //     }));
    // }, [projectsDataForTable, getProjectFinancials, 
    //   // prStatusCountsByProject
    // ]);



    // --- Faceted Filter Options ---
    const facetFilterOptions = useMemo(() => ({
        status: { title: "Status", options: statusOptions },
        project_type: { title: "Project Type", options: projectTypeOptions },
        // customer: { title: "Customer", options: customerOptions }, // If customer is a direct field on Project and searchable
    }), [statusOptions, projectTypeOptions]);


    // --- Realtime Update Handling ---
    // Refetch project list if a project is updated.
    // More granular updates could be handled if other doctypes (PO, SR) change, triggering recalculation of processedProjects.
    useFrappeDocTypeEventListener(DOCTYPE, (event) => {
        console.log(`Realtime event for ${DOCTYPE} (ProjectsList):`, event);
        refetch(); // Refetch the main projects list
        // Potentially trigger refetch of supporting data if necessary, e.g., by invalidating SWR keys
        // For now, relying on hook's refetch for the primary list.
    });
    // useFrappeDocTypeEventListener("Procurement Requests", () => prDataLoading === false && prDataMutate()); // Example
    // Add listeners for POs, SRs, Inflows, Payments if their changes should immediately reflect in financials/counts


    // --- Combined Loading & Error States ---
    const isLoadingOverall = poDataLoading || srDataLoading || projectInflowsLoading || projectPaymentsLoading || projectTypesLoading;

    const combinedErrorOverall = poDataError || srDataError || projectInflowsError || projectPaymentsError || projectTypesError || listError;

    // if (combinedErrorOverall && !projectsDataForTable?.length) {
    //     toast({ title: "Error loading project data", description: combinedErrorOverall.message, variant: "destructive" });
    // }

    if (combinedErrorOverall && !projectsDataForTable?.length) {
            // Display prominent error from data fetching/processing
            return (
                 <Alert variant="destructive" className="m-4">
                    <Terminal className="h-4 w-4" />
                    <AlertTitle>Error Loading Projects Data</AlertTitle>
                    <AlertDescription>
                        Failed to fetch or process project data: {combinedErrorOverall?.message}
                    </AlertDescription>
                </Alert>
            );
        }

    return (
        <div className="flex-1 space-y-4">
         {!customersView && (
        <Card className="hover:animate-shadow-drop-center max-md:w-full my-2 w-[60%]">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">
              Total Projects
            </CardTitle>
            <HardHat className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="flex justify-between items-center">
            <div className="text-2xl font-bold">
              {listIsLoading ? (
                <TailSpin
                  visible={true}
                  height="30"
                  width="30"
                  color="#D03B45"
                  ariaLabel="tail-spin-loading"
                  radius="1"
                  wrapperStyle={{}}
                  wrapperClass=""
                />
              ) : (
                all_projects_count
              )}
            </div>
            <div className="flex flex-col gap-1 text-xs font-semibold">
              {countsOArray.map((item, index) => (
                <div key={index} className={`min-w-[100px] flex items-center justify-between px-2 py-0.5 ${item.color} rounded-md`}>
                  <span className="">{item.label}</span>
                  <i>{item.value}</i>
                </div>
              ))}
              {/* <div className="min-w-[100px] flex items-center justify-between px-2 py-0.5 bg-yellow-100 rounded-md">
                <span className="">WIP</span>
                <i>{wip_projects_count}</i>
              </div>
              <div className="min-w-[100px] flex items-center justify-between px-2 py-0.5 bg-green-100 rounded-md">
                <span className="">Completed</span>
                <i>{completed_projects_count}</i>
              </div>
              <div className="min-w-[100px] flex items-center justify-between px-2 py-0.5 bg-red-100 rounded-md">
                <span className="">Halted</span>
                <i>{halted_projects_count}</i>
              </div> */}
            </div>
          </CardContent>
        </Card>
      )}
            {isLoadingOverall && !projectsDataForTable?.length ? (
                <TableSkeleton />
            ) : (
                <DataTable<ProjectsType>
                    table={table} // The table instance from useServerDataTable, now operating on clientData
                    columns={columns} // Your defined display columns
                    isLoading={listIsLoading} //isLoading for the table data itself
                    error={listError}
                    totalCount={totalCount} // This will be total of processedProjects
                    searchFieldOptions={PROJECT_SEARCHABLE_FIELDS}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    facetFilterOptions={facetFilterOptions}
                    dateFilterColumns={PROJECT_DATE_COLUMNS}
                    showExportButton={true}
                    onExport={'default'}
                    exportFileName="Projects_Report"
                />
            )}
        </div>
    );
};

export default Projects;