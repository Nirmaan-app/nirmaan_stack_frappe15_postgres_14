import { useFrappeGetDocList } from "frappe-react-sdk";
import { Link } from "react-router-dom";
import { MainLayout } from "../layout/main-layout";
import { useUserData } from "@/hooks/useUserData";
import { useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Projects } from "@/types/NirmaanStack/Projects";
import { Form, Input, InputNumber } from 'antd';
import { Button } from "@/components/ui/button";


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
            fields: ['name', 'procurement_request', 'owner', 'order_list', 'vendor_name', 'project', 'project_name', 'creation'],
            limit: 100
        });

    const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects", {
        fields: ["name", "project_name"],
    })

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

    const [orderData,setOrderData] = useState()
    console.log(orderData)

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
                        <div onClick={() => setOrderData(row)} className="font-medium underline cursor-pointer">
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
                        <div className="font-semibold py-4">Selected PO: {orderData.getValue("name")}</div>
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
                        <Link className="underline hover:underline-offset-2" to={`/release-po/${orderData.getValue("name")}`}>
                            <Button className="bg-red-500 hover:bg-red-600 border-none" type="primary" htmlType="submit">
                            Submit
                            </Button>
                        </Link>
                        </Form.Item>
                        </Form>
                    </div>
                    }
                </div>
            </div>
        </MainLayout>
    )
}



