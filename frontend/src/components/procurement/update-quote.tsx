import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet"
import { ArrowLeft, Download, Handshake } from 'lucide-react';
import QuotationForm from "./quotation-form"

import { useFrappeGetDocList, useFrappeCreateDoc, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useParams } from "react-router-dom";
import { useState, useEffect } from "react"
import { Link, useNavigate } from "react-router-dom";
import { PrintRFQ } from "./rfq-pdf";
import { Card } from "../ui/card";
import { Button } from '@/components/ui/button';
import { formatDate } from "@/utils/FormatDate";

export const UpdateQuote = () => {
    const { orderId } = useParams<{ orderId: string }>()
    const navigate = useNavigate();

    const { data: category_list, isLoading: category_list_loading, error: category_list_error } = useFrappeGetDocList("Category",
        {
            fields: ['category_name', 'work_package'],
            orderBy: { field: 'category_name', order: 'asc' },
            limit: 100
        });
    const { data: item_list, isLoading: item_list_loading, error: item_list_error } = useFrappeGetDocList("Items",
        {
            fields: ['name', 'item_name', 'unit_name', 'category'],
            limit: 1000
        });
    const { data: project_list, isLoading: project_list_loading, error: project_list_error } = useFrappeGetDocList("Projects",
        {
            fields: ['name', 'project_name', 'project_address']
        });
    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'category_list', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'creation'],
            limit: 100
        });
    const { data: vendor_category_list, isLoading: vendor_category_list_loading, error: vendor_category_list_error } = useFrappeGetDocList("Vendor Category",
        {
            fields: ['vendor', 'category'],
            limit: 1000
        });
    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error } = useFrappeGetDocList("Vendors",
        {
            fields: ['name', 'vendor_name', 'vendor_address'],
            limit: 1000
        });
    const { data: quotation_request_list, isLoading: quotation_request_list_loading, error: quotation_request_list_error } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['name', 'item', 'category', 'vendor', 'procurement_task', 'quote'],
            filters: [["procurement_task", "=", orderId]],
            limit: 2000
        });
    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    const { updateDoc: updateDoc } = useFrappeUpdateDoc()

    const getVendorName = (vendorName: string) => {
        return vendor_list?.find(vendor => vendor.name === vendorName).vendor_name;
    }
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



    const handleUpdateQuote = () => {
        updateDoc('Procurement Requests', orderId, {
            workflow_state: "Quote Updated",
        })
            .then(() => {
                console.log("orderId", orderId)
                navigate(`/procure-request/quote-update/select-vendors/${orderId}`);
            }).catch(() => {
                console.log("submit_error", submit_error)
            })
    }

    return (
        // <MainLayout>
        <>
            {page == 'quotation' &&
                <div className="flex">
                    <div className="flex-1 space-x-2 md:space-y-4 p-2 md:p-6 pt-6">
                        <div className="flex items-center pt-1 pb-4">
                            <ArrowLeft onClick={() => navigate("/update-quote")} />
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
                                        <SheetContent>
                                            {/* <ScrollArea className="h-[90%] w-[600px] rounded-md border p-4"> */}
                                            <SheetHeader>
                                                <SheetTitle className="text-center">Print PDF</SheetTitle>
                                                <SheetDescription>
                                                    <PrintRFQ vendor_id={item} pr_id={orderData.name} />
                                                </SheetDescription>
                                            </SheetHeader>
                                            {/* </ScrollArea> */}
                                        </SheetContent>
                                    </Sheet>
                                    {/* <button><ReleasePO vendorId = {vendorId}/></button> */}
                                    <div className="flex space-x-2">

                                        <Sheet>
                                            <SheetTrigger className="border-2 border-opacity-50 border-red-500 text-red-500 bg-white font-normal px-4 my-2 rounded-lg">Enter Prices</SheetTrigger>
                                            <SheetContent>
                                                {/* <ScrollArea className="h-[90%] w-[600px] p-2"> */}
                                                <SheetHeader className="text-start">
                                                    <div className="flex items-center gap-1">
                                                        <SheetTitle className="text-xl">Enter Price</SheetTitle>
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
                                {/* <Sheet>
                                    <SheetTrigger className="border-2 border-opacity-50 border-red-500 text-red-500 bg-white font-normal px-4 my-2 rounded-lg">Enter Price</SheetTrigger>
                                    <SheetContent>
                                        <ScrollArea className="h-[90%] w-[600px] rounded-md border p-4">
                                            <SheetHeader>
                                                <SheetTitle>Enter Price</SheetTitle>
                                                <SheetDescription>
                                                    <QuotationForm vendor_id={item} pr_id={orderData.name} />
                                                </SheetDescription>
                                            </SheetHeader>
                                        </ScrollArea>
                                    </SheetContent>
                                </Sheet> */}
                            </div>
                        })}
                        <div className="font-light text-sm text-slate-500 p-10">
                            <span className="text-red-700">Notes:</span> You can download RFQ PRFs for individual vendors for getting quotes
                        </div>
                        <div className="flex pt-10 pr-6 flex-col justify-end items-end">
                            <Button onClick={handleUpdateQuote}>
                                Update Quote
                            </Button>
                        </div>
                    </div>
                </div>}
        </>
        // </MainLayout>
    )
}