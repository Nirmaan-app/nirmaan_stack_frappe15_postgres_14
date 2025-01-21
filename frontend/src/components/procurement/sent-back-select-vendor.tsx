import { ArrowBigUpDash, ArrowLeft, CheckCheck, Info, MessageCircleMore, Pencil, Undo2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useFrappeCreateDoc, useFrappeGetDocList, useFrappeUpdateDoc, useSWRConfig } from "frappe-react-sdk";
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
import { TailSpin } from 'react-loader-spinner';
import { Textarea } from '../ui/textarea';
import { useUserData } from '@/hooks/useUserData';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../ui/hover-card';

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
    makes: any[];
}

const columns: TableColumnsType<DataType> = [
    {
        title: 'Items',
        dataIndex: 'item',
        key: 'item',
        render: (text, record) => {
            return (
                <>
                    <div className="inline items-baseline">
                        <span style={{ fontWeight: record.unit === null ? 'bold' : 'normal', fontStyle: record.unit !== null ? 'italic' : "normal" }}>
                            {text}
                        </span>
                        {(!record.children && record.comment) && (
                            <HoverCard>
                                <HoverCardTrigger><MessageCircleMore className="text-blue-400 w-6 h-6 inline-block ml-1" /></HoverCardTrigger>
                                <HoverCardContent className="max-w-[300px] bg-gray-800 text-white p-2 rounded-md shadow-lg">
                                    <div className="relative pb-4">
                                        <span className="block">{record.comment}</span>
                                        <span className="text-xs absolute right-0 italic text-gray-200">-Comment by PL</span>
                                    </div>

                                </HoverCardContent>
                            </HoverCard>
                        )}
                    </div>
                    {(record?.makes?.filter(m => m?.enabled === "true")?.length > 0) && (
                        <div className="text-xs text-gray-500 lg:ml-10">
                            <span className='text-primary'>makes</span> - {record?.makes?.filter(m => m?.enabled === "true")?.map((i, index, arr) => (
                                <i className='font-semibold'>{i?.make}{index < arr.length - 1 && ", "}</i>
                            ))}
                        </div>
                    )}
                </>
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
        title: 'Qty',
        dataIndex: 'quantity',
        width: '5%',
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
        width: '12%',
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
                    {text === "N/A" ? text : formatToIndianRupee(text)}
                </span>
            )
        }
    },
    {
        title: 'Lowest Quoted Amount',
        dataIndex: 'lowest2',
        width: '8%',
        key: 'lowest2',
        render: (text, record) => (
            <span style={{ fontWeight: record.unit === null ? 'bold' : 'normal' }}>
                {text === "N/A" ? text : formatToIndianRupee(text)}
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
                {text === "N/A" ? text : formatToIndianRupee(text)}
            </span>
        ),
    },
];


export const SentBackSelectVendor = () => {
    const { sbId: id } = useParams<{ sbId: string }>()
    const navigate = useNavigate()

    const userData = useUserData()

    const {mutate} = useSWRConfig()

    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error } = useFrappeGetDocList("Vendors",
        {
            fields: ['name', 'vendor_name', 'vendor_address', 'vendor_type'],
            filters: [["vendor_type", "=", "Material"]],
            limit: 1000
        });
    const { data: quotation_request_list, isLoading: quotation_request_list_loading, error: quotation_request_list_error } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['name', 'lead_time', 'item', 'vendor', 'category', 'procurement_task', 'quote', 'makes'],
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
            fields: ['*'],
            limit: 2000
        });
    const { updateDoc: updateDoc, loading: update_loading, error: submit_error } = useFrappeUpdateDoc()
    const { createDoc: createDoc, loading: create_loading } = useFrappeCreateDoc()

    const [page, setPage] = useState<string>('updatequotation')
    const [orderData, setOrderData] = useState({
        project: ''
    })

    const [comment, setComment] = useState('')

    const { data: filtered_quotation_data } = useFrappeGetDocList("Quotation Requests", {
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
                    if (i.rate === "Delayed" || !selectedVendors[i.key]) {
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

    useEffect(() => {
        delayedItemsCheck()
    }, [selectedVendors, data])

    const getItemQuoteMakes = (item: string, category: string, vendor: string) => {
        return filtered_quotation_data?.find(i => i.vendor === vendor && i.category === category && i.item === item)?.makes?.list || [];
    }

    // console.log("data", data)
    // console.log("delayedItems", delayedItems)

    // console.log("orderData", orderData)
    useEffect(() => {
        if (orderData.project) {
            const newData: DataType[] = [];
            orderData.category_list?.list.forEach((cat) => {
                const items: DataType[] = [];
                // const threeMonthsAgo = new Date();
                // threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

                orderData.item_list?.list.forEach((item) => {
                    if (item.category === cat.name) {
                        const price = getPrice(selectedVendors[item.name], item.name)
                        // const quotesForItem = quote_data?.filter((value) => {
                        //       const modifiedDate = new Date(value.modified);
                        //       return modifiedDate >= threeMonthsAgo;
                        //     })
                        const quotesForItem = quote_data
                            ?.filter(value => value.item_id === item.name && ![null, "0", 0, undefined].includes(value.quote))
                            ?.map(value => value.quote);
                        let minQuote;
                        if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
                        minQuote = parseFloat(minQuote || 0) * item.quantity

                        items.push({
                            item: item.item,
                            key: item.name,
                            unit: item.unit,
                            tax: Number(item.tax),
                            status: "Pending",
                            quantity: item.quantity,
                            category: item.category,
                            comment: item.comment,
                            makes: getItemQuoteMakes(item?.name, item?.category, selectedVendors[item.name]),
                            rate: price !== "-" ? Number(price) : "Delayed",
                            amount: price !== "-" ? Number(price * item.quantity) : "Delayed",
                            selectedVendor: getVendorName(selectedVendors[item.name]),
                            lowest2: (getLowest2(item.name) * item.quantity) || "N/A",
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
                        lowest2: getLowest(cat.name).quote || "N/A",
                        lowest3: getLowest3(cat.name) || "N/A",
                        children: items,
                    };
                    newData.push(node);
                }
            });
            // console.log("newData", newData)
            setData(newData)
        }
    }, [orderData, selectedVendors]);

    // console.log("data", data)

    const rowSelection: TableRowSelection<DataType> = {
        onChange: (selectedRowKeys, selectedRows) => {
            // console.log("onChange")
            // console.log(`selectedRowKeys: ${selectedRowKeys}`, 'selectedRows: ', selectedRows);
        },
        onSelect: (record, selected, selectedRows) => {
            // console.log(record, selected, selectedRows);
        },
        onSelectAll: (selected, selectedRows, changeRows) => {
            // console.log(selected, selectedRows, changeRows);
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

    // const handleSubmit = () => {
    //     quotation_request_list?.map((item) => {
    //         if (selectedVendors[item.item] === item.vendor && orderData?.procurement_request === item.procurement_task) {
    //             updateDoc('Quotation Requests', item.name, {
    //                 status: "Selected",
    //             })
    //                 .then(() => {
    //                     console.log("item", item.name)
    //                 }).catch(() => {
    //                     console.log(update_submit_error)
    //                 })
    //         }
    //     })
    //     updateDoc('Sent Back Category', id, {
    //         workflow_state: "Vendor Selected",
    //         item_list: orderData.item_list,
    //     })
    //         .then(() => {
    //             if (comment) {
    //                 createDoc("Nirmaan Comments", {
    //                     comment_type: "Comment",
    //                     reference_doctype: "Sent Back Category",
    //                     reference_name: id,
    //                     comment_by: userData?.user_id,
    //                     content: comment,
    //                     subject: "sr vendors selected"
    //                 })
    //             }
    //         }).then(() => {

    //             toast({
    //                 title: "Success!",
    //                 description: `Sent Back: ${id} sent for Approval!`,
    //                 variant: "success"
    //             })

    //             if(orderData?.type === "Rejected") {
    //                 navigate("/rejected-sb")
    //             } else if(orderData?.type === "Delayed") {
    //                 navigate("/delayed-sb")
    //             } else {
    //                 navigate("/cancelled-sb")
    //             }
    //         })
    //         .catch((error) => {
    //             toast({
    //                 title: "Failed!",
    //                 description: `Failed to send Sent Back: ${id} for Approval.`,
    //                 variant: "destructive"
    //             })
    //             console.log("submit_error", submit_error, error)
    //         })
    // }

    const handleSubmit = async () => {
        try {
            for (const item of quotation_request_list || []) {
                if (
                    selectedVendors[item.item] === item.vendor &&
                    orderData?.procurement_request === item.procurement_task
                ) {
                    try {
                        await updateDoc('Quotation Requests', item.name, {
                            status: "Selected",
                        });
                        console.log("item", item.name);
                    } catch (error) {
                        console.log("update_submit_error", error);
                    }
                }
            }
    
            await updateDoc('Sent Back Category', id, {
                workflow_state: "Vendor Selected",
                item_list: orderData.item_list,
            });
    
            if (comment) {
                await createDoc("Nirmaan Comments", {
                    comment_type: "Comment",
                    reference_doctype: "Sent Back Category",
                    reference_name: id,
                    comment_by: userData?.user_id,
                    content: comment,
                    subject: "sr vendors selected",
                });
            }
    
            toast({
                title: "Success!",
                description: `Sent Back: ${id} sent for Approval!`,
                variant: "success",
            });

            await mutate(`${orderData?.type} Sent Back Category`)

            // navigate(`/${orderData?.type?.toLowerCase()}-sb`)
            navigate(`/sent-back-requests?type=${orderData?.type}+SB`)
        } catch (error) {
            toast({
                title: "Failed!",
                description: `Failed to send Sent Back: ${id} for Approval.`,
                variant: "destructive",
            });
            console.log("submit_error", error);
        }
    };
    

    const handleUpdateOrderData = () => {
        setPage('approvequotation')
        setOrderData(prevState => {
            const updatedItemList = prevState.item_list.list.map((item) => {
                const newPrice = quotation_request_list.find(value =>
                    value.item === item.name && value.vendor === selectedVendors[item.name] && value.procurement_task === prevState.procurement_request
                )?.quote
                // console.log(newPrice)
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

    // console.log('quotationrequestlist', quotation_request_list)

    const getLeadTime = (vendor: string, category: string) => {
        const item = filtered_quotation_data?.find(item => item.vendor === vendor && item.category === category)
        return item?.lead_time;
    }
    // const getSelectedVendor = (item: string) => {
    //     return selectedVendors[item] ? getVendorName(selectedVendors[item]) : ""
    // }

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
        const quotesForItem = filtered_quotation_data
            ?.filter(value => value.item === item && ![null, "0", 0, undefined].includes(value.quote))
            ?.map(value => value.quote);
        let minQuote;
        if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
        return minQuote;
    }

    const getLowest = (cat: string) => {
        let price: number = 0;

        orderData.item_list?.list.map((item) => {
            if (item.category === cat) {
                const quotesForItem = filtered_quotation_data
                    ?.filter(value => value.item === item.name && value.quote)
                    ?.map(value => value.quote);
                let minQuote;
                if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
                price += parseFloat(minQuote || 0) * item.quantity;
            }
        })

        return { quote: price }
    }

    const getLowest3 = (cat: string) => {
        let total: number = 0;
        // const threeMonthsAgo = new Date();
        // threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        orderData.item_list?.list.map((item) => {
            if (item.category === cat) {
                // const quotesForItem = quote_data?.filter((value) => {
                //     const modifiedDate = new Date(value.modified);
                //     return modifiedDate >= threeMonthsAgo;
                //   })
                const quotesForItem = quote_data
                    ?.filter(value => value.item_id === item.name && value.quote)
                    ?.map(value => value.quote);
                let minQuote;
                if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
                total += parseFloat(minQuote || 0) * item.quantity;
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

    return (
        <>
            {page == 'updatequotation' &&
                <div className="flex-1 space-y-4">
                    {/* <div className="flex items-center">
                        <ArrowLeft onClick={() => navigate(-1)} />
                        <h2 className="text-base pl-2 font-bold tracking-tight">Choose Vendor Quotes</h2>
                    </div> */}
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
                                        {/* <CardTitle className="font-bold text-xl">
                                            {getSelectedVendor(curCategory)}
                                        </CardTitle> */}
                                    </div>
                                    <table className="w-full min-w-[600px]">
                                        <thead className="w-full border-b border-black bg-gray-200">
                                            <tr className='w-full'>
                                                <th className="p-2 font-semibold text-left w-[30%]">Items<p className='py-2 font-light text-sm text-slate-600'>Delivery Time:</p></th>
                                                <th className='w-[50%] '>
                                                    <div className='flex p-2'>
                                                        {selectedCategories[curCategory]?.map((ven) => {
                                                            return <div key={ven} className="font-semibold flex-1 flex flex-col items-start"><p>{getVendorName(ven)}</p>
                                                                <p className={`py-2 font-light text-sm text-opacity-50`}>{getLeadTime(ven, cat.name) || "--"} Days</p>
                                                            </div>
                                                        })}
                                                    </div>
                                                </th>
                                                <th className="p-2 font-medium truncate text-left">Last 3 months <div className=''>Lowest Quote</div></th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                            {orderData?.item_list?.list.map((item) => {
                                                // const threeMonthsAgo = new Date();
                                                // threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
                                                // const quotesForItem = quote_data?.filter((value) => {
                                                //       const modifiedDate = new Date(value.modified);
                                                //       return modifiedDate >= threeMonthsAgo;
                                                //     })
                                                const quotesForItem = quote_data
                                                    ?.filter(value => value.item_id === item.name && ![null, "0", 0, undefined].includes(value.quote))
                                                    ?.map(value => value.quote);
                                                let minQuote;
                                                if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);

                                                if (item.category === curCategory) {
                                                    return <tr>
                                                        <td className="py-2 text-sm px-2 font-semibold w-[30%]">
                                                            {item.item}
                                                        </td>
                                                        <td className='w-[50%]'>
                                                            <div className='flex p-2'>
                                                                {selectedCategories[curCategory]?.map((ven) => {
                                                                    const price = getPrice(ven, item.name);
                                                                    // total += (price ? parseFloat(price) : 0)*item.quantity;
                                                                    const isSelected = selectedVendors[item.name] === ven;
                                                                    const dynamicClass = `flex-1 ${isSelected ? 'text-red-500' : ''}`
                                                                    return <div className={`text-sm flex gap-1 items-center  ${dynamicClass}`}>
                                                                        <input disabled={price === "-" || price === 0} type="radio" id={`${item.name}-${ven}`} name={item.name} value={`${item.name}-${ven}`} onChange={handleChangeWithParam(item.name, ven)} />
                                                                        {Number.isNaN((price * item.quantity)) ? "N/A" : formatToIndianRupee(price * item.quantity)}
                                                                        {(price !== "-" && price !== 0) && (
                                                                            <HoverCard>
                                                                                <HoverCardTrigger><Info className="w-4 h-4 text-blue-500" /></HoverCardTrigger>
                                                                                <HoverCardContent>
                                                                                    {getItemQuoteMakes(item?.name, curCategory, ven)?.filter(k => k?.enabled === "true")?.length > 0 ?
                                                                                        (
                                                                                            <div>
                                                                                                <h2 className='font-bold text-primary mb-2'>Selected Makes:</h2>
                                                                                                <ul className='list-disc pl-4'>
                                                                                                    {
                                                                                                        getItemQuoteMakes(item?.name, curCategory, ven)?.map(m => {
                                                                                                            if (m?.enabled === "true") {
                                                                                                                return <li key={m?.make}><strong>{m?.make}</strong></li>
                                                                                                            }
                                                                                                        })
                                                                                                    }
                                                                                                </ul>
                                                                                            </div>
                                                                                        ) : <strong>No selected makes found for this item!</strong>}
                                                                                </HoverCardContent>
                                                                            </HoverCard>
                                                                        )}
                                                                    </div>
                                                                })}
                                                            </div>
                                                        </td>
                                                        <td className="py-2 text-sm px-2">
                                                            {minQuote ? formatToIndianRupee(minQuote * item.quantity) : "N/A"}
                                                        </td>
                                                    </tr>
                                                }
                                            })}
                                            <tr>
                                                <td className="py-4 text-sm px-2 font-semibold w-[30%]">Total</td>
                                                <td className='w-[50%]'>
                                                    <div className='flex '>
                                                        {selectedCategories[curCategory]?.map((value) => {
                                                            return <div className={`py-2 flex-1 text-sm max-sm:pl-2 pl-8 font-bold`}>
                                                                {Number.isNaN(getTotal2(value, curCategory)) ? "--" : formatToIndianRupee(getTotal2(value, curCategory))}
                                                            </div>
                                                        })}
                                                    </div>
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </CardHeader>
                            </Card>
                        </div>
                    })}
                    {/* <div className="pt-10"></div> */}
                    <div className='pt-6 flex justify-between'>
                        <Button variant={"outline"} className="text-red-500 border-red-500 flex items-center gap-1" onClick={() => {
                            // navigate(`/${orderData?.type?.toLowerCase()}-sb/${orderData?.name}/update-quote`)
                            navigate(`/sent-back-requests/${orderData?.name}/update-quote`)
                        }}>
                            <Pencil className='w-4 h-4' />
                            Edit Price
                        </Button>
                        {/* </div>
                        <div className="flex flex-col justify-end items-end fixed bottom-4 right-4"> */}

                        <Dialog>
                            <DialogTrigger asChild>
                                <Button className='flex items-center gap-1'>
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
                    <div className="flex-1 space-y-4">
                        <div className="flex items-center">
                            <ArrowLeft className='cursor-pointer' onClick={() => setPage('updatequotation')} />
                            <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">Comparison</h2>
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
                    <div className="flex flex-col justify-end items-end mr-2 my-4">
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
                                        <span>You can click on confirm to send it for approval</span>
                                        <div className='flex flex-col gap-2 mt-2 text-start'>
                                            <h4 className='font-bold'>Any remarks for the Project Lead?</h4>
                                            <Textarea placeholder='type here...' value={comment} onChange={(e) => setComment(e.target.value)} />
                                        </div>
                                    </DialogDescription>
                                </DialogHeader>
                                <DialogDescription className='flex items-center justify-center gap-2'>
                                    {(update_loading || create_loading) ? (<TailSpin width={80} color='red' />) : (
                                        <>
                                            <Button variant={"secondary"} onClick={() => setPage("updatequotation")} className="flex items-center gap-1">
                                                <Undo2 className="h-4 w-4" />
                                                Go Back
                                            </Button>
                                            <Button onClick={() => handleSubmit()} className="flex items-center gap-1">
                                                <CheckCheck className="h-4 w-4" />
                                                Confirm
                                            </Button>
                                        </>
                                    )}
                                </DialogDescription>
                            </DialogContent>
                        </Dialog>
                    </div>
                </>
            }
        </>
    )
}