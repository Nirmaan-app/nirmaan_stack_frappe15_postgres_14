import { ArrowBigUpDash, ArrowLeft, BookOpenText, CheckCheck, Info, ListChecks, MessageCircleMore, Pencil, SendToBack, Undo2 } from 'lucide-react';
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
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../ui/hover-card';
import formatToIndianRupee from '@/utils/FormatPrice';
import TextArea from 'antd/es/input/TextArea';
import { useUserData } from '@/hooks/useUserData';
import { ProcurementHeaderCard } from '../ui/ProcurementHeaderCard';
import { TailSpin } from 'react-loader-spinner';
import { QuestionMarkIcon } from '@radix-ui/react-icons';

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
                    {(record?.makes?.filter(m => m?.enabled === "true")?.length > 0 && record?.rate !== "Delayed") && (
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
                <span>{text === "Delayed" ? "Delayed" : formatToIndianRupee(text)}</span>
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
        render: (text, record) => (
            <span style={{ fontWeight: record.unit === null ? 'bold' : 'normal' }}>
                {Number.isNaN(text) ? "Delayed" : text === "Delayed" ? "Delayed" : formatToIndianRupee(text)}
            </span>
        ),
    },
    {
        title: 'Lowest Quoted Amount',
        dataIndex: 'lowest2',
        width: '8%',
        key: 'lowest2',
        render: (text, record) => (
            <span style={{ fontWeight: record.unit === null ? 'bold' : 'normal' }}>
                {(text === "Delayed" || text === "N/A") ? text : formatToIndianRupee(text)}
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
                {(text === "N/A" || text === "Delayed") ? text : formatToIndianRupee(text)}
            </span>
        ),
    },
];

export const SelectVendors = () => {

    const { prId: orderId } = useParams<{ prId: string }>()
    const navigate = useNavigate()

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

    const [selectedVendors, setSelectedVendors] = useState({})
    const [selectedCategories, setSelectedCategories] = useState({})
    const userData = useUserData()

    const [data, setData] = useState<DataType>([])
    const [comment, setComment] = useState({
        approving: "",
        delaying: ""
    });
    const [delayedItems, setDelayedItems] = useState({})

    const [priceMap, setPriceMap] = useState(new Map<string, string>());

    const [submitClicked, setSubmitClicked] = useState(false)

    const { data: procurement_request_list, isLoading: procurement_request_list_loading } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'category_list', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'creation', 'procurement_executive'],
            filters: [['name', '=', orderId]],
            limit: 1000
        });
    const { data: vendor_list, isLoading: vendor_list_loading } = useFrappeGetDocList("Vendors",
        {
            fields: ['name', 'vendor_name', 'vendor_address', 'vendor_type'],
            filters: [["vendor_type", "=", "Material"]],
            limit: 1000
        });
    const { data: quotation_request_list, isLoading: quotation_request_list_loading } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['name', 'lead_time', 'item', 'category', 'vendor', 'procurement_task', 'quote', 'quantity', 'makes'],
            filters: [["procurement_task", "=", orderId]],
            limit: 2000
        });
    const { data: quote_data } = useFrappeGetDocList("Approved Quotations",
        {
            fields: ["*"],
            limit: 2000
        });
    const { createDoc: createDoc, loading: create_loading, error: submit_error } = useFrappeCreateDoc()
    const { updateDoc: updateDoc, loading: update_loading } = useFrappeUpdateDoc()


    if (!orderData.project) {
        procurement_request_list?.map(item => {
            if (item.name === orderId) {
                setOrderData(item)
            }
        })
    }


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

    // console.log("delayedItems", delayedItems)
    // const [checkStrictly, setCheckStrictly] = useState(false);

    // console.log("orderData", orderData)

    useEffect(() => {
        if (orderData.project) {
            const newData: DataType[] = [];
            orderData.category_list?.list.forEach((cat) => {
                const items: DataType[] = [];

                orderData.procurement_list?.list.forEach((item) => {
                    // const threeMonthsAgo = new Date();
                    // threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
                    if (item.category === cat.name) {
                        const price = Number(getPrice(selectedVendors[item.name], item.name))
                        // const quotesForItem = quote_data?.filter((value) => {
                        //     const modifiedDate = new Date(value.modified);
                        //     return modifiedDate >= threeMonthsAgo;
                        //   })
                        const quotesForItem = quote_data
                            ?.filter(value => value.item_id === item.name && ![null, "0", 0, undefined].includes(value.quote))
                            ?.map(value => value.quote);
                        let minQuote;
                        if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
                        minQuote = minQuote ? parseFloat(minQuote) * item.quantity : 0

                        items.push({
                            item: item.item,
                            key: item.name,
                            unit: item.unit,
                            quantity: item.quantity,
                            comment: item.comment || "",
                            makes: getItemQuoteMakes(item.name, item.category, selectedVendors[item.name]),
                            category: item.category,
                            rate: selectedVendors[item.name] ? price : "Delayed",
                            amount: selectedVendors[item.name] ? price * item.quantity : "Delayed",
                            selectedVendor: selectedVendors[item.name] ? getVendorName(selectedVendors[item.name]) : "Delayed",
                            lowest2: selectedVendors[item.name] ? (getLowest2(item.name) ? getLowest2(item.name) * item.quantity : "N/A") : "Delayed",
                            lowest3: selectedVendors[item.name] ? (minQuote ? minQuote : "N/A") : "Delayed",
                        });
                    }
                });

                if (items.length) {
                    const node: DataType = {
                        item: cat.name,
                        key: cat.name,
                        unit: null,
                        quantity: null,
                        amount: getTotal(cat.name) || "Delayed",
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

    const handleSubmit = async () => {
        try {
            const delayedItems: string[] = [];

            const itemlist: any[] = [];
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
                        comment: value.comment || "",
                    });
                    delayedItems.push(value.name);
                }
            });

            // Update the procurement list to mark delayed items
            const updatedProcurementList = orderData.procurement_list.list.map((item) => {
                if (delayedItems.some((i) => i === item.name)) {
                    return { ...item, status: "Delayed" };
                }
                return item;
            });

            const newCategories: { name: string, makes: string[] }[] = [];
            itemlist.forEach((item) => {
                const isDuplicate = newCategories.some((category) => category.name === item.category);
                if (!isDuplicate) {
                    const makes = orderData?.category_list?.list?.find((category) => category.name === item.category)?.makes;
                    newCategories.push({ name: item.category, makes: makes || [] });
                }
            });

            const newSendBack = {
                procurement_request: orderId,
                project: orderData.project,
                category_list: {
                    list: newCategories,
                },
                item_list: {
                    list: itemlist,
                },
                type: "Delayed",
            };

            // Update quotation request status to "Selected" if condition matches
            if (quotation_request_list) {
                await Promise.all(
                    quotation_request_list.map(async (item) => {
                        if (selectedVendors[item.item] === item.vendor) {
                            try {
                                await updateDoc("Quotation Requests", item.name, {
                                    status: "Selected",
                                });
                                console.log("item", item.name);
                            } catch (error) {
                                console.log("update_submit_error", error);
                            }
                        }
                    })
                );
            }

            // Create new document if there are any items in the itemlist
            if (itemlist.length > 0) {
                try {
                    const res = await createDoc("Sent Back Category", newSendBack);
                    if (comment?.delaying) {
                        await createDoc("Nirmaan Comments", {
                            comment_type: "Comment",
                            reference_doctype: "Sent Back Category",
                            reference_name: res.name,
                            comment_by: userData?.user_id,
                            content: comment?.delaying,
                            subject: "creating sent-back(delayed)"
                        })
                    }
                } catch (error) {
                    console.log("submit_error", error);
                }
            }

            // Update Procurement Request based on item conditions
            if (itemlist.length === orderData.procurement_list?.list.length) {
                try {
                    await updateDoc("Procurement Requests", orderId, {
                        workflow_state: "Delayed",
                        procurement_list: { list: updatedProcurementList },
                    });
                    console.log(orderId);
                    toast({
                        title: "Oops!",
                        description: `You just delayed all the items, you can see them in "New Sent Back" tab!`,
                        variant: "default",
                    });
                    navigate(`/procurement-requests?tab=New PR Request`);
                } catch (error) {
                    console.log("update_submit_error", error);
                }
            } else {
                try {
                    await updateDoc("Procurement Requests", orderId, {
                        workflow_state: "Vendor Selected",
                        procurement_list: { list: updatedProcurementList },
                    });

                    if (comment?.approving) {
                        await createDoc("Nirmaan Comments", {
                            comment_type: "Comment",
                            reference_doctype: "Procurement Requests",
                            reference_name: orderId,
                            comment_by: userData?.user_id,
                            content: comment?.approving,
                            subject: "pr vendors selected"
                        })
                    }

                    // console.log(orderId);
                    toast({
                        title: "Success!",
                        description: `Items Sent for Approval`,
                        variant: "success",
                    });
                    navigate(`/procurement-requests?tab=New PR Request`);
                } catch (error) {
                    console.log("update_submit_error", error);
                }
            }
        } catch (error) {
            console.log("handleSubmit error", error);
        }
        finally {
            setSubmitClicked(false)
        }
    };

    // console.log('data', data)
    const { toast } = useToast()

    const generateVendorItemKey = (vendor: string, item: string): string => {
        return `${vendor}-${item}`;
    };

    const getPrice = (vendor: string, item: string): string | undefined => {
        const key = generateVendorItemKey(vendor, item);
        return priceMap.get(key) || "-";
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

        orderData.procurement_list?.list.map((item) => {
            if (item.category === cat) {
                const quotesForItem = quotation_request_list
                    ?.filter(value => value.item === item.name && ![null, "0", 0, undefined].includes(value.quote))
                    ?.map(value => value.quote);
                let minQuote;
                if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
                price += parseFloat(minQuote || 0) * item.quantity;
            }
        })

        return { quote: price }
    }

    const getLowest2 = (item: string) => {
        const quotesForItem = quotation_request_list
            ?.filter(value => value.item === item && ![null, "0", 0, undefined].includes(value.quote))
            ?.map(value => value.quote);
        let minQuote;
        if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
        return minQuote;
    }

    const getLowest3 = (cat: string) => {
        let total: number = 0;
        // const threeMonthsAgo = new Date();
        // threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        orderData.procurement_list?.list.map((item) => {
            if (item.category === cat) {
                // const quotesForItem = quote_data?.filter((value) => {
                //     const modifiedDate = new Date(value.modified);
                //     return modifiedDate >= threeMonthsAgo;
                //   })
                const quotesForItem = quote_data
                    ?.filter(value => value.item_id === item.name && ![null, "0", 0, undefined].includes(value.quote))
                    ?.map(value => value.quote);
                let minQuote;
                if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
                total += parseFloat(minQuote || 0) * item.quantity;
            }
        })
        return total;
    }

    const getLeadTime = (vendor: string, category: string) => {
        return quotation_request_list?.find(item => item.vendor === vendor && item.category === category)?.lead_time;
    }

    const getItemQuoteMakes = (item: string, category: string, vendor: string) => {
        return quotation_request_list?.find(i => i.vendor === vendor && i.category === category && i.item === item)?.makes?.list || [];
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
                navigate(`/procurement-requests/${orderId}?tab=Update Quote`)
            }).catch(() => {
                console.log(submit_error)
            })
    }

    // console.log("orderData", orderData?.procurement_list?.list)

    const generateActionSummary = () => {
        let allDelayedItems = [];
        let vendorWiseApprovalItems = {};
        let delayedItemsOverallTotal = 0;
        let approvalOverallTotal = 0;

        orderData.procurement_list?.list.forEach((item) => {
            const vendor = selectedVendors[item.name];
            const quote = getPrice(vendor, item?.name);
            if (!vendor) {
                // Delayed items
                allDelayedItems.push(item);
                delayedItemsOverallTotal += item.quantity * quote;
            } else {
                // Approval items segregated by vendor
                const itemTotal = item.quantity * quote;
                if (!vendorWiseApprovalItems[vendor]) {
                    vendorWiseApprovalItems[vendor] = {
                        items: [],
                        total: 0,
                    };
                }
                vendorWiseApprovalItems[vendor].items.push(item);
                vendorWiseApprovalItems[vendor].total += itemTotal;
                approvalOverallTotal += itemTotal;
            }
        });

        return {
            allDelayedItems,
            delayedItemsOverallTotal,
            vendorWiseApprovalItems,
            approvalOverallTotal,
        };
    };

    const {
        allDelayedItems,
        delayedItemsOverallTotal,
        vendorWiseApprovalItems,
        approvalOverallTotal,
    } = generateActionSummary();

    // const getPercentdiff = (a: number, b: number) => {
    //     if (a === 0 && b === 0) {
    //         return 0;
    //     }
    //     const difference: number = Math.abs(a - b);
    //     const percentDiff: number = (difference / a) * 100;

    //     return percentDiff.toFixed(2);
    // }

    if (procurement_request_list_loading || quotation_request_list_loading || vendor_list_loading) return <div className="flex items-center h-[90vh] w-full justify-center"><TailSpin color={"red"} /> </div>

    return (
        <>
            {page == 'updatequotation' &&
                <div className="flex-1 space-y-4">
                    <div className="flex items-center">
                        {/* <ArrowLeft onClick={() => navigate("/choose-vendor")} /> */}
                        <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">Choose Vendor/Item Quotes</h2>
                    </div>
                    <ProcurementHeaderCard orderData={orderData} />
                    {orderData?.category_list?.list.map((cat) => {
                        const curCategory = cat.name;
                        return <div key={curCategory}>
                            <Card className="flex w-full shadow-none border border-grey-500 overflow-x-auto" >
                                <CardHeader className="w-full overflow-x-auto">
                                    <div className='flex justify-between py-5'>
                                        <CardTitle className="font-bold text-xl text-red-700">
                                            {cat.name}
                                        </CardTitle>
                                        {/* <CardTitle className="font-bold text-xl">
                                            {getSelectedVendor(cat.name)}
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
                                        <tbody className="bg-white divide-y divide-gray-200 ">
                                            {orderData?.procurement_list?.list.map((item) => {
                                                // const threeMonthsAgo = new Date();
                                                // threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

                                                // const quotesForItem = quote_data
                                                //     ?.filter(value => {
                                                //         const modifiedDate = new Date(value.modified);
                                                //         return modifiedDate >= threeMonthsAgo;
                                                //     })
                                                const quotesForItem = quote_data
                                                    ?.filter(
                                                        value => value.item_id === item.name && ![null, "0", 0, undefined].includes(value.quote))
                                                    ?.map(value => value.quote);
                                                let minQuote;
                                                if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);

                                                if (item.category === cat.name) {
                                                    return <tr>
                                                        <td className="py-2 text-sm px-2 font-slim w-[30%]">
                                                            <div className="inline items-baseline">
                                                                <span>{item.item}</span>
                                                                {item.comment && (
                                                                    <HoverCard>
                                                                        <HoverCardTrigger><MessageCircleMore className="text-blue-400 w-6 h-6 inline-block ml-1" /></HoverCardTrigger>
                                                                        <HoverCardContent className="max-w-[300px] bg-gray-800 text-white p-2 rounded-md shadow-lg">
                                                                            <div className="relative pb-4">
                                                                                <span className="block">{item.comment}</span>
                                                                                <span className="text-xs absolute right-0 italic text-gray-200">-Comment by PL</span>
                                                                            </div>

                                                                        </HoverCardContent>
                                                                    </HoverCard>
                                                                )}
                                                            </div>
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

                    <Card className="p-5 text-xs text-slate-500">
                        <h1 className='text-red-700 underline'>Instructions</h1>
                        <p>- Select a vendor's quote for each item.</p>
                        <p>- You can edit the prices entered before by clicking <span className='text-red-700'>Edit Prices</span> button on the bottom left.</p>
                        <p>- If quote of any vendor displays <span className='text-red-700'>Nan</span> or <span className='text-red-700'>NA</span>, it means the item price for that vendor is not updated.</p>
                        <p>- If you dont select any vendor's quote for a particular item/s, it will display <span className='text-red-700'>Delayed</span> in the next page.</p>
                    </Card>
                    {/* <div className='p-10'></div> */}
                    <div className='flex justify-between pt-4'>
                        <Button className="border-primary text-primary flex gap-1 items-center" variant={"outline"} onClick={() => handleEditPrice()}>
                            <Pencil className="h-4 w-4" />
                            Edit Price
                        </Button>
                        {/* <div className="flex flex-col justify-end items-end"> */}

                        <Dialog>
                            <DialogTrigger asChild>
                                <Button onClick={delayedItemsCheck} className="flex items-center gap-1">
                                    <CheckCheck className="h-4 w-4" />
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
                                    {
                                        Object.keys(delayedItems).length !== 0 ? (
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
                                        ) : <></>
                                    }
                                </DialogHeader>
                                <DialogDescription className='flex items-center justify-center gap-2'>
                                    <DialogClose>
                                        <Button variant={"secondary"} className="flex items-center gap-1">
                                            <Undo2 className="h-4 w-4" />
                                            Cancel
                                        </Button>
                                    </DialogClose>
                                    <Button variant="default" className="flex items-center gap-1" onClick={() => {
                                        delayedItemsCheck()
                                        setPage('approvequotation')
                                    }}>
                                        <CheckCheck className="h-4 w-4" />
                                        Confirm</Button>
                                </DialogDescription>
                            </DialogContent>
                        </Dialog>
                    </div>
                </div>}
            {page == 'approvequotation' &&
                <>
                    <div className="flex-1 space-y-4">
                        <div className="flex items-center">
                            <ArrowLeft className='cursor-pointer' onClick={() => setPage('updatequotation')} />
                            <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">Comparison</h2>
                        </div>
                        <ProcurementHeaderCard orderData={orderData} />
                    </div>

                    <div className="bg-white shadow-md rounded-lg p-4 border border-gray-200 mt-4">
                        <h2 className="text-lg font-bold mb-3 flex items-center">
                            <BookOpenText className="h-5 w-5 text-blue-500 mr-2" />
                            Actions Summary
                        </h2>
                        <div className="grid md:grid-cols-2 gap-4">
                            {/* Delayed Items Summary */}
                            {allDelayedItems.length > 0 && (
                                <div className="p-3 border border-gray-300 rounded-lg bg-gray-50">
                                    <div className="flex items-center mb-2">
                                        <SendToBack className="h-5 w-5 text-red-500 mr-2" />
                                        <h3 className="font-medium text-gray-700">Delayed Items</h3>
                                    </div>
                                    <p className="text-sm text-gray-600">
                                        These items are delayed and a <strong>new Delayed Sent Back</strong> will be created:
                                    </p>
                                    <ul className="mt-1 list-disc pl-5">
                                        {allDelayedItems.map((item) => (
                                            <li key={item.name}>
                                                {item.item} - {item.quantity} {item.unit}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* Approval Items Summary */}
                            {Object.keys(vendorWiseApprovalItems).length > 0 && (
                                <div className="p-3 border border-gray-300 rounded-lg bg-gray-50">
                                    <div className="flex items-center mb-2">
                                        <ListChecks className="h-5 w-5 text-green-500 mr-2" />
                                        <h3 className="font-medium text-gray-700">Approval Items</h3>
                                    </div>
                                    <p className="text-sm text-gray-600">
                                        These items will be sent to the project lead for approval.
                                    </p>
                                    {Object.entries(vendorWiseApprovalItems).map(([vendor, { items, total }]) => (
                                        <div key={vendor} className="mt-2">
                                            <h4 className="text-sm font-medium text-gray-800">
                                                {getVendorName(vendor)}:
                                            </h4>
                                            <ul className="list-disc pl-5 text-sm text-gray-600">
                                                {items.map((item) => (
                                                    <li key={item.name}>
                                                        {item.item} - {item.quantity} {item.unit} -
                                                        {formatToIndianRupee(item.quantity * getPrice(vendor, item?.name))}
                                                    </li>
                                                ))}
                                            </ul>
                                            <p className="text-sm font-medium mt-1">
                                                Vendor Total: {formatToIndianRupee(total)}
                                            </p>
                                        </div>
                                    ))}
                                    <p className="mt-2 font-medium">
                                        Overall Total: {formatToIndianRupee(approvalOverallTotal)}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className='mt-6 overflow-x-auto'>
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
                    <div className="flex flex-col justify-end items-end mr-2 my-4">
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button className="flex items-center gap-1" disabled={submitClicked}>
                                    <ArrowBigUpDash className="" />
                                    Send for Approval
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[425px]">
                                <DialogHeader>
                                    <DialogTitle>Have you cross-checked your selections?</DialogTitle>
                                    <DialogDescription>
                                        {Object.keys(delayedItems).length !== 0 && (
                                            <p>
                                                Remainder: Items whose quotes are not selected will have a delayed status
                                                attached to them. If confirmed, Delayed sent back request will be created for those Items.
                                            </p>
                                        )}

                                        {Object.keys(selectedVendors).length !== 0 && (
                                            <div className='flex flex-col gap-2 mt-2 text-start'>
                                                <h4 className='font-bold'>Any remarks for the Project Lead?</h4>
                                                <TextArea className='border-green-400 focus:border-green-800 bg-green-200' placeholder='type here...' value={comment?.approving} onChange={(e) => setComment({ ...comment, "approving": e.target.value })} />
                                            </div>
                                        )}

                                        {Object.keys(delayedItems).length !== 0 ? (
                                            <div className='flex flex-col gap-2 mt-2 text-start'>
                                                <h4 className='font-bold'>some items are delayed, any reason?</h4>
                                                <TextArea className='border-primary focus:border-red-800 bg-red-200' placeholder='type here...' value={comment?.delaying} onChange={(e) => setComment({ ...comment, "delaying": e.target.value })} />
                                            </div>
                                        ) : <></>}
                                    </DialogDescription>
                                </DialogHeader>
                                <DialogDescription className='flex items-center justify-center gap-2'>
                                    {(update_loading || create_loading || submitClicked) ? <TailSpin width={60} color={"red"} /> : (
                                        <>
                                            <DialogClose><Button variant="secondary" className="flex items-center gap-1">
                                                <Undo2 className="h-4 w-4" />
                                                Cancel</Button></DialogClose>
                                            <Button variant="default" onClick={() => {
                                                setSubmitClicked(true)
                                                handleSubmit()
                                            }} disabled={submitClicked} className="flex items-center gap-1">
                                                <CheckCheck className="h-4 w-4" />
                                                Confirm</Button>
                                        </>
                                    )}
                                </DialogDescription>
                            </DialogContent>
                        </Dialog>
                    </div>
                </>}
        </>
    )
}