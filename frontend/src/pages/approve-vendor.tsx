import { ArrowLeft } from 'lucide-react';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button"
import { useFrappeGetDocList, useFrappeCreateDoc, useFrappeGetDoc, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useParams, useNavigate } from "react-router-dom";
import React, { useState, useEffect, useCallback } from "react";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Table as ReactTable } from "@/components/ui/table";
import { Table, ConfigProvider } from 'antd';
import type { TableColumnsType, TableProps } from 'antd';
import { useToast } from '@/components/ui/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { ProcurementRequests as ProcurementRequestsType } from "@/types/NirmaanStack/ProcurementRequests";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { NirmaanUsers as NirmaanUsersType } from "@/types/NirmaanStack/NirmaanUsers";
import { formatDate } from '@/utils/FormatDate';

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
        key: 'item',
        render: (text, record) => {
            return (
                <span style={{ fontWeight: record.unit === null ? 'bold' : 'normal', fontStyle: record.unit !== null ? 'italic' : "normal" }}>
                    {text}
                </span>
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

const ApproveVendor = () => {

    const { orderId } = useParams<{ orderId: string }>()
    const [project, setProject] = useState()
    const [owner, setOwner] = useState()
    const { data: pr, isLoading: pr_loading, error: pr_error, mutate: pr_mutate } = useFrappeGetDoc<ProcurementRequestsType>("Procurement Requests", orderId);
    const { data: project_data, isLoading: project_loading, error: project_error } = useFrappeGetDoc<ProjectsType>("Projects", project, project ? undefined : null);
    const { data: owner_data, isLoading: owner_loading, error: owner_error } = useFrappeGetDoc<NirmaanUsersType>("Nirmaan Users", owner, owner ? (owner === "Administrator" ? null : undefined) : null);

    useEffect(() => {
        if (pr && !pr_loading) {
            setProject(pr?.project)
            setOwner(pr?.modified_by)
        }
        else {
            return
        }
    }, [pr, pr_loading, project, owner])

    console.log("within 1st component", owner_data)
    if (pr_loading || project_loading || owner_loading) return <h1>Loading...</h1>
    if (pr_error || project_error || owner_error) return <h1>Error</h1>
    return (
        <ApproveVendorPage pr_data={pr} project_data={project_data} owner_data={owner_data == undefined ? { full_name: "Administrator" } : owner_data} procurement_list_mutate={pr_mutate} />
    )
}

interface ApproveVendorPageProps {
    pr_data: ProcurementRequestsType | undefined
    project_data: ProjectsType | undefined
    owner_data: NirmaanUsersType | undefined | { full_name: String }
    procurement_list_mutate: any
}

export const ApproveVendorPage = ({ pr_data, project_data, owner_data, procurement_list_mutate }: ApproveVendorPageProps) => {
    // const { orderId } = useParams<{ orderId: string }>()
    const navigate = useNavigate()

    // const { data: procurement_request_list, isLoading: procurement_request_list_loading, mutate: procurement_list_mutate } = useFrappeGetDocList("Procurement Requests",
    //     {
    //         fields: ['name', 'category_list', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'creation'],
    //         filters: [['name', '=', orderId]],
    //         limit: 1000
    //     });
    const { data: vendor_list } = useFrappeGetDocList("Vendors",
        {
            fields: ['name', 'vendor_name', 'vendor_address', 'vendor_gst'],
            limit: 1000
        });
    // const { data: project_list } = useFrappeGetDocList("Projects",
    //     {
    //         fields: ['name', 'project_name', 'project_address', 'procurement_lead'],
    //         limit: 1000
    //     });
    const { data: quotation_request_list } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['name', 'item', 'category', 'vendor', 'procurement_task', 'quote', 'lead_time', 'quantity'],
            filters: [["status", "=", "Selected"], ["procurement_task", "=", pr_data?.name]],
            limit: 2000
        });
    const { data: quotation_request_list2 } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['name', 'item', 'category', 'vendor', 'procurement_task', 'quote', 'lead_time', 'quantity'],
            filters: [["procurement_task", "=", pr_data?.name]],
            limit: 2000
        });
    const { data: quote_data } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['item', 'quote'],
            limit: 2000
        });

    const { createDoc: createDoc, loading: createLoading } = useFrappeCreateDoc()
    const { updateDoc: updateDoc, loading: updateLoading } = useFrappeUpdateDoc()

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
    const [data, setData] = useState<DataType>([])
    const [checkStrictly, setCheckStrictly] = useState(false);
    const [selectedVendors, setSelectedVendors] = useState({})
    const [comment, setComment] = useState('')
    const [selectedItems, setSelectedItems] = useState()
    const [priceMap, setPriceMap] = useState(new Map<string, string>());

    const getPrice = (vendor: string, item: string): string | undefined => {
        const key = generateVendorItemKey(vendor, item);
        return priceMap.get(key);
    };
    useEffect(() => {

        // console.log("calling useEffect 1, priceMap")
        const newPriceMap = new Map<string, string>();
        quotation_request_list?.forEach((item) => {
            const key = generateVendorItemKey(item.vendor, item.item);
            newPriceMap.set(key, item.quote);
        });
        setPriceMap(newPriceMap);
    }, [quotation_request_list]);


    // Setting initial data
    useEffect(() => {
        // console.log("calling useEffect 2, settingOrderData and updating procurement_list and category_list");

        // if (procurement_request_list) {
        // Initial setup of orderData
        const newOrderData = pr_data;
        // Compute new procurement list and categories
        const newCategories: { name: string }[] = [];
        const newList: DataType[] = [];
        JSON.parse(newOrderData.procurement_list).list.forEach((item) => {
            if (item.status === "Pending") newList.push(item);
            if (!newCategories.some(category => category.name === item.category)) {
                newCategories.push({ name: item.category });
            }
        });

        // Update orderData with computed lists
        setOrderData(() => ({
            ...newOrderData,
            procurement_list: {
                list: newList
            },
            category_list: {
                list: newCategories
            }
        }));
        // }
    }, [pr_data]);


    useEffect(() => {
        let updatedVendors = { ...selectedVendors };
        quotation_request_list?.forEach((item) => {
            const curVendor = item.vendor;
            updatedVendors[item.item] = curVendor;
        });
        setSelectedVendors(updatedVendors);
    }, [quotation_request_list]);


    const getVendorName = (vendorName: string) => {
        return vendor_list?.find(vendor => vendor.name === vendorName)?.vendor_name;
    }
    const getVendorAddress = (vendorName: string) => {
        return vendor_list?.find(vendor => vendor.name === vendorName)?.vendor_address;
    }
    const getVendorGST = (vendorName: string) => {
        return vendor_list?.find(vendor => vendor.name === vendorName)?.vendor_gst;
    }
    // const getProjectName = (projectName: string) => {
    //     return project_list?.find(project => project.name === projectName)?.project_name;
    // }
    // const getProjectAddress = (projectName: string) => {
    //     return project_list?.find(project => project.name === projectName)?.project_address;
    // }
    const getTotal = (cat: string) => {
        return orderData.procurement_list?.list
            .filter(item => item.category === cat)
            .reduce((total, item) => {
                const price = Number(priceMap.get(`${selectedVendors[item.name]}-${item.name}`) || 0);
                return total + (price * item.quantity);
            }, 0);
    }

    const getLowest = (cat: string) => {
        let price: number = 0;
        let vendor: string = 'vendor';
        orderData.procurement_list?.list.map((item) => {
            if (item.category === cat && selectedVendors[item.name]) {
                const quotesForItem = quotation_request_list2
                    ?.filter(q => q.item === item.name && q.quote)
                    ?.map(q => q.quote);
                const minQuote = quotesForItem?.length > 0 ? Math.min(...quotesForItem) : 0;
                price += (minQuote ? parseFloat(minQuote) : 0) * item.quantity;
            }
        })
        return { quote: price, vendor: vendor }
    }

    const getLowest2 = useCallback((item: string) => {
        const quotesForItem = quotation_request_list2
            ?.filter(q => q.item === item && q.quote)
            ?.map(q => q.quote);
        return quotesForItem?.length > 0 ? Math.min(...quotesForItem) : 0;
    }, [quotation_request_list2]);

    const getLowest3 = useCallback((cat: string) => {
        let total: number = 0;
        orderData.procurement_list?.list.forEach((item) => {
            if (item.category === cat && selectedVendors[item.name]) {
                const quotesForItem = quote_data
                    ?.filter(q => q.item === item.name && q.quote)
                    ?.map(q => q.quote);
                const minQuote = quotesForItem?.length > 0 ? Math.min(...quotesForItem) : 0;
                total += (minQuote ? parseFloat(minQuote) : 0) * item.quantity;
            }
        })
        return total;
    }, [quote_data, selectedVendors, orderData.procurement_list]);

    useEffect(() => {
        // console.log("calling useEffect 5, setting column data for table")
        if (!orderData.project) return;
        const newData: DataType[] = [];
        orderData.category_list?.list.forEach((cat) => {
            const items: DataType[] = [];

            orderData.procurement_list?.list.forEach((item) => {
                if (item.category === cat.name) {
                    if (selectedVendors[item.name]) {
                        const price = Number(getPrice(selectedVendors[item.name], item.name))
                        const quotesForItem = quote_data
                            ?.filter(q => q.item === item.name && q.quote)
                            ?.map(q => q.quote);
                        let minQuote = quotesForItem?.length ? Math.min(...quotesForItem) : 0;
                        minQuote = (minQuote ? parseFloat(minQuote) * item.quantity : 0)

                        items.push({
                            item: item.item,
                            key: item.name,
                            unit: item.unit,
                            quantity: item.quantity,
                            category: item.category,
                            tax: Number(item.tax),
                            rate: price,
                            amount: price * item.quantity,
                            selectedVendor: getVendorName(selectedVendors[item.name]),
                            lowest2: getLowest2(item.name) * item.quantity,
                            lowest3: minQuote ? minQuote : "N/A",
                        });
                    }
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
        setData(newData)
    }, [orderData, selectedVendors, quote_data]);


    const rowSelection: TableRowSelection<DataType> = {
        onChange: (selectedRowKeys, selectedRows) => {
            console.log(`selectedRowKeys : ${selectedRowKeys}, selectedRows: ${selectedRows}`)
            setSelectedItems(selectedRows)
        },
        onSelect: (record, selected, selectedRows) => { },
        onSelectAll: (selected, selectedRows, changeRows) => { },
    };

    const BATCH_SIZE = 10; // Adjust the batch size based on your needs

    const createDocBatch = async (doctype, docs) => {
        const results = [];
        for (const doc of docs) {
            try {
                await createDoc(doctype, doc);
                results.push(doc);
            } catch (error) {
                console.error("Error creating document", error);
            }
        }
        return results;
    };

    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState<string | null>(null);

    console.log("selectedItems", selectedItems)

    const newHandleApprove = async () => {
        try {
            setIsLoading('newHandleApprove');

            // Filter and group items by vendor
            const filteredData = selectedItems?.filter(item => item.unit !== null && item.quantity !== null);
            const vendorItems = {};
            filteredData?.forEach((item) => {
                const currentVendor = selectedVendors[item.key];
                if (currentVendor) {
                    if (!vendorItems[currentVendor]) {
                        vendorItems[currentVendor] = [];
                    }
                    const price = Number(getPrice(selectedVendors[item.key], item.key));
                    vendorItems[currentVendor].push({
                        name: item.key,
                        quote: price,
                        quantity: item.quantity,
                        unit: item.unit,
                        item: item.item,
                        category: item.category,
                        tax: item.tax
                    });
                }
            });

            // Flatten the documents into a single array
            const docs = Object.entries(vendorItems).map(([key, value]) => ({
                procurement_request: pr_data?.name,
                project: orderData.project,
                project_name: project_data?.project_name,
                project_address: project_data?.project_address,
                vendor: key,
                vendor_name: getVendorName(key),
                vendor_address: getVendorAddress(key),
                vendor_gst: getVendorGST(key),
                order_list: { list: value }
            }));

            // Process documents in batches
            for (let i = 0; i < docs.length; i += BATCH_SIZE) {
                const batch = docs.slice(i, i + BATCH_SIZE);
                await createDocBatch('Procurement Orders', batch);
            }

            // Update item statuses and workflow state
            // const currentState = pr_data?.workflow_state;
            // const allItemsApproved = filteredData.length === orderData.procurement_list.list.length;
            // const newWorkflowState = currentState === "Vendor Selected"
            //     ? allItemsApproved ? "Vendor Approved" : "Partially Approved"
            //     : currentState;

            // Update item statuses and workflow state
            const currentState = pr_data?.workflow_state;
            const totalItems = orderData.procurement_list.list.length;
            const approvedItems = filteredData.length;
            const allItemsApproved = approvedItems === totalItems;

            // Get count of items with status "Pending"
            const pendingItemsCount = orderData.procurement_list.list.filter(item => item.status === "Pending").length;
            const onlyPendingOrApproved = orderData.procurement_list.list.every(item =>
                item.status === "Pending" || item.status === "Approved"
            );

            let newWorkflowState;

            if (currentState === "Vendor Selected" && allItemsApproved) {
                newWorkflowState = "Vendor Approved";
            } else if (
                currentState === "Partially Approved" &&
                onlyPendingOrApproved &&
                approvedItems === pendingItemsCount
            ) {
                newWorkflowState = "Vendor Approved";
            } else {
                newWorkflowState = "Partially Approved";
            }

            const updatedProcurementList = JSON.parse(pr_data?.procurement_list).list.map(item => {
                if (filteredData.some(selectedItem => selectedItem.key === item.name)) {
                    return { ...item, status: "Approved" };
                }
                return item;
            });

            const filteredList = orderData.procurement_list?.list.filter(item =>
                !filteredData.some(selectedItem => selectedItem.key === item.name)
            );

            await updateDoc('Procurement Requests', pr_data?.name, {
                procurement_list: { list: updatedProcurementList },
                workflow_state: newWorkflowState
            });

            toast({
                title: "Success!",
                description: "New PO(s) created Successfully!",
                variant: "success"
            });

            setSelectedItems(undefined)

            // Update state and navigate if all items are processed
            // setOrderData(prevOrderData => ({
            //     ...prevOrderData,
            //     procurement_list: { list: filteredList }
            // }));

            if (filteredList.length === 0) {
                navigate('/approve-vendor');
            }

            procurement_list_mutate()
        } catch (error) {
            console.error("Error approving vendor:", error);
            toast({
                title: "Failed!",
                description: "Approving Vendor Failed!",
                variant: "destructive"
            });
        } finally {
            setIsLoading(null);
        }
    };

    const newHandleSentBack = async () => {
        try {
            setIsLoading('newHandleSentBack');

            const filteredData = selectedItems?.filter(item => item.unit !== null && item.quantity !== null);
            const itemlist = filteredData.map(value => {
                const price = getPrice(selectedVendors[value.key], value.key);
                return {
                    name: value.key,
                    item: value.item,
                    quantity: value.quantity,
                    tax: Number(value.tax),
                    quote: price,
                    unit: value.unit,
                    category: value.category,
                    status: "Pending"
                };
            });

            const newCategories = Array.from(new Set(itemlist.map(item => item.category)))
                .map(name => ({ name }));

            const newSendBack = {
                procurement_request: pr_data?.name,
                project: orderData.project,
                category_list: { list: newCategories },
                item_list: { list: itemlist },
                comments: comment,
                type: "Rejected"
            };

            if (itemlist.length > 0) {
                await createDoc('Sent Back Category', newSendBack);
            }

            // Update item statuses and workflow state
            // const allItemsSentBack = filteredData.length === orderData.procurement_list.list.length;
            // const currentState = pr_data?.workflow_state;
            // const newWorkflowState = currentState === "Vendor Selected"
            //     ? "Partially Approved"
            //     : currentState;

            // Workflow state logic
            const totalItems = orderData.procurement_list.list.length;
            const sentBackItems = filteredData.length;
            const allItemsSentBack = sentBackItems === totalItems;

            const currentState = pr_data?.workflow_state;

            // Check if no items are "Approved"
            const noApprovedItems = orderData.procurement_list.list.every(item => item.status !== "Approved");

            // Count the number of "Pending" items
            const pendingItemsCount = orderData.procurement_list.list.filter(item => item.status === "Pending").length;

            let newWorkflowState;

            if (currentState === "Vendor Selected" && allItemsSentBack) {
                newWorkflowState = "Sent Back";
            } else if (noApprovedItems && sentBackItems === pendingItemsCount) {
                newWorkflowState = "Sent Back";
            } else {
                newWorkflowState = "Partially Approved";
            }

            const updatedProcurementList = JSON.parse(pr_data?.procurement_list).list.map(item => {
                if (filteredData.some(selectedItem => selectedItem.key === item.name)) {
                    return { ...item, status: "Sent Back" };
                }
                return item;
            });

            const filteredList = orderData.procurement_list?.list.filter(item =>
                !filteredData.some(selectedItem => selectedItem.key === item.name)
            );

            await updateDoc('Procurement Requests', pr_data?.name, {
                procurement_list: { list: updatedProcurementList },
                workflow_state: newWorkflowState
            });
            setSelectedItems(undefined)

            toast({
                title: "Success!",
                description: "New Sent Back created Successfully!",
                variant: "success"
            });

            // Update state and navigate if all items are processed
            // setOrderData(prevOrderData => ({
            //     ...prevOrderData,
            //     procurement_list: { list: filteredList }
            // }));

            if (filteredList.length === 0) {
                navigate('/approve-vendor');
            }

            procurement_list_mutate()
        } catch (error) {
            console.error("Error sending back items:", error);
            toast({
                title: "Failed!",
                description: "Rejecting Items Failed!",
                variant: "destructive"
            });
        } finally {
            setComment('');
            setIsLoading(null);
        }
    };


    const generateVendorItemKey = (vendor: string, item: string): string => {
        return `${vendor}-${item}`;
    };

    return (
        <>
            {page == 'approvequotation' && <div className="flex" >
                <div className="flex-1 space-x-2 md:space-y-4 p-2 md:p-6 pt-6">
                    <div className="flex items-center pt-1  pb-4">
                        <ArrowLeft className='cursor-pointer' onClick={() => navigate("/approve-vendor")} />
                        <h2 className="text-base pl-2 font-bold tracking-tight">Approve PO: <span className="text-red-700">PR-{orderData?.name?.slice(-4)}</span></h2>
                    </div>
                    <Card className="flex md:grid md:grid-cols-5 gap-4 border border-gray-100 rounded-lg p-4">
                        <div className="border-0 flex flex-col justify-center max-sm:hidden">
                            <p className="text-left py-1 font-light text-sm text-sm text-red-700">Date:</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{formatDate(orderData?.creation?.split(" ")[0])}</p>
                        </div>
                        <div className="border-0 flex flex-col justify-center">
                            <p className="text-left py-1 font-light text-sm text-sm text-red-700">Project</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{project_data?.project_name}</p>
                        </div>
                        <div className="border-0 flex flex-col justify-center max-sm:hidden">
                            <p className="text-left py-1 font-light text-sm text-sm text-red-700">Project Location</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{`${project_data?.project_city}, ${project_data?.project_state}`}</p>
                        </div>
                        <div className="border-0 flex flex-col justify-center">
                            <p className="text-left py-1 font-light text-sm text-sm text-red-700">Package</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.work_package}</p>
                        </div>
                        <div className="border-0 flex flex-col justify-center max-sm:hidden">
                            <p className="text-left py-1 font-light text-sm text-sm text-red-700">Procurement By</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{owner_data?.full_name}</p>
                        </div>
                        {/* <div className="border-0 flex flex-col justify-center max-sm:hidden">
                                <p className="text-left py-1 font-light text-sm text-sm text-red-700">PR Number</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.name?.slice(-4)}</p>
                            </div> */}
                    </Card>
                    {(orderData.project && orderData.category_list?.list.length === 0) && <div className="text-red-500 text-center text-2xl font-bold">All Done !!!</div>}
                    {/* {orderData?.category_list?.list.map((cat) => {
                        const curCategory = cat.name
                        const lowest = getLowest(cat.name);
                        let total: number = 0;
                        let count: number = 0;
                        return <div className="grid grid-cols-2 gap-4 w-full">
                            <div className="col-span-2 font-bold text-xl py-2">{cat.name} </div>
                            <Card className="flex w-full shadow-none border border-grey-500" >
                                <CardHeader className="w-full">
                                    <CardTitle>
                                        <div className="flex justify-between border-b">
                                            <div className="font-bold text-lg py-2 border-gray-200">Total</div>
                                            <div className="font-bold text-2xl text-red-500 py-2 border-gray-200">{getTotal(curCategory)}</div>
                                        </div>
                                    </CardTitle>
                                    {orderData?.procurement_list.list.map((item) => {
                                        const price = getPrice(selectedVendors[item.name], item.name);
                                        total += (price ? parseFloat(price) : 0) * (parseFloat(item.quantity));

                                        if (item.category === curCategory) {
                                            if (count >= 2) {
                                                return
                                            }
                                            count++;
                                            return <div className="flex justify-between py-2">
                                                <div className="text-sm">{item.item}</div>
                                                <div className="text-sm">{price ? price * (item.quantity) : "Delayed"}</div>
                                            </div>
                                        }
                                    })}
                                    <Dialog>
                                        <DialogTrigger asChild>
                                            <div className="text-sm text-blue-500 cursor-pointer">View All</div>
                                        </DialogTrigger>
                                        <DialogContent className="sm:max-w-[425px] md:max-w-[825px]">
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
                                                    {orderData?.procurement_list.list.map((item) => {

                                                        if (item.category === curCategory) {
                                                            const price = getPrice(selectedVendors[item.name], item.name);
                                                            total += (price ? parseFloat(price) : 0) * (item.quantity);

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
                                                                <div className="text-sm border p-2">{price ? price : "Delayed"}</div>
                                                                <div className="text-sm border p-2">{price ? price * item.quantity : "Delayed"}</div>
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
                                </CardHeader>
                            </Card>
                            <div>
                                <div className="h-[45%] p-5 rounded-lg border border-grey-500">
                                    <div className="flex justify-between">
                                        <div className="text-sm font-medium text-gray-400">Lowest Quoted Vendor</div>
                                        <div className="font-bold text-2xl text-gray-500 border-gray-200">{lowest?.quote}
                                            <div className='flex'>
                                                {
                                                    (lowest?.quote < getTotal(curCategory)) ?
                                                        <TrendingDown className="text-red-500" /> : <CheckCheck className="text-blue-500" />
                                                }
                                                <span className={`pl-2 text-base font-medium ${(lowest?.quote < getTotal(curCategory)) ? "text-red-500" : "text-blue-500"}`}>{getPercentdiff(lowest?.quote, getTotal(curCategory))}%</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="font-medium text-gray-700 text-sm">
                                        {getVendorName(lowest?.vendor)}
                                    </div>
                                </div>
                                <div className="mt-2 h-[50%] p-5 rounded-lg border border-grey-500">
                                    <div className="flex justify-between">
                                        <div className="text-sm font-medium text-gray-400">Lowest Quoted Vendor</div>
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
                            <div className="col-span-2 py-4 flex space-x-2">
                                <Sheet>
                                    <SheetTrigger className="border border-red-500 text-red-500 bg-white font-normal px-4 py-1 rounded-lg" onClick={() => handleTrigger()}>Add Comment and Send Back</SheetTrigger>
                                    <SheetContent>
                                        <SheetHeader>
                                            <ScrollArea className="h-[90%] w-[600px] rounded-md border p-4">
                                                <SheetTitle>Enter Price</SheetTitle>
                                                <SheetDescription>
                                                    Add Comments and Send Back
                                                    <div className="flex justify-between py-2">
                                                        <div className="text-sm w-[45%]">Added Items</div>
                                                        <div className="text-sm">Qty</div>
                                                        <div className="text-sm">UOM</div>
                                                        <div className="text-sm">Rate</div>
                                                        <div className="text-sm w-[15%]">3 months Lowest Rate</div>
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
                                                    {orderData?.procurement_list.list.map((item) => {
                                                        if (item.category === curCategory) {
                                                            const price = getPrice(selectedVendors[item.name], item.name);
                                                            total += price ? parseFloat(price) : 0;

                                                            const quotesForItem = quote_data
                                                                ?.filter(value => value.item === item.name && value.quote)
                                                                ?.map(value => value.quote);
                                                            let minQuote;
                                                            if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);

                                                            return <div className="flex justify-between py-2">
                                                                <div className="text-sm w-[45%] text-black font-semibold">{1 ? <input disabled={!selectedVendors[item.name] ? true : false} className="botton-0 mr-2 w-4 h-4" type="checkbox" checked={selectedItem.list.some(selected => selected.name === item.name)} onChange={() => handleCheckboxChange(item.name)} /> : " "}{item.item}</div>
                                                                <div className="text-sm text-black font-semibold">{item.quantity}</div>
                                                                <div className="text-sm text-black font-semibold">{item.unit}</div>
                                                                <div className="text-sm text-black font-semibold">{price ? price : "Delayed"}</div>
                                                                <div className="text-sm text-black font-semibold w-[15%]">{minQuote ? minQuote : "N/A"}</div>
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
                                                    <div className="flex flex-col justify-end items-end bottom-4 right-4 pt-10">
                                                        {comment ?
                                                            <SheetClose><Button onClick={() => handleSendBack(curCategory)}>Submit</Button></SheetClose>
                                                            :
                                                            <Button disabled={true} >Submit</Button>
                                                        }

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
                    })} */}
                    {/* {orderData.category_list?.list.length === total_categories ? <div className="flex space-x-2 justify-end items-end bottom-4 right-4">
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
                                <Button variant="secondary" onClick={() => handleApproveAll()}>Confirm</Button>
                            </DialogContent>
                        </Dialog>
                    </div> :
                        ((orderData.project && orderData.category_list.list.length === 0) && <div className="flex space-x-2 justify-center items-center bottom-4 right-4">
                            {(update_loading || loading) ? <div>Loading...</div> : <Button onClick={() => handleDone()}>
                                Done
                            </Button>}
                        </div>)
                    } */}
                </div>
            </div>}
            {/* <Space align="center" style={{ marginBottom: 16 }}>
                CheckStrictly: <Switch checked={checkStrictly} onChange={setCheckStrictly} />
            </Space> */}
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
                {data.length > 0 &&
                    <div className='px-6'>
                        <Table
                            rowSelection={{ ...rowSelection, checkStrictly }}
                            dataSource={data}
                            expandable={{ defaultExpandAllRows: true }}
                            columns={columns}
                        />
                    </div>
                }
            </ConfigProvider>
            {selectedItems?.length > 0 && <div className="text-right space-x-2 mr-6">
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button className="text-red-500 bg-white border border-red-500 hover:text-white cursor-pointer">
                            {(isLoading && isLoading === "newHandleSentBack") ? "Sending Back..." : "Send Back"}
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="sm:max-w-[425px]">
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you Sure</AlertDialogTitle>
                            <AlertDialogDescription>
                                Add Comments and Send Back the Selected Items.
                                <div className="py-2"><label htmlFor="textarea" >Comment:</label></div>
                                <textarea
                                    id="textarea"
                                    className="w-full border rounded-lg p-2"
                                    value={comment}
                                    placeholder="Type your comments here"
                                    onChange={(e) => setComment(e.target.value)}
                                />
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => newHandleSentBack()}>Send Back</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button className='text-red-500 bg-white border border-red-500 hover:text-white cursor-pointer'>
                            {(isLoading && isLoading === "newHandleApprove") ? "Approving..." : "Approve"}
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="sm:max-w-[425px]">
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you Sure</AlertDialogTitle>
                            <AlertDialogDescription>
                                Click on Confirm to Approve the Selected Items.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => newHandleApprove()}>Approve</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>}
            <div className="flex items-center pt-1  pb-4">
                <h2 className="text-base pl-6 font-bold tracking-tight">Delayed Items</h2>
            </div>
            <div className="overflow-x-auto">
                <div className="min-w-full inline-block align-middle">
                    {JSON.parse(pr_data?.procurement_list).list.map(item => {
                        if (item.status === "Delayed") {
                            return <div className="p-5">
                                <ReactTable>
                                    <TableHeader>
                                        <TableRow className="bg-red-100">
                                            <TableHead className="w-[60%]"><span className="text-red-700 pr-1 font-extrabold">{item.category}</span>(Items)</TableHead>
                                            <TableHead className="w-[25%]">UOM</TableHead>
                                            <TableHead className="w-[15%]">Qty</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {/* {orderData.procurement_list?.list.map((item) => {
                                        if (item.category === cat.name) {
                                            if(!selectedVendors[item.name]){return (
                                                <TableRow key={item.item}>
                                                    <TableCell>{item.item}</TableCell>
                                                    <TableCell>{item.unit}</TableCell>
                                                    <TableCell>{item.quantity}</TableCell>
                                                </TableRow>
                                            )}
                                        }
                                    })} */}
                                        <TableRow key={item.item}>
                                            <TableCell>{item.item}</TableCell>
                                            <TableCell>{item.unit}</TableCell>
                                            <TableCell>{item.quantity}</TableCell>
                                        </TableRow>

                                    </TableBody>
                                </ReactTable>
                            </div>
                        }
                        // else {
                        //     return <div className='flex justify-center text-gray-400 tracking-tight my-4'>No delayed items</div>
                        // }
                    })}
                </div>
            </div>
        </>
    )
}

export const Component = ApproveVendor;