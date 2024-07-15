import Select from 'react-select';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet"
import { ArrowLeft, CirclePlus } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import VendorForm from "./vendor-form"
import QuotationForm from "./quotation-form"
import { ScrollArea } from "@/components/ui/scroll-area"

import { useFrappeGetDocList, useFrappeCreateDoc, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useParams } from "react-router-dom";
import { useState, useEffect } from "react"
import { Link, useNavigate } from "react-router-dom";
import { MainLayout } from '../layout/main-layout';
import { Button } from '@/components/ui/button'
import { ItemComponent } from '@/pages/items';

interface VendorItem {
    vendor: string;
    item: string;
}

export const ProcurementOrder = () => {
    const { orderId } = useParams<{ orderId: string }>()
    const navigate = useNavigate();

    const { data: category_list, isLoading: category_list_loading, error: category_list_error } = useFrappeGetDocList("Category",
        {
            fields: ['category_name', 'work_package']
        });
    const { data: item_list, isLoading: item_list_loading, error: item_list_error } = useFrappeGetDocList("Items",
        {
            fields: ['name', 'item_name', 'unit_name', 'category'],
            limit: 1000
        });
    const { data: project_list, isLoading: project_list_loading, error: project_list_error } = useFrappeGetDocList("Projects",
        {
            fields: ['name', 'project_name', 'project_address']
        });
    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'category_list', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'creation'],
            filters: [["name", "=", orderId]],
            limit: 100
        });
    const { data: vendor_category_list, isLoading: vendor_category_list_loading, error: vendor_category_list_error, mutate: vendor_category_mutate } = useFrappeGetDocList("Vendor Category",
        {
            fields: ['vendor', 'category', 'vendor_name'],
            limit: 1000
        });
    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error, mutate: vendor_list_mutate } = useFrappeGetDocList("Vendors",
        {
            fields: ['name', 'vendor_name', 'vendor_address'],
            limit: 1000
        });
    const { data: quotation_request_list, isLoading: quotation_request_list_loading, error: quotation_request_list_error } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['name', 'item', 'category', 'vendor', 'procurement_task', 'quote'],
            filters: [["procurement_task", "=", orderId]],
            limit: 1000
        });
    const { data: quote_data } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['item', 'quote'],
            limit: 1000
        });
    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    const { updateDoc: updateDoc, loading: update_loading, isCompleted: update_complete, error: update_error } = useFrappeUpdateDoc()

    const getVendorName = (vendorName: string) => {
        return vendor_list?.find(vendor => vendor.name === vendorName)?.vendor_name;
    }
    const [page, setPage] = useState<string>('approve')
    const [uniqueVendors, setUniqueVendors] = useState({
        list: []
    })
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
    interface SelectOption {
        label: string;
        value: string;
    }
    const [categories, setCategories] = useState({})
    const [selectedCategories, setSelectedCategories] = useState({})
    const [selectedVendors, setSelectedVendors] = useState({})
    const [uniqueCategories, setUniqueCategories] = useState({
        list: []
    })

    useEffect(() => {
        const updatedCategories = { ...categories };

        vendor_category_list?.forEach((item) => {
            const fieldName = `${item.category}`;
            if (!Array.isArray(updatedCategories[fieldName])) {
                updatedCategories[fieldName] = [];
            }
            const exists = updatedCategories[fieldName].some(
                (entry) => entry.value === item.vendor
            );
            if (!exists) {
                updatedCategories[fieldName].push({
                    value: item.vendor,
                    label: item.vendor_name,
                });
            }
        });

        setCategories(updatedCategories);
    }, [vendor_category_list]);

    const handleChange = (category) => (selectedOptions) => {
        console.log(selectedOptions)
        const updatedCategories = { ...selectedCategories };
        const newVendors = [];
        selectedOptions?.map((item) => {
            if (!Array.isArray(updatedCategories[category])) {
                updatedCategories[category] = [];
            }
            newVendors.push(item.value)
        })
        updatedCategories[category] = newVendors
        setSelectedCategories(updatedCategories);
    }
    const getCategoryByName = (name) => {
        const fieldName = `${name}`;
        return categories[fieldName];
    };

    const handleSubmit = async () => {
        if (Object.keys(selectedCategories).length != orderData.category_list.list.length) return
        const cats = uniqueCategories.list;
        const promises = [];

        orderData.procurement_list.list.forEach((item) => {
            const categoryExists = cats.some(category => category === item.category);
            if (!categoryExists) {
                cats.push(item.category);
            }

            const curCategory = `${item.category}`;
            selectedCategories[curCategory].forEach((cat) => {
                const new_procurement_list = procurement_request_list?.find(value => value.name === orderId).procurement_list;
                const new_quantity = new_procurement_list?.list.find(value => value.name === item.name).quantity;

                const quotation_request = {
                    procurement_task: orderId,
                    category: item.category,
                    item: item.name,
                    vendor: cat,
                    quantity: new_quantity
                };

                const vendors = uniqueVendors.list;
                vendors.push(cat);

                const removeDuplicates = (array) => {
                    return Array.from(new Set(array));
                };
                const uniqueList = removeDuplicates(vendors);
                setUniqueVendors(prevState => ({
                    ...prevState,
                    list: uniqueList
                }));

                promises.push(
                    createDoc('Quotation Requests', quotation_request)
                        .then(() => {
                            console.log(quotation_request);
                        })
                        .catch(() => {
                            console.log(submit_error);
                        })
                );
            });
        });

        setUniqueCategories({
            list: cats
        });

        try {
            await Promise.all(promises);
            updateDoc('Procurement Requests', orderId, {
                workflow_state: "RFQ Generated",
            })
                .then(() => {
                    console.log(orderId)
                    navigate(`/procure-request/quote-update/${orderId}`);
                }).catch(() => {
                    console.log("error", update_error)
                })

        } catch (error) {
            console.error("Error in creating documents:", error);
        }
    };
    console.log("selectedCategories", Object.keys(selectedCategories).length)

    const [block, setBlock] = useState(false);

    return (
        <MainLayout>
            {page == 'approve' &&
                <div className="flex">
                    <div className="flex-1 space-x-2 md:space-y-4 p-2 md:p-6 pt-6">
                        {/* <button className="font-bold text-md" onClick={() => setPage('categorylist')}>Add Items</button> */}
                        <div className="flex items-center pt-1 pb-4">
                            <ArrowLeft onClick={() => navigate("/procure-request")} />
                            <h2 className="text-base pl-2 font-bold tracking-tight">Order Summary </h2>
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
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-gray-200">
                                <thead className="border-b-2 border-black">
                                    <tr>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Items</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">UOM</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estimated Price</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {orderData?.procurement_list?.list.map(item => {
                                        const quotesForItem = quote_data
                                            ?.filter(value => value.item === item.name && value.quote != null)
                                            ?.map(value => value.quote);
                                        let minQuote;
                                        if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);

                                        return <tr key={item.item}>
                                            <td className="px-6 py-4">{<ItemComponent item_id={item.name} />}</td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                {item.category}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">{item.unit}</td>
                                            <td className="px-6 py-4 whitespace-nowrap">{item.quantity}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                                {minQuote ? minQuote * item.quantity : "N/A"}
                                            </td>
                                        </tr>
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex flex-col justify-end items-end">
                            <Button onClick={() => setPage('vendors')}>
                                Select Vendors
                            </Button>
                        </div>
                    </div>
                </div>}
            {page == 'vendors' &&
                <div className="flex">
                    <div className="flex-1 space-x-2 md:space-y-4 p-2 md:p-6 pt-6">
                        {/* <button className="font-bold text-md" onClick={() => setPage('categorylist')}>Add Items</button> */}
                        <div className="flex items-center pt-1 pb-4">
                            <ArrowLeft onClick={() => setPage("approve")} />
                            <h2 className="text-base pl-2 font-bold tracking-tight">Select Vendors</h2>
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
                            return <div>
                                <div className="flex m-2 justify-between">
                                    <div>
                                        <div className="text-xl font-bold py-2">{cat.name}</div>
                                        <div className="text-sm text-gray-400">Select vendors for {cat.name}</div>
                                    </div>
                                    <Sheet>
                                        <SheetTrigger className="text-blue-500">
                                            <div className="flex">
                                                <div className="text-base text-blue-400 flex" >
                                                    <CirclePlus className="w-5 h-5 mr-2" />Add Vendor</div>
                                            </div>
                                        </SheetTrigger>
                                        <SheetContent>
                                            <ScrollArea className="h-[90%] w-[600px]  p-4">
                                                <SheetHeader>
                                                    <SheetTitle>Add Vendor for {cat.name}</SheetTitle>
                                                    <SheetDescription>
                                                        <VendorForm work_package={orderData.work_package} vendor_category_mutate={vendor_category_mutate} vendor_list_mutate={vendor_list_mutate} />
                                                    </SheetDescription>
                                                </SheetHeader>
                                            </ScrollArea>
                                        </SheetContent>
                                    </Sheet>
                                </div>
                                <Select options={getCategoryByName(cat.name)} onChange={handleChange(cat.name)} isMulti />
                            </div>
                        })}
                        <div className="flex flex-col justify-end items-end">
                            {block ? <div>loading...</div> : <Button onClick={() => { handleSubmit(); setBlock(true) }}>
                                Send RFQ
                            </Button>}
                        </div>
                    </div>
                </div>}

        </MainLayout>
    )
}