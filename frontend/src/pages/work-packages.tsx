import { Button } from "@/components/ui/button";
//import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFrappeGetDocList } from "frappe-react-sdk";
//import { HardHat } from "lucide-react";
// import { useMemo } from "react";
// import { Link } from "react-router-dom";
// import { ColumnDef } from "@tanstack/react-table";
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
// import { DataTable } from "@/components/data-table/data-table";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink } from "@/components/breadcrumb";
import { WPCard } from "@/components/wp-card";
import { NavBar } from "@/components/nav/nav-bar";


interface WorkPackage {
    work_package_name: string
}

export default function Projects() {
    //const { data: wp_count, isLoading: wp_count_loading, error: wp_count_error } = useFrappeGetDocCount("Work Packages");

    const { data: data, isLoading: isLoading, error: error } = useFrappeGetDocList<WorkPackage>("Work Packages", {
        fields: ["work_package_name"]
    })


    // const columns: ColumnDef<WorkPackage>[] = useMemo(
    //     () => [
    //         {
    //             accessorKey: "work_package_name",
    //             header: ({ column }) => {
    //                 return (
    //                     <DataTableColumnHeader column={column} title="WP" />
    //                 )
    //             },
    //             cell: ({ row }) => {
    //                 return (
    //                     <div className="font-medium">
    //                         <Link className="underline hover:underline-offset-2" to="/wp">
    //                             {row.getValue("work_package_name")}
    //                         </Link>
    //                     </div>
    //                 )
    //             }
    //         }
    //     ],
    //     []
    // )

    return (
        <>
            <NavBar />
            <div className="flex-1 space-y-4 p-8 pt-6">
                <div className="flex items-center justify-between space-y-2">
                    <Breadcrumb>
                        <BreadcrumbItem>
                            <BreadcrumbLink href="/">Dashboard</BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbItem isCurrentPage>
                            <BreadcrumbLink href="/wp">
                                Work Packages
                            </BreadcrumbLink>
                        </BreadcrumbItem>
                    </Breadcrumb>
                </div>
                <div className="flex items-center justify-between space-y-2">
                    <h2 className="text-3xl font-bold tracking-tight">Work Packages Dashboard</h2>
                    <div className="flex items-center space-x-2">
                        <Button> Add New Work Packages</Button>
                    </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">

                    {isLoading && <h3>LOADING</h3>}
                    {error && <h3>ERROR</h3>}
                    {/*<DataTable columns={columns} data={data || []} /> */}
                    {(data || []).map(d =>
                        <WPCard wp={d.work_package_name} />
                        // <Card className="hover:animate-shadow-drop-center" >
                        //     <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        //         <CardTitle className="text-sm font-medium">
                        //             {d.work_package_name}
                        //         </CardTitle>
                        //         <HardHat className="h-4 w-4 text-muted-foreground" />
                        //     </CardHeader>
                        //     <CardContent>

                        //         <p className="text-xs text-muted-foreground">COUNT</p>
                        //     </CardContent>
                        // </Card>

                    )}
                </div>
            </div>
        </>
    )
}