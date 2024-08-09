import { Button } from "@/components/ui/button";
//import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFrappeGetDocList } from "frappe-react-sdk";
//import { HardHat } from "lucide-react";
// import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DialogClose } from "@/components/ui/dialog"
// import { ColumnDef } from "@tanstack/react-table";
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
// import { DataTable } from "@/components/data-table/data-table";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink } from "@/components/breadcrumb";
import { WPCard } from "@/components/wp-card";
import { NavBar } from "@/components/nav/nav-bar";
import { useEffect } from "react"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { useFrappeCreateDoc } from "frappe-react-sdk"
import { ButtonLoading } from "@/components/button-loading"
import { MainLayout } from "@/components/layout/main-layout";
import { ArrowLeft, CirclePlus } from "lucide-react";
import { Skeleton, WPSkeleton } from "@/components/ui/skeleton";


interface WorkPackage {
    work_package_name: string
}

const SOWFormSchema = z.object({
    work_package_name: z
        .string({
            required_error: "Must provide type Name"
        })
        .min(3, {
            message: "Type Name must be at least 3 characters.",
        }),
})

type SOWFormValues = z.infer<typeof SOWFormSchema>

export default function Projects() {
    const navigate = useNavigate()
    //const { data: wp_count, isLoading: wp_count_loading, error: wp_count_error } = useFrappeGetDocCount("Work Packages");

    const { data: data, isLoading: isLoading, error: error, mutate: mutate } = useFrappeGetDocList<WorkPackage>("Work Packages", {
        fields: ["work_package_name"]
    })
    const form = useForm<SOWFormValues>({
        resolver: zodResolver(SOWFormSchema),
        defaultValues: {
            work_package_name: "",
        },
        mode: "onChange",
    })

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    // 2. Define a submit handler.
    function onSubmit(values: z.infer<typeof SOWFormSchema>) {
        // Do something with the form values.
        // ✅ This will be type-safe and validated.
        console.log("values ", values)

        createDoc('Work Packages', values)
            .then(() => {
                console.log(values)
                mutate()
            }).catch(() => {
                console.log(submit_error)
            })
    }


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
    // function closewindow() {
    //     var button = document.getElementById('dialogClose');
    //     mutate()
    // }
    return (
        // <MainLayout>
            <div className="flex-1 space-y-4 p-8 pt-6">
                {/* <div className="flex items-center justify-between space-y-2">
                    <Breadcrumb>
                        <BreadcrumbItem>
                            <Link to="/" className="md:text-base text-sm">Dashboard</Link>
                        </BreadcrumbItem>
                        <BreadcrumbItem isCurrentPage>
                            <Link to="/wp" className="text-gray-400 md:text-base text-sm">
                                Work Packages
                            </Link>
                        </BreadcrumbItem>
                    </Breadcrumb>
                </div> */}
                <div className="flex items-center justify-between mb-2 space-y-2">
                    <div className="flex">
                        <ArrowLeft className="mt-1.5 cursor-pointer" onClick={() => navigate("/")} />
                        <h2 className="pl-2 text-xl md:text-3xl font-bold tracking-tight">Work Packages Dashboard</h2>
                    </div>
                    <div className="flex items-center space-x-2">
                        {/* <Button> Add New Work Packages</Button> */}
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button variant="secondary">
                                    <div className="flex cursor-pointer"><CirclePlus className="w-5 h-5 mt- pr-1 " />
                                        <span className="pl-1">Add New Work Package</span>
                                    </div>
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[425px]">
                                <DialogHeader>
                                    <DialogTitle>Add New Work Package</DialogTitle>
                                    {/* <DialogDescription>
                                        Add New Work Packages.
                                    </DialogDescription> */}
                                </DialogHeader>
                                <Form {...form}>
                                    <form onSubmit={(event) => {
                                        event.stopPropagation();
                                        return form.handleSubmit(onSubmit)(event);

                                    }} className="space-y-8">
                                        <FormField
                                            control={form.control}
                                            name="work_package_name"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Work Package Name</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="Work Package Name" {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        {(loading) ? (<ButtonLoading />) : (<DialogClose asChild><Button type="submit">Submit</Button></DialogClose>)}
                                        {/* <DialogClose asChild><Button id="dialogClose" className="w-0 h-0 invisible"></Button></DialogClose> */}
                                        <div>
                                            {submit_complete &&
                                                <div>
                                                    {/* <div className="font-semibold text-green-500"> Customer added</div> */}
                                                    {/* {closewindow()} */}
                                                </div>
                                            }
                                            {submit_error && <div>{submit_error}</div>}
                                        </div>
                                    </form>
                                </Form>
                            </DialogContent>
                        </Dialog>
                    </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
                    {isLoading ? (
                        [...Array(5)].map((_, index) => (
                            <div key={index}>
                            <WPSkeleton />
                            </div>
                        ))
                    ) : (
                        (data || []).map(d =>
                            <div key={d.work_package_name}>
                            <WPCard wp={d.work_package_name} />
                            </div>
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
    
                        )
                    )
                
                }
                    {/*<DataTable columns={columns} data={data || []} /> */}
                    
                </div>
            </div>
        // </MainLayout>
    )
}