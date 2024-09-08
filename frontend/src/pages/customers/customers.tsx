// import { fetchDoc, fetchDocCount, fetchDocList } from '@/reactQuery/customFunctions';
// import {  useQuery, useQueryClient } from '@tanstack/react-query';

// export default function Customers() {


//   const { data, isLoading, error, refetch } = useQuery({
//     queryKey: ['docList', "Procurement Orders", {filters: [["vendor", "=", "VEN-Material-0001"]], fields: ["name", "project", "vendor", "procurement_request", "creation","project_name", "project_address" ]}], 
//     queryFn: () => fetchDocList("Procurement Orders", ["name", "project", "vendor", "procurement_request", "creation", "project_name", "project_address"], [["vendor", "=", "VEN-Material-0001"]]),
//     staleTime: 1000 * 60 * 5
//   });

//   // const id = "PO/003/00001/24-25" 

// const {data: singleDoc, isLoading: docLoading} = useQuery({
//   queryKey: ["docList", "Procurement Orders"],
//   queryFn: () => fetchDocList("Procurement Orders"),
//   staleTime: 1000 * 60 * 5
// })



//   // if(!docLoading) {
//   //   console.log("singleDoc", singleDoc.data)
//   // }

//   const queryClient = useQueryClient()

//   // setTimeout(() => {
//   //   queryClient.invalidateQueries({queryKey: ['docList', 'Procurement Orders'], refetchType: 'active' })
//   // }, 1 * 60 * 1000);



//   if (isLoading) return <div>Loading...</div>;
//   if (error) return <div>Error: {error.message}</div>;

//     // const {data : count, isLoading: countLoading, error: countError} = useQuery({
//     //   queryKey: ["docCount", "Items"],
//     //   queryFn: () => fetchDocCount("Items")
//     // })

//     // console.log("counData", count)
//   return (
//     <div>
//       <h1>Customers</h1>
//       <ul>
//         {data?.data?.map((item) => (
//           <li key={item.name}>
//             <strong>{item.name}</strong> - {JSON.stringify(item)}  {/* Displaying all fields for each customer */}
//           </li>
//         ))}
//       </ul>
//       <button onClick={() => queryClient.invalidateQueries({queryKey: ['docList', 'Procurement Orders'], refetchType: 'all' })}>refetch</button>
//     </div>
//   );
// }

import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, CirclePlus, User } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Customers as CustomersType } from "@/types/NirmaanStack/Customers";
import { TableSkeleton } from "@/components/ui/skeleton";
import { TailSpin } from "react-loader-spinner";
// import { useQuery } from "@tanstack/react-query";
// import { fetchDocList } from "@/reactQuery/customFunctions";
import { useFrappeGetDocList } from "frappe-react-sdk";

export default function Customers() {
    const columns: ColumnDef<CustomersType>[] = useMemo(
        () => [
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Customer ID" />
                    );
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            <Link className="underline hover:underline-offset-2 whitespace-nowrap" to={`/customers/${row.getValue("name")}`}>
                                {row.getValue("name")?.slice(-4)}
                            </Link>
                        </div>
                    );
                },
            },
            {
                accessorKey: "company_name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Company Name" />
                    );
                },
                cell: ({ row }) => {
                    return <div className="font-medium">{row.getValue("company_name")}</div>;
                },
            },
            {
                accessorKey: "company_contact_person",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Contact Person" />
                    );
                },
                cell: ({ row }) => {
                    return <div className="font-medium">{row.getValue("company_contact_person")}</div>;
                },
            },
            {
                accessorKey: "company_phone",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Phone Number" />
                    );
                },
                cell: ({ row }) => {
                    return <div className="font-medium">{row.getValue("company_phone")}</div>;
                },
            },
            {
                accessorKey: "company_email",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Email Address" />
                    );
                },
                cell: ({ row }) => {
                    return <div className="font-medium">{row.getValue("company_email")}</div>;
                },
            },
            {
                accessorKey: "creation",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Date Created" />
                    );
                },
                cell: ({ row }) => {
                    return <div className="font-medium">{row.getValue("creation")?.split(" ")[0]}</div>;
                },
            },
        ],
        []
    );

    // const { data, isLoading, error } = useFrappeGetDocList("Customers", {
    //     fields: ["name", "company_name", "company_contact_person", "company_phone", "company_email", "creation"],
    //     limit: 1000,
    // });

    // const { data, isLoading, error, refetch } = useQuery({
    //   queryKey: ['docList', "Customers"], 
    //   queryFn: () => fetchDocList({doctype: "Customers", fields : ["name", "company_name", "company_contact_person", "company_phone", "company_email", "creation"]}),
    //   staleTime: 1000 * 60 * 5
    // }); 


    const { data, isLoading, error } = useFrappeGetDocList("Customers",
        {
            fields: ["*"],
            limit: 1000
        }
    )

    return (
        <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
            <div className="flex items-center justify-between mb-2 space-y-2">
                <div className="flex">
                    <Link to="/">
                        <ArrowLeft className="mt-1.5" />
                    </Link>
                    <h2 className="pl-2 text-xl md:text-3xl font-bold tracking-tight">Customers Dashboard</h2>
                </div>

                <div className="flex items-center space-x-2">
                    <Button asChild>
                        <Link to="new">
                            <CirclePlus className="w-5 h-5 mt- pr-1 " />
                            Add <span className="hidden md:flex pl-1"> New Customer</span>
                        </Link>
                    </Button>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
                <Card className="hover:animate-shadow-drop-center">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Customers</CardTitle>
                        <User className="h-4 w-4 text-muted-foreground" />
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
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="pl-0 pr-2">
                {isLoading ? <TableSkeleton /> : <DataTable columns={columns} data={data || []} />}
            </div>
        </div>
    );
}


