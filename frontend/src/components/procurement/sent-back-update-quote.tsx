import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet"
import { ArrowLeft, CirclePlus } from 'lucide-react';
import SentBackQuotationForm from "./sent-back-quotation-form"
import { useFrappeCreateDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { useParams } from "react-router-dom";
import { useState, useEffect, useMemo, useCallback } from "react"
import { useNavigate } from "react-router-dom";
import { Button } from "../ui/button";
import { NewVendor } from "@/pages/vendors/new-vendor";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ColumnDef } from "@tanstack/react-table";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { formatDate } from '@/utils/FormatDate';
import { Badge } from "../ui/badge";
import { AddVendorCategories } from "../forms/addvendorcategories";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../ui/accordion";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DataTable } from "../data-table/data-table";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { useToast } from "../ui/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@radix-ui/react-dialog";
import { DialogHeader } from "../ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../ui/alert-dialog";

export const SentBackUpdateQuote = () => {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate();

    const { data: category_data, isLoading: category_loading, error: category_error } = useFrappeGetDocList("Category", {
        fields: ["*"],
        limit: 1000
    })

    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'category_list', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'creation'],
            limit: 1000
        });

    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error, mutate: vendor_list_mutate } = useFrappeGetDocList("Vendors",
        {
            fields: ["*"],
            limit: 1000
        },
        "Vendors"
    );
    const { data: quotation_request_list, isLoading: quotation_request_list_loading, error: quotation_request_list_error, mutate: quotation_request_list_mutate } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ["*"],
            limit: 10000
        },
        "Quotation Requests"
    );

    const { data: sent_back_list, isLoading: sent_back_list_loading, error: sent_back_list_error } = useFrappeGetDocList("Sent Back Category",
        {
            fields: ['owner', 'name', 'workflow_state', 'procurement_request', 'category_list', 'project', 'creation', 'item_list', 'comments'],
            filters: [["workflow_state", "=", "Pending"]],
            limit: 1000
        });

    const [categoryOptions, setCategoryOptions] = useState<{ label: string; value: string }[]>([]); // State for dynamic category options

    const getVendorName = (vendorName: string) => {
        return vendor_list?.find(vendor => vendor.name === vendorName)?.vendor_name;
    }
    const getPackage = (name: string) => {
        return procurement_request_list?.find(item => item.name === name)?.work_package;
    }

    const [page, setPage] = useState<string>('summary')
    const [uniqueVendors, setUniqueVendors] = useState({
        list: []
    })
    const [orderData, setOrderData] = useState({
        project: ''
    })

    const {createDoc} = useFrappeCreateDoc()

    useEffect(() => {
        sent_back_list?.map(item => {
            if (item.name === id) {
                setOrderData(item)
            }
        })
    }, [sent_back_list]);

    useEffect(() => {
        if (category_data) {
            const currOptions = category_data.map((item) => ({
                value: item.name,
                label: item.name + "(" + item.work_package.slice(0, 4).toUpperCase() + ")"
            }))
            setCategoryOptions(currOptions);
        }
    }, [category_data]);

    // console.log("uniqueVendors", uniqueVendors)

    // console.log("orderData", orderData)

    useEffect(() => {
        if (orderData.project) {
            const vendors = uniqueVendors.list;
            // vendor_list?.map((item) => (item.vendor_category.categories)[0] === (orderData.category_list.list)[0].name && vendors.push(item.name))
            quotation_request_list?.map((item) => {
                const isPresent = orderData.category_list.list.find(cat => cat.name === item.category)
                const isSameItem = orderData.item_list.list.find(i => i.name === item.item)
                if (orderData.procurement_request === item.procurement_task && isPresent && isSameItem) {
                    const value = item.vendor;
                    vendors.push(value)
                }
            })
            const removeDuplicates = (array) => {
                return Array.from(new Set(array));
            };
            const uniqueList = removeDuplicates(vendors);
            setUniqueVendors({
                list: uniqueList
            });
        }
    }, [quotation_request_list, orderData, vendor_list]);

    // console.log("orderData", orderData)

    console.log("uniquevendors", uniqueVendors)

    const handleUpdateQuote = () => {
        navigate(`/sent-back-request/select-vendor/${id}`);
    }

    const isButtonDisabled = useCallback((vencat) => {
        const orderCategories = orderData?.category_list?.list || []
        return !orderCategories.every((category) => vencat.includes(category.name))
    }, [orderData, vendor_list])

    const {toast} = useToast()

    const handleAddVendor = async (vendor_name) => {

        const vendorId = vendor_list?.find((ven) => ven.vendor_name === vendor_name).name
        try {
            const promises = [];
                orderData?.item_list?.list.forEach((item) => {
                    const newItem = {
                        procurement_task: orderData.procurement_request,
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
                    description: "Vendor Added Successfully!",
                    variant: "success"
                });
        } catch (error) {
            toast({
                title: "Failed!",
                description: `${error?.message}`,
                variant: "destructive"
            });
            console.error("Submit Error", error);
        }
    }


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
                                            <span>Add to Sent Back</span>
                                        </div>
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Add Vendor to the current Sent Back</AlertDialogTitle>
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
                                <HoverCardTrigger asChild>
                                    <div>
                                    <Button disabled={isButtonDisabled(vendorCategories)} variant={"outline"} className="font-light max-md:text-xs border-green-500 py-6 flex flex-col items-start">
                                        <div className="w-[300px] text-wrap flex flex-col">
                                            <span className="text-red-500 font-semibold">{row.getValue("vendor_name")}</span> <span>Add to Sent Back</span>
                                        </div>
                                    </Button>
                                    </div>
                                </HoverCardTrigger>
                                <HoverCardContent className="w-80">
                                    <div>Please add <span className="font-semibold underline">All Associated Categories of Current Sent Back</span> to this vendor to enable</div>
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
                                <SheetContent>
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

    return (
        <>
            {page == 'summary' &&
                <div className="flex">
                    <div className="flex-1 space-x-2 md:space-y-4 p-2 md:p-6 pt-6">
                        <div className="flex items-center pt-1 pb-4">
                            <ArrowLeft className="cursor-pointer" onClick={() => navigate('/sent-back-request')} />
                            <h2 className="text-base pl-2 font-bold tracking-tight">Select Vendor</h2>
                        </div>
                        <Card className="grid grid-cols-5 gap-4 border border-gray-100 rounded-lg p-4">

                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">Sent Back ID</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.name}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">PR Number</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.procurement_request?.slice(-4)}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">Date</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.creation?.split(" ")[0]}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">Project</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.project}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">Package</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{getPackage(orderData?.procurement_request)}</p>
                            </div>

                        </Card>
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-gray-200">
                                <thead className="border-b-2 border-black">
                                    <tr>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider pr-32">Items</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">UOM</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rate</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {orderData.item_list?.list.map(item => (
                                        <tr key={item.name}>
                                            <td className="px-6 py-4 pr-32 border-b-0">{item.item}</td>
                                            <td className="px-6 py-4 whitespace-nowrap">{item.unit}</td>
                                            <td className="px-6 py-4 whitespace-nowrap">{item.quantity}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                                {item.quote}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                                {item.quote * item.quantity}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex items-center space-y-2 pt-8">
                            <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">Sent Back Comments</h2>
                        </div>
                        <div className="border border-gray-200 rounded-lg p-4 font-semibold text-sm">
                            {orderData.comments}
                        </div>
                        <div className="flex flex-col justify-end items-end mt-4">
                            <Button onClick={() => setPage('quotation')}>
                                Next
                            </Button>
                        </div>
                    </div>
                </div>}
            {
                page == 'quotation' &&
                <div className="flex">
                    <div className="flex-1 space-x-2 md:space-y-4 p-2 md:p-6 pt-6">
                        <div className="flex items-center pt-1  pb-4">
                            <ArrowLeft className="cursor-pointer" onClick={() => setPage('summary')} />
                            <h2 className="text-base pl-2 font-bold tracking-tight">Update Quote</h2>
                        </div>
                        <Card className="grid grid-cols-5 gap-4 border border-gray-100 rounded-lg p-4">
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">Sent Back ID</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.name}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">PR Number</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.procurement_request?.slice(-4)}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">Date</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.creation?.split(" ")[0]}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">Project</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.project}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">Package</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{getPackage(orderData?.procurement_request)}</p>
                            </div>
                        </Card>
                        {uniqueVendors.list.map((item) => {
                            return <div className="px-4 flex justify-between">
                                <div className="py-4 font-semibold whitespace-nowrap">{getVendorName(item)}</div>
                                <Sheet>
                                    <SheetTrigger className="border-2 border-opacity-50 border-red-500 text-red-500 bg-white font-normal px-4 my-2 rounded-lg">Enter Price</SheetTrigger>
                                    <SheetContent >
                                        {/* <ScrollArea className="h-[90%] w-[600px] rounded-md border p-4"> */}
                                            <SheetHeader className="text-start">
                                                <SheetTitle>Enter Price</SheetTitle>
                                                <SheetDescription>
                                                    <SentBackQuotationForm vendor_id={item} pr_id={orderData.procurement_request} sb_id={id} />
                                                </SheetDescription>
                                            </SheetHeader>
                                        {/* </ScrollArea> */}
                                    </SheetContent>
                                </Sheet>
                            </div>
                        })}
                        <Sheet>
                            <SheetTrigger className="text-blue-500"><div className="flex pl-5"><CirclePlus className="w-4 mr-2" />Add New Vendor</div></SheetTrigger>
                            <SheetContent className="overflow-auto">
                                <SheetHeader className="text-start">
                                    <SheetTitle>Add New Vendor for "{orderData.name}"</SheetTitle>
                                    <SheetDescription>
                                        {/* <SentBackVendorForm quotation_request_list_mutate={quotation_request_list_mutate} sent_back_data={orderData} vendor_list_mutate={vendor_list_mutate} /> */}
                                        <NewVendor dynamicCategories={orderData?.category_list?.list?.map(item => item.name) || []} sentBackData={orderData} renderCategorySelection={false} navigation={false} />
                                    </SheetDescription>
                                </SheetHeader>
                            </SheetContent>
                        </Sheet>
                        <div className="flex flex-col justify-end items-end">
                            <Button className="font-normal py-2 px-6" onClick={handleUpdateQuote}>
                                Update Quote
                            </Button>
                        </div>

                        <div className="pl-2 flex gap-1 items-center pt-10 flex-wrap">
                            <span className="font-light max-md:text-sm">All Categories of this Sent Back: </span>
                            {orderData?.category_list?.list.map((cat) => (
                                <Badge>{cat.name}</Badge>
                            ))}
                        </div>

                        <Accordion type="multiple" >
                            <AccordionItem value="Vendors">
                                <AccordionTrigger>
                                    <Button variant="ghost" size="lg" className="md:mb-2 text-base md:text-lg px-2  w-full justify-start">
                                        <span className=" text-base mb-0.5 md:text-lg font-slim">Add Existing Vendors</span>
                                    </Button>
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
                    </div>
                </div>
            }
        </>
    )
}