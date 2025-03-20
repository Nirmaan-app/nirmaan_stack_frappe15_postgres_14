import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { TableSkeleton } from "@/components/ui/skeleton";
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows";
import { Projects } from "@/types/NirmaanStack/Projects";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { ColumnDef } from "@tanstack/react-table";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

export const InFlowPayments : React.FC = () => {

  const navigate = useNavigate()  

  const {data : projectInflows, isLoading: projectInflowsLoading} = useFrappeGetDocList<ProjectInflows>("Project Inflows", {
    fields: ["*"],
    limit: 1000,
    orderBy: { field: "creation", order: "desc" },
  }, "Project Inflows")

  const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>("Projects", {
          fields: ["name", "project_name"],
          limit: 1000,
      });

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
                      <DataTableColumnHeader column={column} title="UTR" />
                  )
              },
              cell: ({ row }) => {
                  const data = row.original
                  return <div className="font-medium">
                          {data?.utr}
                        </div>;
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
                      return <div className="font-medium">
                          {formatToIndianRupee(row.original?.amount)}
                      </div>
                  },
              },
          ],
          [projectValues, projectInflows]
      );

return (
       <div className="flex-1 space-y-4">
        {projectsLoading || projectInflowsLoading ? (
            <TableSkeleton />
        ) : (
            <DataTable columns={columns} data={projectInflows || []} project_values={projectValues} inFlowButton />
        )}
       </div>
)
}
