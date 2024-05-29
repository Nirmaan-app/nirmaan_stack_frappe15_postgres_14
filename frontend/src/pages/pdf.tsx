import { MainLayout } from "@/components/layout/main-layout";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Link } from "react-router-dom";
import { useState,useEffect,useRef } from "react"
import React from 'react';
import { useReactToPrint } from 'react-to-print';



export const PDF = () => {

    const { data: procurement_order_list, isLoading: procurement_order_list_loading, error: procurement_order_list_error } = useFrappeGetDocList("Procurement Orders",
        {
            fields: ['name','project_name', 'project_address', 'vendor_name', 'vendor_address', 'vendor_gst', 'order_list','creation']
        });
    const { data: quotation_request_list, isLoading: quotation_request_list_loading, error: quotation_request_list_error } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['name', 'project','quantity', 'item', 'category', 'vendor', 'procurement_task', 'quote'],
            filters: [["procurement_task","=","PT-PROJ-00001-22-05-2024-0004"],["vendor","=","VENDOR-Material-00005"]]
        });
    const [orderData, setOrderData] = useState({
        name:''
    });

    useEffect(() => {
        if (Array.isArray(procurement_order_list) && procurement_order_list.length > 0) {
            setOrderData(procurement_order_list[0]);
        }
    }, [procurement_order_list]);
    console.log(procurement_order_list)

      const [isPrinting, setIsPrinting] = useState(false);
        const componentRef = React.useRef();

        const handlePrint = useReactToPrint({
            content: () => componentRef.current,
        });

        const togglePrintMode = () => {
            setIsPrinting(prevState => !prevState);
            if (!isPrinting) {
            handlePrint();
            }
        };

    return (
        // PO pdf
        <div className="align-center">
            <div ref={componentRef} className="w-full my-4 border rounded-md p-4">
                <div className="flex justify-between border-b-2 border-gray-600 pb-3 mb-3">
                    <div>
                        <div className="text-3xl text-red-600 font-bold">Nirmaan</div>
                        <div className="py-2 text-lg text-gray-500 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
                    </div>
                    <div>
                        <div className="pb-2 pt-4 text-lg text-gray-600 font-semibold">Purchase Order</div>
                        <div className="text-base text-black font-bold">PO # : {orderData.name}</div>
                    </div>
                </div>
                <div className="text-gray-500 text-sm py-2">Vendor Address</div>
                <div className="text-sm font-medium text-gray-900 break-words max-w-[280px]">{orderData.vendor_address}</div>
                <div className="text-sm font-medium text-gray-900">GSTIN: {orderData.vendor_gst}</div>
                <div className="flex justify-between">
                    <div>
                        <h3 className="text-gray-500 text-sm py-2">Delivery Location</h3>
                        <div className="text-sm font-medium text-gray-900 break-words max-w-[280px]">{orderData.project_address}</div>
                    </div>
                    <div className="pt-4">
                        <div className="text-sm font-medium text-gray-900"><span className="text-gray-500 font-normal">Date:</span>&nbsp;&nbsp;&nbsp;{orderData.creation?.split(" ")[0]}</div>
                        <div className="text-sm font-medium text-gray-900"><span className="text-gray-500 font-normal">Project Name:</span>&nbsp;&nbsp;&nbsp;{orderData.project_name}</div>
                    </div>
                </div>
                <div className="overflow-x-auto pt-4">
                        <table className="min-w-full divide-gray-200">
                            <thead className="border-b border-black">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-800 tracking-wider pr-48">Items</th>
                                    <th scope="col" className="px-2 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Quantity</th>
                                    <th scope="col" className="px-2 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Rate</th>
                                    <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Amount</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                    {orderData?.order_list?.list.map((item)=>
                                        {return <tr className="">
                                        <td className="px-6 py-4 text-sm whitespace-nowrap">{item.item}</td>
                                        <td className="px-6 py-4 text-sm whitespace-nowrap">
                                            {item.quantity}
                                        </td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">{item.quote}</td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">N/A</td>
                                    </tr>})}
                            </tbody>
                        </table>
                    </div>
            </div>
            <button onClick={togglePrintMode} className="mt-4 p-2 bg-blue-500 text-white">{isPrinting ? 'Exit Print Mode' : 'Print'}</button>
            {/* RFQ pdf */}
            <div className="ml-80 w-[580px] my-4 border rounded-md p-4">
                <div className="flex justify-between border-b-2 border-gray-600 pb-3 mb-3">
                    <div>
                        <div className="text-3xl text-red-600 font-bold">Nirmaan</div>
                        <div className="py-2 text-lg text-gray-500 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
                    </div>
                </div>
                <div className="grid grid-cols-4 justify-between border border-gray-100 rounded-lg p-4">
                    <div className="border-0 flex flex-col">
                        <p className="text-left py-1 font-medium  text-xs text-gray-500">Date</p>
                        <p className="text-left font-bold py-1 font-semibold text-sm text-black">{orderData?.creation?.split(" ")[0]}</p>
                    </div>
                    <div className="border-0 flex flex-col">
                         <p className="text-left py-1 font-medium text-xs text-gray-500">Project</p>
                        <p className="text-left font-bold py-1 font-semibold text-sm text-black">{orderData?.project_name}</p>
                    </div>
                    <div className="border-0 flex flex-col">
                        <p className="text-left py-1 font-medium  text-xs text-gray-500">Address</p>
                        <p className="text-left font-bold py-1 font-semibold text-sm text-black truncate pr-4">{orderData.project_address}</p>
                    </div>
                    <div className="border-0 flex flex-col">
                        <p className="text-left py-1 font-medium  text-xs text-gray-500">For</p>
                        <p className="text-left font-bold py-1 font-semibold text-sm text-black">{orderData.vendor_name}</p>
                    </div>
                </div>
                <div className="overflow-x-auto pt-4">
                        <table className="min-w-full divide-gray-200">
                            <thead className="border-b border-black">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-800 tracking-wider pr-32">Items</th>
                                    <th scope="col" className="px-2 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Category</th>
                                    <th scope="col" className="px-2 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Unit</th>
                                    <th scope="col" className="px-2 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Quantity</th>
                                    <th scope="col" className="px-2 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Price</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                    {quotation_request_list?.map((item)=>
                                        {return <tr className="">
                                        <td className="px-6 py-2 text-sm whitespace-nowrap">{item.item}</td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">
                                            {item.category}
                                        </td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">meter</td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">{item.quantity}</td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">{}</td>
                                    </tr>})}
                            </tbody>
                        </table>
                    </div>
            </div>
        </div>
    )
}