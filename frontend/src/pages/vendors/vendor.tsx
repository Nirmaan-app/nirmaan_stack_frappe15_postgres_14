// import { Button } from "@/components/ui/button"
// import { Vendors } from "@/types/NirmaanStack/Vendors"
// import { useFrappeGetDoc } from "frappe-react-sdk"
// import { ArrowLeft } from "lucide-react"
// import { Link, useNavigate, useParams } from "react-router-dom"

import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { ApprovedSRList } from "@/components/service-request/approved-sr-list"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { OverviewSkeleton2, Skeleton, TableSkeleton } from "@/components/ui/skeleton"
import { ColumnDef } from "@tanstack/react-table"
import { ConfigProvider, Menu, MenuProps } from "antd"
import { useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk"
import { ArrowLeft, CheckCircleIcon, ChevronDownIcon, ChevronRightIcon, FilePenLine } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"



// const Vendor = () => {

//     const { vendorId } = useParams<{ vendorId: string }>()

//     return (
//         <div>
//             {vendorId && <VendorView vendorId={vendorId} />}
//         </div>
//     )
// }

// export const Component = Vendor

// const VendorView = ({ vendorId }: { vendorId: string }) => {

//     const navigate = useNavigate();

//     const { data, error, isLoading } = useFrappeGetDoc<Vendors>(
//         'Vendors',
//         `${vendorId}`
//     );


//     if (isLoading) return <h1>Loading..</h1>
//     if (error) return <h1 className="text-red-700">{error.message}</h1>
//     return (
//         <div className="flex-1 space-y-4 p-8 pt-4">
//             {data &&
//                 <>
//                     <div className="flex items-center justify-between space-y-2">
//                         <div className="flex">
//                             <ArrowLeft className="mt-1.5 cursor-pointer" onClick={() => navigate("/vendors")} />
//                             <h2 className="pl-1 text-2xl font-bold tracking-tight">{data.vendor_name}</h2>
//                         </div>
//                         <div className="flex space-x-2">
//                             {/* <Button onClick={handlePrint}>
//                             Report
//                         </Button>
//                         <Button onClick={handlePrint2}>
//                             Schedule
//                         </Button>*/}
//                             <Button asChild>
//                                 <Link to={`/vendors/${vendorId}/edit`}> Edit Vendor</Link>
//                             </Button>
//                         </div>
//                     </div>
//                     <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">

//                     </div>
//                 </>
//             }
//         </div>
//     )
// }


type PRTable = {
    name: string
    project_name: string
    creation: string
    category: string
}


const Vendor = () => {

    const { vendorId } = useParams<{ vendorId: string }>()

    return (
        <div>
            {vendorId && <VendorView vendorId={vendorId} />}
        </div>
    )
}

export const Component = Vendor

const VendorView = ({ vendorId }: { vendorId: string }) => {

    const navigate = useNavigate();

    const { data, error, isLoading } = useFrappeGetDoc(
        'Vendors',
        vendorId,
        `Vendors ${vendorId}`
    );

    const { data: vendorAddress, isLoading: vendorAddressLoading, error: vendorAddressError } = useFrappeGetDoc(
        "Address",
        data?.vendor_address,
        data?.vendor_address ? `Address ${data?.vendor_address}` : null
    )

    const { data: procurementOrders, isLoading: procurementOrdersLoading, error: procurementOrdersError } = useFrappeGetDocList("Procurement Orders",
        {
            fields: ["*"],
            filters: [['vendor', '=', vendorId], ["status", "!=", "Merged"]],
            limit: 10000
        },
        `Procurement Orders ${vendorId}`
    )

    const { data: Categories, isLoading: categoriesLoading, error: categoriesError } = useFrappeGetDocList("Category", {
        fields: ["*"],
        limit: 1000
    },
        "Category"
    )

    const { data: procurementRequests, isLoading: procurementRequestsLoading, error: procurementRequestsError } = useFrappeGetDocList("Procurement Requests", {
        fields: ["*"],
        limit: 1000
    }, `Procurement Requests`,
    )

    type MenuItem = Required<MenuProps>['items'][number];

    const items: MenuItem[] = [
        {
            label: 'Overview',
            key: 'overview',
        },
        data?.vendor_type === "Material" ? {
            label: 'Previous Orders',
            key: 'previousOrders',
        } : null,
        data?.vendor_type === "Material" ? {
            label: 'Open Orders',
            key: 'openOrders',
        } : null,
        data?.vendor_type === "Service" ? {
            label: 'Service Orders',
            key: 'serviceOrders'
        } : null
    ];

    const [current, setCurrent] = useState('overview')

    const onClick: MenuProps['onClick'] = (e) => {
        setCurrent(e.key);
    };

    const getWorkPackage = (pr: any, procRequests: any) => {
        return procRequests?.find((proc) => proc.name === pr)?.work_package

    }

    const getCategories = (ol: any) => {
        return Array.from(new Set(ol?.list?.map((order: any) => order.category)))
    }

    type Item = {
        quantity: number,
        quote: number
    }

    interface OrderList {
        list: Item[]
    }

    const getTotal = (ol: OrderList) => {
        return useMemo(() => ol.list.reduce((total: number, item) => {
            return total + item.quantity * item.quote
        }, 0), [ol])
    }

    type ExpandedPackagesState = {
        [key: string]: boolean;
    }

    const [expandedPackages, setExpandedPackages] = useState<ExpandedPackagesState>({});

    const toggleExpand = (packageName: string) => {
        setExpandedPackages((prev) => ({
            ...prev,
            [packageName]: !prev[packageName],
        }));
    };

    const vendorCategories = data && (JSON.parse(data?.vendor_category)?.categories) || []

    const groupedCategories: { [key: string]: string[] } = useMemo(() => {
        if (!Categories || !vendorCategories.length) return {};

        const filteredCategories = Categories.filter(category =>
            vendorCategories.includes(category.name)
        );

        const grouped = filteredCategories.reduce((acc, category) => {
            const { work_package, name } = category;

            if (!acc[work_package]) {
                acc[work_package] = [];
            }

            acc[work_package].push(name);

            return acc;
        }, {});

        return grouped;
    }, [Categories, data]);

    useEffect(() => {
        const initialExpandedState = Object.keys(groupedCategories).reduce((acc, work_package) => {
            acc[work_package] = true;
            return acc;
        }, {});
        setExpandedPackages(initialExpandedState);
    }, [groupedCategories]);

    const columns: ColumnDef<PRTable>[] = useMemo(
        () => [
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader className="text-black font-bold" column={column} title="PO Number" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="text-[#11050599]">
                            <Link className="underline hover:underline-offset-2" to={`${row.getValue("name").replaceAll("/", "&=")}`}>
                                {row.getValue("name").split("/")[1]}
                            </Link>
                        </div>
                    )
                }
            },
            {
                accessorKey: "creation",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader className="text-black font-bold" column={column} title="Date" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="text-[#11050599]">
                            {row.getValue("creation")?.split(" ")[0]}
                        </div>
                    )
                }
            },
            {
                accessorKey: "project_name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader className="text-black font-bold" column={column} title="Project" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="text-[#11050599]">
                            {row.getValue("project_name")}
                        </div>
                    )
                },
                filterFn: (row, id, value) => {
                    return value.includes(row.getValue(id))
                },
            },
            {
                id: "pr",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader className="text-black font-bold" column={column} title="PR Number" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="text-[#11050599]">
                            {row.getValue("procurement_request")}
                        </div>
                    )
                }
            },

            {
                accessorKey: "procurement_request",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader className="text-black font-bold" column={column} title="Package" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="text-[#11050599]">
                            {getWorkPackage(row.getValue("procurement_request"), procurementRequests)}
                        </div>
                    )
                }
            },
            {
                accessorKey: "order_list",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader className="text-black font-bold" column={column} title="Category" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <ul className="text-[#11050599] list-disc">
                            {getCategories(row.getValue("order_list")).map((cat, index) => (
                                <li key={index}>{cat}</li>
                            ))}
                        </ul>
                    )
                }
            },
            {
                id: "total",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader className="text-black font-bold" column={column} title="Order Price" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="text-[#11050599]">
                            {getTotal(row.getValue("order_list")).toFixed(2)}
                        </div>
                    )

                }
            }
        ],
        [procurementOrders, procurementRequests]
    )

    if (error || vendorAddressError || procurementOrdersError || procurementRequestsError) return <h1 className="text-red-700">There is an error while fetching the document, please check!</h1>

    return (
        <div className="flex-1 space-y-2 md:space-y-4">
            <div className="flex items-center gap-1">
                {/* <ArrowLeft className="cursor-pointer" onClick={() => navigate("/vendors")} /> */}
                {isLoading ? (<Skeleton className="h-10 w-1/3 bg-gray-300" />) :
                    <h2 className="text-xl md:text-3xl font-bold tracking-tight">{data?.vendor_name}</h2>}
                <FilePenLine onClick={() => navigate('edit')} className="w-10 text-blue-300 hover:-translate-y-1 transition hover:text-blue-600 cursor-pointer" />
            </div>
            <ConfigProvider
                theme={{
                    components: {
                        Menu: {
                            horizontalItemSelectedColor: "#D03B45",
                            itemSelectedBg: "#FFD3CC",
                            itemSelectedColor: "#D03B45"
                        }
                    }
                }}
            >
                <Menu selectedKeys={[current]} onClick={onClick} mode="horizontal" items={items} />
            </ConfigProvider>
            {/* Overview Section */}
            {current === "overview" && (
                (isLoading || vendorAddressLoading ? <OverviewSkeleton2 /> : (
                    <div className="flex flex-col gap-4">
                        <Card>
                            <CardHeader>
                                <CardTitle>
                                    {data?.vendor_name}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="flex flex-col gap-10 w-full">
                                {/* <Card className="bg-[#F9FAFB]">
                              <CardHeader>
                                <CardContent className="flex max-lg:flex-col max-lg:gap-10"> */}
                                <div className="flex max-lg:flex-col max-lg:gap-10">
                                    <div className="space-y-4 lg:w-[50%]">
                                        <CardDescription className="space-y-2">
                                            <span>Vendor ID</span>
                                            <p className="font-bold text-black">{data?.name}</p>
                                        </CardDescription>

                                        <CardDescription className="space-y-2">
                                            <span>Contact Person</span>
                                            <p className="font-bold text-black">{!data?.vendor_contact_person_name ? "N.A." : data.vendor_contact_person_name}</p>
                                        </CardDescription>

                                        <CardDescription className="space-y-2">
                                            <span>Contact Number</span>
                                            <p className="font-bold text-black">{!data?.vendor_mobile ? "N.A." : data?.vendor_mobile}</p>
                                        </CardDescription>
                                        <CardDescription className="space-y-2">
                                            <span>GST Number</span>
                                            <p className="font-bold text-black">{data?.vendor_gst}</p>
                                        </CardDescription>

                                    </div>

                                    <div className="space-y-4">
                                        <CardDescription className="space-y-2">
                                            <span>Address</span>
                                            <p className="font-bold text-black">{vendorAddress?.address_line1}, {vendorAddress?.address_line2}, {vendorAddress?.city}, {vendorAddress?.state}</p>
                                        </CardDescription>

                                        <CardDescription className="space-y-2">
                                            <span>City</span>
                                            <p className="font-bold text-black">{vendorAddress?.city}</p>
                                        </CardDescription>

                                        <CardDescription className="space-y-2">
                                            <span>State</span>
                                            <p className="font-bold text-black">{vendorAddress?.state}</p>
                                        </CardDescription>
                                        <CardDescription className="space-y-2">
                                            <span>pincode</span>
                                            <p className="font-bold text-black">{vendorAddress?.pincode}</p>
                                        </CardDescription>

                                        {/* <CardDescription className="space-y-2">
                                          <span>Categories</span>
                                        <ul className="space-y-2">
                                              {vendorCategories.map((cat, index) => (
                                                <li
                                                  key={index}
                                                  className="flex items-center gap-2 p-2 bg-gray-50 hover:bg-gray-100 rounded-md transition-all duration-200"
                                                >
                                                  <CheckCircleIcon className="w-5 h-5 text-green-500" />
                                                  <span className="text-sm font-medium text-gray-600">{cat}</span>
                                                </li>
                                              ))}
                                        </ul>
                                      </CardDescription> */}
                                    </div>
                                </div>
                                {/* </CardContent>
                              </CardHeader>
                            </Card> */}
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader>
                                <CardTitle>Packages-Categories Offered</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <CardDescription className="space-y-2">
                                    <ul className={`flex gap-2 flex-wrap`}>
                                        {Object.entries(groupedCategories).map(([workPackage, categoryList], index) => (
                                            <li key={index} className={`border p-1 max-md:p-2 bg-white rounded-lg shadow-sm max-sm:w-full`}>
                                                <div
                                                    className="flex items-center gap-4 justify-between max-md:gap-2 cursor-pointer hover:bg-gray-100 p-2 max-md:p-1 rounded-md transition-all duration-200"
                                                    onClick={() => toggleExpand(workPackage)}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        {expandedPackages[workPackage] ? (
                                                            <ChevronDownIcon className="w-5 h-5 text-gray-500" />
                                                        ) : (
                                                            <ChevronRightIcon className="w-5 h-5 text-gray-500" />
                                                        )}
                                                        <span className="text-md font-medium text-gray-800">{workPackage}</span>
                                                    </div>
                                                    <span className="text-sm text-gray-500">{categoryList.length} items</span>
                                                </div>
                                                {expandedPackages[workPackage] && (
                                                    <ul className="pl-8 mt-2 space-y-2">
                                                        {categoryList.map((cat, index) => (
                                                            <li
                                                                key={index}
                                                                className="flex items-center gap-2 p-2 bg-gray-50 hover:bg-gray-100 rounded-md transition-all duration-200"
                                                            >
                                                                <CheckCircleIcon className="w-5 h-5 text-green-500" />
                                                                <span className="text-sm font-medium text-gray-600">{cat}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                </CardDescription>
                            </CardContent>
                        </Card>
                    </div>
                ))
            )}

            {/* Previous Orders Section  */}

            {current === "previousOrders" && (
                (procurementOrdersLoading || procurementRequestsLoading) ? (<TableSkeleton />) : (
                    <DataTable columns={columns} data={procurementOrders?.filter((po) => ["Dispatched", "Partially Delivered", "Delivered"].includes(po.status))} />
                )
            )}

            {/* Open Orders Section  */}

            {current === "openOrders" && (
                (procurementOrdersLoading || procurementRequestsLoading) ? (<TableSkeleton />) : (
                    <DataTable columns={columns} data={procurementOrders?.filter((po) => ["PO Approved", "PO Sent", "PO Amendment"].includes(po.status))} />
                )
            )}

            {/* Transactions Section  */}

            {current === "serviceOrders" && (
                <ApprovedSRList for_vendor={data?.name} />
            )}
        </div>
    )

}