import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import { Link, useSearchParams } from "react-router-dom";
import { useContext, useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Projects } from "@/types/NirmaanStack/Projects";
import { useToast } from "../../components/ui/use-toast";
import { TableSkeleton } from "../../components/ui/skeleton";
import { Badge } from "../../components/ui/badge";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { ProcurementOrders as ProcurementOrdersType } from "@/types/NirmaanStack/ProcurementOrders";
import { useNotificationStore } from "@/zustand/useNotificationStore";
import { Button } from "@/components/ui/button";
import { ConfigProvider, Menu, MenuProps, Radio } from "antd";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { useUserData } from "@/hooks/useUserData";


// interface ReleasePOSelectProps {
//     status: string
//     not: boolean
// }

export const ReleasePOSelect = () => {

    const [searchParams] = useSearchParams();

    const [tab, setTab] = useState<string>(searchParams.get("tab") || "Approved PO");

    const { role, user_id } = useUserData()

    const { data: procurement_order_list, isLoading: procurement_order_list_loading, error: procurement_order_list_error, mutate: mutate } = useFrappeGetDocList("Procurement Orders",
        {
            fields: ["*"],
            filters: [["status", tab === "Released PO" ? "not in" : "in", tab === "Released PO" ? ["PO Approved", "PO Amendment", "Merged"] : ["PO Approved"]]],
            limit: 10000,
            orderBy: { field: "modified", order: "desc" }
        },
    );

    const { data: projectPayments, isLoading: projectPaymentsLoading, error: projectPaymentsError, mutate: projectPaymentsMutate } = useFrappeGetDocList("Project Payments", {
            fields: ["*"],
            limit: 100000
        })
    // console.log("data", procurement_order_list)

    useFrappeDocTypeEventListener("Procurement Orders", async (event) => {
        await mutate()
    })

    const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects", {
        fields: ["name", "project_name"],
        limit: 1000
    })

    const { data: vendorsList, isLoading: vendorsListLoading, error: vendorsError } = useFrappeGetDocList("Vendors", {
        fields: ["vendor_name", 'vendor_type'],
        filters: [["vendor_type", "=", "Material"]],
        limit: 1000
    },
        "Material Vendors"
    )

    const vendorOptions = vendorsList?.map((ven) => ({ label: ven.vendor_name, value: ven.vendor_name }))
    const project_values = projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || []

    const getTotal = (order_id: string) => {
        let total: number = 0;
        let totalWithGST: number = 0;

        const orderData = procurement_order_list?.find(item => item.name === order_id)?.order_list;

        orderData?.list.map((item) => {
            const price = parseFloat(item?.quote) || 0;
            const quantity = parseFloat(item?.quantity) || 1;
            const gst = parseFloat(item?.tax) || 0;

            total += price * quantity;

            const gstAmount = (price * gst) / 100;
            totalWithGST += (price + gstAmount) * quantity;
        });

        return {
            totalWithoutGST: total,
            totalWithGST: totalWithGST
        };
    };


    const getTotalAmountPaid = (id) => {
        const payments = projectPayments?.filter((payment) => payment.document_name === id);


        return payments?.reduce((acc, payment) => {
            const amount = parseFloat(payment.amount || 0)
            const tds = parseFloat(payment.tds || 0)
            return acc + amount;
        }, 0);
    }

    const { newPOCount, otherPOCount, adminNewPOCount, adminOtherPOCount } = useDocCountStore()

    const { notifications, mark_seen_notification } = useNotificationStore()

    const { db } = useContext(FrappeContext) as FrappeConfig
    const handleNewPRSeen = (notification) => {
        if (notification) {
            mark_seen_notification(db, notification)
        }
    }

    // useEffect(() => {
    //     const currentTab = searchParams.get("tab") || "Approved PO";
    //     setTab(currentTab);
    //     updateURL("tab", currentTab);
    // }, []);

    const updateURL = (key, value) => {
        const url = new URL(window.location);
        url.searchParams.set(key, value);
        window.history.pushState({}, "", url);
    };

    // const setPOTab = (changeTab) => {
    //   if (tab === changeTab) return; // Prevent redundant updates
    //   setTab(changeTab);
    //   updateURL("tab", changeTab);
    // };

    const onClick = (value) => {

        if (tab === value) return; // Prevent redundant updates

        const newTab = value;
        setTab(newTab);
        updateURL("tab", newTab);

    };

    // type MenuItem = Required<MenuProps>["items"][number];

    const items = [
        {
            label: (
                <div className="flex items-center">
                    <span>Approved PO</span>
                    <span className="ml-2 text-xs font-bold">
                        {(role === "Nirmaan Admin Profile" || user_id === "Administrator") ? adminNewPOCount : newPOCount}
                    </span>
                </div>
            ),
            value: "Approved PO",
        },
        {
            label: (
                <div className="flex items-center">
                    <span>Released PO</span>
                    <span className="ml-2 rounded text-xs font-bold">
                        {(role === "Nirmaan Admin Profile" || user_id === "Administrator") ? adminOtherPOCount : otherPOCount}
                    </span>
                </div>
            ),
            value: "Released PO",
        },
    ];

    const columns: ColumnDef<ProcurementOrdersType>[] = useMemo(
        () => [
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="ID" />
                    )
                },
                cell: ({ row }) => {
                    const id = row.getValue("name")
                    const poId = id?.replaceAll("/", "&=")
                    const isNew = notifications.find(
                        (item) => item.docname === id && item.seen === "false" && item.event_id === "po:new" && tab === "Approved"
                    )
                    return (
                        <div onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative">
                            {isNew && (
                                <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
                            )}
                            <Link
                                className="underline hover:underline-offset-2"
                                to={`${poId}?tab=${tab}`}
                            >
                                {id?.toUpperCase()}
                            </Link>
                        </div>
                    )
                }
            },
            {
                accessorKey: "procurement_request",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="PR No" />
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
                            {formatDate(row.getValue("creation")?.split(" ")[0])}
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
                },
                filterFn: (row, id, value) => {
                    return value.includes(row.getValue(id))
                }
            },
            {
                accessorKey: "status",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Status" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <Badge variant={row.getValue("status") === "PO Approved" ? "default" : row.getValue("status") === "PO Sent" ? "yellow" : row.getValue("status") === "Dispatched" ? "orange" : "green"}>{row.getValue("status") === "Partially Delivered" ? "Delivered" : row.getValue("status")}</Badge>
                    )
                }
            },
            {
                id: "totalWithoutGST",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Amt (exc. GST)" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {formatToIndianRupee(getTotal(row.getValue("name")).totalWithoutGST)}
                        </div>
                    )
                }
            },
            {
                id: "totalWithGST",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Amt (inc. GST)" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {formatToIndianRupee(getTotal(row.getValue("name")).totalWithGST)}
                        </div>
                    )
                }
            },
            {
                id: "Amount_paid",
                header: "Amt Paid",
                cell: ({ row }) => {
                    const data = row.original
                    const amountPaid = getTotalAmountPaid(data?.name);
                    return <div className="font-medium">
                        {formatToIndianRupee(amountPaid)}
                    </div>
                },
            },
            {
                accessorKey: 'order_list',
                header: ({ column }) => {
                    return <h1 className="hidden">:</h1>
                },
                cell: ({ row }) => <span className="hidden">hh</span>
            }
        ],
        [project_values, procurement_order_list, projectPayments]
    )

    const { toast } = useToast()

    if (procurement_order_list_error || projects_error || vendorsError) {
        console.log("Error in release-po-select.tsx", procurement_order_list_error?.message, projects_error?.message, vendorsError?.message)
        toast({
            title: "Error!",
            description: `Error ${procurement_order_list_error?.message || projects_error?.message || vendorsError?.message}`,
            variant: "destructive"
        })
    }

    return (
        <>
            <div className="flex-1 space-y-4">
                {/* <div className="flex items-center justify-between space-y-2">
                    <h2 className="text-base pt-1 pl-2 font-bold tracking-tight">{not ? "Released" : "Approved"} PO</h2>
                </div> */}
                {/* <div className="flex items-center gap-4">
                    <Button variant={`${tab === "Approved" ? "default" : "outline"}`} onClick={() => setPOTab("Approved")}>Approved PO</Button>
                    <Button variant={`${tab === "Released" ? "default" : "outline"}`} onClick={() => setPOTab("Released")}>Released PO</Button>
                </div> */}

                {/* <div className="w-full">
                  <ConfigProvider
                    theme={{
                      components: {
                        Menu: {
                          horizontalItemSelectedColor: "#D03B45",
                          itemSelectedBg: "#FFD3CC",
                          itemSelectedColor: "#D03B45",
                        },
                      },
                    }}
                  >
                    <Menu
                      selectedKeys={[tab]}
                      onClick={onClick}
                      mode="horizontal"
                      items={items}
                    />
                  </ConfigProvider>
                </div> */}
                {items && (
                    <Radio.Group
                        block
                        options={items}
                        defaultValue="Approved PO"
                        optionType="button"
                        buttonStyle="solid"
                        value={tab}
                        onChange={(e) => onClick(e.target.value)}
                    />
                )}
                {(procurement_order_list_loading || projects_loading || vendorsListLoading) ? (<TableSkeleton />) : (
                    <DataTable columns={columns} data={procurement_order_list?.filter((po) => po?.status !== "Cancelled") || []} project_values={project_values} vendorOptions={vendorOptions} itemSearch={true} />
                )}
            </div>

        </>
    )
}

