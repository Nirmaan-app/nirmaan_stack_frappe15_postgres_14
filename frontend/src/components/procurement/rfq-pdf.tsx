import { MainLayout } from "@/components/layout/main-layout";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Link } from "react-router-dom";
import { useState, useEffect, useRef } from "react"
import React from 'react';
import { useReactToPrint } from 'react-to-print';
import redlogo from "@/assets/red-logo.png"

export const PrintRFQ = ({ pr_id, vendor_id }) => {

    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'category_list', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'creation'],
            filters: [["name", "=", pr_id]],
            limit: 100
        });
    const { data: quotation_request_list, isLoading: quotation_request_list_loading, error: quotation_request_list_error } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['name', 'quantity', 'item', 'category', 'vendor', 'procurement_task', 'quote'],
            filters: [["procurement_task", "=", pr_id], ["vendor", "=", vendor_id]],
            limit: 1000
        });
    const { data: project_list, isLoading: project_list_loading, error: project_list_error } = useFrappeGetDocList("Projects",
        {
            fields: ['name', 'project_name', 'project_address']
        });
    const { data: address_list, isLoading: address_list_loading, error: address_list_error } = useFrappeGetDocList("Address",
        {
            fields: ['name', 'address_title', 'address_line1', 'city', 'state', 'pincode']
        });
    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error } = useFrappeGetDocList("Vendors",
        {
            fields: ['name', 'vendor_name', 'vendor_address', 'vendor_city'],
            limit: 1000
        });
    const [orderData, setOrderData] = useState({
        name: ''
    });

    useEffect(() => {
        if (Array.isArray(procurement_request_list) && procurement_request_list.length > 0) {
            setOrderData(procurement_request_list[0]);
        }
    }, [procurement_request_list]);

    const getItem = (item: string) => {
        const item_name = orderData?.procurement_list?.list.find(value => value.name === item)?.item;
        return item_name
    }
    const getProjectAddress = (item: string) => {
        const id = project_list?.find(value => value.name === item)?.project_address;
        const doc = address_list?.find(item => item.name === id);
        const address = `${doc?.address_title}, ${doc?.address_line1}, ${doc?.city}, ${doc?.state}, PIN-${doc?.pincode}`
        return address
    }
    const getVendorName = (item: string) => {
        const name = vendor_list?.find(value => value.name === item)?.vendor_name;
        return name
    }
    const getVendorCity = (item: string) => {
        const name = vendor_list?.find(value => value.name === item)?.vendor_city;
        return name
    }
    const getProjectName = (item: string) => {
        const name = project_list?.find(value => value.name === item)?.project_name;
        return name
    }


    const [isPrinting, setIsPrinting] = useState(false);
    const componentRef = React.useRef();

    const handlePrint = useReactToPrint({
        content: () => componentRef.current,
        documentTitle: `${getVendorName(vendor_id)}_${getVendorCity(vendor_id)}`
    });
    // const testQuotationRequestList = [];
    // if(quotation_request_list){for (let i = 0; i < 100; i++) {
    //     testQuotationRequestList.push(...quotation_request_list);
    // }}

    return (
        <div className="align-center">
            {/* RFQ pdf */}
            <div ref={componentRef} className="px-4 pb-4">
                {/* <div className="flex justify-between border-b-2 border-gray-600 pb-3 mb-3">
                    <div>
                        <img className="w-44" src={redlogo} alt="Nirmaan" />
                        <div className="py-2 text-lg text-gray-500 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
                    </div>
                </div>  */}
                {/* <div className="grid grid-cols-4 justify-between border border-gray-100 rounded-lg p-4">
                    <div className="border-0 flex flex-col">
                        <p className="text-left py-1 font-medium  text-xs text-gray-500">Date</p>
                        <p className="text-left font-bold py-1 font-semibold text-sm text-black">{orderData?.creation?.split(" ")[0]}</p>
                    </div>
                    <div className="border-0 flex flex-col">
                         <p className="text-left py-1 font-medium text-xs text-gray-500">Project</p>
                        <p className="text-left font-bold py-1 font-semibold text-sm text-black">{getProjectName(orderData?.project)}</p>
                    </div>
                    <div className="border-0 flex flex-col">
                        <p className="text-left py-1 font-medium  text-xs text-gray-500">Address</p>
                        <p className="text-left font-bold py-1 font-semibold text-sm text-black truncate pr-4">{getProjectAddress(orderData?.project)}</p>
                    </div>
                    <div className="border-0 flex flex-col">
                        <p className="text-left py-1 font-medium  text-xs text-gray-500">For</p>
                        <p className="text-left font-bold py-1 font-semibold text-sm text-black">{getVendorName(vendor_id)}</p>
                    </div>
                </div> */}
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="w-full border-b border-black">
                            <tr>
                                <th colSpan="5" className="p-0">
                                    <div className="mt-6 flex justify-between">
                                        <div>
                                            <img className="w-44" src={redlogo} alt="Nirmaan" />
                                            <div className="pt-2 text-lg text-gray-500 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
                                        </div>
                                    </div>
                                </th>
                            </tr>
                            <tr>
                                <th colSpan="5" className="p-0">
                                    <div className="py-2 border-b-2 border-gray-600 pb-3 mb-3">
                                        <div className="flex justify-between">
                                            <div className="text-xs text-gray-500 font-normal">Obeya Verve, 5th Main, Sector 6, HSR Layout, Bangalore, India - 560102</div>
                                            <div className="text-xs text-gray-500 font-normal">GST: 29ABFCS9095N1Z9</div>
                                        </div>
                                    </div>
                                </th>
                            </tr>
                            <tr>
                                <th colSpan="5" className="p-0">
                                    <div className="grid grid-cols-4 justify-between border border-gray-100 rounded-lg p-4">
                                        <div className="border-0 flex flex-col">
                                            <p className="text-left py-1 font-medium text-xs text-gray-500">Date</p>
                                            <p className="text-left font-bold py-1 font-semibold text-sm text-black">{orderData?.creation?.split(" ")[0]}</p>
                                        </div>
                                        <div className="border-0 flex flex-col">
                                            <p className="text-left py-1 font-medium text-xs text-gray-500">Project</p>
                                            <p className="text-left font-bold py-1 font-semibold text-sm text-black">{getProjectName(orderData?.project)}</p>
                                        </div>
                                        <div className="border-0 flex flex-col">
                                            <p className="text-left py-1 font-medium text-xs text-gray-500">Address</p>
                                            <p className="text-left font-bold py-1 font-semibold text-sm text-black truncate pr-4">{getProjectAddress(orderData?.project)}</p>
                                        </div>
                                        <div className="border-0 flex flex-col">
                                            <p className="text-left py-1 font-medium text-xs text-gray-500">For</p>
                                            <p className="text-left font-bold py-1 font-semibold text-sm text-black">{getVendorName(vendor_id)}</p>
                                        </div>
                                    </div>
                                </th>
                            </tr>
                            <tr>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-800 tracking-wider pr-32">Items</th>
                                <th scope="col" className="px-2 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Category</th>
                                <th scope="col" className="px-2 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Unit</th>
                                <th scope="col" className="px-2 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Quantity</th>
                                <th scope="col" className="px-2 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Price</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {quotation_request_list?.map((item) => {
                                return <tr className="">
                                    <td className="px-6 py-2 text-sm">{getItem(item.item)}</td>
                                    <td className="px-2 py-2 text-sm whitespace-nowrap">
                                        {item.category}
                                    </td>
                                    <td className="px-2 py-2 text-sm whitespace-nowrap">meter</td>
                                    <td className="px-2 py-2 text-sm whitespace-nowrap">{item.quantity}</td>
                                    <td className="px-2 py-2 text-sm whitespace-nowrap">{ }</td>
                                </tr>
                            })}
                            {/* {testQuotationRequestList?.map((item)=>
                                        {return <tr className="">
                                        <td className="px-6 py-2 text-sm whitespace-nowrap">{getItem(item.item)}</td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">
                                            {item.category}
                                        </td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">meter</td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">{item.quantity}</td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">{}</td>
                                    </tr>})} */}
                        </tbody>
                    </table>
                </div>
            </div>
            <button onClick={handlePrint} className="m-1 p-2 bg-blue-500 text-white">Print</button>
        </div>
    )
}