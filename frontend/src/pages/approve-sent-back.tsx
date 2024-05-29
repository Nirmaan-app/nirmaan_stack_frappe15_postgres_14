import { ArrowLeft } from 'lucide-react';
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button"
import { useFrappeGetDocList, useFrappeCreateDoc, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { MainLayout } from '@/components/layout/main-layout';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
    SheetClose
} from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"

export const ApproveSentBack = () => {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()

    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'category_list', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'creation']
        });
    const { data: item_list, isLoading: item_list_loading, error: item_list_error } = useFrappeGetDocList("Items",
        {
            fields: ['name', 'item_name', 'unit_name']
        });
    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error } = useFrappeGetDocList("Vendors",
        {
            fields: ['name', 'vendor_name', 'vendor_address','vendor_gst']
        });
    const { data: project_list, isLoading: project_list_loading, error: project_list_error } = useFrappeGetDocList("Projects",
        {
            fields: ['name', 'project_name', 'project_address']
        });
    const { data: quotation_request_list, isLoading: quotation_request_list_loading, error: quotation_request_list_error } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['name', 'project', 'item', 'category', 'vendor', 'procurement_task', 'quote','lead_time'],
            filters: [["is_selected", "=", "True"]]
        });
    const { data: sent_back_list, isLoading: sent_back_list_loading, error: sent_back_list_error } = useFrappeGetDocList("Sent Back Category",
        {
            fields: ['name','item_list', 'workflow_state','procurement_request','category','project_name','vendor','creation','owner'],
            filters:[["workflow_state","=","Vendor Selected"]]
        });


    const [page, setPage] = useState<string>('approvequotation')
    const [orderData, setOrderData] = useState({
        project_name: '',
        category: ''
    })
    if (!orderData.project_name) {
        sent_back_list?.map(item => {
            if (item.name === id) {
                setOrderData(item)
            }
        })
    }
    const [comment,setComment] = useState('')

    const getVendorName = (vendorName: string) => {
        return vendor_list?.find(vendor => vendor.name === vendorName)?.vendor_name;
    }
    const getVendorAddress = (vendorName: string) => {
        return vendor_list?.find(vendor => vendor.name === vendorName)?.vendor_address;
    }
    const getVendorGST = (vendorName: string) => {
        return vendor_list?.find(vendor => vendor.name === vendorName)?.vendor_gst;
    }
    const getProjectName = (projectName: string) => {
        return project_list?.find(project => project.name === projectName)?.project_name;
    }
    const getProjectAddress = (projectName: string) => {
        return project_list?.find(project => project.name === projectName)?.project_address;
    }
    const getItem = (item: string) => {
        const item_name = item_list?.find(value => value.name === item).item_name;
        return item_name
    }
    const getUnit = (item: string) => {
        const item_unit = item_list?.find(value => value.name === item).unit_name;
        return item_unit
    }

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    const { updateDoc: updateDoc, loading: update_loading, isCompleted: update_submit_complete, error: update_submit_error } = useFrappeUpdateDoc()

    const handleSendBack = (cat: string) => {
        updateDoc('Sent Back Category', id, {
            comments: comment,
            workflow_state: "Pending"
        })
            .then(() => {
                console.log("item", id)
                navigate("/")
            }).catch(() => {
                console.log("update_submit_error",update_submit_error)
            })
    }
    const curCategory = orderData.category
    
    const handleApprove = (cat: string) => {
        const order_list = {
            list:[]
        };
        orderData.item_list?.list.map((value)=>{
                const newItem = {
                    name:value.name,
                    item: getItem(value.name),
                    unit: getUnit(value.name),
                    quantity: value.quantity,
                    quote: value.quote
                }
                order_list.list.push(newItem)
        })
        const newProcurementOrder = {
            procurement_request: orderData.procurement_request,
            project: orderData.project_name,
            project_name: getProjectName(orderData.project_name),
            project_address: getProjectAddress(orderData.project_name),
            category: curCategory,
            vendor: orderData.vendor,
            vendor_name: getVendorName(orderData.vendor),
            vendor_address: getVendorAddress(orderData.vendor),
            vendor_gst: getVendorGST(orderData.vendor),
            order_list: order_list
        }
        createDoc('Procurement Orders', newProcurementOrder)
            .then(() => {
                console.log(newProcurementOrder);
                navigate("/")
            })
            .catch(() => {
                console.log("submit_error",submit_error);
            })
        updateDoc('Sent Back Category', id, {
                workflow_state: "Approved"
            })
                .then(() => {
                    console.log("item", id)
                    navigate("/")
                }).catch(() => {
                    console.log("update_submit_error",update_submit_error)
                })
        
    }

    const getTotal = (cat: string) => {
        let total: number = 0;
        orderData.item_list?.list.map((item) => {
            const price = item.quote;
            total += price ? parseFloat(price) : 0;
        })
        return total
    }

    return (
        <MainLayout>
            <div className="flex" >
                <div className="flex-1 space-x-2 md:space-y-4 p-2 md:p-12 pt-6">
                    <div className="flex items-center space-y-2">
                        {/* <ArrowLeft /> */}
                        <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">Comparison</h2>
                    </div>
                    <div className="grid grid-cols-5 gap-4 border border-gray-100 rounded-lg p-4">
                        <div className="border-0 flex flex-col items-center justify-center">
                            <p className="text-left py-1 font-semibold text-sm text-gray-300">Date</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.creation?.split(" ")[0]}</p>
                        </div>
                        <div className="border-0 flex flex-col items-center justify-center">
                            <p className="text-left py-1 font-semibold text-sm text-gray-300">Project</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.project_name}</p>
                        </div>
                        <div className="border-0 flex flex-col items-center justify-center">
                            <p className="text-left py-1 font-semibold text-sm text-gray-300">Category</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.category}</p>
                        </div>
                        <div className="border-0 flex flex-col items-center justify-center">
                            <p className="text-left py-1 font-semibold text-sm text-gray-300">Project Lead</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.owner}</p>
                        </div>
                        <div className="border-0 flex flex-col items-center justify-center">
                            <p className="text-left py-1 font-semibold text-sm text-gray-300">PR Number</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.procurement_request?.slice(-4)}</p>
                        </div>
                    </div>
                        <div className="w-full">
                            <div className="font-bold text-xl py-2">{orderData.category}</div>
                            <Card className="flex w-1/2 shadow-none border border-grey-500" >
                                <CardHeader className="w-full">
                                    <CardTitle>
                                        <div className="text-sm text-gray-400">Selected Vendor</div>
                                        <div className="flex justify-between border-b">
                                            <div className="font-bold text-lg py-2 border-gray-200">{getVendorName(orderData.vendor)}</div>
                                            <div className="font-bold text-2xl text-red-500 py-2 border-gray-200">{getTotal(curCategory)}</div>
                                        </div>
                                    </CardTitle>
                                    {orderData.item_list?.list.map((item) => {
                                        const price = item.quote;
                                            return <div className="flex justify-between py-2">
                                                <div className="text-sm">{item.item}</div>
                                                <div className="text-sm">{price}</div>
                                            </div>
                                        
                                    })}
                                </CardHeader>
                            </Card>
                            <div className="py-4 flex justify-between">
                            <Sheet>
                                <SheetTrigger className="border border-red-500 text-red-500 bg-white font-normal px-4 py-1 rounded-lg">Add Comment and Send Back</SheetTrigger>
                                <SheetContent>
                                <ScrollArea className="h-[90%] w-[600px] rounded-md border p-4">
                                    <SheetHeader>
                                        <SheetTitle>Enter Price</SheetTitle>
                                        <SheetDescription>
                                            Add Comments and Send Back
                                            <div className="flex justify-between py-2">
                                                <div className="text-sm w-1/2">Added Items</div>
                                                <div className="text-sm">Qty</div>
                                                <div className="text-sm">UOM</div>
                                                <div className="text-sm">Quote</div>
                                            </div>
                                            {orderData.item_list?.list.map((item) => {
                                                    return <div className="flex justify-between py-2">
                                                        <div className="text-sm w-1/2 text-black font-semibold">{item.item}</div>
                                                        <div className="text-sm text-black font-semibold">{item.quantity}</div>
                                                        <div className="text-sm text-black font-semibold">{item.unit}</div>
                                                        <div className="text-sm text-black font-semibold">{item.quote}</div>
                                                    </div>
                                            })}
                                            
                                            <div className="py-2"><label htmlFor="textarea" >Comment:</label></div>
                                                <textarea
                                                    id="textarea"
                                                    className="w-full border rounded-lg p-2"
                                                    value={comment}
                                                    placeholder="Type your comments here"
                                                    onChange={(e) => setComment(e.target.value)}
                                                />
                                            <div className="flex flex-col justify-end items-end fixed bottom-4 right-4">
                                            <SheetClose><Button onClick={()=>handleSendBack(curCategory)}>Submit</Button></SheetClose>
                                            </div>
                                        </SheetDescription>
                                    </SheetHeader>
                                    </ScrollArea>
                                </SheetContent>
                            </Sheet>
                            <Button onClick={() => handleApprove(curCategory)}>Approve</Button>
                            </div>
                        </div>
                </div>
            </div>
        </MainLayout>
    )
}