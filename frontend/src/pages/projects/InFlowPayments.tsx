import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { TableSkeleton } from "@/components/ui/skeleton";
import SITEURL from "@/constants/siteURL";
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows";
import { Projects } from "@/types/NirmaanStack/Projects";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { ColumnDef } from "@tanstack/react-table";
import { Filter, FrappeDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { useMemo } from "react";
import { NewInflowPayment } from "./NewInflowPayment";


interface InFlowPaymentsProps {
    customerId? : string
}

export const InFlowPayments : React.FC<InFlowPaymentsProps> = ({customerId}) => {

    const paymentFilters : Filter<FrappeDoc<ProjectInflows>>[] | undefined = []
        
        if (customerId) {
            paymentFilters.push(["customer", "=", customerId])
        }

  const {data : projectInflows, isLoading: projectInflowsLoading} = useFrappeGetDocList<ProjectInflows>("Project Inflows", {
    fields: ["*"],
    filters: paymentFilters,
    limit: 1000,
    orderBy: { field: "creation", order: "desc" },
  }, customerId ? `Project Inflows ${customerId}` : "Project Inflows")

  const { data: projects, isLoading: projectsLoading } = useFrappeGetDocList<Projects>("Projects", {
          fields: ["name", "project_name"],
          limit: 1000,
      }, "Projects");

  const projectValues = useMemo(() => projects?.map((item) => ({
          label: item.project_name,
          value: item.name,
    })) || [], [projects])

  const columns : ColumnDef<ProjectInflows>[] = useMemo(
          () => [
            {
              accessorKey: "utr",
              header: ({ column }) => {
                  return (
                      <DataTableColumnHeader column={column} title="Payment Ref" />
                  )
              },
              cell: ({ row }) => {
                  const data = row.original
                  const screenshotUrl = data?.inflow_attachment;
                  return (
                    screenshotUrl ? (
                        <div className="font-medium text-blue-500">
                           <HoverCard>
                                <HoverCardTrigger>
                                    {data?.utr}
                                </HoverCardTrigger>
                                <HoverCardContent className="w-auto rounded-md shadow-lg">
                                  <img
                                    src={`${SITEURL}${screenshotUrl}`}
                                    alt="Payment Screenshot"
                                    className="max-w-xs max-h-64 object-contain rounded-md shadow-md"
                                  />
                                </HoverCardContent>
                           </HoverCard>
                        </div>
                    ) : (
                        <div className="font-medium">
                            {data?.utr}
                        </div>
                    )
                  );
              },
          },
          {
              accessorKey: "creation",
              header: ({ column }) => {
                  return (
                      <DataTableColumnHeader column={column} title="Date" />
                  )
              },
              cell: ({ row }) => {
                  const data = row.original
                  return <div className="font-medium flex items-center gap-2 relative">
                          {formatDate(data?.payment_date || data?.creation)}
                        </div>;
              },
          },
             
              {
                  accessorKey: "project",
                  header: "Project",
                  cell: ({ row }) => {
                      const project = projectValues.find(
                          (project) => project.value === row.getValue("project")
                      );
                      return project ? <div className="font-medium">{project.label}</div> : null;
                  },
                  filterFn: (row, id, value) => {
                      return value.includes(row.getValue(id))
                  },
              },
              {
                  accessorKey: "amount",
                  header: ({ column }) => {
                      return (
                          <DataTableColumnHeader column={column} title="Amount" />
                      )
                  },
                  cell: ({ row }) => {
                      return <div className="font-medium text-green-600">
                          {formatToIndianRupee(row.original?.amount)}
                      </div>
                  },
              },
          ],
          [projectValues, projectInflows, customerId]
      );

return (
       <div className="flex-1 space-y-4">
        {projectsLoading || projectInflowsLoading ? (
            <TableSkeleton />
        ) : (
            <DataTable columns={columns} data={projectInflows || []} project_values={projectValues} inFlowButton={customerId ? false : true} />
        )}
        <NewInflowPayment />
       </div>
)
}

export default InFlowPayments;
