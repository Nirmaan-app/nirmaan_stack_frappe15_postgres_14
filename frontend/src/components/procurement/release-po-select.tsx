import { useFrappeGetDocList } from "frappe-react-sdk";
import { Link } from "react-router-dom";
import { MainLayout } from "../layout/main-layout";
import { useUserData } from "@/hooks/useUserData";
import { useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Projects } from "@/types/NirmaanStack/Projects";
import { Form, Input, InputNumber } from 'antd';
import { Button } from "@/components/ui/button";
import { useReactToPrint } from 'react-to-print';
import redlogo from "@/assets/red-logo.png"
import React from 'react';


type PRTable = {
    name: string
    project_name: string
    creation: string
    category: string
}


export const ReleasePOSelect = () => {
    const userData = useUserData();
    const { data: procurement_order_list, isLoading: procurement_order_list_loading, error: procurement_order_list_error } = useFrappeGetDocList("Procurement Orders",
        {
            fields: ['name', 'project_name', 'project_address', 'vendor_name', 'vendor_address', 'vendor_gst', 'order_list', 'creation'],
            limit: 100
        });

    const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects", {
        fields: ["name", "project_name"],
    })

    const { data: address_list, isLoading: address_list_loading, error: address_list_error } = useFrappeGetDocList("Address",
        {
            fields: ['name', 'address_title', 'address_line1', 'address_line2', 'city', 'state', 'pincode']
        });

    const project_values = projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || []

    const getTotal = (order_id: string) => {
        let total: number = 0;
        const orderData = procurement_order_list?.find(item => item.name === order_id)?.order_list;
        orderData?.list.map((item) => {
            const price = item.quote;
            total += (price ? parseFloat(price) : 0) * (item.quantity ? parseFloat(item.quantity) : 1);
        })
        return total;
    }

    const componentRef = React.useRef();

    const handlePrint = useReactToPrint({
        content: () => componentRef.current,
        // documentTitle: `${orderData?.name}_${orderData?.vendor_name}`
    });

    const handleSet = (id: string) => {
        const curOrder = procurement_order_list?.find(item => item.name === id);
        setOrderData(curOrder)
    }
    
    const [orderData, setOrderData] = useState();
    const [projectAddress, setProjectAddress] = useState()
    const [vendorAddress, setVendorAddress] = useState()

    useEffect(() => {
        if (orderData?.project_address) {
            const doc = address_list?.find(item => item.name == orderData?.project_address);
            const address = `${doc?.address_line1}, ${doc?.address_line2}, ${doc?.city}, ${doc?.state}-${doc?.pincode}`
            setProjectAddress(address)
            const doc2 = address_list?.find(item => item.name == orderData?.vendor_address);
            const address2 = `${doc2?.address_line1}, ${doc2?.address_line2}, ${doc2?.city}, ${doc2?.state}-${doc2?.pincode}`
            setVendorAddress(address2)
        }

    }, [orderData]);

    const columns: ColumnDef<PRTable>[] = useMemo(
        () => [
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="ID" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div onClick={() => handleSet(row.getValue("name"))} className="font-medium underline cursor-pointer">
                            {/* <Link className="underline hover:underline-offset-2" to={`/release-po/${row.getValue("name")}`}> */}
                                {row.getValue("name")}
                            {/* </Link> */}
                        </div>
                    )
                }
            },
            {
                accessorKey: "procurement_request",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="PR Number" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("procurement_request")?.slice(-4)}
                        </div>
                    )
                }
            },
            {
                accessorKey: "creation",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Date" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("creation")?.split(" ")[0]}
                        </div>
                    )
                }
            },
            {
                accessorKey: "project",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Project" />
                    )
                },
                cell: ({ row }) => {
                    const project = project_values.find(
                        (project) => project.value === row.getValue("project")
                    )
                    if (!project) {
                        return null;
                    }

                    return (
                        <div className="font-medium">
                            {project.label}
                            {/* {row.getValue("project")} */}
                        </div>
                    )
                },
                filterFn: (row, id, value) => {
                    return value.includes(row.getValue(id))
                },
            },
            {
                accessorKey: "vendor_name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Vendor" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("vendor_name")}
                        </div>
                    )
                }
            },
            {
                accessorKey: "total",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Amount" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {getTotal(row.getValue("name"))}
                        </div>
                    )
                }
            }
        ],
        [project_values]
    )

    const [advance, setAdvance] = useState(0);
    const [totalAmount, setTotalAmount] = useState(100); // Example total amount

    const handleAdvanceChange = (value) => {
        setAdvance(value);
    };

    const handleSubmit = (values) => {
        console.log('Form values:', values);
        console.log('Advance percentage:', values.advance);

    };

  const afterDelivery = totalAmount * (1 - advance / 100);

    return (
        <MainLayout>
            <div className="flex">
                <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                    <div className="flex items-center justify-between space-y-2">
                        <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">Release PO</h2>
                    </div>
                    <DataTable columns={columns} data={procurement_order_list || []} project_values={project_values} />
                    {orderData && 
                    
                    <div className="max-w-md mx-auto mt-10">
                        <div className="font-semibold py-4">Selected PO: {orderData?.name}</div>
                        <Form layout="vertical" onFinish={handleSubmit}>
                        <Form.Item
                            name="advance"
                            label="Advance (%)"
                            rules={[{ required: true, message: 'Please input the advance percentage!' }]}
                        >
                            <InputNumber
                            type="number"
                            min={0}
                            max={100}
                            value={advance}
                            className="w-full"
                            onChange={handleAdvanceChange}
                            />
                        </Form.Item>
                        <Form.Item label="After Delivery Amount">
                            <Input
                            value={afterDelivery.toFixed(2)}
                            disabled
                            className="w-full"
                            />
                        </Form.Item>
                        <Form.Item>
                        {/* <Link className="underline hover:underline-offset-2" to={`/release-po/${orderData.getValue("name")}`}> */}
                            <Button className="bg-red-500 hover:bg-red-600 border-none" type="primary" htmlType="submit" onClick={handlePrint}>
                                Print
                            </Button>
                        {/* </Link> */}
                        </Form.Item>
                        </Form>
                    </div>
                    }
                </div>
            </div>
            <div className="hidden">
                <div ref={componentRef} className="w-full p-4">
                    <div className="flex justify-between border-b-2 border-gray-600 pb-3 mb-3">
                        <div className="mt-6 flex justify-between">
                            <div>
                                <img className="w-44" src={redlogo} alt="Nirmaan" />
                                <div className="pt-2 text-lg text-gray-500 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
                            </div>
                        </div>
                        <div>
                            <div className="pb-2 pt-8 text-lg text-gray-600 font-semibold">Purchase Order</div>
                            <div className="text-base text-black font-bold">PO # : {orderData?.name}</div>
                        </div>
                    </div>
                    <div className="text-gray-500 text-sm py-2">Vendor Address</div>
                    <div className="text-sm font-medium text-gray-900 break-words max-w-[280px]">{orderData?.vendor_name}</div>
                    <div className="text-sm font-medium text-gray-900 break-words max-w-[280px]">{vendorAddress}</div>
                    <div className="text-sm font-medium text-gray-900">GSTIN: {orderData?.vendor_gst}</div>
                    <div className="flex justify-between">
                        <div>
                            <h3 className="text-gray-500 text-sm py-2">Delivery Location</h3>
                            <div className="text-sm font-medium text-gray-900 break-words max-w-[280px]">{projectAddress}</div>
                        </div>
                        <div className="pt-4">
                            <div className="text-sm font-medium text-gray-900"><span className="text-gray-500 font-normal">Date:</span>&nbsp;&nbsp;&nbsp;{orderData?.creation?.split(" ")[0]}</div>
                            <div className="text-sm font-medium text-gray-900"><span className="text-gray-500 font-normal">Project Name:</span>&nbsp;&nbsp;&nbsp;{orderData?.project_name}</div>
                        </div>
                    </div>
                    <div className="overflow-x-auto pt-4">
                        <table className="min-w-full divide-gray-200">
                            <thead className="border-b border-black">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-800 tracking-wider pr-48">Items</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-800 tracking-wider">Unit</th>
                                    <th scope="col" className="px-2 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Quantity</th>
                                    <th scope="col" className="px-2 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Rate</th>
                                    <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Amount</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {orderData?.order_list?.list.map((item) => {
                                    return <tr className="">
                                        <td className="px-6 py-4 text-sm whitespace-nowrap">{item.item}</td>
                                        <td className="px-6 py-4 text-sm whitespace-nowrap">{item.unit}</td>
                                        <td className="px-6 py-4 text-sm whitespace-nowrap">
                                            {item.quantity}
                                        </td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">{item.quote}</td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">{(item.quote) * (item.quantity)}</td>
                                    </tr>
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </MainLayout>
    )
}



