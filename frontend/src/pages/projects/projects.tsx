import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TableSkeleton } from "@/components/ui/skeleton";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { getTotalInflowAmount } from "@/utils/getAmounts";
import { parseNumber } from "@/utils/parseNumber";
import { ColumnDef } from "@tanstack/react-table";
import { Filter, FrappeDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { HardHat } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { Link } from "react-router-dom";

interface ProjectsProps {
  customersView?: boolean;
  customerId?: string;
}

export const Projects : React.FC<ProjectsProps> = ({customersView = false, customerId = undefined}) => {
  const project_filters: Filter<FrappeDoc<ServiceRequests>>[] | undefined = []
      if (customerId) {
        project_filters.push(["customer", "=", customerId])
      }

  const { data: data, isLoading: isLoading } = useFrappeGetDocList<ProjectsType>("Projects", {
    fields: [
      "name",
      "customer",
      "project_name",
      "project_type",
      "project_city",
      "project_state",
      "creation",
      "status",
    ],
    limit: 1000,
    filters: project_filters,
    orderBy: { field: "creation", order: "desc" },
  });

  const { data: projectTypesList, isLoading: projectTypesListLoading } = useFrappeGetDocList("Project Types",
      {
        fields: ["*"],
        limit: 1000,
      },
      "Project Types"
    );

  const [prToProjectData, setPrToProjectData] = useState<Record<string, ProcurementRequest[]>>({});
  const [projectStatusCounts, setProjectStatusCounts] = useState({});

  const { data: pr_data, isLoading: prData_loading } = useFrappeGetDocList<ProcurementRequest>(
    "Procurement Requests",
    {
      fields: ["*"],
      limit: 10000,
    }
  );

  const {data : po_item_data} = useFrappeGetDocList<ProcurementOrder>("Procurement Orders",
    {
      fields: ["*"],
      filters: [["status", "!=", "Merged"]],
      limit: 100000,
      orderBy: { field: "creation", order: "desc" },
    }
  );

  const { data: serviceRequestsData, isLoading: sRloading } =
      useFrappeGetDocList<ServiceRequests>("Service Requests", {
        fields: ["*"],
        filters: [
          ["status", "=", "Approved"],
        ],
        limit: 10000,
      });
  
  const {data : projectInflows, isLoading: projectInflowsLoading} = useFrappeGetDocList<ProjectInflows>("Project Inflows", {
      fields: ["*"],
      limit: 1000
    })
  
  const getProjectWiseInflowAmount = useMemo(() => (projectId : string) : number => {
    const filteredInflows = projectInflows?.filter(i => i?.project === projectId)
    return getTotalInflowAmount(filteredInflows || [])
  }, [projectInflows])

    

  const getSRTotal = useMemo(() => (project : string) => {
    return serviceRequestsData
      ?.filter((item) => item.project === project)
      ?.reduce((total, item) => {
        const gstMultiplier = item.gst === "true" ? 1.18 : 1;
        return (
          total +
          (item?.service_order_list?.list?.reduce(
            (srTotal, i) => srTotal + parseNumber(i.rate) * parseNumber(i.quantity) * gstMultiplier,
            0
          ) || 0)
        );
      }, 0) || 0;
  }, [serviceRequestsData]);

  const getPOTotalWithGST = useMemo(() => (projectId : string) => {
    if (!po_item_data?.length) return 0;
  
    return po_item_data
      .filter((order) => order.project === projectId)
      .reduce((total, order) => {
        return (
          total +
          (order.order_list?.list?.reduce((orderSum, item) => {
            const itemTotal = parseNumber(item.quantity) * parseNumber(item.quote);
            const taxAmount = (parseNumber(item.tax) / 100) * itemTotal;
            return orderSum + itemTotal + taxAmount;
          }, 0) || 0)
        );
      }, 0);
  }, [po_item_data]);
  

  const { data: po_data, isLoading: po_loading } = useFrappeGetDocList<ProcurementOrder>(
    "Procurement Orders",
    {
      fields: ["*"],
      filters: [["status", "!=", "PO Approved"]],
      limit: 10000,
      orderBy: { field: "creation", order: "desc" },
    }
  );

  const { data: projectPayments, isLoading: projectPaymentsLoading } = useFrappeGetDocList<ProjectPayments>("Project Payments", {
          fields: ["*"],
          filters: [["status", "=", "Paid"]],
          limit: 100000
  })

  const getTotalAmountPaid = useMemo(() => (projectId : string) => {
    return projectPayments
      ?.filter((payment) => payment.project === projectId)
      ?.reduce((total, payment) => total + parseNumber(payment.amount), 0) || 0;
  }, [projectPayments]);

const {
    data: project_estimates,
    isLoading: project_estimates_loading,
  } = useFrappeGetDocList("Project Estimates", {
    fields: ["*"],
    limit: 100000,
  });

  const getItemStatus = useMemo(() => (item: any, filteredPOs: ProcurementOrder[]) => {
    return filteredPOs.some((po) =>
      po?.order_list?.list.some((poItem) => poItem?.name === item.name)
    );
  }, []);

  const statusRender = useMemo(() => (status: string, procurementRequest: ProcurementRequest) => {
    const itemList = procurementRequest?.procurement_list?.list || [];

    if (["Pending", "Approved", "Rejected"].includes(status)) {
      return "New PR";
    }

    const filteredPOs = po_data?.filter((po) => po?.procurement_request === procurementRequest?.name) || [];
    const allItemsApproved = itemList.every((item) => {
      return getItemStatus(item, filteredPOs);
    });

    return allItemsApproved ? "Approved PO" : "Open PR";
  }, [getItemStatus, po_data]);

  useEffect(() => {
    if (prToProjectData && po_data) {
      const statusCounts : Record<string, Record<string, number>> = {};

      for (const [project, prs] of Object.entries(prToProjectData)) {
        statusCounts[project] = { "New PR": 0, "Open PR": 0, "Approved PO": 0 };

        prs?.forEach((pr) => {
          const status = statusRender(pr?.workflow_state, pr);
          statusCounts[project][status] += 1;
        });
      }

      setProjectStatusCounts(statusCounts);
    }
  }, [prToProjectData, po_data]);

  useEffect(() => {
    if (!pr_data) return;

    const groupedData = pr_data.reduce((acc : Record<string, ProcurementRequest[]>, pr) => {
      if (pr?.project) {
        acc[pr.project] = acc[pr.project] || [];
        acc[pr.project].push(pr);
      }
      return acc;
    }, {});
  
    setPrToProjectData(groupedData);
  }, [pr_data]);

  // const getTotalEstimateAmt = useCallback((projectId : string) => {
  //   return project_estimates
  //     ?.filter((i) => i?.project === projectId)
  //     ?.reduce((total, i) => total + parseNumber(i?.quantity_estimate) * parseNumber(i?.rate_estimate), 0) || 0;
  // }, [project_estimates]);

  const projectTypeOptions = useMemo(
    () =>
      projectTypesList?.map((pt) => ({
        label: pt.name,
        value: pt.name,
      })) || [],
    [projectTypesList]
  );

  // console.log("projecttype", projectTypeOptions)

  const columns: ColumnDef<ProjectsType>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => {
          return <DataTableColumnHeader column={column} title="ID" />;
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium">
              <Link
                className="underline hover:underline-offset-2"
                to={`/projects/${row.getValue("name")}?page=overview`}
              >
                {row.getValue("name")?.slice(-4)}
              </Link>
            </div>
          );
        },
      },
      {
        accessorKey: "status",
        header: ({ column }) => {
          return <DataTableColumnHeader column={column} title="Status" />;
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium">
              <Badge>{row.getValue("status")}</Badge>
            </div>
          );
        },
        filterFn: (row, id, value) => {
          return value.includes(row.getValue(id));
        },
      },
      {
        accessorKey: "project_name",
        header: ({ column }) => {
          return <DataTableColumnHeader column={column} title="Project Name" />;
        },
        cell: ({ row }) => {
          return (
            <Link
              className="underline hover:underline-offset-2"
              to={`/projects/${row.getValue("name")}`}
            >
              <div className="font-medium">{row.getValue("project_name")}</div>
            </Link>
          );
        },
      },
      {
        accessorKey: "creation",
        header: ({ column }) => {
          return <DataTableColumnHeader column={column} title="Date" />;
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium">
              {formatDate(row.getValue("creation")?.split(" ")[0])}
            </div>
          );
        },
      },
      {
        accessorKey: "project_type",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader column={column} title="Projects Type" />
          );
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium">
              {row.getValue("project_type") || (
                <p className="flex items-center justify-center">--</p>
              )}
            </div>
          );
        },
        filterFn: (row, id, value) => {
          return value.includes(row.getValue(id));
        },
      },
      {
        id: "location",
        accessorFn: (row) => `${row.project_city},${row.project_state}`,
        header: ({ column }) => {
          return <DataTableColumnHeader column={column} title="Location" />;
        },
      },
      // {
      //   accessorKey: "name",
      //   id: "statusCount",
      //   header: ({ column }) => {
      //     return <DataTableColumnHeader column={column} title="Status Count" />;
      //   },
      //   cell: ({ row }) => {
      //     const projectName = row.getValue("name");
      //     const statusCounts = projectStatusCounts[projectName] || {};

      //     return (
      //       <div className="font-medium flex flex-col gap-1">
      //         {/* {Object.entries(statusCounts).map(([status, count]) => ( */}
      //         <Badge
      //           onClick={() =>
      //             navigate(`${projectName}?page=prsummary&Status=New+PR`)
      //           }
      //           className="flex justify-between cursor-pointer"
      //         >
      //           <span>New PR:</span> <span>{statusCounts["New PR"] || 0}</span>
      //         </Badge>
      //         <Badge
      //           onClick={() =>
      //             navigate(`${projectName}?page=prsummary&Status=Open+PR`)
      //           }
      //           variant={"yellow"}
      //           className="flex justify-between cursor-pointer"
      //         >
      //           <span>Open PR:</span>{" "}
      //           <span>{statusCounts["Open PR"] || 0}</span>
      //         </Badge>
      //         <Badge
      //           onClick={() =>
      //             navigate(`${projectName}?page=prsummary&Status=Approved+PO`)
      //           }
      //           variant={"green"}
      //           className="flex justify-between cursor-pointer"
      //         >
      //           <span>Apprd PO:</span>{" "}
      //           <span>{statusCounts["Approved PO"] || 0}</span>
      //         </Badge>
      //         {/* ))} */}
      //       </div>
      //     );
      //   },
      // },
      {
        id: "project_financials",
        header: ({ column }) => {
          return <DataTableColumnHeader column={column} title="Project Financials" />;
        },
        cell: ({ row }) => {
          const data = row.original

          const totalPOAmt = getPOTotalWithGST(data?.name) + getSRTotal(data?.name)
          const amountPaid = getTotalAmountPaid(data?.name);
          // const totalEstimateAmt = getTotalEstimateAmt(data?.name)
          const totalInflowAmt = getProjectWiseInflowAmount(data?.name)

       return (
         <div className="font-medium flex flex-col gap-1 min-w-[180px]">
           <Badge
             className="flex justify-between"
           >
             <span>Total PO Amt inc. GST:</span> <span>{formatToIndianRupee(totalPOAmt)}</span>
           </Badge>
           {/* <Badge
             variant={"yellow"}
             className="flex justify-between"
           >
             <span>Total Estimates Amt:</span>{" "}
             <span>{formatToIndianRupee(totalEstimateAmt)}</span>
           </Badge> */}
           <Badge
             variant={"yellow"}
             className="flex justify-between"
           >
             <span>Total Amt Paid:</span>{" "}
             <span>{formatToIndianRupee(amountPaid)}</span>
           </Badge>
           <Badge
             variant={"green"}
             className="flex justify-between"
           >
             <span>Total Inflow Amt:</span>{" "}
             <span>{formatToIndianRupee(totalInflowAmt)}</span>
           </Badge>
         </div>
       );
        },

      }
    ],
    [data, projectStatusCounts, project_estimates, projectPayments, po_item_data, serviceRequestsData]
  );

  const statusOptions = useMemo(() => [{value : "Created", label : "Created"},
    {value : "WIP", label : "WIP"},
    {value : "Completed", label : "Completed"},
    {value : "Halted", label : "Halted"},
   ], [])

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
             {isLoading ? (
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
               data?.length
             )}
           </div>
           <div className="flex flex-col gap-1 text-xs font-semibold">
             <div className="min-w-[100px] flex items-center justify-between px-2 py-0.5 bg-yellow-100 rounded-md">
               <span className="">WIP</span>
               <i>{data?.filter(i => i?.status === "WIP").length}</i>
             </div>
             <div className="min-w-[100px] flex items-center justify-between px-2 py-0.5 bg-green-100 rounded-md">
               <span className="">Completed</span>
               <i>{data?.filter(i => i?.status === "Completed").length}</i>
             </div>
             <div className="min-w-[100px] flex items-center justify-between px-2 py-0.5 bg-red-100 rounded-md">
               <span className="">Halted</span>
               <i>{data?.filter(i => i?.status === "Halted").length}</i>
             </div>
           </div>
         </CardContent>
       </Card>
      )}
        {isLoading || projectTypesListLoading || project_estimates_loading || 
        projectPaymentsLoading || po_loading || sRloading || prData_loading || projectInflowsLoading ? (
          <TableSkeleton />
        ) : (
          <DataTable
            columns={columns}
            data={data || []}
            projectStatusOptions={statusOptions}
            projectTypeOptions={projectTypeOptions}
          />
        )}
    </div>
  );
}

export default Projects;
