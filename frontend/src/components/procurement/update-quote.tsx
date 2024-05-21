import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet"
import { ArrowLeft } from 'lucide-react';
import QuotationForm from "./quotation-form"

import { useFrappeGetDocList, useFrappeCreateDoc, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useParams } from "react-router-dom";
import { useState,useEffect } from "react"
import { Link, useNavigate } from "react-router-dom";
import { MainLayout } from '../layout/main-layout';

export const UpdateQuote = () => {
    const { orderId } = useParams<{ orderId: string }>()
    const navigate = useNavigate();

    const { data: category_list, isLoading: category_list_loading, error: category_list_error } = useFrappeGetDocList("Category",
        {
            fields: ['category_name', 'work_package']
        });
    const { data: item_list, isLoading: item_list_loading, error: item_list_error } = useFrappeGetDocList("Items",
        {
            fields: ['name', 'item_name', 'unit_name', 'category']
        });
    const { data: project_list, isLoading: project_list_loading, error: project_list_error } = useFrappeGetDocList("Projects",
        {
            fields: ['name', 'project_name', 'project_address']
        });
    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'category_list', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'creation']
        });
    const { data: vendor_category_list, isLoading: vendor_category_list_loading, error: vendor_category_list_error } = useFrappeGetDocList("Vendor Category",
        {
            fields: ['vendor', 'category']
        });
    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error } = useFrappeGetDocList("Vendors",
        {
            fields: ['name', 'vendor_name', 'vendor_address']
        });
    const { data: quotation_request_list, isLoading: quotation_request_list_loading, error: quotation_request_list_error } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['name', 'project', 'item', 'category', 'vendor', 'procurement_task', 'quote']
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
        quotation_request_list?.map((item)=>{
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
                console.log(orderId)
                navigate(`/procure-request/quote-update/select-vendors/${orderId}`);
            }).catch(() => {
                console.log(submit_error)
            })
    }

    return (
        <MainLayout>
            {page == 'quotation' &&
                <div className="flex">
                    <div className="flex-1 space-x-2 md:space-y-4 p-2 md:p-12 pt-6">
                        <div className="flex items-center space-y-2">
                            <ArrowLeft />
                            <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">Orders</h2>
                        </div>
                        <div className="grid grid-cols-5 gap-4 border border-gray-100 rounded-lg p-4">
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
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.work_package}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">Project Lead</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.owner}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">PR Number</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.name?.slice(-4)}</p>
                            </div>
                        </div>
                        {uniqueVendors.list.map((item) => {
                            return <div className="px-4 flex justify-between">
                                <div className="px-6 py-4 font-semibold whitespace-nowrap">{getVendorName(item)}</div>
                                <Sheet>
                                    <SheetTrigger className="border-2 border-opacity-50 border-red-500 text-red-500 bg-white font-normal px-4 my-2 rounded-lg">Enter Price</SheetTrigger>
                                    <SheetContent>
                                        <SheetHeader>
                                            <SheetTitle>Enter Price</SheetTitle>
                                            <SheetDescription>
                                                <QuotationForm vendor_id={item} pr_id={orderData.name} />
                                            </SheetDescription>
                                        </SheetHeader>
                                    </SheetContent>
                                </Sheet>
                            </div>
                        })}
                        <div className="flex flex-col justify-end items-end fixed bottom-4 right-4">
                            <button className="bg-red-500 text-white font-normal py-2 px-6 rounded-lg" onClick={handleUpdateQuote}>
                                Update Quote
                            </button>
                        </div>
                    </div>
                </div>}
        </MainLayout>
    )
}