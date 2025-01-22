import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ColumnDef } from "@tanstack/react-table";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { ArrowLeft, CirclePlus, HardHat } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { TailSpin } from "react-loader-spinner";
import { TableSkeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/utils/FormatDate";
import { useUserData } from "@/hooks/useUserData";
import { Badge } from "@/components/ui/badge";
import formatToIndianRupee from "@/utils/FormatPrice";

export default function Projects() {
  const navigate = useNavigate();
  const { role } = useUserData();

  const {
    data: data,
    isLoading: isLoading,
    error: error,
  } = useFrappeGetDocList<ProjectsType>("Projects", {
    fields: [
      "name",
      "project_name",
      "project_type",
      "project_city",
      "project_state",
      "creation",
      "status",
    ],
    limit: 1000,
    orderBy: { field: "creation", order: "desc" },
  });

  const { data: projectTypesList, isLoading: projectTypesListLoading } =
    useFrappeGetDocList(
      "Project Types",
      {
        fields: ["*"],
        limit: 1000,
      },
      "Project Types"
    );

  const [prToProjectData, setPrToProjectData] = useState({});
  const [projectStatusCounts, setProjectStatusCounts] = useState({});

  const { data: pr_data, isLoading: prData_loading } = useFrappeGetDocList(
    "Procurement Requests",
    {
      fields: ["*"],
      limit: 2000,
    }
  );

  const {data : po_item_data} = useFrappeGetDocList("Procurement Orders",
    {
      fields: ["*"],
      filters: [["status", "!=", "Merged"]],
      limit: 100000,
      orderBy: { field: "creation", order: "desc" },
    }
  );

  const getPOTotalWithGST = (projectId) => {
    // Ensure the po_item_data is fetched
    if (!po_item_data || !po_item_data.length) {
      return 0;
    }

    const filteredOrders = po_item_data.filter(order => order.project === projectId);
  
    // Calculate the total amount including GST
    const totalAmount = filteredOrders.reduce((total, order) => {
      if (order.order_list && Array.isArray(order.order_list?.list)) {
        // Sum the total amount for each order's items
        const orderTotal = order.order_list?.list.reduce((orderSum, item) => {
          const itemTotal = parseFloat(item.quantity) * parseFloat(item.quote);
          const taxAmount = (parseFloat(item.tax) / 100) * itemTotal; // Calculate GST based on tax percentage
          return orderSum + itemTotal + taxAmount; // Add GST to the item total
        }, 0);
        return total + orderTotal;
      }
      return total;
    }, 0);
  
    return totalAmount;
  };
  

  const { data: po_data, isLoading: po_loading } = useFrappeGetDocList(
    "Procurement Orders",
    {
      fields: ["*"],
      filters: [["status", "!=", "PO Approved"]],
      limit: 1000,
      orderBy: { field: "creation", order: "desc" },
    }
  );

  const { data: projectPayments, isLoading: projectPaymentsLoading, error: projectPaymentsError, mutate: projectPaymentsMutate } = useFrappeGetDocList("Project Payments", {
          fields: ["*"],
          limit: 100000
  })

  const getTotalAmountPaid = (id) => {
    const payments = projectPayments?.filter((payment) => payment.project === id);
    return payments?.reduce((acc, payment) => {
        const amount = parseFloat(payment.amount || 0)
        const tds = parseFloat(payment.tds || 0)
        return acc + amount;
    }, 0);
}

const {
    data: project_estimates,
    isLoading: project_estimates_loading,
    error: project_estimates_error,
  } = useFrappeGetDocList("Project Estimates", {
    fields: ["*"],
    limit: 100000,
  });

  const getTotalEstimateAmt = (projectId) => {
    const estimates = project_estimates?.filter(i => i?.project === projectId)
    return estimates?.reduce(
      (acc, i) =>
        acc +
        parseFloat(i?.quantity_estimate || 0) *
        parseFloat(i?.rate_estimate || 0),
      0
    );
  }

  const projectTypeOptions = projectTypesList?.map((pt) => ({
    label: pt.name,
    value: pt.name,
  }));

  // console.log("projecttype", projectTypeOptions)

  useEffect(() => {
    if (pr_data) {
      const groupedData = pr_data.reduce((acc, pr) => {
        const projectKey = pr?.project;
        if (projectKey) {
          if (!acc[projectKey]) {
            acc[projectKey] = [];
          }
          acc[projectKey].push(pr);
        }
        return acc;
      }, {});

      setPrToProjectData(groupedData);
    }
  }, [pr_data]);

  // console.log("prToProjectData", prToProjectData)

  const getItemStatus = (item: any, filteredPOs: any[]) => {
    return filteredPOs.some((po) =>
      po?.order_list?.list.some((poItem) => poItem?.name === item.name)
    );
  };

  const statusRender = (status: string, procurementRequest: any) => {
    const itemList = procurementRequest?.procurement_list?.list || [];

    if (["Pending", "Approved", "Rejected"].includes(status)) {
      return "New PR";
    }

    const filteredPOs =
      po_data?.filter(
        (po) => po?.procurement_request === procurementRequest?.name
      ) || [];
    const allItemsApproved = itemList.every((item) => {
      return getItemStatus(item, filteredPOs);
    });

    return allItemsApproved ? "Approved PO" : "Open PR";
  };

  useEffect(() => {
    if (prToProjectData && po_data) {
      const statusCounts = {};

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

          const totalPOAmt = getPOTotalWithGST(data?.name)
          const amountPaid = getTotalAmountPaid(data?.name);
          const totalEstimateAmt = getTotalEstimateAmt(data?.name)

       return (
         <div className="font-medium flex flex-col gap-1 min-w-[180px]">
           <Badge
             className="flex justify-between"
           >
             <span>Total inc. GST:</span> <span>{formatToIndianRupee(totalPOAmt)}</span>
           </Badge>
           <Badge
             variant={"yellow"}
             className="flex justify-between"
           >
             <span>Total Estimates Amt:</span>{" "}
             <span>{formatToIndianRupee(totalEstimateAmt)}</span>
           </Badge>
           <Badge
             variant={"green"}
             className="flex justify-between"
           >
             <span>Total Amt Paid:</span>{" "}
             <span>{formatToIndianRupee(amountPaid)}</span>
           </Badge>
         </div>
       );
        },

      }
    ],
    [projectStatusCounts, project_estimates, projectPayments, po_item_data]
  );

  // console.log("projectStatusCounts", projectStatusCounts)

  return (
    <div className="flex-1 space-y-4">
      {/* <div className="flex items-center justify-between space-y-2">
                    <Breadcrumb>
                        <BreadcrumbItem>
                            <Link to="/" className="md:text-base text-sm">Dashboard</Link>
                        </BreadcrumbItem>
                        <BreadcrumbItem isCurrentPage>
                            <Link to="/projects" className="text-gray-400 md:text-base text-sm">
                                Projects
                            </Link>
                        </BreadcrumbItem>
                    </Breadcrumb>
                </div> */}
      {/* <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1">
                    <ArrowLeft className="cursor-pointer" onClick={() => navigate("/")} />
                    <h2 className="text-xl md:text-3xl font-bold tracking-tight">Projects Dashboard</h2>
                </div>

            </div> */}
        <Card className="hover:animate-shadow-drop-center max-md:w-full my-2 w-[60%]">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">
              Total Projects
            </CardTitle>
            <HardHat className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
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
              {error && <p>Error</p>}
            </div>
          </CardContent>
        </Card>
        {isLoading || projectTypesListLoading ? (
          <TableSkeleton />
        ) : (
          <DataTable
            columns={columns}
            data={data || []}
            projectTypeOptions={projectTypeOptions}
          />
        )}
    </div>
  );
}
