import { Button } from "@/components/ui/button";
//import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
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
import { ArrowLeft, CirclePlus, Pencil } from "lucide-react";
import { WPSkeleton } from "@/components/ui/skeleton";
import { toast, useToast } from "@/components/ui/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./ui/alert-dialog";
import { useState } from "react";
import { Switch } from "./ui/switch";
import { Badge } from "./ui/badge";


interface WorkPackage {
    work_package_name: string
}

// const SOWFormSchema = z.object({
//     work_package_name: z
//         .string({
//             required_error: "Must provide type Name"
//         })
//         .min(3, {
//             message: "Type Name must be at least 3 characters.",
//         }),
// })

// type SOWFormValues = z.infer<typeof SOWFormSchema>

export const ProcurementPackages = () => {
    const navigate = useNavigate()

    const {updateDoc} = useFrappeUpdateDoc()
    const { data: procurementPackages, isLoading: isLoading, error: error, mutate: mutate } = useFrappeGetDocList<WorkPackage>("Procurement Packages", {
        fields: ["*"],
        limit: 1000
    })

    const {data : categoriesList, isLoading: categoriesListLoading, mutate: categoriesListMutate} = useFrappeGetDocList("Category", {
        fields: ["*"],
        limit: 1000
    })

    const {data : itemList, isLoading: itemListLoading} = useFrappeGetDocList("Items", {
        fields: ["*"],
        limit: 10000
    })

    const [editCategory, setEditCategory] = useState({})


    // console.log("categories", categoriesList)

    // const form = useForm<SOWFormValues>({
    //     resolver: zodResolver(SOWFormSchema),
    //     defaultValues: {
    //         work_package_name: "",
    //     },
    //     mode: "onChange",
    // })

    // const {toast} = useToast()

    // const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    // // 2. Define a submit handler.
    // function onSubmit(values: z.infer<typeof SOWFormSchema>) {
    //     // Do something with the form values.
    //     // ✅ This will be type-safe and validated.
    //     console.log("values ", values)

    //     createDoc('Work Packages', values)
    //         .then(() => {
    //             console.log(values)
    //             toast({
    //                 title: "Success!",
    //                 description: `${values.work_package_name} created successfully!`,
    //                 variant : "success"
    //             })

    //             form.reset({
    //                 work_package_name: ""
    //             })
    //             mutate()
    //             document.getElementById("dialogClosewp")?.click()
    //         }).catch(() => {
    //             console.log(submit_error)
    //         })
    // }

    // if (error) {
    //     console.log("Error in work-packages.tsx", error?.message)
    //     toast({
    //         title: "Error!",
    //         description: `Error ${error?.message}`,
    //         variant : "destructive"
    //     })   
    // }
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

    const handleEditCategory = async () => {
        try {
            await updateDoc("Category", editCategory?.name, {
                tax : editCategory?.tax,
                new_items: editCategory?.new_items
            })

            await categoriesListMutate()

            toast({
                title: "Success",
                description: `${editCategory?.name} updated successfully!`,
                variant: "success"
            })
        } catch (error) {
            toast({
                title: "Failed",
                description: `${editCategory?.name} updation failed!`,
                variant: "destructive"
            })
            console.log("error while editing category", error)
        }
    }

    return (
            <div className="flex-1 space-y-4">
                <div className="flex items-center justify-between mb-2 space-y-2">
                    <div className="flex">
                        <ArrowLeft className="mt-1.5 cursor-pointer" onClick={() => navigate("/")} />
                        <h2 className="pl-2 text-xl md:text-3xl font-bold tracking-tight">Procurement Packages</h2>
                    </div>
                    {/* <div className="flex items-center space-x-2">
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
                    </div> */}
                </div>
                <div className="flex flex-col gap-4">
                    {(isLoading || categoriesListLoading || itemListLoading) ? (
                        [...Array(5)].map((_, index) => (
                            <div key={index}>
                            <WPSkeleton />
                            </div>
                        ))
                    ) : (
                        procurementPackages?.sort((a,b) => a?.work_package_name?.localeCompare(b?.work_package_name))?.map(d =>
                            <div key={d?.work_package_name}>
                            {/* <WPCard wp={d.work_package_name} /> */}
                            <Card className="hover:animate-shadow-drop-center" >
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">
                                        {d?.work_package_name}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="overflow-auto">
                                    {categoriesList?.filter((i) => i?.work_package === d?.work_package_name)?.length !== 0 && (
                                        <Table>
                                            <TableHeader className="bg-red-100">
                                                <TableRow>
                                                    <TableHead className="w-[50%]">Category</TableHead>
                                                    <TableHead className="w-[10%]">Items count</TableHead>
                                                    <TableHead className="w-[10%]">Tax</TableHead>
                                                    <TableHead className="w-[10%]">New Items Addition</TableHead>
                                                    <TableHead className="w-[10%]">Edit</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {categoriesList?.filter((i) => i?.work_package === d?.work_package_name)?.sort((a,b) => a?.name?.localeCompare(b?.name))?.map((cat) => (
                                                    <TableRow key={cat?.name}>
                                                        <TableCell>{cat?.name}</TableCell>
                                                        <TableCell>{itemList?.filter((i) => i?.category === cat?.name)?.length}</TableCell>
                                                        <TableCell>{cat?.tax}%</TableCell>
                                                        <TableCell><Badge variant={cat?.new_items === "true" ? "green" : "red"}>{cat?.new_items === "true" ? "Enabled" : "Disabled"}</Badge></TableCell>
                                                        <TableCell>
                                                            <AlertDialog>
                                                                <AlertDialogTrigger onClick={() => setEditCategory(cat)}>
                                                                    <Pencil className="text-blue-600" />
                                                                </AlertDialogTrigger>
                                                                <AlertDialogContent>
                                                                    <AlertDialogHeader className="flex flex-col items-start">
                                                                        <AlertDialogTitle>
                                                                            Edit <span className="text-primary">{cat?.name}</span>
                                                                        </AlertDialogTitle>
                                                                        <AlertDialogDescription className="w-full">
                                                                            <div className="flex flex-col items-start gap-1">
                                                                                <p>Tax</p>
                                                                                <Input
                                                                                    id="tax"
                                                                                    type="number"
                                                                                    placeholder="Enter tax..."
                                                                                    value={editCategory?.tax}
                                                                                    onChange={(e) => setEditCategory(prev => ({...prev, "tax" : e.target.value}))}
                                                                                 />
                                                                            </div>
                                                                            <div className="flex flex-col items-start gap-2 py-6">
                                                                                <p className="font-semibold">Enable/Disable New Items Addition</p>
                                                                                <Switch id="hello" defaultChecked={editCategory?.new_items === "true"} onCheckedChange={(e) => setEditCategory(prev => ({...prev, "new_items" : e ? "true" : "false"}))}  /> 
                                                                            </div>
                                                                            <div className="flex items-center gap-2 justify-end">
                                                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                                <AlertDialogAction onClick={handleEditCategory} disabled={(cat?.tax === editCategory?.tax && cat?.new_items === editCategory?.new_items)}>Confirm</AlertDialogAction>
                                                                            </div>
                                                                        </AlertDialogDescription>
                                                                    </AlertDialogHeader>
                                                                </AlertDialogContent>
                                                            </AlertDialog>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    )}
                                </CardContent>
                            </Card>
                            </div>
                        )
                    )}
                </div>
            </div>
    )
}