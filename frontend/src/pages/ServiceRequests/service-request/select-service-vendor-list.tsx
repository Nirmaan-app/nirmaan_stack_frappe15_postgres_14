import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { formatDate } from "@/utils/FormatDate";
import { ColumnDef } from "@tanstack/react-table";
import { useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import { useMemo } from "react";
import { Link } from "react-router-dom";

export const SelectServiceVendorList : React.FC = () => {
    const { data: service_list, isLoading: service_list_loading, error: service_list_error, mutate: serviceListMutate } = useFrappeGetDocList<ServiceRequests>("Service Requests",
        {
            fields: ["*"],
            filters: [["status", "in", ["Created", "Rejected", "Edit"]]],
            limit: 10000,
            orderBy: { field: "modified", order: "desc" }
        });

    const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects", {
        fields: ["name", "project_name"],
        limit: 1000
    })


    useFrappeDocTypeEventListener("Service Requests", async () => {
        await serviceListMutate()
    })

    const project_values = useMemo(() => projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || [], [projects])

    const columns : ColumnDef<ServiceRequests>[] = useMemo(
        () => [
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="SR Number" />
                    )
                },
                cell: ({ row }) => {
                    const data = row.original
                    return (
                        <div className="font-medium flex items-center gap-2">
                            <Link className="underline hover:underline-offset-2" to={`${row.getValue("name")}?tab=choose-vendor`}>
                                {row.getValue("name")?.slice(-4)}
                            </Link>
                            <ItemsHoverCard order_list={data?.service_order_list?.list} isSR />
                        </div>
                    )
                }
            },
            {
                accessorKey: "creation",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Date" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {formatDate(row.getValue("creation")?.split(" ")[0])}
                        </div>
                    )
                }
            },
            {
                accessorKey: "project",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Project" />
                    )
                },
                cell: ({ row }) => {
                    const project = project_values.find(
                        (project) => project.value === row.getValue("project")
                    )
                    if (!project) {
                        return null;
                    }

                    return (
                        <div className="font-medium">
                            {project.label}
                        </div>
                    )
                },
                filterFn: (row, id, value) => {
                    return value.includes(row.getValue(id))
                },
            },
            {
                accessorKey: "service_category_list",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Categories" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="flex flex-col gap-1 items-start justify-center">
                            {row.getValue("service_category_list").list.map((obj) => <Badge className="inline-block">{obj["name"]}</Badge>)}
                        </div>
                    )
                }
            },
            {
                accessorKey: "status",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Status" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <Badge variant={row.getValue("status") === "Rejected" ? "red" : row.getValue("status") === "Created"  ? "yellow" : "orange"}>{row.getValue("status")}</Badge>
                    )
                }
            }

        ],
        [project_values, service_list]
    )
    const { toast } = useToast()

    if (service_list_error || projects_error) {
        console.log("Error in select-service-vendor-list.tsx", service_list_error?.message, projects_error?.message)
        toast({
            title: "Error!",
            description: `Error ${service_list_error?.message || projects_error?.message}`,
            variant: "destructive"
        })
    }

    return (
        <div className="flex-1 space-y-4">
            {(projects_loading || service_list_loading) ? (<TableSkeleton />) : (
                <DataTable columns={columns} data={service_list || []} project_values={project_values} />
            )}
        </div>
    )
}

export default SelectServiceVendorList;