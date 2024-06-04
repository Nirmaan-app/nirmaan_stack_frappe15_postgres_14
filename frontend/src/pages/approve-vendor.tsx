import { ArrowLeft } from 'lucide-react';
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button"
import { useFrappeGetDocList, useFrappeCreateDoc, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useParams, useNavigate } from "react-router-dom";
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


export const ApproveVendor = () => {
    const { orderId } = useParams<{ orderId: string }>()
    const navigate = useNavigate()

    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'category_list', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'creation', 'procurement_executive']
        });
    const { data: item_list, isLoading: item_list_loading, error: item_list_error } = useFrappeGetDocList("Items",
        {
            fields: ['name', 'item_name', 'unit_name']
        });
    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error } = useFrappeGetDocList("Vendors",
        {
            fields: ['name', 'vendor_name', 'vendor_address', 'vendor_gst']
        });
    const { data: project_list, isLoading: project_list_loading, error: project_list_error } = useFrappeGetDocList("Projects",
        {
            fields: ['name', 'project_name', 'project_address', 'procurement_lead']
        });
    const { data: quotation_request_list, isLoading: quotation_request_list_loading, error: quotation_request_list_error } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['name', 'project', 'item', 'category', 'vendor', 'procurement_task', 'quote', 'lead_time','quantity'],
            filters: [["is_selected", "=", "True"], ["procurement_task", "=", orderId]]
        });
    const { data: quotation_request_list2, isLoading: quotation_request_list2_loading, error: quotation_request_list2_error } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['name', 'project', 'item', 'category', 'vendor', 'procurement_task', 'quote', 'lead_time','quantity'],
            filters: [["procurement_task", "=", orderId]]
        });


    const [page, setPage] = useState<string>('approvequotation')
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

    useEffect(() => {
        const foundItem = procurement_request_list?.find(item => item.name === orderId);
        if (foundItem) {
            setOrderData(foundItem)
        }
    }, [procurement_request_list]);

    const [selectedVendors, setSelectedVendors] = useState({})
    const [comment, setComment] = useState('')
    const total_categories = procurement_request_list?.find(item => item.name === orderId)?.category_list.list.length;

    const getVendorName = (vendorName: string) => {
        return vendor_list?.find(vendor => vendor.name === vendorName)?.vendor_name;
    }
    const getVendorAddress = (vendorName: string) => {
        return vendor_list?.find(vendor => vendor.name === vendorName)?.vendor_address;
    }
    const getVendorGST = (vendorName: string) => {
        return vendor_list?.find(vendor => vendor.name === vendorName)?.vendor_gst;
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
    const handleSendBack = (cat: string) => {
        const itemlist = [];
        orderData.procurement_list.list.map((value) => {
            if (value.category === cat) {
                const price = getPrice(selectedVendors[cat], value.name);
                itemlist.push({
                    name: value.name,
                    item: value.item,
                    quantity: value.quantity,
                    quote: price,
                    unit: value.unit
                })
            }
        })
        const delivery_time = quotation_request_list?.find(item => item.category === cat)?.lead_time;
        const newSendBack = {
            procurement_request: orderId,
            project_name: orderData.project,
            category: cat,
            vendor: selectedVendors[cat],
            item_list: {
                list: itemlist
            },
            lead_time: delivery_time,
            comments: comment,
            procurement_executive: orderData.procurement_executive
        }
        createDoc('Sent Back Category', newSendBack)
            .then(() => {
                console.log(newSendBack);
                setComment('')
            })
            .catch(() => {
                console.log("submit_error", submit_error);
            })
        updateDoc('Procurement Requests', orderId, {
            workflow_state: "Partially Approved"
        })
            .then(() => {
                console.log("item", orderId)
            }).catch(() => {
                console.log("update_submit_error", update_submit_error)
            })
        setOrderData((prevState) => {
            const newCategoryList = prevState.category_list.list.filter(
                (category) => category.name !== cat
            );
            return {
                ...prevState,
                category_list: {
                    ...prevState.category_list,
                    list: newCategoryList
                }
            };
        });
    }

    // const handleRejectAll = () => {
    //     orderData.category_list.list.map((cat) => {
    //         const itemlist = [];
    //         const curCategory = cat.name;
    //         orderData.procurement_list.list.map((value) => {
    //             if (value.category === curCategory) {
    //                 const price = getPrice(selectedVendors[curCategory], value.name);
    //                 itemlist.push({
    //                     name: value.name,
    //                     item: value.item,
    //                     quantity: value.quantity,
    //                     quote: price,
    //                     unit: value.unit
    //                 })
    //             }
    //         })
    //         const delivery_time = quotation_request_list?.find(item => item.category === curCategory)?.lead_time;
    //         const newSendBack = {
    //             procurement_request: orderId,
    //             project_name: orderData.project,
    //             category: curCategory,
    //             vendor: selectedVendors[curCategory],
    //             item_list: {
    //                 list: itemlist
    //             },
    //             lead_time: delivery_time,
    //             comments: comment,
    //             procurement_executive: orderData.procurement_executive
    //         }
    //         createDoc('Sent Back Category', newSendBack)
    //             .then(() => {
    //                 console.log(newSendBack);
    //                 setComment('')

    //             })
    //             .catch(() => {
    //                 console.log("submit_error", submit_error);
    //             })
    //         setOrderData((prevState) => {
    //             const newCategoryList = prevState.category_list.list.filter(
    //                 (category) => category.name !== curCategory
    //             );
    //             return {
    //                 ...prevState,
    //                 category_list: {
    //                     ...prevState.category_list,
    //                     list: newCategoryList
    //                 }
    //             };
    //         });
    //     })
    //     updateDoc('Procurement Requests', orderId, {
    //         workflow_state: "Partially Approved"
    //     })
    //         .then(() => {
    //             console.log("item", orderId)
    //             navigate("/")
    //         }).catch(() => {
    //             console.log("update_submit_error", update_submit_error)
    //         })
    // }

    const handleRejectAll = () => {
        // Create an array to hold all the promises
        const createDocPromises = [];
    
        orderData.category_list.list.forEach((cat) => {
            const itemlist = [];
            const curCategory = cat.name;
    
            // Populate the itemlist with matching items
            orderData.procurement_list.list.forEach((value) => {
                if (value.category === curCategory) {
                    const price = getPrice(selectedVendors[curCategory], value.name);
                    itemlist.push({
                        name: value.name,
                        item: value.item,
                        quantity: value.quantity,
                        quote: price,
                        unit: value.unit
                    });
                }
            });
    
            const delivery_time = quotation_request_list?.find(item => item.category === curCategory)?.lead_time;
            const newSendBack = {
                procurement_request: orderId,
                project_name: orderData.project,
                category: curCategory,
                vendor: selectedVendors[curCategory],
                item_list: {
                    list: itemlist
                },
                lead_time: delivery_time,
                comments: comment,
                procurement_executive: orderData.procurement_executive
            };
    
            // Add the createDoc promise to the array
            const createDocPromise = createDoc('Sent Back Category', newSendBack)
                .then(() => {
                    console.log(newSendBack);
                    setComment('');
                })
                .catch((error) => {
                    console.log("submit_error", error);
                });
    
            createDocPromises.push(createDocPromise);
    
            // Update the state for the order data
            setOrderData((prevState) => {
                const newCategoryList = prevState.category_list.list.filter(
                    (category) => category.name !== curCategory
                );
                return {
                    ...prevState,
                    category_list: {
                        ...prevState.category_list,
                        list: newCategoryList
                    }
                };
            });
        });
    
        // Wait for all createDoc promises to resolve
        Promise.all(createDocPromises)
            .then(() => {
                // After all createDoc operations are complete, update the document
                return updateDoc('Procurement Requests', orderId, {
                    workflow_state: "Partially Approved"
                });
            })
            .then(() => {
                console.log("item", orderId);
                navigate("/");
            })
            .catch((error) => {
                console.log("update_submit_error", error);
            });
    };
    

    // const handleApproveAll = () => {
    //     orderData.category_list.list.map((cat) => {
    //         const order_list = {
    //             list: []
    //         };
    //         quotation_request_list?.map((value) => {
    //             if (value.category === cat.name) {
    //                 const newItem = {
    //                     name: value.item,
    //                     item: getItem(value.item),
    //                     unit: getUnit(value.item),
    //                     quantity: value.quantity,
    //                     quote: value.quote
    //                 }
    //                 order_list.list.push(newItem)
    //             }
    //         })
    //         const newProcurementOrder = {
    //             procurement_request: orderId,
    //             project: orderData.project,
    //             project_name: getProjectName(orderData.project),
    //             project_address: getProjectAddress(orderData.project),
    //             category: cat.name,
    //             vendor: selectedVendors[cat.name],
    //             vendor_name: getVendorName(selectedVendors[cat.name]),
    //             vendor_address: getVendorAddress(selectedVendors[cat.name]),
    //             vendor_gst: getVendorGST(selectedVendors[cat.name]),
    //             order_list: order_list
    //         }
    //         createDoc('Procurement Orders', newProcurementOrder)
    //             .then(() => {
    //                 console.log(newProcurementOrder);
    //                 navigate("/")
    //             })
    //             .catch(() => {
    //                 console.log("submit_error", submit_error);
    //             })
    //         updateDoc('Procurement Requests', orderId, {
    //             workflow_state: "Vendor Approved"
    //         })
    //             .then(() => {
    //                 console.log("item", orderId)
    //             }).catch(() => {
    //                 console.log("update_submit_error", update_submit_error)
    //             })

    //     })
    // }
    const handleApproveAll = () => {
        // Create an array to hold all the promises
        const createDocPromises = [];
    
        orderData.category_list.list.forEach((cat) => {
            const order_list = {
                list: []
            };
    
            // Populate the order_list with matching items
            quotation_request_list?.forEach((value) => {
                if (value.category === cat.name) {
                    const newItem = {
                        name: value.item,
                        item: getItem(value.item),
                        unit: getUnit(value.item),
                        quantity: value.quantity,
                        quote: value.quote
                    };
                    order_list.list.push(newItem);
                }
            });
    
            // Create a new procurement order object
            const newProcurementOrder = {
                procurement_request: orderId,
                project: orderData.project,
                project_name: getProjectName(orderData.project),
                project_address: getProjectAddress(orderData.project),
                category: cat.name,
                vendor: selectedVendors[cat.name],
                vendor_name: getVendorName(selectedVendors[cat.name]),
                vendor_address: getVendorAddress(selectedVendors[cat.name]),
                vendor_gst: getVendorGST(selectedVendors[cat.name]),
                order_list: order_list
            };
    
            // Add the createDoc promise to the array
            const createDocPromise = createDoc('Procurement Orders', newProcurementOrder)
                .then(() => {
                    console.log(newProcurementOrder);
                })
                .catch((error) => {
                    console.log("submit_error", error);
                });
    
            createDocPromises.push(createDocPromise);
        });
    
        // Wait for all createDoc promises to resolve
        Promise.all(createDocPromises)
            .then(() => {
                // After all createDoc operations are complete, update the document
                return updateDoc('Procurement Requests', orderId, {
                    workflow_state: "Vendor Approved"
                });
            })
            .then(() => {
                console.log("item", orderId);
                navigate("/");
            })
            .catch((error) => {
                console.log("update_submit_error", error);
            });
    };
    

    const handleApprove = (cat: string) => {
        const order_list = {
            list: []
        };
        quotation_request_list?.map((value) => {
            if (value.category === cat) {
                const newItem = {
                    name: value.item,
                    item: getItem(value.item),
                    unit: getUnit(value.item),
                    quantity: value.quantity,
                    quote: value.quote
                }
                order_list.list.push(newItem)
            }
        })
        const newProcurementOrder = {
            procurement_request: orderId,
            project: orderData.project,
            project_name: getProjectName(orderData.project),
            project_address: getProjectAddress(orderData.project),
            category: cat,
            vendor: selectedVendors[cat],
            vendor_name: getVendorName(selectedVendors[cat]),
            vendor_address: getVendorAddress(selectedVendors[cat]),
            vendor_gst: getVendorGST(selectedVendors[cat]),
            order_list: order_list
        }
        createDoc('Procurement Orders', newProcurementOrder)
            .then(() => {
                console.log(newProcurementOrder);
            })
            .catch(() => {
                console.log("submit_error", submit_error);
            })
        updateDoc('Procurement Requests', orderId, {
            workflow_state: "Partially Approved"
        })
            .then(() => {
                console.log("item", orderId)
            }).catch(() => {
                console.log("update_submit_error", update_submit_error)
            })
        setOrderData((prevState) => {
            const newCategoryList = prevState.category_list.list.filter(
                (category) => category.name !== cat
            );
            return {
                ...prevState,
                category_list: {
                    ...prevState.category_list,
                    list: newCategoryList
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
        return priceMap.get(key);
    };
    useEffect(() => {
        const newPriceMap = new Map<string, string>();
        quotation_request_list?.forEach((item) => {
            const key = generateVendorItemKey(item.vendor, item.item);
            newPriceMap.set(key, item.quote);
        });
        setPriceMap(newPriceMap);
    }, [quotation_request_list]);
    useEffect(() => {
        let updatedVendors = { ...selectedVendors };
        quotation_request_list?.forEach((item) => {
            const curCategory = item.category;
            const curVendor = item.vendor;
            updatedVendors[curCategory] = curVendor;
        });
        setSelectedVendors(updatedVendors);
    }, [quotation_request_list]);
    const getTotal = (cat: string) => {
        let total: number = 0;
        orderData?.procurement_list.list.map((item) => {
            if (item.category === cat) {
                const price = getPrice(selectedVendors[cat], item.name);
                total += (price ? parseFloat(price) : 0)*item.quantity;
            }
        })
        return total
    }
    const handleDone = () => {
        console.log(orderData.category_list?.list.length)
        if (orderData.category_list?.list.length === 0) {
            navigate("/")
        }
    }

    const [selectedCategories, setSelectedCategories] = useState({})

    useEffect(() => {
        const updatedCategories = { ...selectedCategories };
        orderData?.category_list.list.map((cat) => {
            const newVendorsSet = new Set();
            const curCategory = cat.name
            quotation_request_list2?.forEach((item) => {
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
    }, [quotation_request_list2,orderData]);

    console.log(selectedCategories,quotation_request_list2)

    const getLowest = (cat: string) => {
        let price: number = 100000000;
        let vendor: string = '';
        selectedCategories[cat]?.map((ven) => {
            let total: number = 0;
            quotation_request_list2?.map((item) => {
                if (item.vendor === ven && item.category === cat) {
                    const price = item.quote
                    total += (price ? parseFloat(price) : 0)*item.quantity;
                }
            })
            if (total < price) {
                price = total;
                vendor = ven;
            }
        })
        if(price != 100000000) return {quote : price , vendor:vendor}
    }

    return (
        <MainLayout>
            <div className="flex" >
                <div className="flex-1 space-x-2 md:space-y-4 p-2 md:p-12 pt-6">
                    <div className="flex items-center space-y-2">
                        {/* <ArrowLeft /> */}
                        <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">Comparison</h2>
                    </div>
                    <div className="grid grid-cols-5 gap-4 border border-gray-100 rounded-lg p-4">
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
                    </div>
                    {orderData?.category_list?.list.map((cat) => {
                        const curCategory = cat.name
                        const lowest = getLowest(cat.name);
                        let total: number = 0;
                        let count: number = 0;
                        return <div className="grid grid-cols-2 gap-4 w-full">
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
                                        const price = getPrice(selectedVendors[curCategory], item.name);
                                        total += (price ? parseFloat(price) : 0)*(parseFloat(item.quantity));
                                        if(count === 2 ) {return }
                                        count++;
                                        if (item.category === curCategory) {
                                            return <div className="flex justify-between py-2">
                                                <div className="text-sm">{item.item}</div>
                                                <div className="text-sm">{price*(item.quantity)}</div>
                                            </div>
                                        }
                                    })}
                                    <Dialog>
                                        <DialogTrigger asChild>
                                        <div className="text-sm text-blue-500 cursor-pointer">View All</div>
                                        </DialogTrigger>
                                        <DialogContent className="sm:max-w-[425px]">
                                            <DialogHeader>
                                                <DialogTitle>Items List</DialogTitle>
                                                <DialogDescription>
                                                <div className="grid grid-cols-6 font-medium text-black py-2">
                                                    <div className="text-sm col-span-2">Items</div>
                                                    <div className="text-sm">Unit</div>
                                                    <div className="text-sm">Qty</div>
                                                    <div className="text-sm">Rate</div>
                                                    <div className="text-sm">Amount</div>
                                                </div>
                                                {orderData?.procurement_list.list.map((item) => {
                                                    const price = getPrice(selectedVendors[curCategory], item.name);
                                                    total += (price ? parseFloat(price) : 0)*(item.quantity);
                                                    if (item.category === curCategory) {
                                                        return <div className="grid grid-cols-6 py-2">
                                                            <div className="text-sm col-span-2">{item.item}</div>
                                                            <div className="text-sm">{item.unit}</div>
                                                            <div className="text-sm">{item.quantity}</div>
                                                            <div className="text-sm">{price}</div>
                                                            <div className="text-sm">{price*item.quantity}</div>
                                                        </div>
                                                    }
                                                })}
                                                </DialogDescription>
                                            </DialogHeader>
                                        </DialogContent>
                                    </Dialog>
                                </CardHeader>
                            </Card>
                            <div>
                                    <div className="h-[50%] p-5 rounded-lg border border-grey-500">
                                        <div className="flex justify-between">
                                            <div className="text-sm font-medium text-gray-400">Lowest Quoted Vendor</div>
                                            <div className="font-bold text-2xl text-gray-500 border-gray-200">{lowest?.quote}</div>
                                        </div>
                                        <div className="font-medium text-gray-700 text-sm">
                                            {getVendorName(lowest?.vendor)}
                                        </div>
                                        {/* <div className="text-end text-sm text-gray-400">Delivery Time: {getLeadTime(selectedVendors[curCategory], curCategory)} Days</div> */}
                                    </div>
                                    <div className="mt-2 h-[45%] p-5 rounded-lg border border-grey-500">
                                        <div className="flex justify-between">
                                            <div className="text-sm font-medium text-gray-400">Lowest Quoted Vendor</div>
                                            <div className="font-bold text-2xl text-gray-500 border-gray-200">{lowest?.quote}</div>
                                        </div>
                                        <div className="font-medium text-gray-700 text-sm">
                                            Last 3 months Lowest Price
                                        </div>
                                    </div>
                                    </div>
                            <div className="col-span-2 py-4 flex justify-between">
                                <Sheet>
                                    <SheetTrigger className="border border-red-500 text-red-500 bg-white font-normal px-4 py-1 rounded-lg">Add Comment and Send Back</SheetTrigger>
                                    <SheetContent>
                                        <SheetHeader>
                                            <ScrollArea className="h-[90%] w-[600px] rounded-md border p-4">
                                                <SheetTitle>Enter Price</SheetTitle>
                                                <SheetDescription>
                                                    Add Comments and Send Back
                                                    <div className="flex justify-between py-2">
                                                        <div className="text-sm w-1/2">Added Items</div>
                                                        <div className="text-sm">Qty</div>
                                                        <div className="text-sm">UOM</div>
                                                        <div className="text-sm">Quote</div>
                                                    </div>
                                                    {orderData?.procurement_list.list.map((item) => {
                                                        if (item.category === curCategory) {
                                                            const price = getPrice(selectedVendors[curCategory], item.name);
                                                            total += price ? parseFloat(price) : 0;
                                                            return <div className="flex justify-between py-2">
                                                                <div className="text-sm w-1/2 text-black font-semibold">{item.item}</div>
                                                                <div className="text-sm text-black font-semibold">{item.quantity}</div>
                                                                <div className="text-sm text-black font-semibold">{item.unit}</div>
                                                                <div className="text-sm text-black font-semibold">{price}</div>
                                                            </div>
                                                        }
                                                    })}
                                                    <div className="py-2"><label htmlFor="textarea" >Comment:</label></div>
                                                    <textarea
                                                        id="textarea"
                                                        className="w-full border rounded-lg p-2"
                                                        value={comment}
                                                        placeholder="Type your comments here"
                                                        onChange={(e) => setComment(e.target.value)}
                                                    />
                                                    <div className="flex flex-col justify-end items-end fixed bottom-4 right-4">
                                                        <SheetClose><Button onClick={() => handleSendBack(curCategory)}>Submit</Button></SheetClose>
                                                    </div>
                                                </SheetDescription>
                                            </ScrollArea>
                                        </SheetHeader>
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
                                        <DialogClose><Button variant="secondary" onClick={() => handleApprove(curCategory)}>Confirm</Button></DialogClose>
                                    </DialogContent>
                                </Dialog>
                            </div>
                        </div>
                    })}
                    {orderData.category_list.list.length === total_categories ? <div className="flex space-x-2 justify-end items-end bottom-4 right-4">
                        <Dialog>
                            <DialogTrigger asChild>
                            <Button className="border border-red-500 bg-white text-red-500 hover:text-white" >
                                Reject All
                            </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[425px]">
                                <DialogHeader>
                                    <DialogTitle>Are you Sure</DialogTitle>
                                    <DialogDescription>
                                        Click on Confirm to Reject All.
                                    </DialogDescription>
                                </DialogHeader>
                                <Button variant="secondary" onClick={() => handleRejectAll()}>Confirm</Button>
                            </DialogContent>
                        </Dialog>
                        <Dialog>
                            <DialogTrigger asChild>
                            <Button>
                                Approve All
                            </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[425px]">
                                <DialogHeader>
                                    <DialogTitle>Are you Sure</DialogTitle>
                                    <DialogDescription>
                                        Click on Confirm to Approve.
                                    </DialogDescription>
                                </DialogHeader>
                                <Button variant="secondary"  onClick={() => handleApproveAll()}>Confirm</Button>
                            </DialogContent>
                        </Dialog>
                    </div> :
                        <div className="flex space-x-2 justify-end items-end fixed bottom-4 right-4">
                            <Button onClick={() => handleDone()}>
                                Done
                            </Button>
                        </div>
                    }
                </div>
            </div>
        </MainLayout>
    )
}