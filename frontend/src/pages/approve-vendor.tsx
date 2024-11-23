import { ArrowLeft, BookOpenText, CheckCheck, ListChecks, MessageCircleMore, SendToBack, Undo2 } from 'lucide-react';
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
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import formatToIndianRupee from '@/utils/FormatPrice';
import { useUserData } from '@/hooks/useUserData';
import { TailSpin } from 'react-loader-spinner';
import { ProcurementActionsHeaderCard } from '@/components/ui/ProcurementActionsHeaderCard';

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
        render: (text) => {
            return (
                <span>{text === undefined ? "" : formatToIndianRupee(text)}</span>
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
        render: (text, record) => (
            <span style={{ fontWeight: record.unit === null ? 'bold' : 'normal' }}>
                {formatToIndianRupee(text)}
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
                {formatToIndianRupee(text)}
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

const ApproveVendor = () => {

    const { orderId } = useParams<{ orderId: string }>()
    const [project, setProject] = useState()
    const [owner, setOwner] = useState()
    const { data: pr, isLoading: pr_loading, error: pr_error, mutate: pr_mutate } = useFrappeGetDoc<ProcurementRequestsType>("Procurement Requests", orderId);
    const { data: project_data, isLoading: project_loading, error: project_error } = useFrappeGetDoc<ProjectsType>("Projects", project, project ? undefined : null);
    const { data: owner_data, isLoading: owner_loading, error: owner_error } = useFrappeGetDoc<NirmaanUsersType>("Nirmaan Users", owner, owner ? (owner === "Administrator" ? null : undefined) : null);

    const { data: usersList, isLoading: usersListLoading, error: usersListError } = useFrappeGetDocList("Nirmaan Users", {
        fields: ["name", "full_name"],
        limit: 1000
    })

    useEffect(() => {
        if (pr) {
            setProject(pr?.project)
            setOwner(pr?.modified_by)
        }
    }, [pr])

    const navigate = useNavigate()

    const getUserName = (id) => {
        if (usersList) {
            return usersList.find((user) => user?.name === id)?.full_name
        }
    }

    // console.log("within 1st component", owner_data)
    if (pr_loading || project_loading || owner_loading) return <div className="flex items-center h-full w-full justify-center"><TailSpin color={"red"} /> </div>
    if (pr_error || project_error || owner_error) return <h1>Error</h1>

    if (!["Vendor Selected", "Partially Approved"].includes(pr?.workflow_state) && !pr?.procurement_list?.list?.some((i) => i?.status === "Pending")) return (
        <div className="flex items-center justify-center h-full">
            <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center space-y-4">
                <h2 className="text-2xl font-semibold text-gray-800">
                    Heads Up!
                </h2>
                <p className="text-gray-600 text-lg">
                    Hey there, the PR:{" "}
                    <span className="font-medium text-gray-900">{pr?.name}</span>{" "}
                    is no longer available for{" "}
                    <span className="italic">Reviewing</span>. The current state is{" "}
                    <span className="font-semibold text-blue-600">
                        {pr?.workflow_state}
                    </span>{" "}
                    And the last modification was done by <span className="font-medium text-gray-900">
                        {pr?.modified_by === "Administrator" ? pr?.modified_by : getUserName(pr?.modified_by)}
                    </span>
                    !
                </p>
                <button
                    className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors duration-300"
                    onClick={() => navigate("/approve-vendor")}
                >
                    Go Back
                </button>
            </div>
        </div>
    );
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
            fields: ['name', 'vendor_name', 'vendor_address', 'vendor_gst', 'vendor_type'],
            filters: [["vendor_type", "=", "Material"]],
            limit: 1000
        });
    const { data: universalComments } = useFrappeGetDocList("Nirmaan Comments", {
        fields: ["*"],
        filters: [["reference_name", "=", pr_data.name]],
        orderBy: { field: "creation", order: "desc" }
    })
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
    const { data: quote_data } = useFrappeGetDocList("Approved Quotations",
        {
            fields: ['item_id', 'quote'],
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
        JSON.parse(newOrderData?.procurement_list)?.list?.forEach((item) => {
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
                    ?.filter(q => q.item_id === item.name && q.quote)
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
                            ?.filter(q => q.item_id === item.name && q.quote)
                            ?.map(q => q.quote);
                        let minQuote = quotesForItem?.length ? Math.min(...quotesForItem) : 0;
                        minQuote = (minQuote ? parseFloat(minQuote) * item.quantity : 0)

                        items.push({
                            item: item.item,
                            key: item.name,
                            unit: item.unit,
                            quantity: item.quantity,
                            category: item.category,
                            comment: item.comment,
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

    const { toast } = useToast();
    const userData = useUserData()
    const [isLoading, setIsLoading] = useState<string | null>(null);

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
                        tax: item.tax,
                        comment: item.comment
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

            document.getElementById("ApproveAlertClose")?.click()

            await procurement_list_mutate()
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
                    status: "Pending",
                    comment: value.comment
                };
            });

            const newCategories = Array.from(new Set(itemlist.map(item => item.category)))
                .map(name => ({ name }));

            const newSendBack = {
                procurement_request: pr_data?.name,
                project: orderData.project,
                category_list: { list: newCategories },
                item_list: { list: itemlist },
                // comments: comment,
                type: "Rejected"
            };

            if (itemlist.length > 0) {
                const res = await createDoc('Sent Back Category', newSendBack);
                if (comment) {
                    await createDoc("Nirmaan Comments", {
                        comment_type: "Comment",
                        reference_doctype: "Sent Back Category",
                        reference_name: res.name,
                        comment_by: userData?.user_id,
                        content: comment,
                        subject: "creating sent-back"
                    })
                }
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

            document.getElementById("SendBackAlertClose")?.click()

            await procurement_list_mutate()
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

    const generateActionSummary = (actionType) => {
        if (actionType === "approve") {
            const groupedVendors = selectedItems?.reduce((acc, item) => {
                const vendor = selectedVendors[item.key];
                if (vendor) {
                    if (!acc[vendor]) acc[vendor] = [];
                    acc[vendor].push(item);
                }
                return acc;
            }, {});

            if (!groupedVendors || Object.keys(groupedVendors).length === 0) {
                return "No valid items selected for approval.";
            }

            const vendorTotals = Object.entries(groupedVendors).map(([vendor, items]) => ({
                vendor,
                total: items.reduce((sum, item) => sum + (item.amount || 0), 0),
            }));
            const overallTotal = vendorTotals.reduce((sum, { total }) => sum + total, 0);

            return (
                <div>
                    <p>Upon approval, the following actions will be taken:</p>
                    <ul className="mt-2 list-disc pl-5">
                        {Object.entries(groupedVendors).map(([vendor, items]) => (
                            <li key={vendor}>
                                A <strong>new PO</strong> will be created for vendor <strong>{getVendorName(vendor)}</strong>:
                                <ul className="mt-1 list-disc pl-5">
                                    {items.map((item) => (
                                        <li key={item.key}>
                                            {item.item} - {item.quantity} {item.unit} ({formatToIndianRupee(item.amount)})
                                        </li>
                                    ))}
                                </ul>
                                <p className="mt-1 text-gray-600">
                                    Vendor Total: <strong>{formatToIndianRupee(vendorTotals.find(v => v.vendor === vendor)?.total)}</strong>
                                </p>
                            </li>
                        ))}
                    </ul>
                    <p className="mt-3 text-gray-800">
                        Overall Total: <strong>{formatToIndianRupee(overallTotal)}</strong>
                    </p>
                </div>
            );
        } else if (actionType === "sendBack") {
            const itemsToSendBack = selectedItems?.filter(item => item.unit && item.quantity);

            if (!itemsToSendBack || itemsToSendBack.length === 0) {
                return "No valid items selected for sending back.";
            }

            const totalAmount = itemsToSendBack.reduce((sum, item) => sum + (item.amount || 0), 0);

            return (
                <div>
                    <p>Upon sending back, the following actions will be taken:</p>
                    <ul className="mt-2 list-disc pl-5">
                        <li>
                            A <strong>new rejected type sent-back</strong> will be created with the following items:
                            <ul className="mt-1 list-disc pl-5">
                                {itemsToSendBack.map((item) => (
                                    <li key={item.key}>
                                        {item.item} - {item.quantity} {item.unit} ({formatToIndianRupee(item.amount)})
                                    </li>
                                ))}
                            </ul>
                            <p className="mt-1 text-gray-600">
                                Total: <strong>{formatToIndianRupee(totalAmount)}</strong>
                            </p>
                        </li>
                    </ul>
                </div>
            );
        }

        return "No valid action details available.";
    };

    return (
        <>
            {page == 'approvequotation' &&
                <div className="flex-1 md:space-y-4">
                    <div className="flex items-center pt-1  pb-4">
                        <ArrowLeft className='cursor-pointer' onClick={() => navigate("/approve-vendor")} />
                        <h2 className="text-base pl-2 font-bold tracking-tight">Approve PO: <span className="text-red-700">PR-{orderData?.name?.slice(-4)}</span></h2>
                    </div>
                    <ProcurementActionsHeaderCard orderData={orderData} po={true} />
                </div>}
            {selectedItems?.length > 0 && (
                <div className="mt-4">
                    <div className="bg-white shadow-md rounded-lg p-4 border border-gray-200">
                        <h2 className="text-lg font-bold mb-3 flex items-center">
                            <BookOpenText className="h-5 w-5 text-blue-500 mr-2" />
                            Actions Summary
                        </h2>
                        <div className="grid md:grid-cols-2 gap-4">
                            {/* Send Back Action Summary */}
                            <div className="p-3 border border-gray-300 rounded-lg bg-gray-50">
                                <div className="flex items-center mb-2">
                                    <SendToBack className="h-5 w-5 text-red-500 mr-2" />
                                    <h3 className="font-medium text-gray-700">Send Back</h3>
                                </div>
                                <p className="text-sm text-gray-600">{generateActionSummary("sendBack")}</p>
                            </div>

                            {/* Approve Action Summary */}
                            <div className="p-3 border border-gray-300 rounded-lg bg-gray-50">
                                <div className="flex items-center mb-2">
                                    <ListChecks className="h-5 w-5 text-green-500 mr-2" />
                                    <h3 className="font-medium text-gray-700">Approve</h3>
                                </div>
                                <p className="text-sm text-gray-600">{generateActionSummary("approve")}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className='overflow-x-auto pt-6'>
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
                        <Table
                            rowSelection={{ ...rowSelection, checkStrictly }}
                            dataSource={data}
                            expandable={{ defaultExpandAllRows: true }}
                            columns={columns}
                        />
                    }
                </ConfigProvider>
            </div>
            {selectedItems?.length > 0 && <div className="flex justify-end gap-2 mr-2 mt-2">
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant={"outline"} className="text-red-500 border-red-500 flex items-center gap-1">
                            <SendToBack className='w-4 h-4' />
                            Send Back
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
                                    placeholder="type here..."
                                    onChange={(e) => setComment(e.target.value)}
                                />
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        {isLoading === "newHandleSentBack" ? <div className='flex items-center justify-center'><TailSpin width={80} color='red' /> </div> : (
                            <AlertDialogFooter>
                                <AlertDialogCancel className="flex items-center gap-1">
                                    <Undo2 className="h-4 w-4" />
                                    Cancel
                                </AlertDialogCancel>
                                <Button onClick={() => newHandleSentBack()} className='flex items-center gap-1'>
                                    <CheckCheck className="h-4 w-4" />
                                    Confirm
                                </Button>
                            </AlertDialogFooter>
                        )}
                        <AlertDialogCancel id='SendBackAlertClose' className="hidden">
                            Cancel
                        </AlertDialogCancel>
                    </AlertDialogContent>
                </AlertDialog>
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant={"outline"} className='text-red-500 border-red-500 flex gap-1 items-center'>
                            <ListChecks className="h-4 w-4" />
                            Approve
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="sm:max-w-[425px]">
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you Sure</AlertDialogTitle>
                            <AlertDialogDescription>
                                Click on Confirm to Approve the Selected Items.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        {isLoading === "newHandleApprove" ? <div className='flex items-center justify-center'><TailSpin width={80} color='red' /> </div> : (
                            <AlertDialogFooter>
                                <AlertDialogCancel className="flex items-center gap-1">
                                    <Undo2 className="h-4 w-4" />
                                    Cancel
                                </AlertDialogCancel>
                                <Button onClick={() => newHandleApprove()} className='flex items-center gap-1'>
                                    <CheckCheck className="h-4 w-4" />
                                    Confirm
                                </Button>
                            </AlertDialogFooter>
                        )}
                        <AlertDialogCancel id='ApproveAlertClose' className="hidden">
                            Cancel
                        </AlertDialogCancel>
                    </AlertDialogContent>
                </AlertDialog>
            </div>}
            {/* {universalComments?.filter((comment) => ["Nirmaan Project Lead Profile", "Nirmaan Admin Profile"].includes(comment.comment_by)).length ? (
                <div className="relative py-4 px-10">
                    <h4 className="text-sm font-semibold">Comments by {universalComments?.filter((comment) => ["Nirmaan Project Lead Profile", "Nirmaan Admin Profile"].includes(comment.comment_by))[0]?.comment_by}</h4>
                    <span className="relative left-[5%] text-sm">-{universalComments?.filter((comment) => ["Nirmaan Project Lead Profile", "Nirmaan Admin Profile"].includes(comment.comment_by))[0]?.content}</span>
                </div>
            ) : ""} */}
            <div className="flex items-center py-4">
                <h2 className="text-base pl-6 font-bold tracking-tight">Delayed Items</h2>
            </div>
            <div className="overflow-x-auto">
                <div className="min-w-full inline-block align-middle">
                    {/* Group items by category */}
                    {(() => {
                        const delayedItems = JSON.parse(pr_data?.procurement_list)?.list.filter(item => item.status === "Delayed");
                        const groupedByCategory = delayedItems.reduce((acc, item) => {
                            if (!acc[item.category]) {
                                acc[item.category] = [];
                            }
                            acc[item.category].push(item);
                            return acc;
                        }, {});

                        // Render each category group
                        return Object.keys(groupedByCategory).map(category => (
                            <div key={category} className="p-5">
                                <ReactTable>
                                    <TableHeader>
                                        <TableRow className="bg-red-100">
                                            <TableHead className="w-[60%]">
                                                <span className="text-red-700 pr-1 font-extrabold">{category}</span>
                                            </TableHead>
                                            <TableHead className="w-[25%]">UOM</TableHead>
                                            <TableHead className="w-[15%]">Qty</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {groupedByCategory[category].map(item => (
                                            <TableRow key={item.item}>
                                                <TableCell>{item.item}</TableCell>
                                                <TableCell>{item.unit}</TableCell>
                                                <TableCell>{item.quantity}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </ReactTable>
                            </div>
                        ));
                    })()}
                </div>
            </div>
        </>
    )
}

export const Component = ApproveVendor;