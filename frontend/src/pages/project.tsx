import { Breadcrumb, BreadcrumbItem, BreadcrumbLink } from "@/components/breadcrumb"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { NavBar } from "@/components/nav/nav-bar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Projects } from "@/types/NirmaanStack/Projects"
import { ColumnDef } from "@tanstack/react-table"
import { useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk"
import { HardHat } from "lucide-react"
import { useMemo } from "react"
import { Link, useParams } from "react-router-dom"

interface WPN {
    name: string
}

type ScopesMilestones = {
    work_package: string
    scope_of_work: string
    milestone: string
}

const Project = () => {
    const { projectId } = useParams<{ projectId: string }>()

    return (
        <div>
            {projectId && <ProjectView projectId={projectId} />}
        </div>
    )
}

export const Component = Project

const ProjectView = ({ projectId }: { projectId: string }) => {

    const columns: ColumnDef<ScopesMilestones>[] = useMemo(
        () => [
            {
                accessorKey: "work_package",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Work Package" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("work_package")}
                        </div>
                    )
                }
            },
            {
                accessorKey: "scope_of_work",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Scope of work" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("scope_of_work")}
                        </div>
                    )
                }
            },
            {
                accessorKey: "milestone",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Milestone" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("milestone")}
                        </div>
                    )
                }
            }

        ],
        []
    )

    const { data, error, isValidating } = useFrappeGetDoc<Projects>(
        'Projects',
        `${projectId}`
    );



    const { data: mile_data, isLoading: mile_isloading, error: mile_error } = useFrappeGetDocList("Project Work Milestones", {
        fields: ["work_package", "scope_of_work", "milestone"],
        filters: [["project", "=", `${data?.project_name}`]]
    })


    if (isValidating || mile_isloading) return <h1>Loading...</h1>
    if (error || mile_error) return <h1>Error</h1>
    return (
        <>
            <NavBar />
            <div className="flex-1 space-y-4 p-8 pt-6">
                <div className="flex items-center justify-between space-y-2">
                    <Breadcrumb>
                        <BreadcrumbItem>
                            <Link to="/" className="md:text-base text-sm">Dashboard</Link>
                        </BreadcrumbItem>
                        <BreadcrumbItem>
                            <Link to="/projects" className="md:text-base text-sm">Projects</Link>
                        </BreadcrumbItem>
                        <BreadcrumbItem isCurrentPage>
                            <Link to="/projects/edit" className="text-gray-400 md:text-base text-sm">
                                {projectId}
                            </Link>
                        </BreadcrumbItem>
                    </Breadcrumb>
                </div>
                {(isValidating) && (<p>Loading</p>)}
                {error && <p>Error</p>}
                {data &&
                    <>
                        <div className="flex items-center justify-between space-y-2">
                            <h2 className="text-3xl font-bold tracking-tight">{data.project_name}</h2>
                            <div className="flex items-center space-x-2">
                                <Button asChild>
                                    <Link to={`/projects/edit-one/${projectId}`}> Edit Project</Link>
                                </Button>
                            </div>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-2xl font-bold">
                                        Project Details
                                    </CardTitle>
                                    <HardHat className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <Card>
                                        <CardContent>
                                            <br />
                                            <div className="flex flex-row">
                                                <div className="basis-1/2 flex flex-col">
                                                    <div className="pt-2 pb-2">
                                                        <div className="text-l text-muted-foreground">
                                                            <p>Name</p>
                                                        </div>
                                                        <p className="text-xl font-medium">{data.project_name}</p>
                                                    </div>
                                                    <div className="pt-2 pb-2">
                                                        <div className="text-l text-muted-foreground">
                                                            <p>Start Date & End Date</p>
                                                        </div>
                                                        <p className="text-xl font-medium">{data.project_start_date + " to " + data.project_end_date}</p>
                                                    </div>
                                                    <div className="pt-2 pb-2">
                                                        <div className="text-l text-muted-foreground">
                                                            <p>Estimated Completion Date</p>
                                                        </div>
                                                        <p className="text-xl font-medium">{data.project_end_date}</p>
                                                    </div>
                                                </div>
                                                <div className="basis-1/2 flex flex-col">
                                                    <div className="pt-2 pb-2">
                                                        <div className="text-l text-muted-foreground">
                                                            <p>Location</p>
                                                        </div>
                                                        <p className="text-xl font-medium">{data.project_city + ", " + data.project_state}</p>
                                                    </div>
                                                    <div className="pt-2 pb-2">
                                                        <div className="text-l text-muted-foreground">
                                                            <p>Area</p>
                                                        </div>
                                                        <p className="text-xl font-medium">PLACEHOLDER</p>
                                                    </div>
                                                    <div className="pt-2 pb-2">
                                                        <div className="text-l text-muted-foreground">
                                                            <p>No. of Sections in Layout</p>
                                                        </div>
                                                        <p className="text-xl font-medium">PLACEHOLDER</p>
                                                    </div>
                                                </div>


                                            </div>
                                        </CardContent>
                                    </Card>

                                </CardContent>
                            </Card>
                            <div className="grid gap-4 md:grid-rows-3 lg:grid-rows-3">
                                <Card>
                                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                        <CardTitle className="text-2xl font-bold">
                                            Work Package
                                        </CardTitle>
                                        <HardHat className="h-4 w-4 text-muted-foreground" />
                                    </CardHeader>
                                    <CardContent>
                                        {JSON.parse(data.project_work_milestones!).work_packages.map((wp: WPN) => (
                                            <Badge variant="outline">{wp.work_package_name}</Badge>
                                        )) || ""} 
                                </CardContent>
                                </Card>
                                <Card>
                                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                        <CardTitle className="text-2xl font-bold">
                                            Status
                                        </CardTitle>
                                        <HardHat className="h-4 w-4 text-muted-foreground" />
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-sm font-medium">
                                            <p>PLACEHOLDER</p>
                                        </div>
                                        <p className="text-xs text-muted-foreground">METRIC</p>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                        <CardTitle className="text-2xl font-bold">
                                            Health Score
                                        </CardTitle>
                                        <HardHat className="h-4 w-4 text-muted-foreground" />
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-sm font-medium">
                                            <p>PLACEHOLDER</p>
                                        </div>
                                        <p className="text-xs text-muted-foreground">METRIC</p>
                                    </CardContent>
                                </Card>
                            </div>
                        </div>
                    </>
                }
                <div className="container mx-auto py-10">
                    <DataTable columns={columns} data={mile_data || []} />
                </div>
            </div >
        </>
    )
}