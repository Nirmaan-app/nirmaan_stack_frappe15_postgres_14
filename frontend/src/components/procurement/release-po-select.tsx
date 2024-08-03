import { useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
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
import { BadgeIndianRupee } from 'lucide-react';


type PRTable = {
    name: string
    project_name: string
    creation: string
    category: string
}


export const ReleasePOSelect = () => {
    const userData = useUserData();
    const { data: procurement_order_list, isLoading: procurement_order_list_loading, error: procurement_order_list_error, mutate: mutate } = useFrappeGetDocList("Procurement Orders",
        {
            fields: ['name', 'project_name', 'project_address', 'vendor_name', 'vendor_address', 'vendor_gst', 'order_list', 'creation', 'procurement_request', 'advance'],
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
    const [orderData, setOrderData] = useState();

    const componentRef = React.useRef();

    const handlePrint = useReactToPrint({
        content: () => componentRef.current,
        documentTitle: `${orderData?.name}_${orderData?.vendor_name}`
    });


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
                            <Link className="underline hover:underline-offset-2" to={`/release-po/${row.getValue("name").replaceAll("/", "&=")}`}>
                                {(row.getValue("name"))?.toUpperCase()}
                            </Link>
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
                accessorKey: "project_name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Project" />
                    )
                },
                cell: ({ row }) => {
                    // const project = project_values.find(
                    //     (project) => project.value === row.getValue("project")
                    // )
                    // if (!project) {
                    //     return null;
                    // }

                    return (
                        <div className="font-medium">
                            {/* {project.label} */}
                            {row.getValue("project_name")}
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
    const [form] = Form.useForm();

    const handleSet = (id: string) => {
        const curOrder = procurement_order_list?.find(item => item.name === id);
        setOrderData(curOrder)
        // form.setFieldsValue({
        //     advance: newAdvance,
        //     afterDelivery: 100
        // });
    }

    const { updateDoc: updateDoc, loading: update_loading, isCompleted: update_submit_complete, error: update_submit_error } = useFrappeUpdateDoc()

    const handleSubmit = (values) => {
        console.log('Form values:', values);
        updateDoc('Procurement Orders', orderData?.name, {
            advance: values.advance,
        })
            .then(() => {
                console.log("orderData?.name", orderData?.name)
                mutate()
                handlePrint()
            }).catch(() => {
                console.log("update_submit_error", update_submit_error)
            })
    };

    const afterDelivery = totalAmount * (1 - advance / 100);
    let count = 1;

    return (
        // <MainLayout>
        <>
            <div className="flex">
                <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                    <div className="flex items-center justify-between space-y-2">
                        <h2 className="text-base pt-1 pl-2 font-bold tracking-tight">Release PO</h2>
                    </div>
                    <DataTable columns={columns} data={procurement_order_list || []} project_values={project_values} />
                    {orderData &&

                        <div className="max-w-md mx-auto mt-10">
                            <div className="font-semibold py-4">Selected PO: {(orderData?.name)?.toUpperCase()}</div>
                            <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{ advance, afterDelivery: totalAmount * (1 - advance / 100) }}>
                                <Form.Item
                                    name="advance"
                                    label="Advance (%)"
                                    rules={[{ required: true, message: 'Please input the advance percentage!' }]}
                                >
                                    <InputNumber
                                        // type="number"
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
                                    {update_loading ? <div>loading...</div> : <Button className="bg-red-500 hover:bg-red-600 border-none" type="primary" htmlType="submit">
                                        Print
                                    </Button>}
                                </Form.Item>
                            </Form>
                        </div>
                    }
                </div>
            </div>
            <div className="hidden">
                <div ref={componentRef} className="w-full p-4">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-gray-200">
                            <thead className="border-b border-black">
                                <tr>
                                    <th colSpan={5}>
                                        <div className="flex justify-between border-gray-600 pb-1">
                                            <div className="mt-2 flex justify-between">
                                                <div>
                                                    <img className="w-44" src={redlogo} alt="Nirmaan" />
                                                    <div className="pt-2 text-lg text-gray-500 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
                                                </div>
                                            </div>
                                            <div>
                                                <div className="pt-2 text-xl text-gray-600 font-semibold">Purchase Order</div>
                                                <div className="text-lg text-black font-bold">PO # : {(orderData?.name)?.toUpperCase()}</div>
                                            </div>
                                        </div>

                                        <div className=" border-b-2 border-gray-600 pb-1 mb-1">
                                            <div className="flex justify-between">
                                                <div className="text-xs text-gray-500 font-normal">Obeya Verve, 5th Main, Sector 6, HSR Layout, Bangalore, India - 560102</div>
                                                <div className="text-xs text-gray-500 font-normal">GST: 29ABFCS9095N1Z9</div>
                                            </div>
                                        </div>

                                        <div className="flex justify-between">
                                            <div>
                                                <div className="text-gray-500 text-sm pb-2 text-left">Vendor Address</div>
                                                <div className="text-sm font-medium text-gray-900 max-w-[280px] truncate text-left">{orderData?.vendor_name}</div>
                                                <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">{vendorAddress}</div>
                                                <div className="text-sm font-medium text-gray-900 text-left">GSTIN: {orderData?.vendor_gst}</div>
                                            </div>
                                            <div>
                                                <div>
                                                    <h3 className="text-gray-500 text-sm pb-2 text-left">Delivery Location</h3>
                                                    <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">{projectAddress}</div>
                                                </div>
                                                <div className="pt-2">
                                                    <div className="text-sm font-medium text-gray-900 text-left"><span className="text-gray-500 font-normal">Date:</span>&nbsp;&nbsp;&nbsp;{orderData?.creation?.split(" ")[0]}</div>
                                                    <div className="text-sm font-medium text-gray-900 text-left"><span className="text-gray-500 font-normal">Project Name:</span>&nbsp;&nbsp;&nbsp;{orderData?.project_name}</div>
                                                </div>
                                            </div>
                                        </div>
                                    </th>
                                </tr>
                                <tr>
                                    <th scope="col" className="py-3 text-left text-xs font-bold text-gray-800 tracking-wider w-[7%]">S. No.</th>
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
                                        <td className="py-2 text-sm whitespace-nowrap w-[7%]">{count++}.</td>
                                        <td className="px-6 py-2 text-sm whitespace-nowrap">{item.item}</td>
                                        <td className="px-6 py-2 text-sm whitespace-nowrap">{item.unit}</td>
                                        <td className="px-6 py-2 text-sm whitespace-nowrap">
                                            {item.quantity}
                                        </td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">{item.quote}</td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">{(item.quote) * (item.quantity)}</td>
                                    </tr>
                                })}
                                {/* {Array.from({ length: 10 }).map((_, index) => (
                                    orderData?.order_list?.list.map((item, itemIndex) => (
                                    <tr key={`${index}-${itemIndex}`} className="">
                                        <td className="px-6 py-2 text-sm whitespace-nowrap">{item.item}</td>
                                        <td className="px-6 py-2 text-sm whitespace-nowrap">{item.unit}</td>
                                        <td className="px-6 py-2 text-sm whitespace-nowrap">{item.quantity}</td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">{item.quote}</td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">{item.quote * item.quantity}</td>
                                    </tr>
                                ))
                                ))} */}
                                <tr>
                                    <td></td>
                                    <td></td>
                                    <td></td>
                                    <td className="space-y-4 py-4 text-sm font-semibold">
                                        <div>Sub Total:</div>
                                        <div>IGST(18%):</div>
                                        <div>Total:</div>
                                    </td>
                                    <td className="space-y-4 py-4 text-sm">
                                        <div>{getTotal(orderData?.name)}</div>
                                        <div>{(getTotal(orderData?.name) * 0.18).toFixed(2)}</div>
                                        <div>{(getTotal(orderData?.name) * 1.18).toFixed(2)}</div>
                                    </td>
                                    <td>

                                    </td>
                                </tr>
                                <tr className="border-none">
                                    <td colSpan={5}>
                                        <div className="text-gray-400 text-sm py-2">Note</div>
                                        <div className="text-sm text-gray-900">Above Sheet to be used of Jindal or Tata</div>

                                        <div className="text-gray-400 text-sm py-2">Payment Terms</div>
                                        <div className="text-sm text-gray-900">{advance}% advance and remaining on material readiness before delivery of material to site</div>

                                        <BadgeIndianRupee className="w-24 h-24" />
                                        <div className="text-sm text-gray-900 py-6">For, Stratos Infra Technologies Pvt. Ltd.</div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            </>
        // </MainLayout>
    )
}



