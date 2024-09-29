import { Button } from "@/components/ui/button";
//import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFrappeGetDocList } from "frappe-react-sdk";
//import { HardHat } from "lucide-react";
// import { useMemo } from "react";
import {  useNavigate } from "react-router-dom";
import { DialogClose } from "@/components/ui/dialog"
// import { ColumnDef } from "@tanstack/react-table";
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
// import { DataTable } from "@/components/data-table/data-table";
import { WPCard } from "@/components/wp-card";
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
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
import { ButtonLoading } from "@/components/ui/button-loading"
import { ArrowLeft, CirclePlus } from "lucide-react";
import { WPSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";


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

    const {toast} = useToast()

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    // 2. Define a submit handler.
    function onSubmit(values: z.infer<typeof SOWFormSchema>) {
        // Do something with the form values.
        // ✅ This will be type-safe and validated.
        console.log("values ", values)

        createDoc('Work Packages', values)
            .then(() => {
                console.log(values)
                toast({
                    title: "Success!",
                    description: `${values.work_package_name} created successfully!`,
                    variant : "success"
                })

                form.reset({
                    work_package_name: ""
                })
                mutate()
                document.getElementById("dialogClosewp")?.click()
            }).catch(() => {
                console.log(submit_error)
            })
    }

    if (error) {
        console.log("Error in work-packages.tsx", error?.message)
        toast({
            title: "Error!",
            description: `Error ${error?.message}`,
            variant : "destructive"
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
            <div className="flex-1 space-y-4 p-8 pt-6">
                <div className="flex items-center justify-between mb-2 space-y-2">
                    <div className="flex">
                        <ArrowLeft className="mt-1.5 cursor-pointer" onClick={() => navigate("/")} />
                        <h2 className="pl-2 text-xl md:text-3xl font-bold tracking-tight">Work Packages Dashboard</h2>
                    </div>
                    <div className="flex items-center space-x-2">
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
                                </DialogHeader>
                                <Form {...form}>
                                    <form onSubmit={(event) => {
                                        event.stopPropagation();
                                        return form.handleSubmit(onSubmit)(event);

                                    }} className="flex flex-col gap-2">
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
                                        <div className="flex items-center justify-center">
                                        {(loading) ? (<ButtonLoading />) : (
                                            <>
                                            <Button type="submit">Submit</Button>
                                            <DialogClose id="dialogClosewp" className="hidden">hello</DialogClose>
                                            </>
                                            )}    
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
                        )
                    )}
                </div>
            </div>
    )
}