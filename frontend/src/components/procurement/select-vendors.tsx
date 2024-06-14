import { ArrowLeft } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

import { useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react"
import { MainLayout } from '../layout/main-layout';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface VendorItem {
    vendor: string;
    item: string;
}

export const SelectVendors = () => {
    const { orderId } = useParams<{ orderId: string }>()
    const navigate = useNavigate()

    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'category_list', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'creation'],
            filters: [['name', '=', orderId]]
        });
    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error } = useFrappeGetDocList("Vendors",
        {
            fields: ['name', 'vendor_name', 'vendor_address'],
            limit: 1000
        });
    const { data: quotation_request_list, isLoading: quotation_request_list_loading, error: quotation_request_list_error } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['name', 'lead_time', 'project', 'item', 'category', 'vendor', 'procurement_task', 'quote', 'quantity'],
            filters: [["procurement_task", "=", orderId]],
            limit: 1000
        });
    const { data: quote_data } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['item', 'quote'],
            limit: 1000
        });
    const { updateDoc: updateDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeUpdateDoc()

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
    const [totals, setTotals] = useState()

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
    const handleRadioChange = (cat, vendor) => {
        setSelectedVendors(prevState => {
            if (prevState.hasOwnProperty(cat)) {
                return { ...prevState, [cat]: vendor };
            } else {
                return { ...prevState, [cat]: vendor };
            }
        });
    };

    const handleChangeWithParam = (cat, vendor) => {
        return () => handleRadioChange(cat, vendor);
    };

    const handleSubmit = () => {
        quotation_request_list?.map((item) => {
            const cat = item.category;
            if (selectedVendors[cat] === item.vendor) {
                console.log(item)
                updateDoc('Quotation Requests', item.name, {
                    is_selected: "True",
                })
                    .then(() => {
                        console.log("item", item.name)
                        setPage('updatequotation')
                    }).catch(() => {
                        console.log(submit_error)
                    })
            }
        })

        updateDoc('Procurement Requests', orderId, {
            workflow_state: "Vendor Selected",
        })
            .then(() => {
                console.log(orderId)
                navigate("/")
            }).catch(() => {
                console.log(submit_error)
            })

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
            const key = generateVendorItemKey(item.vendor, item.item);
            newPriceMap.set(key, item.quote);
        });
        setPriceMap(newPriceMap);
    }, [quotation_request_list]);
    const getLowest = (cat: string) => {
        let price: number = 100000000;
        let vendor: string = '';
        selectedCategories[cat]?.map((ven) => {
            let total: number = 0;
            quotation_request_list?.map((item) => {
                if (item.vendor === ven && item.category === cat) {
                    const price = item.quote
                    total += (price ? parseFloat(price) : 0) * item.quantity;
                }
            })
            if (total < price) {
                price = total;
                vendor = ven;
            }
        })
        return { quote: price, vendor: vendor }
    }

    const getLowest2 = (item: string) => {
        let total: number = 100000000;
        quotation_request_list?.map((value) => {
            if (value.item === item) {
                if (value.quote < total) {
                    total = value.quote;
                }
            }
        })
        return total;
    }

    const getLowest3 = (cat: string) => {
        let total: number = 0;
        orderData.procurement_list?.list.map((item) => {
            if (item.category === cat) {
                const quotesForItem = quote_data
                    ?.filter(value => value.item === item.name && value.quote != null)
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
                const price = getPrice(selectedVendors[cat], item.name);
                total += (price ? parseFloat(price) : 0) * item.quantity;
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


    return (
        <MainLayout>
            {page == 'updatequotation' &&
                <div className="flex">
                    <div className="flex-1 space-x-2 md:space-y-4 p-2 md:p-6 pt-6">
                        <div className="flex items-center pt-1  pb-4">
                            <ArrowLeft onClick={() => navigate("/select-vendor-list")} />
                            <h2 className="text-base pl-2 font-bold tracking-tight">Select Vendor</h2>
                        </div>
                        <Card className="grid grid-cols-5 gap-4 border border-gray-100 rounded-lg p-4">
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">Date</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.creation?.split(" ")[0]}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">Project</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.project}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">Package</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.work_package}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">Project Lead</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.owner}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">PR Number</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.name?.slice(-4)}</p>
                            </div>
                        </Card>
                        {orderData?.category_list?.list.map((cat) => {
                            const curCategory = cat.name;
                            return <div>
                                <Card className="flex w-full shadow-none border border-grey-500" >
                                    <CardHeader className="w-full">
                                        <div className='flex justify-between py-5'>
                                            <CardTitle className="font-bold text-xl">
                                                {cat.name}
                                            </CardTitle>
                                            <CardTitle className="font-bold text-xl">
                                                {getSelectedVendor(cat.name)}
                                            </CardTitle>
                                        </div>
                                        <table className="w-full">
                                            <thead className="w-full border-b border-black">
                                                <tr>
                                                    <th scope="col" className="bg-gray-200 p-2 font-semibold text-left">Items<div className='py-2 font-light text-sm text-gray-400'>Delivery Time:</div></th>
                                                    {selectedCategories[curCategory]?.map((item) => {
                                                        const isSelected = selectedVendors[curCategory] === item;
                                                        const dynamicClass = `flex-1 ${isSelected ? 'text-red-500' : ''}`
                                                        return <th className="bg-gray-200 font-semibold p-2 text-left "><span className={dynamicClass}><input className="mr-2" type="radio" id={item} name={cat.name} value={item} onChange={handleChangeWithParam(cat.name, item)} />{getVendorName(item).length >= 12 ? getVendorName(item).slice(0, 12) + '...' : getVendorName(item)}</span>
                                                            <div className={`py-2 font-light text-sm text-opacity-50 ${dynamicClass}`}>{getLeadTime(item, cat.name)} Days</div>
                                                        </th>
                                                    })}
                                                    <th className="bg-gray-200 p-2 font-medium truncate text-left">Last 3 months <div className=''>Lowest Quote</div></th>
                                                </tr>
                                            </thead>
                                            <tbody className="bg-white divide-y divide-gray-200">
                                                {orderData?.procurement_list?.list.map((item) => {
                                                    const quotesForItem = quote_data
                                                        ?.filter(value => value.item === item.name && value.quote != null)
                                                        ?.map(value => value.quote);
                                                    let minQuote;
                                                    if (quotesForItem && quotesForItem.length>0) minQuote = Math.min(...quotesForItem);

                                                    if (item.category === cat.name) {
                                                        return <tr>
                                                            <td className="py-2 text-sm px-2 font-slim border-b w-[40%]">
                                                                {item.item}
                                                            </td>
                                                            {selectedCategories[curCategory]?.map((value) => {
                                                                const price = getPrice(value, item.name);
                                                                // total += (price ? parseFloat(price) : 0)*item.quantity;
                                                                const isSelected = selectedVendors[curCategory] === value;
                                                                const dynamicClass = `flex-1 ${isSelected ? 'text-red-500' : ''}`
                                                                return <td className={`py-2 text-sm px-2 border-b text-left ${dynamicClass}`}>
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
                                        {/* <div className="flex">
                                            <div className='flex-1'>
                                                <div className="bg-gray-200 p-2 font-semibold">Items<div className='py-2 font-light text-sm text-gray-400'>Delivery Time:</div></div>

                                                {orderData?.procurement_list?.list.map((item) => {
                                                    if (item.category === cat.name) {
                                                        return <div className="py-2 text-sm px-2 font-semibold border-b text-ellipsis overflow-hidden">
                                                            {item.item}
                                                        </div>
                                                    }
                                                })}
                                                <div className="py-4 text-sm px-2 font-semibold">
                                                    Total
                                                </div>
                                            </div>
                                            {selectedCategories[curCategory]?.map((item) => {
                                                let total: number = 0;
                                                const isSelected = selectedVendors[curCategory] === item;
                                                const dynamicClass = `flex-1 ${isSelected ? 'text-red-500' : ''}`
                                                return <div className={dynamicClass}>
                                                    <div className="bg-gray-200 font-semibold p-2"><span className="truncate"><input className="mr-2" type="radio" id={item} name={cat.name} value={item} onChange={handleChangeWithParam(cat.name, item)} />{getVendorName(item)}</span>
                                                        <div className='py-2 font-light text-sm text-opacity-20'>{getLeadTime(item, cat.name)} Days</div>
                                                    </div>
                                                    {orderData?.procurement_list.list.map((value) => {
                                                        if (value.category === cat.name) {
                                                            const price = getPrice(item, value.name);
                                                            total += (price ? parseFloat(price) : 0) * value.quantity;
                                                            return <div className="py-2 text-sm px-2 text-opacity-10 border-b">
                                                                {price * value.quantity}
                                                            </div>
                                                        }
                                                    })}
                                                    <div className="py-4 font-semibold text-sm px-2">
                                                        {total}
                                                    </div>
                                                </div>
                                            })}
                                            <div className='flex-1'>
                                                <div className="bg-gray-200 p-2 font-semibold truncate">Last 3 months Lowest Quote<div className='py-2 font-light text-sm'>3 Days</div></div>
                                                {orderData?.procurement_list?.list.map((item) => {
                                                    if (item.category === cat.name) {
                                                        return <div className="py-2 text-sm px-2 border-b">
                                                            Price
                                                        </div>
                                                    }
                                                })}
                                            </div>
                                        </div> */}
                                    </CardHeader>
                                </Card>
                            </div>
                        })}
                        <div className='pt-12'></div>
                        <div className="flex flex-col justify-end items-end fixed bottom-4 right-4">
                            {Object.keys(selectedVendors).length === orderData.category_list.list.length ?
                                <Button onClick={() => setPage('approvequotation')}>
                                    Confirm
                                </Button>
                                :
                                <Button disabled={true}>
                                    Confirm
                                </Button>}
                        </div>
                    </div>
                </div>}
            {page == 'approvequotation' &&
                <div className="flex">
                    <div className="flex-1 space-x-2 md:space-y-4 p-2 md:p-6 pt-6">
                        <div className="flex items-center pt-1 pb-4">
                            <ArrowLeft onClick={() => setPage('updatequotation')} />
                            <h2 className="text-base pl-2 font-bold tracking-tight">Comparison</h2>
                        </div>
                        <Card className="grid grid-cols-5 gap-4 border border-gray-100 rounded-lg p-4">
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">Date</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.creation?.split(" ")[0]}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">Project</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.project}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">Package</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.work_package}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">Project Lead</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.owner}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">PR Number</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.name?.slice(-4)}</p>
                            </div>
                        </Card>
                        {orderData?.category_list?.list.map((cat) => {
                            const curCategory = cat.name
                            let total: number = 0;
                            const lowest = getLowest(cat.name);
                            let count: number = 0;
                            // console.log("lowest")
                            return <div className="grid grid-cols-2 gap-4 w-full">
                                {/* <div className="w-1/2"> */}
                                <div className="col-span-2 font-bold text-xl py-2">{cat.name}</div>
                                <Card className="flex w-full shadow-none border border-grey-500" >
                                    <CardHeader className="w-full">
                                        <CardTitle>
                                            <div className="text-sm text-gray-400">Selected Vendor</div>
                                            <div className="flex justify-between border-b">
                                                <div className="font-bold text-lg py-2 border-gray-200">{getVendorName(selectedVendors[curCategory])}</div>
                                                <div className="font-bold text-2xl text-red-500 py-2 border-gray-200">{getTotal(curCategory)}</div>
                                            </div>
                                        </CardTitle>
                                        {orderData?.procurement_list.list.map((item) => {
                                            if (count === 2) { return }
                                            if (item.category === curCategory) {
                                                count++;
                                                const price = getPrice(selectedVendors[curCategory], item.name);
                                                total += price ? parseFloat(price) : 0;
                                                return <div className="flex justify-between py-2">
                                                    <div className="text-sm">{item.item}</div>
                                                    <div className="text-sm">{price * item.quantity}</div>
                                                </div>
                                            }
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
                                                                <div className="text-sm border p-2">Unit</div>
                                                                <div className="text-sm border p-2">Qty</div>
                                                                <div className="text-sm border p-2">Rate</div>
                                                                <div className="text-sm border p-2">Amount</div>
                                                                <div className="text-sm col-span-2 border p-2">Lowest Quoted Vendor</div>
                                                                <div className="text-sm col-span-2 border p-2">3 months Lowest Amount</div>
                                                            </div>
                                                            {orderData?.procurement_list?.list.map((item) => {
                                                                if (item.category === curCategory) {
                                                                    const price = getPrice(selectedVendors[curCategory], item.name);
                                                                    total += price ? parseFloat(price) : 0;

                                                                    const lowest2 = getLowest2(item.name)

                                                                    const quotesForItem = quote_data
                                                                        ?.filter(value => value.item === item.name && value.quote != null)
                                                                        ?.map(value => value.quote);
                                                                    let minQuote;
                                                                    if (quotesForItem && quotesForItem.length>0) minQuote = Math.min(...quotesForItem);

                                                                    return <div className="grid grid-cols-10">
                                                                        <div className="text-sm col-span-2 border p-2">{item.item}</div>
                                                                        <div className="text-sm border p-2">{item.unit}</div>
                                                                        <div className="text-sm border p-2">{item.quantity}</div>
                                                                        <div className="text-sm border p-2">{price}</div>
                                                                        <div className="text-sm border p-2">{price * item.quantity}</div>
                                                                        <div className="text-sm col-span-2 border p-2">{lowest2 ? lowest2 * item.quantity : "N/A"}</div>
                                                                        <div className="text-sm col-span-2 border p-2">{minQuote ? minQuote * item.quantity : "N/A"}</div>
                                                                    </div>
                                                                }
                                                            })}
                                                        </DialogDescription>
                                                    </DialogHeader>
                                                </DialogContent>
                                            </Dialog>
                                            <div className="text-sm text-gray-400">Delivery Time: {getLeadTime(selectedVendors[curCategory], curCategory)} Days</div>
                                        </div>
                                    </CardHeader>
                                </Card>
                                {/* </div> */}
                                <div>
                                    <div className="h-[50%] p-5 rounded-lg border border-grey-500">
                                        <div className="flex justify-between">
                                            <div className="text-sm font-medium text-gray-400">Lowest Quoted Vendor</div>
                                            <div className="font-bold text-2xl text-gray-500 border-gray-200">{lowest.quote}</div>
                                        </div>
                                        <div className="font-medium text-gray-700 text-sm">
                                            {getVendorName(lowest.vendor)}
                                        </div>
                                        <div className="text-end text-sm text-gray-400">Delivery Time: {getLeadTime(selectedVendors[curCategory], curCategory)} Days</div>
                                    </div>
                                    <div className="mt-2 h-[45%] p-5 rounded-lg border border-grey-500">
                                        <div className="flex justify-between">
                                            <div className="text-sm font-medium text-gray-400">Last 3 months Metric</div>
                                            <div className="font-bold text-2xl text-gray-500 border-gray-200">{getLowest3(curCategory)}</div>
                                        </div>
                                        <div className="font-medium text-gray-700 text-sm">
                                            Last 3 months Lowest Amount
                                        </div>
                                    </div>
                                </div>
                            </div>
                        })}
                        <div className='p-10'></div>
                        <div className="flex flex-col justify-end items-end fixed bottom-4 right-4">
                            <Dialog>
                                <DialogTrigger asChild>
                                    <Button>
                                        Send for Approval
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="sm:max-w-[425px]">
                                    <DialogHeader>
                                        <DialogTitle>Are you Sure</DialogTitle>
                                        <DialogDescription>
                                            Click on Confirm to Approve.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <Button variant="secondary" onClick={() => handleSubmit()}>Confirm</Button>
                                </DialogContent>
                            </Dialog>
                        </div>
                    </div>
                </div>}
        </MainLayout>
    )
}