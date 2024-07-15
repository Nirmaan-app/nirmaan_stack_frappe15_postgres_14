import { ArrowLeft } from 'lucide-react';
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button"
import { useFrappeGetDocList, useFrappeCreateDoc, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useParams, useNavigate, Navigate } from "react-router-dom";
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogClose
} from "@/components/ui/dialog"
import { Space, Switch, Table, ConfigProvider, Collapse, Checkbox } from 'antd';
import type { TableColumnsType, TableProps } from 'antd';
import { ItemComponent } from './items';

type TableRowSelection<T> = TableProps<T>['rowSelection'];

interface DataType {
    key: React.ReactNode;
    category: string;
    item: string;
    unit: string;
    quantity: number;
    rate: number;
    selectedVendor: string;
    amount: number;
    lowest2: string;
    lowest3: string;
    children?: DataType[];
}

const columns: TableColumnsType<DataType> = [
    {
        title: 'Items',
        dataIndex: 'item',
        key: 'item'
    },
    {
        title: 'Unit',
        dataIndex: 'unit',
        key: 'unit',
        width: '7%',
    },
    {
        title: 'Quantity',
        dataIndex: 'quantity',
        width: '7%',
        key: 'quantity',
    },
    {
        title: 'Rate',
        dataIndex: 'rate',
        width: '7%',
        key: 'rate',
    },
    {
        title: 'Selected Vendor',
        dataIndex: 'selectedVendor',
        width: '15%',
        key: 'selectedVendor',
    },
    {
        title: 'Amount',
        dataIndex: 'amount',
        width: '9%',
        key: 'amount',
        render: (text, record) => (
            <span style={{ fontWeight: record.unit === null ? 'bold' : 'normal' }}>
                {text}
            </span>
        ),
    },
    {
        title: '3 months Lowest Amount',
        dataIndex: 'lowest3',
        width: '10%',
        key: 'lowest3',
        render: (text, record) => (
            <span style={{ fontWeight: record.unit === null ? 'bold' : 'normal' }}>
                {text}
            </span>
        ),
    },
];


export const ApproveSentBack = () => {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()

    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'category_list', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'creation'],
            limit: 100
        });
    const { data: item_list, isLoading: item_list_loading, error: item_list_error } = useFrappeGetDocList("Items",
        {
            fields: ['name', 'item_name', 'unit_name'],
            limit: 1000
        });
    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error } = useFrappeGetDocList("Vendors",
        {
            fields: ['name', 'vendor_name', 'vendor_address', 'vendor_gst'],
            limit: 200
        });
    const { data: project_list, isLoading: project_list_loading, error: project_list_error } = useFrappeGetDocList("Projects",
        {
            fields: ['name', 'project_name', 'project_address']
        });
    const { data: sent_back_list, isLoading: sent_back_list_loading, error: sent_back_list_error } = useFrappeGetDocList("Sent Back Category",
        {
            fields: ['name', 'item_list', 'workflow_state', 'procurement_request', 'category_list', 'project', 'creation', 'owner',],
            filters: [["workflow_state", "=", "Vendor Selected"]],
            limit: 100
        });

    const { data: quote_data } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['item', 'quote'],
            limit: 1000
        });


    const [page, setPage] = useState<string>('approvequotation')
    const [selectedItem, setSelectedItem] = useState({
        list: []
    })
    const [selectAll, setSelectAll] = useState(false);
    const [orderData, setOrderData] = useState({
        project_name: '',
        category: ''
    })
    if (!orderData.project) {
        sent_back_list?.map(item => {
            if (item.name === id) {
                setOrderData(item)
            }
        })
    }

    const [data, setData] = useState<DataType>([])
    const [checkStrictly, setCheckStrictly] = useState(false);

    useEffect(() => {
        if (orderData.project) {
            const newData: DataType[] = [];
            orderData.category_list?.list?.forEach((cat) => {
                const items: DataType[] = [];

                orderData.item_list?.list?.forEach((item) => {
                    if (item.category === cat.name) {
                        const quotesForItem = quote_data
                            ?.filter(value => value.item === item.name && value.quote)
                            ?.map(value => value.quote);
                        let minQuote;
                        if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
                        minQuote = (minQuote ? parseFloat(minQuote) * item.quantity : 0)

                        items.push({
                            item: <ItemComponent item_id={item.name} />,
                            key: item.name,
                            unit: item.unit,
                            quantity: item.quantity,
                            category: item.category,
                            rate: item.quote,
                            amount: item.vendor ? item.quote * item.quantity : "Delayed",
                            selectedVendor: item.vendor ? getVendorName(item.vendor) : "Delayed",
                            // lowest2: item.vendor ? getLowest2(item.name)*item.quantity : "Delayed",
                            lowest3: minQuote ? minQuote : "N/A",
                        });
                    }
                });

                if (items.length) {
                    const node: DataType = {
                        item: cat.name,
                        key: cat.name,
                        unit: null,
                        quantity: null,
                        amount: getTotal(cat.name),
                        // lowest2: getLowest(cat.name).quote,
                        lowest3: getLowest3(cat.name),
                        children: items,
                    };
                    newData.push(node);
                }
            });
            console.log("newData", newData)
            setData(newData)
        }
    }, [orderData,vendor_list,quote_data]);
    console.log("data", data)

    const [selectedItems, setSelectedItems] = useState()
    const rowSelection: TableRowSelection<DataType> = {
        onChange: (selectedRowKeys, selectedRows) => {
            console.log("onChange")
            console.log(`selectedRowKeys: ${selectedRowKeys}`, 'selectedRows: ', selectedRows);
            setSelectedItems(selectedRows)
        },
        onSelect: (record, selected, selectedRows) => {
            console.log(record, selected, selectedRows);
        },
        onSelectAll: (selected, selectedRows, changeRows) => {
            console.log(selected, selectedRows, changeRows);
        },
    };

    const [comment, setComment] = useState('')

    const getVendorName = (vendorName: string) => {
        return vendor_list?.find(vendor => vendor.name === vendorName)?.vendor_name;
    }
    const getVendorAddress = (vendorName: string) => {
        return vendor_list?.find(vendor => vendor.name === vendorName)?.vendor_address;
    }
    const getVendorGST = (vendorName: string) => {
        return vendor_list?.find(vendor => vendor.name === vendorName)?.vendor_gst;
    }
    const getVendorId = (vendorName: string) => {
        return vendor_list?.find(vendor => vendor.vendor_name === vendorName)?.name;
    }
    const getProjectName = (projectName: string) => {
        return project_list?.find(project => project.name === projectName)?.project_name;
    }
    const getProjectAddress = (projectName: string) => {
        return project_list?.find(project => project.name === projectName)?.project_address;
    }
    const getItem = (item: string) => {
        const item_name = item_list?.find(value => value.name === item)?.item_name;
        return item_name
    }
    const getUnit = (item: string) => {
        const item_unit = item_list?.find(value => value.name === item)?.unit_name;
        return item_unit
    }

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    const { updateDoc: updateDoc, loading: update_loading, isCompleted: update_submit_complete, error: update_submit_error } = useFrappeUpdateDoc()

    const handleCheckboxChange = (id: string) => {
        const isSelected = selectedItem.list.some(item => item.name === id);
        const updatedSelectedList = isSelected
            ? selectedItem.list.filter(item => item.name !== id)
            : [...selectedItem.list, orderData.item_list?.list.find(item => item.name === id)];

        setSelectedItem({ list: updatedSelectedList });
    };

    const handleSelectAllChange = () => {
        const newSelectAll = !selectAll;
        setSelectAll(newSelectAll);

        const updatedSelectedList = newSelectAll ? [...orderData.item_list?.list] : [];
        setSelectedItem({ list: updatedSelectedList });
    };

    const getPrice = (itemName: string) => {
        return orderData?.item_list?.list.find(item => item.name === itemName)?.quote
    }

    const newHandleApprove = () => {

        const filteredData = selectedItems?.filter(item => {
            return item.unit !== null && item.quantity !== null
        });
        console.log(filteredData)

        const vendorItems = {};
        filteredData?.forEach((item) => {
            if (item.selectedVendor) {
                if (!vendorItems[item.selectedVendor]) {
                    vendorItems[item.selectedVendor] = [];
                }
                // const price = Number(getPrice(item.selectedVendor, item.key))
                vendorItems[item.selectedVendor].push({
                    name: item.key,
                    quote: Number(item.rate),
                    quantity: item.quantity,
                    unit: item.unit,
                    item: item.item
                });
            }

        })

        const createDocPromises = [];

        Object.entries(vendorItems)?.forEach(([key, value]) => {

            const newProcurementOrder = {
                procurement_request: orderData.procurement_request,
                project: orderData.project,
                project_name: getProjectName(orderData.project),
                project_address: getProjectAddress(orderData.project),
                vendor: getVendorId(key),
                vendor_name: key,
                vendor_address: getVendorAddress(getVendorId(key)),
                vendor_gst: getVendorGST(getVendorId(key)),
                order_list: {
                    list: value
                }
            };

            if (value?.length > 0) {
                const createDocPromise = createDoc('Procurement Orders', newProcurementOrder)
                    .then(() => {
                        console.log(newProcurementOrder);
                    })
                    .catch((error) => {
                        console.log("submit_error", error);
                    });

                createDocPromises.push(createDocPromise);
            }

        });

        const filteredList = orderData.item_list?.list.filter(procItem =>
            !filteredData.some(selItem => selItem.key === procItem.name)
        );

        setOrderData(prevOrderData => ({
            ...prevOrderData,
            item_list: {
                list: filteredList
            }
        }));
    }

    const newHandleSentBack = () => {
        const filteredData = selectedItems?.filter(item => {
            return item.unit !== null && item.quantity !== null
        });
        console.log(filteredData)

        const itemlist = [];
        filteredData?.map((value) => {
            // const price = getPrice(value.selectedVendor, value.key);
            itemlist.push({
                name: value.key,
                item: value.item,
                quantity: value.quantity,
                quote: value.rate,
                unit: value.unit,
                category: value.category
            })
        })

        const newCategories = [];
        itemlist?.forEach((item) => {
            const isDuplicate = newCategories.some(category => category.name === item.category);
            if (!isDuplicate) {
                newCategories.push({ name: item.category })
            }
        })

        const newSendBack = {
            procurement_request: orderData.procurement_request,
            project: orderData.project,
            category_list: {
                list: newCategories
            },
            item_list: {
                list: itemlist
            },
            comments: comment,
            type: "Rejected"
        }
        if (itemlist.length > 0) {
            createDoc('Sent Back Category', newSendBack)
                .then(() => {
                    console.log(newSendBack);
                    setComment('')
                })
                .catch(() => {
                    console.log("submit_error", submit_error);
                })
        }

        const filteredList = orderData.item_list?.list.filter(procItem =>
            !filteredData.some(selItem => selItem.key === procItem.name)
        );

        setOrderData(prevOrderData => ({
            ...prevOrderData,
            item_list: {
                list: filteredList
            }
        }));

    }

    useEffect(() => {
        const newCategories = [];
        orderData?.item_list?.list.map((item) => {
            const isDuplicate = newCategories.some(category => category.name === item.category);
            if (!isDuplicate) {
                newCategories.push({ name: item.category })
            }
        })
        setOrderData((prevState) => ({
            ...prevState,
            category_list: {
                list: newCategories
            },
        }));
    }, [orderData]);

    useEffect(() => {
        if (orderData.project && orderData.item_list?.list.length === 0) {
            updateDoc('Sent Back Category', id, {
                workflow_state: "Approved",
            })
                .then(() => {
                    console.log("item", id)
                    navigate("/")
                }).catch(() => {
                    console.log("update_submit_error", update_submit_error)
                })
        }
    }, [orderData]);

    const handleSendBack = (cat: string) => {
        if (selectedItem.list?.length > 0) {
            updateDoc('Sent Back Category', id, {
                comments: comment,
                workflow_state: "Pending",
                item_list: {
                    list: selectedItem.list
                },
            })
                .then(() => {
                    console.log("item", id)
                    navigate("/")
                }).catch(() => {
                    console.log("update_submit_error", update_submit_error)
                })
        }

        const order_list = {
            list: []
        };
        orderData.item_list?.list.map((value) => {
            const isSelected = selectedItem.list.some(item => item.name === value.name);
            if (!isSelected) {
                const newItem = {
                    name: value.name,
                    item: value.item,
                    unit: value.unit,
                    quantity: value.quantity,
                    quote: value.quote
                }
                order_list.list.push(newItem)
            }
        })

        const vendorItems = {};
        order_list.list.map((item) => {
            if (!vendorItems[item.vendor]) {
                vendorItems[item.vendor] = [];
            }

            vendorItems[item.vendor].push({
                name: item.name,
                quote: Number(item.quote),
                quantity: item.quantity,
                unit: item.unit,
                item: item.item
            });
        })

        const createDocPromises = [];

        Object.entries(vendorItems)?.forEach(([key, value]) => {

            const newProcurementOrder = {
                procurement_request: orderData.procurement_request,
                project: orderData.project_name,
                project_name: getProjectName(orderData.project_name),
                project_address: getProjectAddress(orderData.project_name),
                vendor: key,
                vendor_name: getVendorName(key),
                vendor_address: getVendorAddress(key),
                vendor_gst: getVendorGST(key),
                order_list: {
                    list: value
                }
            };

            if (order_list.length > 0) {
                const createDocPromise = createDoc('Procurement Orders', newProcurementOrder)
                    .then(() => {
                        console.log(newProcurementOrder);
                    })
                    .catch((error) => {
                        console.log("submit_error", error);
                    });

                createDocPromises.push(createDocPromise);
            }
        });

        Promise.all(createDocPromises)
            .then(() => {
                navigate("/");
            })
            .catch((error) => {
                console.log("update_submit_error", error);
            });
    }
    const curCategory = orderData.category

    const handleApprove = (cat: string) => {
        const vendorItems = {};
        orderData.item_list?.list.map((item) => {
            if (!vendorItems[item.vendor]) {
                vendorItems[item.vendor] = [];
            }

            vendorItems[item.vendor].push({
                name: item.name,
                quote: Number(item.quote),
                quantity: item.quantity,
                unit: item.unit,
                item: item.item
            });
        })

        const createDocPromises = [];

        Object.entries(vendorItems)?.forEach(([key, value]) => {

            const newProcurementOrder = {
                procurement_request: orderData.procurement_request,
                project: orderData.project_name,
                project_name: getProjectName(orderData.project_name),
                project_address: getProjectAddress(orderData.project_name),
                vendor: key,
                vendor_name: getVendorName(key),
                vendor_address: getVendorAddress(key),
                vendor_gst: getVendorGST(key),
                order_list: {
                    list: value
                }
            };

            if (value.length > 0) {
                const createDocPromise = createDoc('Procurement Orders', newProcurementOrder)
                    .then(() => {
                        console.log(newProcurementOrder);
                    })
                    .catch((error) => {
                        console.log("submit_error", error);
                    });

                createDocPromises.push(createDocPromise);
            }
        });

        Promise.all(createDocPromises)
            .then(() => {
                updateDoc('Sent Back Category', id, {
                    workflow_state: "Approved"
                })
                    .then(() => {
                        console.log("item", id)
                        navigate("/")
                    }).catch(() => {
                        console.log("update_submit_error", update_submit_error)
                    })
            })
            .catch((error) => {
                console.log("update_submit_error", error);
            });
    }

    const getTotal = (cat: string) => {
        let total: number = 0;
        orderData.item_list?.list.map((item) => {
            if(item.category === cat){
            const price = item.quote;
            total += (price ? parseFloat(price) : 0) * item.quantity}
        })
        return total
    }

    // const getLowest = (cat: string) => {
    //     let price: number = 0;
    //     let vendor: string = 'vendor';

    //     orderData.procurement_list?.list.map((item) => {
    //         if (item.category === cat) {
    //             const quotesForItem = quotation_request_list
    //                 ?.filter(value => value.item === item.name && value.quote)
    //                 ?.map(value => value.quote);
    //             let minQuote;
    //             if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
    //             price += (minQuote ? parseFloat(minQuote) : 0) * item.quantity;
    //         }
    //     })

    //     return { quote: price, vendor: vendor }
    // }

    // const getLowest2 = (item: string) => {
    //     const quotesForItem = quotation_request_list
    //         ?.filter(value => value.item === item && value.quote)
    //         ?.map(value => value.quote);
    //     let minQuote;
    //     if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
    //     return minQuote;
    // }

    const getLowest3 = (cat: string) => {
        let total: number = 0;
        orderData.item_list?.list.map((item) => {
            if (item.category === cat) {
                const quotesForItem = quote_data
                    ?.filter(value => value.item === item.name && value.quote)
                    ?.map(value => value.quote);
                let minQuote;
                if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
                total += (minQuote ? parseFloat(minQuote) : 0) * item.quantity;
            }
        })
        return total;
    }

    return (
        <MainLayout>
            <div className="flex" >
                <div className="flex-1 space-x-2 md:space-y-4 p-2 md:p-6 pt-6">
                    <div className="flex items-center pt-1 pb-4">
                        <ArrowLeft onClick={() => { navigate('/approve-sent-back') }} />
                        <h2 className="text-base pl-2 font-bold tracking-tight">Approve</h2>
                    </div>
                    <Card className="grid grid-cols-5 gap-4 border border-gray-100 rounded-lg p-4">
                        <div className="border-0 flex flex-col items-center justify-center">
                            <p className="text-left py-1 font-semibold text-sm text-gray-300">Sent Back ID</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.name?.split("-")[3]}</p>
                        </div>
                        <div className="border-0 flex flex-col items-center justify-center">
                            <p className="text-left py-1 font-semibold text-sm text-gray-300">Date</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.creation?.split(" ")[0]}</p>
                        </div>
                        <div className="border-0 flex flex-col items-center justify-center">
                            <p className="text-left py-1 font-semibold text-sm text-gray-300">Project</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.project}</p>
                        </div>
                        <div className="border-0 flex flex-col items-center justify-center">
                            <p className="text-left py-1 font-semibold text-sm text-gray-300">Project Lead</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.owner}</p>
                        </div>
                        <div className="border-0 flex flex-col items-center justify-center">
                            <p className="text-left py-1 font-semibold text-sm text-gray-300">PR Number</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.procurement_request?.slice(-4)}</p>
                        </div>
                    </Card>
                    {/* <div className="w-full">
                        <div className="font-bold text-xl py-2">{orderData?.category}</div>
                        <Card className="flex w-1/2 shadow-none border border-grey-500" >
                            <CardHeader className="w-full">
                                <CardTitle>
                                    
                                    <div className="flex justify-between border-b">
                                        <div className="font-bold text-lg py-2 border-gray-200">Total</div>
                                        <div className="font-bold text-2xl text-red-500 py-2 border-gray-200">{getTotal(curCategory)}</div>
                                    </div>
                                </CardTitle>
                                {orderData.item_list?.list.map((item) => {
                                    const price = item.quote;
                                    if (count === 2) { return }
                                    count++;
                                    return <div className="flex justify-between py-2">
                                        <div className="text-sm">{item.item}</div>
                                        <div className="text-sm">{price * item.quantity}</div>
                                    </div>

                                })}
                                <Dialog>
                                    <DialogTrigger asChild>
                                        <div className="text-sm text-blue-500 cursor-pointer">View All</div>
                                    </DialogTrigger>
                                    <DialogContent className="sm:max-w-[425px] md:max-w-[725px]">
                                        <DialogHeader>
                                            <DialogTitle>Items List</DialogTitle>
                                            <DialogDescription>
                                                <div className="grid grid-cols-10 font-medium text-black justify-between">
                                                    <div className="text-sm col-span-2 border p-2">Items</div>
                                                    <div className="text-sm border p-2">Unit</div>
                                                    <div className="text-sm border p-2">Qty</div>
                                                    <div className="text-sm border p-2">Rate</div>
                                                    <div className="text-sm border p-2">Amount</div>
                                                    <div className="text-sm col-span-2 border p-2">Selected Vendor</div>
                                                    <div className="text-sm col-span-2 border p-2">3 months Lowest Amount</div>
                                                </div>
                                                {orderData.item_list?.list.map((item) => {
                                                    const price = item.quote;
                                                    const quotesForItem = quote_data
                                                        ?.filter(value => value.item === item.name && value.quote != null)
                                                        ?.map(value => value.quote);
                                                    let minQuote;
                                                    if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);

                                                    return <div className="grid grid-cols-10">
                                                        <div className="text-sm col-span-2 border p-2">{item.item}</div>
                                                        <div className="text-sm border p-2">{item.unit}</div>
                                                        <div className="text-sm border p-2">{item.quantity}</div>
                                                        <div className="text-sm border p-2">{price}</div>
                                                        <div className="text-sm border p-2">{price * item.quantity}</div>
                                                        <div className="text-sm col-span-2 border p-2">{getVendorName(item.vendor)}</div>
                                                        <div className="text-sm col-span-2 border p-2">{minQuote ? minQuote * item.quantity : "N/A"}</div>
                                                    </div>

                                                })}
                                            </DialogDescription>
                                        </DialogHeader>
                                    </DialogContent>
                                </Dialog>
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
                                                    <div className="text-sm w-[45%]">Added Items</div>
                                                    <div className="text-sm">Qty</div>
                                                    <div className="text-sm">UOM</div>
                                                    <div className="text-sm">Rate</div>
                                                    <div className="text-sm w-[20%]">Last 3 months Lowest Rate</div>
                                                </div>
                                                <label className="text-black">
                                                    <input
                                                        className="botton-0 mr-2 w-4 h-4"
                                                        type="checkbox"
                                                        checked={selectAll}
                                                        onChange={handleSelectAllChange}
                                                    />
                                                    Select All
                                                </label>
                                                {orderData.item_list?.list.map((item) => {
                                                    const quotesForItem = quote_data
                                                        ?.filter(value => value.item === item.name && value.quote != null)
                                                        ?.map(value => value.quote);
                                                    let minQuote;
                                                    if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);

                                                    return <div className="flex justify-between py-2">
                                                        <div className="text-sm w-[45%] text-black font-semibold"><input className="botton-0 mr-2 w-4 h-4" type="checkbox" checked={selectedItem.list.some(selected => selected.name === item.name)} onChange={() => handleCheckboxChange(item.name)} />{item.item}</div>
                                                        <div className="text-sm text-black font-semibold">{item.quantity}</div>
                                                        <div className="text-sm text-black font-semibold">{item.unit}</div>
                                                        <div className="text-sm text-black font-semibold">{item.quote}</div>
                                                        <div className="text-sm text-black font-semibold w-[20%]">{minQuote ? minQuote : "N/A"}</div>
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
                                                <div className="flex flex-col justify-end items-end pt-10 bottom-4 right-4">
                                                    <SheetClose><Button onClick={() => handleSendBack(curCategory)}>Submit</Button></SheetClose>
                                                </div>
                                            </SheetDescription>
                                        </SheetHeader>
                                    </ScrollArea>
                                </SheetContent>
                            </Sheet>
                            <Dialog>
                                <DialogTrigger asChild>
                                    <Button>
                                        Approve
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="sm:max-w-[425px]">
                                    <DialogHeader>
                                        <DialogTitle>Are you Sure</DialogTitle>
                                        <DialogDescription>
                                            Click on Confirm to Approve.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <Button variant="secondary" onClick={() => handleApprove(curCategory)}>Confirm</Button>
                                </DialogContent>
                            </Dialog>
                        </div>
                    </div> */}
                </div>
            </div>
            <ConfigProvider
                theme={{
                    token: {
                        // Seed Token
                        colorPrimary: '#FF2828',
                        borderRadius: 4,

                        // Alias Token
                        colorBgContainer: '#FFFFFF',
                    },
                }}
            >
                {data.length > 0 && <Table
                    dataSource={data}
                    rowSelection={{ ...rowSelection, checkStrictly }}
                    expandable={{ defaultExpandAllRows: true }}
                    columns={columns}
                />}

            </ConfigProvider>
            {selectedItems?.length > 0 && <div className="text-right space-x-2">
                <Dialog>
                    <DialogTrigger asChild>
                        <Button className="text-red-500 bg-white border border-red-500 hover:text-white">
                            Send Back
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                            <DialogTitle>Are you Sure</DialogTitle>
                            <DialogDescription>
                                Add Comments and Send Back the Selected Items.
                                <div className="py-2"><label htmlFor="textarea" >Comment:</label></div>
                                <textarea
                                    id="textarea"
                                    className="w-full border rounded-lg p-2"
                                    value={comment}
                                    placeholder="Type your comments here"
                                    onChange={(e) => setComment(e.target.value)}
                                />
                            </DialogDescription>
                        </DialogHeader>
                        <DialogClose>
                            <Button className="text-white bg-red-500" onClick={() => newHandleSentBack()}>Send Back</Button>
                        </DialogClose>
                    </DialogContent>
                </Dialog>
                <Dialog>
                    <DialogTrigger asChild>
                        <Button>
                            Approve
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                            <DialogTitle>Are you Sure</DialogTitle>
                            <DialogDescription>
                                Click on Confirm to Approve the Selected Items.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogClose>
                            <Button className="text-white bg-red-500" onClick={() => newHandleApprove()}>Approve</Button>
                        </DialogClose>
                    </DialogContent>
                </Dialog>
            </div>}
        </MainLayout>
    )
}