import { Breadcrumb, BreadcrumbItem } from "@/components/breadcrumb";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { ColumnDef } from "@tanstack/react-table";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { HardHat } from "lucide-react";

import { useMemo } from "react";
import { Link } from "react-router-dom";

import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { MainLayout } from "@/components/layout/main-layout"

export default function Vendors() {

    const columns: ColumnDef<ProjectsType>[] = useMemo(
        () => [
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Vendor ID" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            <Link className="underline hover:underline-offset-2 whitespace-nowrap" to={`/vendors/${row.getValue("name")}`}>
                                {row.getValue("name")}
                            </Link>
                        </div>
                    )
                }
            },
            {
                accessorKey: "vendor_name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Vendor Name" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("vendor_name")}
                        </div>
                    )
                }
            },
            {
                accessorKey: "vendor_type",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Vendor Type" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("vendor_type")}
                        </div>
                    )
                }
            },
            {
                accessorKey: "vendor_email",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Vendor Email" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("vendor_email")}
                        </div>
                    )
                }
            }
        ],
        []
    )

    const { data: data, isLoading: isLoading, error: error } = useFrappeGetDocList("Vendors", {
        fields: ["name", "vendor_name", "vendor_type", "vendor_city", "vendor_email"],
        limit: 1000
    })

    return (

        <MainLayout>
            <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                <div className="flex items-center justify-between space-y-2">
                    <Breadcrumb>
                        <BreadcrumbItem>
                            <Link to="/" className="md:text-base text-sm">Dashboard</Link>
                        </BreadcrumbItem>
                        <BreadcrumbItem isCurrentPage>
                            <Link to="/vendors" className="text-gray-400 md:text-base text-sm">
                                Vendors
                            </Link>
                        </BreadcrumbItem>
                    </Breadcrumb>
                </div>
                <div className="flex items-center justify-between mb-2 space-y-2">
                    <h2 className="text-xl md:text-3xl font-bold tracking-tight">Vendors Dashboard</h2>
                    {/* <div className="flex items-center space-x-2">
                        <Button asChild>
                            <Link to="edit"> +Add <span className="hidden md:flex">Project</span></Link>
                        </Button>
                    </div> */}
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
                    <Card className="hover:animate-shadow-drop-center" onClick={() => {

                    }}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                Total Vendors
                            </CardTitle>
                            <HardHat className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">
                                {(isLoading) ? (<p>Loading</p>) : (data?.length)}
                                {error && <p>Error</p>}
                            </div>
                            <p className="text-xs text-muted-foreground">COUNT</p>
                        </CardContent>
                    </Card>
                </div>
                <div className="container pl-0 pr-2">
                    {isLoading && <h3>LOADING</h3>}
                    {error && <h3>ERROR</h3>}
                    <DataTable columns={columns} data={data || []} />
                </div>
            </div>
        </MainLayout>

    )
}