import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet"
import { ArrowLeft, CirclePlus, Download, Handshake } from 'lucide-react';
import QuotationForm from "./quotation-form"
import { useFrappeCreateDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useParams } from "react-router-dom";
import { useState, useEffect, useMemo, useCallback } from "react"
import {  useNavigate } from "react-router-dom";
import { PrintRFQ } from "./rfq-pdf";
import { Card, CardContent, CardHeader } from "../ui/card";
import { Button } from '@/components/ui/button';
import { formatDate } from "@/utils/FormatDate";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ColumnDef } from "@tanstack/react-table";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { Badge } from "../ui/badge";
import { AddVendorCategories } from "../forms/addvendorcategories";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../ui/accordion";
import { DataTable } from "../data-table/data-table";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { useToast } from "../ui/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../ui/alert-dialog";
import { NewVendor } from "@/pages/vendors/new-vendor";

export const UpdateQuote = () => {
    const { orderId } = useParams<{ orderId: string }>()
    const navigate = useNavigate();

    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error, mutate: vendor_list_mutate } = useFrappeGetDocList("Vendors",
        {
            fields: ["*"],
            limit: 1000
        },
        "Vendors"
    );

    const {data: procurement_request_list} = useFrappeGetDocList("Procurement Requests", {
        fields: ["*"],
        limit: 1000
    })
    const { data: quotation_request_list, isLoading: quotation_request_list_loading, error: quotation_request_list_error, mutate : quotation_request_list_mutate } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ["*"],
            filters: [["procurement_task", "=", orderId]],
            limit: 2000
        },
        `Quotations Requests, Procurement_task=${orderId}`
    );

    const { data: category_data, isLoading: category_loading, error: category_error } = useFrappeGetDocList("Category", {
        fields: ["*"],
        limit: 1000
    })

    const { updateDoc: updateDoc, error: update_error } = useFrappeUpdateDoc()
    const {createDoc} = useFrappeCreateDoc()

    const getVendorName = (vendorName: string) => {
        return vendor_list?.find(vendor => vendor.name === vendorName).vendor_name;
    }
    const [categoryOptions, setCategoryOptions] = useState<{ label: string; value: string }[]>([]);
    const [page, setPage] = useState<string>('quotation')
    const [uniqueVendors, setUniqueVendors] = useState({
        list: []
    })
    const [orderData, setOrderData] = useState({
        project: '',
        work_package: '',
        procurement_list: {
            list: []
        },
        category_list: {
            list: []
        }
    })
    if (!orderData.project) {
        procurement_request_list?.map(item => {
            if (item.name === orderId) {
                setOrderData(item)
            }
        })
    }

    const isButtonDisabled = useCallback((vencat) => {
        const orderCategories = orderData?.category_list?.list || []
        return !orderCategories.every((category) => vencat.includes(category.name))
    }, [orderData, vendor_list])

    const { toast } = useToast()

    const handleAddVendor = async (vendor_name) => {

        const vendorId = vendor_list?.find((ven) => ven.vendor_name === vendor_name).name
        try {
            const promises = [];
            orderData?.procurement_list?.list.forEach((item) => {
                const newItem = {
                    procurement_task: orderData.name,
                    category: item.category,
                    item: item.name,
                    vendor: vendorId,
                    quantity: item.quantity
                };
                promises.push(createDoc("Quotation Requests", newItem));
            });

            await Promise.all(promises);

            // Mutate the vendor-related data
            // await mutate("Vendors");
            // await mutate("Quotation Requests");
            // await mutate("Vendor Category");
            vendor_list_mutate()
            quotation_request_list_mutate()

            toast({
                title: "Success!",
                description: `Vendor: ${vendor_name} Added Successfully!`,
                variant: "success"
            });
        } catch (error) {
            toast({
                title: "Failed!",
                description: `${error?.message}`,
                variant: "destructive"
            });
            console.error("There was an error while adding the vendor in update-quote", error);
        }
    }

    useEffect(() => {
        if (category_data) {
            const currOptions = category_data.map((item) => ({
                value: item.name,
                label: item.name + "(" + item.work_package.slice(0, 4).toUpperCase() + ")"
            }))
            setCategoryOptions(currOptions);
        }
    }, [category_data]);

    useEffect(() => {
        const vendors = uniqueVendors.list;
        quotation_request_list?.map((item) => {
            const value = item.vendor;
            vendors.push(value)
        })
        const removeDuplicates = (array) => {
            return Array.from(new Set(array));
        };
        const uniqueList = removeDuplicates(vendors);
        setUniqueVendors(prevState => ({
            ...prevState,
            list: uniqueList
        }));
    }, [quotation_request_list]);

    // console.log("orderData", orderData)


    const columns: ColumnDef<ProjectsType>[] = useMemo(
        () => [
            {
                accessorKey: "vendor_name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Vendor Name" />
                    )
                },
                cell: ({ row }) => {
                    const vendor_name = row.getValue("vendor_name")
                    const vendorCategories = row.getValue("vendor_category").categories || [];
                    return (
                        <>
                            {!isButtonDisabled(vendorCategories) && (
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant={"outline"} className="font-light max-md:text-xs border-green-500 py-6 flex flex-col items-start">
                                            <div className="w-[300px] text-wrap flex flex-col">
                                                <span className="text-red-500 font-semibold">{vendor_name}</span>
                                                <span>Add to PR</span>
                                            </div>
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Add Vendor to the current PR</AlertDialogTitle>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                <AlertDialogAction onClick={() => handleAddVendor(vendor_name)}>Add</AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogHeader>
                                    </AlertDialogContent>
                                </AlertDialog>
                            )}
                            {isButtonDisabled(vendorCategories) && (
                                <HoverCard>
                                    <HoverCardTrigger>
                                        <Button disabled={isButtonDisabled(vendorCategories)} variant={"outline"} className="font-light max-md:text-xs border-green-500 py-6 flex flex-col items-start">
                                            <div className="w-[250px] text-wrap flex flex-col">
                                                <span className="text-red-500 font-semibold">{row.getValue("vendor_name")}</span> <span>Add to PR</span>
                                            </div>
                                        </Button>
                                    </HoverCardTrigger>
                                    <HoverCardContent className="w-80">
                                        <div>Please add <span className="font-semibold underline">All Associated Categories of Current PR</span> to this vendor to enable</div>
                                    </HoverCardContent>
                                </HoverCard>
                            )}
                        </>
                    )
                }
            },

            {
                accessorKey: "creation",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Date Created" />
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
                accessorKey: "vendor_category",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Vendor Categories" />
                    )
                },
                cell: ({ row }) => {

                    const categories = row.getValue("vendor_category")
                    const vendor_name = row.getValue("vendor_name")
                    return (
                        <div className="space-x-1 space-y-1">
                            {categories?.categories.map((cat) => (
                                <Badge key={cat} >{cat}</Badge>
                            ))}
                            <Sheet>
                                <SheetTrigger>
                                    <button className="px-2 border flex gap-1 items-center rounded-md hover:bg-gray-200">
                                        <CirclePlus className="w-3 h-3" />
                                        <span>Add categories</span>
                                    </button>
                                </SheetTrigger>
                                <SheetContent className="overflow-auto">
                                    <AddVendorCategories vendor_name={vendor_name} isSheet={true} isSentBack={true} />
                                </SheetContent>
                            </Sheet>
                        </div>
                    )
                },
                // Implement filtering for the categories
                filterFn: (row, _columnId, filterValue: string[]) => {
                    const categories = row.getValue<string[]>("vendor_category")['categories'] || [];
                    return filterValue.every((filter) => categories.includes(filter));
                },
            },
        ],
        [orderData, isButtonDisabled, vendor_list]
    )

    const handleUpdateQuote = () => {
        updateDoc('Procurement Requests', orderId, {
            workflow_state: "Quote Updated",
        })
            .then(() => {
                console.log("orderId", orderId)
                navigate(`/procure-request/quote-update/select-vendors/${orderId}`);
            }).catch(() => {
                console.log("submit_error", update_error)
            })
    }

    return (
        <>
            {page == 'quotation' &&
                    <div className="flex-1 md:space-y-4 p-4">
                        <div className="flex items-center pt-1 pb-4">
                            <ArrowLeft className="cursor-pointer" onClick={() => navigate("/update-quote")} />
                            <h2 className="text-base pl-2 font-bold tracking-tight"><span className="text-red-700">PR-{orderData?.name?.slice(-4)}</span>: Update Quote</h2>
                        </div>
                        <Card className="flex md:grid md:grid-cols-4 gap-4 border border-gray-100 rounded-lg p-4">
                            <div className="border-0 flex flex-col justify-center max-sm:hidden">
                                <p className="text-left py-1 font-light text-sm text-sm text-red-700">Date:</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{formatDate(orderData?.creation?.split(" ")[0])}</p>
                            </div>
                            <div className="border-0 flex flex-col justify-center">
                                <p className="text-left py-1 font-light text-sm text-sm text-red-700">Project</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.project}</p>
                            </div>
                            <div className="border-0 flex flex-col justify-center">
                                <p className="text-left py-1 font-light text-sm text-sm text-red-700">Package</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.work_package}</p>
                            </div>
                            <div className="border-0 flex flex-col justify-center max-sm:hidden">
                                <p className="text-left py-1 font-light text-sm text-sm text-red-700">Project Lead</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.owner}</p>
                            </div>
                            {/* <div className="border-0 flex flex-col justify-center max-sm:hidden">
                                <p className="text-left py-1 font-light text-sm text-sm text-red-700">PR Number</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.name?.slice(-4)}</p>
                            </div> */}
                        </Card>
                        <div className="flex justify-between">
                            <div className="p-2 pl-7 font-light underline text-red-700">Selected Vendor List</div>
                            <div className="p-2 pl-7 font-light underline text-red-700 pr-32">Options</div>
                        </div>
                        {uniqueVendors.list.map((item) => {
                            return <div className="px-4 flex justify-between">
                                <div className="px-6 py-4 font-semibold whitespace-nowrap">{getVendorName(item)}</div>
                                <div className="flex space-x-2">
                                    <Sheet>
                                        <SheetTrigger className="border-2 border-opacity-50 border-red-500 text-red-500 bg-white font-normal px-4 my-2 rounded-lg"><div className="flex"><Download className="h-5 w-5 mt-0.5 mr-1" />RFQ PDF</div></SheetTrigger>
                                        <SheetContent className="overflow-auto">
                                            {/* <ScrollArea className="h-[90%] w-[600px] rounded-md border p-4"> */}
                                            <SheetHeader>
                                                <SheetTitle className="text-center">Print PDF</SheetTitle>
                                                <SheetDescription>
                                                    <PrintRFQ vendor_id={item} pr_id={orderData.name} itemList={orderData?.procurement_list || []} />
                                                </SheetDescription>
                                            </SheetHeader>
                                            {/* </ScrollArea> */}
                                        </SheetContent>
                                    </Sheet>
                                    {/* <button><ReleasePO vendorId = {vendorId}/></button> */}
                                        <Sheet>
                                            <SheetTrigger className="border-2 border-opacity-50 border-red-500 text-red-500 bg-white font-normal px-4 my-2 rounded-lg">Enter Price(s)</SheetTrigger>
                                            <SheetContent className="overflow-auto">
                                                {/* <ScrollArea className="h-[90%] w-[600px] p-2"> */}
                                                <SheetHeader className="text-start">
                                                    <div className="flex items-center gap-1">
                                                        <SheetTitle className="text-xl">Enter Price(s)</SheetTitle>
                                                        <Handshake className="w-5 h-5 text-primary" />
                                                    </div>
                                                    <SheetDescription>
                                                        <Card className="p-5">
                                                            <QuotationForm vendor_id={item} pr_id={orderData.name} />
                                                        </Card>
                                                    </SheetDescription>
                                                </SheetHeader>
                                                {/* </ScrollArea> */}
                                            </SheetContent>
                                        </Sheet>
                                </div>
                            </div>
                        })}
                        <div className="font-light text-sm text-slate-500 px-10 py-6">
                            <span className="text-red-700">Notes:</span> You can download RFQ PDFs for individual vendors for getting quotes
                        </div>
                        <Sheet>
                            <SheetTrigger className="text-blue-500"><div className="flex pl-5"><CirclePlus className="w-4 mr-2" />Add New Vendor</div></SheetTrigger>
                            <SheetContent className="overflow-auto">
                                <SheetHeader className="text-start">
                                    <SheetTitle>Add New Vendor for "{orderData.name}"</SheetTitle>
                                    <SheetDescription>
                                        <div className="flex-1">
                                            <span className=" text-slim text-sm text-red-700">Note:</span>
                                            <p className="text-xs"> - This will add a new vendor entry within the system. Only add new vendors here.</p>
                                            <p className="text-xs"> - This form will automatically add vendors categories from this PR/SB to the vendor.</p>
                                        </div>
                                        <NewVendor dynamicCategories={orderData?.category_list?.list?.map(item => item.name) || []} prData={orderData} renderCategorySelection={false} navigation={false} />
                                    </SheetDescription>
                                </SheetHeader>
                            </SheetContent>
                        </Sheet>
                        <div className="flex flex-col justify-end items-end">
                            <Button className="font-normal py-2 px-6" onClick={handleUpdateQuote}>
                                Update Quote
                            </Button>
                        </div>

                        <Accordion type="multiple" defaultValue={["Vendors"]}>
                            <AccordionItem value="Vendors">
                                <AccordionTrigger>
                                    <div className="md:mb-2 text-base md:text-lg px-2  w-full text-left">
                                        <div className="flex-1">
                                            <span className=" text-base mb-0.5 md:text-lg font-slim">Recently Added Vendors List</span>
                                            <div className="text-sm text-gray-400">Here you can add previosuly added vendors to this PR. You can also update a previously added vendor`s <span className="text-red-700 italic">category</span> </div>
                                        </div>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <div className="">
                                        <Card className=''>
                                            <CardHeader>
                                                <CardContent>
                                                    <DataTable columns={columns} data={vendor_list?.filter((ven) => !uniqueVendors?.list?.includes(ven.name)) || []} category_options={categoryOptions} />
                                                </CardContent>
                                            </CardHeader>
                                        </Card>
                                    </div>
                                </AccordionContent>
                            </AccordionItem>
                        </Accordion>
                    </div>}
        </>
    )
}