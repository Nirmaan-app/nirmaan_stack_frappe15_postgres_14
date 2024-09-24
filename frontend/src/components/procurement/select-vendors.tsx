import { ArrowLeft, MessageCircleMore } from 'lucide-react';
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { useFrappeGetDocList, useFrappeUpdateDoc, useFrappeCreateDoc } from "frappe-react-sdk";
import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react"
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
import { useToast } from '../ui/use-toast';
import { formatDate } from '@/utils/FormatDate';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../ui/hover-card';

// type TableRowSelection<T> = TableProps<T>['rowSelection'];

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
        key: 'item',
        render: (text, record) => {
            return (
                    <div className="inline items-baseline">
                        <span style={{ fontWeight: record.unit === null ? 'bold' : 'normal', fontStyle: record.unit !== null ? 'italic' : "normal" }}>
                            {text}
                            </span>
                        {(!record.children && record.comment) && (
                          <HoverCard>
                          <HoverCardTrigger><MessageCircleMore className="text-blue-400 w-6 h-6 inline-block ml-1" /></HoverCardTrigger>
                          <HoverCardContent className="max-w-[300px]">
                          <div className="relative pb-4">
                              <span className="block">{record.comment}</span>
                              <span className="text-xs absolute right-0 italic text-gray-500">-Comment by PL</span>
                          </div>

                            </HoverCardContent>
                        </HoverCard>
                        )}
                        </div>
            )
        }
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
        title: 'Lowest Quoted Amount',
        dataIndex: 'lowest2',
        width: '10%',
        key: 'lowest2',
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

export const SelectVendors = () => {
    const { orderId } = useParams<{ orderId: string }>()
    const navigate = useNavigate()

    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'category_list', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'creation', 'procurement_executive'],
            filters: [['name', '=', orderId]],
            limit: 1000
        });
    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error } = useFrappeGetDocList("Vendors",
        {
            fields: ['name', 'vendor_name', 'vendor_address'],
            limit: 1000
        });
    const { data: quotation_request_list, isLoading: quotation_request_list_loading, error: quotation_request_list_error } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['name', 'lead_time', 'item', 'category', 'vendor', 'procurement_task', 'quote', 'quantity'],
            filters: [["procurement_task", "=", orderId]],
            limit: 2000
        });
    const { data: quote_data } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['item', 'quote'],
            limit: 2000
        });
    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    const { updateDoc: updateDoc, loading: update_loading, isCompleted: update_submit_complete, error: update_submit_error } = useFrappeUpdateDoc()

    const [page, setPage] = useState<string>('updatequotation')
    const [orderData, setOrderData] = useState({
        project: '',
        work_package: '',
        procurement_list: {
            list: []
        },
        category_list: {
            list: []
        }
    })
    if (!orderData.project) {
        procurement_request_list?.map(item => {
            if (item.name === orderId) {
                setOrderData(item)
            }
        })
    }
    const [selectedVendors, setSelectedVendors] = useState({})
    const [selectedCategories, setSelectedCategories] = useState({})

    const [data, setData] = useState<DataType>([])
    // const [checkStrictly, setCheckStrictly] = useState(false);

    console.log("orderData", orderData)

    useEffect(() => {
        if (orderData.project) {
            const newData: DataType[] = [];
            orderData.category_list?.list.forEach((cat) => {
                const items: DataType[] = [];

                orderData.procurement_list?.list.forEach((item) => {
                    if (item.category === cat.name) {
                        const price = Number(getPrice(selectedVendors[item.name], item.name))
                        const quotesForItem = quote_data
                            ?.filter(value => value.item === item.name && value.quote)
                            ?.map(value => value.quote);
                        let minQuote;
                        if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
                        minQuote = (minQuote ? parseFloat(minQuote) * item.quantity : 0)

                        items.push({
                            item: item.item,
                            key: item.name,
                            unit: item.unit,
                            quantity: item.quantity,
                            comment : item.comment || "",
                            category: item.category,
                            rate: selectedVendors[item.name] ? price : "Delayed",
                            amount: selectedVendors[item.name] ? price * item.quantity : "Delayed",
                            selectedVendor: selectedVendors[item.name] ? getVendorName(selectedVendors[item.name]) : "Delayed",
                            lowest2: getLowest2(item.name) ? getLowest2(item.name) * item.quantity : "Delayed",
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
    }, [orderData, selectedVendors, vendor_list]);


    useEffect(() => {
        const updatedCategories = { ...selectedCategories };
        orderData?.category_list.list.map((cat) => {
            const newVendorsSet = new Set();
            const curCategory = cat.name
            quotation_request_list?.forEach((item) => {
                if (item.category === cat.name) {
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

    const getVendorName = (vendorName: string) => {
        return vendor_list?.find(vendor => vendor.name === vendorName)?.vendor_name;
    }
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
    console.log("orderData in select vendors", orderData)
    console.log("selected Vendors", selectedVendors)

    const handleSubmit = () => {
        const delayedItems = [];
        quotation_request_list?.map((item) => {
            if (selectedVendors[item.item] === item.vendor) {
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

        const itemlist = [];
        orderData.procurement_list?.list.map((value) => {
            if (!selectedVendors[value.name]) {
                itemlist.push({
                    name: value.name,
                    item: value.item,
                    quantity: value.quantity,
                    quote: 0,
                    unit: value.unit,
                    category: value.category,
                    tax: value.tax,
                    status: "Pending",
                    comment: value.comment || ""
                })

                delayedItems.push(value.name);
            }
        })

        const updatedProcurementList = procurement_request_list?.[0].procurement_list.list.map((item) => {
            if (delayedItems.some((i) => i === item.name)) {
                return { ...item, status: "Delayed" }
            }
            return item
        })

        const newCategories = [];
        itemlist.forEach((item) => {
            const isDuplicate = newCategories.some(category => category.name === item.category);
            if (!isDuplicate) {
                newCategories.push({ name: item.category })
            }
        })

        const newSendBack = {
            procurement_request: orderId,
            project: orderData.project,
            category_list: {
                list: newCategories
            },
            item_list: {
                list: itemlist
            },
            type: "Delayed"
        }

        if (itemlist.length > 0) {
            createDoc('Sent Back Category', newSendBack)
                .then(() => {
                    console.log(newSendBack);
                })
                .catch(() => {
                    console.log("submit_error", submit_error);
                })
        }
        if (itemlist.length === orderData.procurement_list?.list.length) {
            updateDoc('Procurement Requests', orderId, {
                workflow_state: "Delayed",
                procurement_list: { list: updatedProcurementList }
            })
                .then(() => {
                    console.log(orderId)
                    toast({
                        title: "Oops!",
                        description: `You just delayed all the items, you can see them in "New Sent Back" tab!`,
                        variant: "default"
                    })
                    navigate("/")
                }).catch(() => {
                    console.log(update_submit_error)
                })
        }
        else {
            updateDoc('Procurement Requests', orderId, {
                workflow_state: "Vendor Selected",
                procurement_list: { list: updatedProcurementList }
            })
                .then(() => {
                    console.log(orderId)
                    toast({
                        title: "Success!",
                        description: `Items Sent for Approval`,
                        variant: "success"
                    })
                    navigate("/")
                }).catch(() => {
                    console.log(update_submit_error)
                })
        }
    }

    const { toast } = useToast()

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
            const key = generateVendorItemKey(item.vendor, item.item);
            newPriceMap.set(key, item.quote);
        });
        setPriceMap(newPriceMap);
    }, [quotation_request_list]);

    const getLowest = (cat: string) => {
        let price: number = 0;
        let vendor: string = 'vendor';

        orderData.procurement_list?.list.map((item) => {
            if (item.category === cat) {
                const quotesForItem = quotation_request_list
                    ?.filter(value => value.item === item.name && value.quote)
                    ?.map(value => value.quote);
                let minQuote;
                if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
                price += (minQuote ? parseFloat(minQuote) : 0) * item.quantity;
            }
        })

        return { quote: price, vendor: vendor }
    }

    const getLowest2 = (item: string) => {
        const quotesForItem = quotation_request_list
            ?.filter(value => value.item === item && value.quote)
            ?.map(value => value.quote);
        let minQuote;
        if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
        return minQuote;
    }

    const getLowest3 = (cat: string) => {
        let total: number = 0;
        orderData.procurement_list?.list.map((item) => {
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

    const getLeadTime = (vendor: string, category: string) => {
        return quotation_request_list?.find(item => item.vendor === vendor && item.category === category)?.lead_time;
    }
    const getSelectedVendor = (cat: string) => {
        return selectedVendors[cat] ? getVendorName(selectedVendors[cat]) : ""
    }

    const getTotal = (cat: string) => {
        let total: number = 0;
        orderData?.procurement_list.list.map((item) => {
            if (item.category === cat) {
                const price = getPrice(selectedVendors[item.name], item.name);
                if (selectedVendors[item.name]) total += (price ? parseFloat(price) : 0) * item.quantity;
            }
        })
        return total
    }
    const getTotal2 = (vendor: string, cat: string) => {
        let total: number = 0;
        orderData?.procurement_list.list.map((item) => {
            if (item.category === cat) {
                const price = getPrice(vendor, item.name);
                total += (price ? parseFloat(price) : 0) * item.quantity;
            }
        })
        return total
    }

    const handleEditPrice = () => {
        updateDoc('Procurement Requests', orderId, {
            workflow_state: "RFQ Generated",
        })
            .then(() => {
                console.log("orderId", orderId)
                navigate(`/procure-request/quote-update/${orderId}`)
            }).catch(() => {
                console.log(submit_error)
            })
    }

    // const getPercentdiff = (a: number, b: number) => {
    //     if (a === 0 && b === 0) {
    //         return 0;
    //     }
    //     const difference: number = Math.abs(a - b);
    //     const percentDiff: number = (difference / a) * 100;

    //     return percentDiff.toFixed(2);
    // }

    return (
        <>
            {page == 'updatequotation' &&
                    <div className="flex-1 md:space-y-4 p-4">
                        <div className="flex items-center pt-1  pb-4">
                            <ArrowLeft onClick={() => navigate("/select-vendor-list")} />
                            <h2 className="text-base pl-2 font-bold tracking-tight"><span className="text-red-700">PR-{orderData?.name?.slice(-4)}</span>: Select Vendor/Item Quotes</h2>
                        </div>
                        <Card className="flex md:grid md:grid-cols-4 gap-4 border border-gray-100 rounded-lg p-4">
                            <div className="border-0 flex flex-col justify-center max-sm:hidden">
                                <p className="text-left py-1 font-light text-sm text-sm text-red-700">Date:</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{formatDate(orderData?.creation?.split(" ")[0])}</p>
                            </div>
                            <div className="border-0 flex flex-col justify-center">
                                <p className="text-left py-1 font-light text-sm text-sm text-red-700">Project</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.project}</p>
                            </div>
                            <div className="border-0 flex flex-col justify-center">
                                <p className="text-left py-1 font-light text-sm text-sm text-red-700">Package</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.work_package}</p>
                            </div>
                            <div className="border-0 flex flex-col justify-center max-sm:hidden">
                                <p className="text-left py-1 font-light text-sm text-sm text-red-700">Project Lead</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.owner}</p>
                            </div>
                            {/* <div className="border-0 flex flex-col justify-center max-sm:hidden">
                                <p className="text-left py-1 font-light text-sm text-sm text-red-700">PR Number</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.name?.slice(-4)}</p>
                            </div> */}
                        </Card>
                        <Card className="p-5 text-xs text-slate-500">
                            <h1 className='text-red-700 underline'>Instructions</h1>
                            <p>- Select a vendor's quote for each item.</p>
                            <p>- You can edit the prices entered before by clicking <span className='text-red-700'>Edit Prices</span> button on the bottom left.</p>
                            <p>- If quote of any vendor displays <span className='text-red-700'>Nan</span> or <span className='text-red-700'>NA</span>, it means the item price for that vendor is not updated.</p>
                            <p>- If you dont select any vendor's quote for a particular item/s, it will display <span className='text-red-700'>Delayed</span> in the next page.</p>
                        </Card>
                        {orderData?.category_list?.list.map((cat) => {
                            const curCategory = cat.name;
                            return <div>
                                <Card className="flex w-full shadow-none border border-grey-500" >
                                    <CardHeader className="w-full">
                                        <div className='flex justify-between py-5'>
                                            <CardTitle className="font-bold text-xl text-red-700">
                                                {cat.name}
                                            </CardTitle>
                                            <CardTitle className="font-bold text-xl">
                                                {getSelectedVendor(cat.name)}
                                            </CardTitle>
                                        </div>
                                        <table className="w-full">
                                            <thead className="w-full border-b border-black">
                                                <tr>
                                                    <th scope="col" className="bg-gray-200 p-2 font-semibold text-left">Items<div className='py-2 font-light text-sm text-slate-600'>Delivery Time:</div></th>
                                                    {selectedCategories[curCategory]?.map((item) => {
                                                        const isSelected = selectedVendors[curCategory] === item;
                                                        const dynamicClass = `flex-1 ${isSelected ? 'text-red-500' : ''}`
                                                        return <th className="bg-gray-200 font-semibold p-2 text-left "><span className={dynamicClass}>{getVendorName(item)?.length >= 12 ? getVendorName(item).slice(0, 12) + '...' : getVendorName(item)}</span>
                                                            <div className={`py-2 font-light text-sm text-opacity-50 ${dynamicClass}`}>{getLeadTime(item, cat.name)} Days</div>
                                                        </th>
                                                    })}
                                                    <th className="bg-gray-200 p-2 font-medium truncate text-left">Last 3 months <div className=''>Lowest Quote</div></th>
                                                </tr>
                                            </thead>
                                            <tbody className="bg-white divide-y divide-gray-200">
                                                {orderData?.procurement_list?.list.map((item) => {
                                                    const quotesForItem = quote_data
                                                        ?.filter(value => value.item === item.name && value.quote)
                                                        ?.map(value => value.quote);
                                                    let minQuote;
                                                    if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);

                                                    if (item.category === cat.name) {
                                                        return <tr>
                                                            <td className="py-2 text-sm px-2 font-slim w-[40%]">
                                                                <div className="inline items-baseline">
                                                                  <span>{item.item}</span>
                                                                  {item.comment && (
                                                                    <HoverCard>
                                                                    <HoverCardTrigger><MessageCircleMore className="text-blue-400 w-6 h-6 inline-block ml-1" /></HoverCardTrigger>
                                                                    <HoverCardContent className="max-w-[300px]">
                                                                    <div className="relative pb-4">
                                                                        <span className="block">{item.comment}</span>
                                                                        <span className="text-xs absolute right-0 italic text-gray-500">-Comment by PL</span>
                                                                    </div>
                    
                                                                    </HoverCardContent>
                                                                </HoverCard>
                                                                )}
                                                                </div>
                                                            </td>
                                                            {selectedCategories[curCategory]?.map((value) => {
                                                                const price = getPrice(value, item.name);
                                                                // total += (price ? parseFloat(price) : 0)*item.quantity;
                                                                const isSelected = selectedVendors[item.name] === value;
                                                                const dynamicClass = `flex-1 ${isSelected ? 'text-red-500' : ''}`
                                                                return <td className={`py-2 text-sm px-2 border-b text-left ${dynamicClass}`}>
                                                                    <input className="mr-2" disabled={(price === "-" || price === 0) ? true : false} type="radio" id={`${item.name}-${value}`} name={item.name} value={`${item.name}-${value}`} onChange={handleChangeWithParam(item.name, value)} />
                                                                    {price * item.quantity}
                                                                </td>
                                                            })}
                                                            <td className="py-2 text-sm px-2 border-b">
                                                                {minQuote ? minQuote * item.quantity : "N/A"}
                                                            </td>
                                                        </tr>
                                                    }
                                                })}
                                                <tr>
                                                    <td className="py-4 text-sm px-2 font-semibold">Total</td>
                                                    {selectedCategories[curCategory]?.map((value) => {
                                                        const isSelected = selectedVendors[curCategory] === value;
                                                        const dynamicClass = `flex-1 ${isSelected ? 'text-red-500' : ''}`
                                                        return <td className={`py-2 text-sm px-2 text-left font-bold ${dynamicClass}`}>
                                                            {getTotal2(value, curCategory)}
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
                        {/* <div className='p-10'></div> */}
                        <div className='flex justify-between pt-6'>
                            <Button className="bg-white text-red-500 border border-red-500 hover:text-white" onClick={() => handleEditPrice()}>
                                Edit Price
                            </Button>
                            {/* <div className="flex flex-col justify-end items-end"> */}

                            <Dialog>
                                <DialogTrigger asChild>
                                    <Button>
                                        Confirm
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="sm:max-w-[425px]">
                                    <DialogHeader>
                                        <DialogTitle>Have you selected quotes for all the items?</DialogTitle>
                                        <DialogDescription>
                                            Items whose quotes are not selected will have `Delayed` status attached to them.
                                            Click on 'Confirm' to continue
                                        </DialogDescription>
                                    </DialogHeader>
                                    <DialogClose>
                                        <Button variant="secondary" >Go Back</Button>
                                        <Button variant="secondary" className="ml-4" onClick={() => setPage('approvequotation')}>Confirm</Button>
                                    </DialogClose>
                                </DialogContent>
                            </Dialog>
                        </div>
                    </div>}
            {page == 'approvequotation' &&
                <>
                        <div className="flex-1 md:space-y-4 p-4">
                            <div className="flex items-center pt-1 pb-4">
                                <ArrowLeft className='cursor-pointer' onClick={() => setPage('updatequotation')} />
                                <h2 className="text-base pl-2 font-bold tracking-tight">Comparison</h2>
                            </div>
                            <Card className="flex md:grid md:grid-cols-4 gap-4 border border-gray-100 rounded-lg p-4">
                                <div className="border-0 flex flex-col justify-center max-sm:hidden">
                                    <p className="text-left py-1 font-light text-sm text-sm text-red-700">Date:</p>
                                    <p className="text-left font-bold py-1 font-bold text-base text-black">{formatDate(orderData?.creation?.split(" ")[0])}</p>
                                </div>
                                <div className="border-0 flex flex-col justify-center">
                                    <p className="text-left py-1 font-light text-sm text-sm text-red-700">Project</p>
                                    <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.project}</p>
                                </div>
                                <div className="border-0 flex flex-col justify-center">
                                    <p className="text-left py-1 font-light text-sm text-sm text-red-700">Package</p>
                                    <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.work_package}</p>
                                </div>
                                <div className="border-0 flex flex-col justify-center max-sm:hidden">
                                    <p className="text-left py-1 font-light text-sm text-sm text-red-700">Project Lead</p>
                                    <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.owner}</p>
                                </div>
                                {/* <div className="border-0 flex flex-col justify-center max-sm:hidden">
                                <p className="text-left py-1 font-light text-sm text-sm text-red-700">PR Number</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.name?.slice(-4)}</p>
                            </div> */}
                            </Card>
                            {/* {orderData?.category_list?.list.map((cat) => {
                            const curCategory = cat.name
                            let total: number = 0;
                            const lowest = getLowest(cat.name);
                            let count: number = 0;

                            return <div className="grid grid-cols-2 gap-4 w-full">

                                <div className="col-span-2 font-bold text-xl py-2">{cat.name}</div>
                                <Card className="flex w-full shadow-none border border-grey-500" >
                                    <CardHeader className="w-full">
                                        <CardTitle>
                                            <div className="flex justify-between border-b">
                                                <div className="font-bold text-lg py-2 border-gray-200">Total</div>
                                                <div className="font-bold text-2xl text-red-500 py-2 border-gray-200">{getTotal(curCategory)}</div>
                                            </div>
                                        </CardTitle>
                                        {orderData?.procurement_list.list.map((item) => {
                                            if (count === 2) { return }
                                            if (item.category === curCategory) {
                                                count++;
                                                const price = getPrice(selectedVendors[item.name], item.name);
                                                total += price ? parseFloat(price) : 0;
                                                return <div className="flex justify-between py-2">
                                                    <div className="text-sm">{item.item}</div>
                                                    <div className="text-sm">{selectedVendors[item.name] ? price * item.quantity : "Delayed"}</div>
                                                </div>
                                            }
                                        })}
                                        <div className="flex justify-between py-2">
                                            <Dialog>
                                                <DialogTrigger asChild>
                                                    <div className="text-sm text-blue-500 cursor-pointer">View All</div>
                                                </DialogTrigger>
                                                <DialogContent className="md:min-w-[825px]">
                                                    <DialogHeader>
                                                        <DialogTitle>Items List</DialogTitle>
                                                        <DialogDescription>
                                                            <div className="grid grid-cols-12 font-medium text-black justify-between">
                                                                <div className="text-sm col-span-2 border p-2">Items</div>
                                                                <div className="text-sm border p-2">Unit</div>
                                                                <div className="text-sm border p-2">Qty</div>
                                                                <div className="text-sm border p-2">Rate</div>
                                                                <div className="text-sm border p-2">Amount</div>
                                                                <div className="text-sm col-span-2 border p-2">Selected Vendor</div>
                                                                <div className="text-sm col-span-2 border p-2">Lowest Quoted Vendor</div>
                                                                <div className="text-sm col-span-2 border p-2">3 months Lowest Amount</div>
                                                            </div>
                                                            {orderData?.procurement_list?.list.map((item) => {
                                                                if (item.category === curCategory) {
                                                                    const price = getPrice(selectedVendors[item.name], item.name);
                                                                    total += price ? parseFloat(price) : 0;

                                                                    const lowest2 = getLowest2(item.name)

                                                                    const quotesForItem = quote_data
                                                                        ?.filter(value => value.item === item.name && value.quote)
                                                                        ?.map(value => value.quote);
                                                                    let minQuote;
                                                                    if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);

                                                                    return <div className="grid grid-cols-12">
                                                                        <div className="text-sm col-span-2 border p-2">{item.item}</div>
                                                                        <div className="text-sm border p-2">{item.unit}</div>
                                                                        <div className="text-sm border p-2">{item.quantity}</div>
                                                                        <div className="text-sm border p-2">{selectedVendors[item.name] ? price : "Delayed"}</div>
                                                                        <div className="text-sm border p-2">{selectedVendors[item.name] ? price * item.quantity : "Delayed"}</div>
                                                                        <div className="text-sm col-span-2 border p-2">{selectedVendors[item.name] ? getVendorName(selectedVendors[item.name]) : "Delayed"}</div>
                                                                        <div className="text-sm col-span-2 border p-2">{lowest2 ? lowest2 * item.quantity : "N/A"}</div>
                                                                        <div className="text-sm col-span-2 border p-2">{minQuote ? minQuote * item.quantity : "N/A"}</div>
                                                                    </div>
                                                                }
                                                            })}
                                                        </DialogDescription>
                                                    </DialogHeader>
                                                </DialogContent>
                                            </Dialog>
                                        </div>
                                    </CardHeader>
                                </Card>

                                <div>
                                    <div className="h-[50%] p-5 rounded-lg border border-grey-500">
                                        <div className="flex justify-between">
                                            <div className="text-sm font-medium text-gray-400">Lowest Quoted Vendor</div>
                                            <div className="font-bold text-2xl text-gray-500 border-gray-200 py-0">{lowest.quote}
                                                <div className='flex'>
                                                    {
                                                        (lowest?.quote < getTotal(curCategory)) ?
                                                            <TrendingDown className="text-red-500" /> : <CheckCheck className="text-blue-500" />
                                                    }
                                                    <span className={`pl-2 text-base font-medium ${(lowest?.quote < getTotal(curCategory)) ? "text-red-500" : "text-blue-500"}`}>{getPercentdiff(lowest?.quote, getTotal(curCategory))}%</span>
                                                </div>

                                            </div>
                                        </div>
                                        <div className="flex justify-between font-medium text-gray-700 text-sm">
                                            {getVendorName(lowest.vendor)}
                                            <div className="text-end text-sm text-gray-400">Delivery Time: {getLeadTime(selectedVendors[curCategory], curCategory)} Days</div>
                                        </div>

                                    </div>
                                    <div className="mt-2 h-[45%] p-5 rounded-lg border border-grey-500">
                                        <div className="flex justify-between">
                                            <div className="text-sm font-medium text-gray-400">Last 3 months Metric</div>
                                            <div className="font-bold text-2xl text-gray-500 border-gray-200">{getLowest3(curCategory)}
                                                <div className='flex'>
                                                    {
                                                        (getLowest3(curCategory) > getTotal(curCategory)) ?
                                                            <TrendingUp className="text-green-500" /> : ((getLowest3(curCategory) < getTotal(curCategory)) ? <TrendingDown className="text-red-500" /> : <CheckCheck className="text-blue-500" />)
                                                    }
                                                    <span className={`pl-2 text-base font-medium ${(getLowest3(curCategory) < getTotal(curCategory)) ? "text-red-500" : ((getLowest3(curCategory) > getTotal(curCategory)) ? "text-green-500" : "text-blue-500")}`}>{getPercentdiff(getTotal(curCategory), getLowest3(curCategory))}%</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="font-medium text-gray-700 text-sm">
                                            Last 3 months Lowest Amount
                                        </div>
                                    </div>
                                </div>
                            </div>
                        })} */}
                            {/* <div className='p-10'></div> */}
                            {/* <div className="flex flex-col justify-end items-end">
                            <Dialog>
                                <DialogTrigger asChild>
                                    <Button>
                                        Send for Approval
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="sm:max-w-[425px]">
                                    <DialogHeader>
                                        <DialogTitle>Have you cross-checked your selections?</DialogTitle>
                                        <DialogDescription>
                                            Remainder: Items whose quotes are not selected will have a delayed status attached to them. If confirmed, Delayed sent back request will be created for those Items.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <DialogClose>
                                        <Button variant="secondary">Go Back</Button>
                                        <Button variant="secondary" onClick={() => handleSubmit()}>Confirm</Button>
                                    </DialogClose>
                                </DialogContent>
                            </Dialog>
                        </div> */}
                        </div>
                    <div className='pl-7'>
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
                                expandable={{ defaultExpandAllRows: true }}
                                columns={columns}
                            />

                        </ConfigProvider>
                    </div>
                    <div className="flex flex-col justify-end items-end mr-2">
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button>
                                    Send for Approval
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[425px]">
                                <DialogHeader>
                                    <DialogTitle>Have you cross-checked your selections?</DialogTitle>
                                    <DialogDescription>
                                        Remainder: Items whose quotes are not selected will have a delayed status attached to them. If confirmed, Delayed sent back request will be created for those Items.
                                    </DialogDescription>
                                </DialogHeader>
                                <DialogClose>
                                    <Button variant="secondary">Go Back</Button>
                                    <Button variant="secondary" className="ml-4" onClick={() => handleSubmit()}>Confirm</Button>
                                </DialogClose>
                            </DialogContent>
                        </Dialog>
                    </div>
                </>}
        </>
    )
}