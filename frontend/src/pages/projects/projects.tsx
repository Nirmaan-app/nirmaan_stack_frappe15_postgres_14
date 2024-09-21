import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ColumnDef } from "@tanstack/react-table";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { ArrowLeft, CirclePlus, HardHat } from "lucide-react";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { TailSpin } from "react-loader-spinner";
import { TableSkeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/utils/FormatDate";


export default function Projects() {
    const navigate = useNavigate()

    const {data: projectTypesList, isLoading: projectTypesListLoading} = useFrappeGetDocList("Project Types", {
        fields: ["*"],
        limit: 1000
    },
    "Project Types"
    )

    const projectTypeOptions = projectTypesList?.map((pt) => ({label : pt.name, value: pt.name}))

    console.log("projecttype", projectTypeOptions)

    const columns: ColumnDef<ProjectsType>[] = useMemo(
        () => [
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="ID" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            <Link className="underline hover:underline-offset-2" to={`/projects/${row.getValue("name")}`}>
                                {row.getValue("name")?.slice(-4)}
                            </Link>
                        </div>
                    )
                }
            },
            {
                accessorKey: "project_name",
                header: ({ column }) => {
                    return (

                        <DataTableColumnHeader column={column} title="Project Name" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <Link className="underline hover:underline-offset-2" to={`/projects/${row.getValue("name")}`}>
                            <div className="font-medium">
                                {row.getValue("project_name")}
                            </div>
                        </Link>
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
                accessorKey: "project_type",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Projects Type" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("project_type")}
                        </div>
                    )
                },
                filterFn: (row, id, value) => {
                    return value.includes(row.getValue(id))
                }
            },
            {
                id: "location",
                accessorFn: row => `${row.project_city}, ${row.project_state}`,
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Location" />
                    )
                },
            }
        ],
        []
    )

    const { data: data, isLoading: isLoading, error: error } = useFrappeGetDocList<ProjectsType>("Projects", {
        fields: ["name", "project_name", "project_type", "project_city", "project_state", "creation"],
        limit: 1000
    })

    return (
        <div className="flex-1 space-x-2 md:space-y-4 p-6 pt-6">
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
            <div className="flex items-center justify-between mb-2 space-y-2">
                <div className="flex">
                    <ArrowLeft className="mt-1.5 cursor-pointer" onClick={() => navigate("/")} />
                    <h2 className="pl-2 text-xl md:text-3xl font-bold tracking-tight">Projects Dashboard</h2>
                </div>

                <div className="flex items-center space-x-2">
                    <Button asChild data-cy="add-project-button">
                        <Link to="new"> <CirclePlus className="w-5 h-5 mt- pr-1 " />Add <span className="hidden md:flex pl-1"> Project</span></Link>
                    </Button>
                </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2 cursor-pointer">
                <Card className="hover:animate-shadow-drop-center" onClick={() => {

                }}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">
                            Total Projects
                        </CardTitle>
                        <HardHat className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {(isLoading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />) : (data?.length)}
                            {error && <p>Error</p>}
                        </div>
                        {/* <p className="text-xs text-muted-foreground">COUNT</p> */}
                    </CardContent>
                </Card>
            </div>
            <div className="pl-0 pr-2">
                {isLoading || projectTypesListLoading ? (
                    <TableSkeleton />
                ) : (
                    <DataTable columns={columns} data={data || []} projectTypeOptions={projectTypeOptions} />
                )}
            </div>
        </div>
    )
}