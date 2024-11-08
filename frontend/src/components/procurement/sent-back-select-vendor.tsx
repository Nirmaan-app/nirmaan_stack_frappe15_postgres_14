import { ArrowBigUpDash, ArrowLeft, CheckCheck, Pencil, Undo2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react"
import { formatDate } from '@/utils/FormatDate';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Table, ConfigProvider } from 'antd';
import type { TableColumnsType, TableProps } from 'antd';
import { toast } from '../ui/use-toast';
import formatToIndianRupee from '@/utils/FormatPrice';
import { ProcurementHeaderCard } from '../ui/ProcurementHeaderCard';

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
        render: (text) => {
            return (
                <span>{text === undefined ? "" : text === "Delayed" ? "Delayed" : formatToIndianRupee(text)}</span>
            )
        }
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
        render: (text, record) => {
            // console.log("text", text)
            return (
                <span style={{ fontWeight: record.unit === null ? 'bold' : 'normal' }}>
                    {Number.isNaN(text) ? "Delayed" : text === "Delayed" ? "Delayed" : formatToIndianRupee(text)}
                </span>
            )
        }
    },
    {
        title: 'Lowest Quoted Amount',
        dataIndex: 'lowest2',
        width: '10%',
        key: 'lowest2',
        render: (text, record) => (
            <span style={{ fontWeight: record.unit === null ? 'bold' : 'normal' }}>
                {text === "Delayed" ? text : formatToIndianRupee(text)}
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
                {formatToIndianRupee(text)}
            </span>
        ),
    },
];


export const SentBackSelectVendor = () => {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()

    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'category_list', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'creation'],
            limit: 1000
        });
    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error } = useFrappeGetDocList("Vendors",
        {
            fields: ['name', 'vendor_name', 'vendor_address'],
            limit: 1000
        });
    const { data: quotation_request_list, isLoading: quotation_request_list_loading, error: quotation_request_list_error } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['name', 'lead_time', 'item', 'vendor', 'category', 'procurement_task', 'quote'],
            limit: 10000,
            orderBy: { field: "creation", order: "desc" }
        });
    const { data: sent_back_list, isLoading: sent_back_list_loading, error: sent_back_list_error } = useFrappeGetDocList("Sent Back Category",
        {
            fields: ['*'],
            filters: [["workflow_state", "=", "Pending"]],
            limit: 1000
        });
    const { data: quote_data } = useFrappeGetDocList("Approved Quotations",
        {
            fields: ['item_id', 'quote'],
            limit: 2000
        });
    const { updateDoc: updateDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeUpdateDoc()

    const [page, setPage] = useState<string>('updatequotation')
    const [orderData, setOrderData] = useState({
        project: ''
    })

    const {data: filtered_quotation_data} = useFrappeGetDocList("Quotation Requests", {
        fields: ["*"],
        filters: [["procurement_task", "=", orderData?.procurement_request]],
        limit: 2000
    })

    if (!orderData.project) {
        sent_back_list?.map(item => {
            if (item.name === id) {
                setOrderData(item)
            }
        })
    }

    const [selectedVendors, setSelectedVendors] = useState({})
    const [selectedCategories, setSelectedCategories] = useState({})

    useEffect(() => {
        const updatedCategories = { ...selectedCategories };
        orderData?.category_list?.list.map((cat) => {
            const newVendorsSet = new Set();
            const curCategory = cat.name
            quotation_request_list?.forEach((item) => {
                if (item.category === cat.name && item.procurement_task === orderData.procurement_request) {
                    if (!Array.isArray(updatedCategories[curCategory])) {
                        updatedCategories[curCategory] = [];
                    }
                    newVendorsSet.add(item.vendor);
                }
            });
            const newVendors = Array.from(newVendorsSet);
            updatedCategories[curCategory] = newVendors;
        })
        setSelectedCategories(updatedCategories);
    }, [quotation_request_list, orderData]);

    const [data, setData] = useState<DataType>([])

    const [delayedItems, setDelayedItems] = useState({})

    const delayedItemsCheck = () => {
        let delayedItems = {};

        if (data) {
            data.forEach((item) => {
                item.children.forEach((i) => {
                    if (i.rate === "Delayed") {
                        if (!delayedItems[i.category]) {
                            delayedItems[i.category] = [];
                        }
                        delayedItems[i.category].push(i.item);
                    }
                });
            });
        }

        setDelayedItems(delayedItems);
    };

    // console.log("data", data)
    // console.log("delayedItems", delayedItems)

    // console.log("orderData", orderData)
    useEffect(() => {
        if (orderData.project) {
            const newData: DataType[] = [];
            orderData.category_list?.list.forEach((cat) => {
                const items: DataType[] = [];

                orderData.item_list?.list.forEach((item) => {
                    if (item.category === cat.name) {
                        const price = Number(getPrice(selectedVendors[item.name], item.name))
                        const quotesForItem = quote_data
                            ?.filter(value => value.item_id === item.name && value.quote)
                            ?.map(value => value.quote);
                        let minQuote;
                        if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
                        minQuote = (minQuote ? parseFloat(minQuote) * item.quantity : 0)

                        items.push({
                            item: item.item,
                            key: item.name,
                            unit: item.unit,
                            tax: Number(item.tax),
                            status: "Pending",
                            quantity: item.quantity,
                            category: item.category,
                            rate: selectedVendors[item.name] ? price : "Delayed",
                            amount: selectedVendors[item.name] ? price * item.quantity : "Delayed",
                            selectedVendor: selectedVendors[item.name] ? getVendorName(selectedVendors[item.name]) : "Delayed",
                            lowest2: selectedVendors[item.name] ? getLowest2(item.name) * item.quantity : "Delayed",
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
                        lowest2: getLowest(cat.name).quote,
                        lowest3: getLowest3(cat.name),
                        children: items,
                    };
                    newData.push(node);
                }
            });
            console.log("newData", newData)
            setData(newData)
        }
    }, [orderData, selectedVendors]);

    // console.log("data", data)

    const rowSelection: TableRowSelection<DataType> = {
        onChange: (selectedRowKeys, selectedRows) => {
            console.log("onChange")
            console.log(`selectedRowKeys: ${selectedRowKeys}`, 'selectedRows: ', selectedRows);
        },
        onSelect: (record, selected, selectedRows) => {
            console.log(record, selected, selectedRows);
        },
        onSelectAll: (selected, selectedRows, changeRows) => {
            console.log(selected, selectedRows, changeRows);
        },
    };

    const getVendorName = (vendorName: string) => {
        return vendor_list?.find(vendor => vendor.name === vendorName)?.vendor_name;
    }

    // console.log("orderData", orderData)

    const handleRadioChange = (item, vendor) => {
        setSelectedVendors(prevState => {
            if (prevState.hasOwnProperty(item)) {
                return { ...prevState, [item]: vendor };
            } else {
                return { ...prevState, [item]: vendor };
            }
        });

    };

    const handleChangeWithParam = (item, vendor) => {
        return () => handleRadioChange(item, vendor);
    };

    const handleSubmit = () => {
        // console.log("submit orderData", orderData)
        quotation_request_list?.map((item) => {
            if (selectedVendors[item.item] === item.vendor && orderData?.procurement_request === item.procurement_task) {
                updateDoc('Quotation Requests', item.name, {
                    status: "Selected",
                })
                    .then(() => {
                        console.log("item", item.name)
                    }).catch(() => {
                        console.log(update_submit_error)
                    })
            }
        })
        updateDoc('Sent Back Category', id, {
            workflow_state: "Vendor Selected",
            item_list: orderData.item_list,
        })
            .then(() => {
                console.log("item", id)

                toast({
                    title: "Success!",
                    description: `Sent Back: ${id} sent for Approval!`,
                    variant: "success"
                })
                navigate(-2)
            }).catch((error) => {
                toast({
                    title: "Failed!",
                    description: `Failed to send Sent Back: ${id} for Approval`,
                    variant: "destructive"
                })
                console.log("submit_error", submit_error)
            })
    }

    // useEffect(() => {
    //     setOrderData(prevState => ({
    //         ...prevState,
    //         vendor: selectedVendors[curCategory]
    //     }));
    // }, [selectedVendors]);

    const handleUpdateOrderData = () => {
        setPage('approvequotation')
        setOrderData(prevState => {
            const updatedItemList = prevState.item_list.list.map((item) => {
                const newPrice = quotation_request_list.find(value =>
                    value.item === item.name && value.vendor === selectedVendors[item.name] && value.procurement_task === prevState.procurement_request
                )?.quote
                console.log(newPrice)
                return {
                    ...item,
                    quote: newPrice,
                    vendor: selectedVendors[item.name]
                };
            });
            return {
                ...prevState,
                item_list: {
                    ...prevState.itemlist,
                    list: updatedItemList
                }
            };
        });
    }

    const generateVendorItemKey = (vendor: string, item: string): string => {
        return `${vendor}-${item}`;
    };
    const [priceMap, setPriceMap] = useState(new Map<string, string>());

    const getPrice = (vendor: string, item: string): string | undefined => {
        const key = generateVendorItemKey(vendor, item);
        return priceMap.get(key) ? priceMap.get(key) : "-";
    };
    useEffect(() => {
        const newPriceMap = new Map<string, string>();
        quotation_request_list?.forEach((item) => {
            if (item.procurement_task === orderData?.procurement_request) {
                const key = generateVendorItemKey(item.vendor, item.item);
                newPriceMap.set(key, item.quote);
            }
        });
        setPriceMap(newPriceMap);
    }, [quotation_request_list, orderData]);

    // const getPackage = (name: string) => {
    //     return procurement_request_list?.find(item => item.name === name)?.work_package;
    // }

    console.log('quotationrequestlist', quotation_request_list)

    const getLeadTime = (vendor: string, category: string) => {
        const item = filtered_quotation_data?.find(item => item.vendor === vendor && item.category === category)
        return item?.lead_time;
    }
    const getSelectedVendor = (item: string) => {
        return selectedVendors[item] ? getVendorName(selectedVendors[item]) : ""
    }

    const getTotal = (cat: string) => {
        let total: number = 0;
        orderData.item_list?.list.map((item) => {
            if (item.category === cat) {
                const price = getPrice(selectedVendors[item.name], item.name);
                total += (price ? parseFloat(price) : 0) * item.quantity;
            }
        })
        return total
    }

    const getLowest2 = (item: string) => {
        const quotesForItem = quotation_request_list
            ?.filter(value => value.item === item && value.procurement_task === orderData?.procurement_request && value.quote)
            ?.map(value => value.quote);
        let minQuote;
        if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
        return minQuote;
    }

    const getLowest = (cat: string) => {
        let price: number = 0;
        let vendor: string = 'vendor';

        orderData.item_list?.list.map((item) => {
            if (item.category === cat) {
                const quotesForItem = quotation_request_list
                    ?.filter(value => value.item === item.name && value.quote && value.procurement_task === orderData.procurement_request)
                    ?.map(value => value.quote);
                let minQuote;
                if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
                price += (minQuote ? parseFloat(minQuote) : 0) * item.quantity;
            }
        })

        return { quote: price, vendor: vendor }
    }

    const getLowest3 = (cat: string) => {
        let total: number = 0;
        orderData.item_list?.list.map((item) => {
            if (item.category === cat) {
                const quotesForItem = quote_data
                    ?.filter(value => value.item_id === item.name && value.quote)
                    ?.map(value => value.quote);
                let minQuote;
                if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
                total += (minQuote ? parseFloat(minQuote) : 0) * item.quantity;
            }
        })
        return total;
    }

    const getTotal2 = (vendor: string, cat: string) => {
        let total: number = 0;
        orderData?.item_list?.list.map((item) => {
            if (item.category === cat) {
                const price = getPrice(vendor, item.name);
                total += (price ? parseFloat(price) : 0) * item.quantity;
            }
        })
        return total
    }
    let count: number = 0;

    return (
        <>
            {page == 'updatequotation' &&
                <div className="flex-1 space-y-2 md:space-y-4">
                    <div className="flex items-center pt-1 pb-4">
                        <ArrowLeft onClick={() => navigate(-1)} />
                        <h2 className="text-base pl-2 font-bold tracking-tight"><span className="text-red-700">SB-{orderData?.name?.slice(-4)}</span>: Select Vendor Quotes</h2>
                    </div>
                    <ProcurementHeaderCard orderData={orderData} sentBack />
                    {orderData?.category_list?.list.map((cat) => {
                        const curCategory = cat.name;
                        return <div>
                            <Card className="flex w-full shadow-none border border-grey-500 overflow-x-auto">
                                <CardHeader className="w-full overflow-x-auto">
                                    <div className='flex justify-between py-5'>
                                        <CardTitle className="font-bold text-xl">
                                            {curCategory}
                                        </CardTitle>
                                        <CardTitle className="font-bold text-xl">
                                            {getSelectedVendor(curCategory)}
                                        </CardTitle>
                                    </div>
                                    <table className="w-full">
                                        <thead className="w-full border-b border-black">
                                            <tr>
                                                <th scope="col" className="bg-gray-200 p-2 font-semibold text-left">Items<div className='py-2 font-light text-sm text-gray-400'>Delivery Time:</div></th>
                                                {selectedCategories[curCategory]?.map((item) => {
                                                    const isSelected = selectedVendors[curCategory] === item;
                                                    const dynamicClass = `flex-1 ${isSelected ? 'text-red-500' : ''}`
                                                    return <th className="bg-gray-200 font-semibold p-2 text-left"><span className={dynamicClass}>{getVendorName(item)?.length >= 12 ? getVendorName(item).slice(0, 12) + '...' : getVendorName(item)}</span>
                                                        <div className={`py-2 font-light text-sm text-opacity-50 ${dynamicClass}`}>{getLeadTime(item, curCategory) || "--"} Days</div>
                                                    </th>
                                                })}
                                                <th className="bg-gray-200 p-2 font-medium truncate text-left">Last 3 months <div className=''>Lowest Quote</div></th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">

                                            {orderData?.item_list?.list.map((item) => {
                                                const quotesForItem = quote_data
                                                    ?.filter(value => value.item_id === item.name && value.quote)
                                                    ?.map(value => value.quote);
                                                let minQuote;
                                                if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);

                                                if (item.category === curCategory) {
                                                    return <tr>
                                                        <td className="py-2 text-sm px-2 font-semibold border-b w-[40%]">
                                                            {item.item}
                                                        </td>
                                                        {selectedCategories[curCategory]?.map((value) => {
                                                            const price = getPrice(value, item.name);
                                                            // total += (price ? parseFloat(price) : 0)*item.quantity;
                                                            const isSelected = selectedVendors[item.name] === value;
                                                            const dynamicClass = `flex-1 ${isSelected ? 'text-red-500' : ''}`
                                                            return <td className={`py-2 text-sm px-2 border-b text-left ${dynamicClass}`}>
                                                                <input className="mr-2" disabled={price === "-" ? true : false} type="radio" id={`${item.name}-${value}`} name={item.name} value={`${item.name}-${value}`} onChange={handleChangeWithParam(item.name, value)} />
                                                                {Number.isNaN((price * item.quantity)) ? "N/A" : formatToIndianRupee(price * item.quantity)}
                                                            </td>
                                                        })}
                                                        <td className="py-2 text-sm px-2 border-b">
                                                            {minQuote ? formatToIndianRupee(minQuote * item.quantity) : "N/A"}
                                                        </td>
                                                    </tr>
                                                }
                                            })}
                                            <tr>
                                                <td className="py-4 text-sm px-2 font-semibold">Total</td>
                                                {selectedCategories[curCategory]?.map((value) => {
                                                    const isSelected = selectedVendors[curCategory] === value;
                                                    const dynamicClass = `flex-1 ${isSelected ? 'text-red-500' : ''}`
                                                    return <td className={`py-2 text-sm max-sm:pl-2 pl-8 text-left font-bold ${dynamicClass}`}>
                                                        {Number.isNaN(getTotal2(value, curCategory)) ? "--" : formatToIndianRupee(getTotal2(value, curCategory))}
                                                    </td>
                                                })}
                                                <td></td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </CardHeader>
                            </Card>
                        </div>
                    })}
                    {/* <div className="pt-10"></div> */}
                    <div className='pt-6 flex justify-between'>
                        <Button variant={"outline"} className="text-red-500 border-red-500 flex items-center gap-1" onClick={() => navigate(-1)}>
                            <Pencil className='w-4 h-4' />
                            Edit Price
                        </Button>
                        {/* </div>
                        <div className="flex flex-col justify-end items-end fixed bottom-4 right-4"> */}

                        <Dialog>
                            <DialogTrigger asChild>
                                <Button onClick={delayedItemsCheck} className='flex items-center gap-1'>
                                    <CheckCheck className="h-4 w-4" />
                                    Confirm
                                </Button>
                            </DialogTrigger>
                            {
                                Object.keys(delayedItems).length ? (
                                    <DialogContent className="sm:max-w-[425px]">
                                        <DialogHeader>
                                            <DialogTitle>Attention Please!!</DialogTitle>
                                            <DialogDescription>
                                                No item status should be delayed. close the dialog and rectify delayed Items with quotes
                                            </DialogDescription>
                                            <DialogDescription className='text-start'>
                                                <div className='flex flex-col gap-2'>
                                                    <h4 className='text-sm font-semibold'>For your reference, Here's the list of items whose quotes are not selected:</h4>
                                                    {
                                                        Object.keys(delayedItems).map((cat) => (
                                                            <div>
                                                                <h3 className='font-semibold italic'>{cat}</h3>
                                                                <ul className='list-disc ml-4'>
                                                                    {delayedItems[cat].map((item) => (
                                                                        <li>{item}</li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        ))
                                                    }
                                                </div>
                                            </DialogDescription>
                                        </DialogHeader>
                                        <DialogDescription className='flex items-center justify-center gap-2'>
                                            <DialogClose><Button variant={"outline"} className="flex items-center gap-1">
                                                <Undo2 className="h-4 w-4" />
                                                Cancel
                                            </Button></DialogClose>
                                            <Button disabled variant="default" className="flex items-center gap-1">
                                                <CheckCheck className="h-4 w-4" />
                                                Confirm</Button>
                                        </DialogDescription>
                                    </DialogContent>
                                ) : (
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>
                                                Click on confirm to go to the comparison page
                                            </DialogTitle>
                                        </DialogHeader>
                                        <DialogDescription className='flex items-center justify-center gap-2'>
                                            <DialogClose><Button variant={"outline"} className="flex items-center gap-1">
                                                <Undo2 className="h-4 w-4" />
                                                Cancel</Button></DialogClose>
                                            <Button variant="default" className="flex items-center gap-1" onClick={() => {
                                                delayedItemsCheck()
                                                handleUpdateOrderData()
                                            }}>
                                                <CheckCheck className="h-4 w-4" />
                                                Confirm</Button>
                                        </DialogDescription>
                                    </DialogContent>
                                )
                            }
                        </Dialog>

                        {/* <Button onClick={() => handleUpdateOrderData()}>
                                Confirm
                            </Button> */}
                    </div>
                </div>}
            {page == 'approvequotation' &&
                <>
                    <div className="flex-1 space-y-2 md:space-y-4">
                        <div className="flex items-center pt-1 pb-4">
                            <ArrowLeft onClick={() => setPage('updatequotation')} />
                            <h2 className="text-base pl-2 font-bold tracking-tight"><span className="text-red-700">SB-{orderData?.name?.slice(-4)}</span>: Comparison</h2>
                        </div>
                        <ProcurementHeaderCard orderData={orderData} sentBack />
                        <div className="w-full">
                            {/* <div className="font-bold text-xl py-2">{curCategory}</div> */}
                            {/* <Card className="flex w-1/2 shadow-none border border-grey-500" >
                                <CardHeader className="w-full">
                                    <CardTitle>
                                        <div className="flex justify-between border-b">
                                            <div className="font-bold text-lg py-2 border-gray-200">Total</div>
                                            <div className="font-bold text-2xl text-red-500 py-2 border-gray-200">{getTotal(curCategory)}</div>
                                        </div>
                                    </CardTitle>
                                    {orderData.item_list?.list.map((item) => {
                                        if (count === 2) { return }
                                        count++;
                                        const price = getPrice(selectedVendors[item.name], item.name);
                                        return <div className="flex justify-between py-2">
                                            <div className="text-sm">{item.item}</div>
                                            <div className="text-sm">{price * item.quantity}</div>
                                        </div>
                                    })}
                                    <div className="flex justify-between py-2">
                                        <Dialog>
                                            <DialogTrigger asChild>
                                                <div className="text-sm text-blue-500 cursor-pointer">View All</div>
                                            </DialogTrigger>
                                            <DialogContent className="sm:max-w-[425px] md:max-w-[675px]">
                                                <DialogHeader>
                                                    <DialogTitle>Items List</DialogTitle>
                                                    <DialogDescription>
                                                        <div className="grid grid-cols-10 font-medium text-black justify-between">
                                                            <div className="text-sm col-span-2 border p-2">Items</div>
                                                            <div className="text-sm border p-2">Qty</div>
                                                            <div className="text-sm border p-2">Unit</div>
                                                            <div className="text-sm border p-2">Rate</div>
                                                            <div className="text-sm border p-2">Amount</div>
                                                            <div className="text-sm col-span-2 border p-2">Selected Vendor</div>
                                                            <div className="text-sm col-span-2 border p-2">3 months Lowest Amount</div>
                                                        </div>
                                                        {orderData.item_list?.list.map((item) => {
                                                            const price = getPrice(selectedVendors[item.name], item.name);

                                                            const quotesForItem = quote_data
                                                                ?.filter(value => value.item_id === item.name && value.quote != null)
                                                                ?.map(value => value.quote);
                                                            let minQuote;
                                                            if (quotesForItem) minQuote = Math.min(...quotesForItem);

                                                            return <div className="grid grid-cols-10">
                                                                <div className="text-sm col-span-2 border p-2">{item.item}</div>
                                                                <div className="text-sm border p-2">{item.quantity}</div>
                                                                <div className="text-sm border p-2">{item.unit}</div>
                                                                <div className="text-sm border p-2">{price}</div>
                                                                <div className="text-sm border p-2">{price * item.quantity}</div>
                                                                <div className="text-sm col-span-2 border p-2">{getVendorName(selectedVendors[item.name])}</div>
                                                                <div className="text-sm col-span-2 border p-2">{minQuote ? minQuote * item.quantity : "N/A"}</div>
                                                            </div>
                                                        })}
                                                    </DialogDescription>
                                                </DialogHeader>
                                            </DialogContent>
                                        </Dialog>
                                        <div className="text-sm text-gray-400">Delivery Time: {getLeadTime(selectedVendors[curCategory], curCategory)} Days</div>
                                    </div>
                                </CardHeader>
                            </Card> */}



                        </div>
                    </div>
                    <div className='overflow-x-auto'>
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
                            <Table
                                dataSource={data}
                                columns={columns}
                                expandable={{ defaultExpandAllRows: true }}

                            />

                        </ConfigProvider>
                    </div>
                    <div className="flex flex-col justify-end items-end mr-2 mb-4 mt-4">
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button className="flex items-center gap-1">
                                    <ArrowBigUpDash />
                                    Send for Approval
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[425px]">
                                <DialogHeader>
                                    <DialogTitle>Have you cross-checked your quote selections?</DialogTitle>
                                    <DialogDescription>
                                        {/* {orderData.item_list?.list.filter((item) => item.vendor === undefined).length === 0 ?
                                            <span>You can click on confirm to send it for approval</span>
                                            :
                                            <span>No item status should be delayed. Go Back and rectify delayed Items with quotes</span>
                                        } */}
                                        <span>You can click on confirm to send it for approval</span>
                                    </DialogDescription>
                                </DialogHeader>
                                <DialogDescription className='flex items-center justify-center gap-2'>
                                    <Button variant={"secondary"} onClick={() => setPage("updatequotation")} className="flex items-center gap-1">
                                        <Undo2 className="h-4 w-4" />
                                        Go Back</Button>
                                    {/* {console.log("filter:", orderData.item_list?.list.filter((item) => item.vendor === undefined).length)} */}
                                    {/* {orderData.item_list?.list.filter((item) => item.vendor === undefined).length === 0 ?
                                        <Button onClick={() => handleSubmit()}>Confirm</Button>
                                        :
                                        <Button variant="secondary" disabled={true}>Confirm</Button>
                                    } */}
                                    <Button onClick={() => handleSubmit()} className="flex items-center gap-1">
                                        <CheckCheck className="h-4 w-4" />
                                        Confirm</Button>
                                </DialogDescription>
                            </DialogContent>
                        </Dialog>
                    </div>
                </>
            }
        </>
    )
}