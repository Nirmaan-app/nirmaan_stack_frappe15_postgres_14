import { ArrowLeft, CheckCheck, ListChecks, SendToBack, Undo2 } from 'lucide-react';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button"
import { useFrappeGetDocList, useFrappeGetDoc, useFrappeCreateDoc, useFrappeUpdateDoc, useSWRConfig } from "frappe-react-sdk";
import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { Table, ConfigProvider } from 'antd';
import type { TableColumnsType, TableProps } from 'antd';
import { useToast } from '@/components/ui/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { formatDate } from '@/utils/FormatDate';
import { SentBackCategory as SentBackCategoryType } from '@/types/NirmaanStack/SentBackCategory';
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { NirmaanUsers as NirmaanUsersType } from "@/types/NirmaanStack/NirmaanUsers";
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

const ApproveSentBack = () => {

    const { sbId : id } = useParams<{ sbId: string }>()
    const [project, setProject] = useState()
    const [owner, setOwner] = useState()
    const { data: sb, isLoading: sb_loading, error: sb_error, mutate: sb_mutate } = useFrappeGetDoc<SentBackCategoryType>("Sent Back Category", id);
    const { data: project_data, isLoading: project_loading, error: project_error } = useFrappeGetDoc<ProjectsType>("Projects", project, project ? undefined : null);
    const { data: owner_data, isLoading: owner_loading, error: owner_error } = useFrappeGetDoc<NirmaanUsersType>("Nirmaan Users", owner, owner ? (owner === "Administrator" ? null : undefined) : null);

    const { data: usersList, isLoading: usersListLoading, error: usersListError } = useFrappeGetDocList("Nirmaan Users", {
        fields: ["name", "full_name"],
        limit: 1000
    })

    useEffect(() => {
        if (sb) {
            setProject(sb?.project)
            setOwner(sb?.modified_by)
        }
    }, [sb])

    const navigate = useNavigate()

    const getUserName = (id) => {
        if (usersList) {
            return usersList.find((user) => user?.name === id)?.full_name
        }
    }

    if (sb_loading || project_loading || owner_loading) return <div className="flex items-center h-[90vh] w-full justify-center"><TailSpin color={"red"} /> </div>
    if (sb_error || project_error || owner_error) return <h1>Error</h1>
    if (!["Vendor Selected", "Partially Approved"].includes(sb?.workflow_state) && !sb?.item_list?.list?.some((i) => i?.status === "Pending")) return (
        <div className="flex items-center justify-center h-screen">
            <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center space-y-4">
                <h2 className="text-2xl font-semibold text-gray-800">
                    Heads Up!
                </h2>
                <p className="text-gray-600 text-lg">
                    Hey there, the SB:{" "}
                    <span className="font-medium text-gray-900">{sb?.name}</span>{" "}
                    is no longer available for{" "}
                    <span className="italic">Reviewing</span>. The current state is{" "}
                    <span className="font-semibold text-blue-600">
                        {sb?.workflow_state}
                    </span>{" "}
                    And the last modification was done by <span className="font-medium text-gray-900">
                        {sb?.modified_by === "Administrator" ? sb?.modified_by : getUserName(sb?.modified_by)}
                    </span>
                    !
                </p>
                <button
                    className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors duration-300"
                    onClick={() => navigate("/approve-po")}
                >
                    Go Back
                </button>
            </div>
        </div>
    );
    return (
        <ApproveSentBackPage sb_data={sb} project_data={project_data} owner_data={owner_data == undefined ? { full_name: "Administrator" } : owner_data} sent_back_list_mutate={sb_mutate} />
    )
}

interface ApproveSentBackPageProps {
    sb_data: SentBackCategoryType | undefined
    project_data: ProjectsType | undefined
    owner_data: NirmaanUsersType | undefined | { full_name: String }
    sent_back_list_mutate: any
}


const ApproveSentBackPage = ({ sb_data, project_data, owner_data, sent_back_list_mutate }: ApproveSentBackPageProps) => {
    // const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()

    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error } = useFrappeGetDocList("Vendors",
        {
            fields: ['name', 'vendor_name', 'vendor_address', 'vendor_gst', 'vendor_type'],
            filters: [["vendor_type", "=", "Material"]],
            limit: 200
        });
    // const { data: project_list, isLoading: project_list_loading, error: project_list_error } = useFrappeGetDocList("Projects",
    //     {
    //         fields: ['name', 'project_name', 'project_address'],
    //         limit: 1000
    //     });
    // const { data: sent_back_list, isLoading: sent_back_list_loading, error: sent_back_list_error, mutate: sent_back_list_mutate } = useFrappeGetDocList("Sent Back Category",
    //     {
    //         fields: ["*"],
    //         filters: [["name", "=", id]],
    //         limit: 1000
    //     });

    const { data: quote_data } = useFrappeGetDocList("Approved Quotations",
        {
            fields: ['item_id', 'quote'],
            limit: 2000
        });


    const [orderData, setOrderData] = useState({
        project_name: '',
        category: ''
    })

    const [data, setData] = useState<DataType>([])
    const [checkStrictly, setCheckStrictly] = useState(false);

    useEffect(() => {
        // if (sent_back_list) {
        const newOrderData = sb_data;
        const newCategories: { name: string }[] = [];
        const newList: DataType[] = [];
        JSON.parse(newOrderData?.item_list)?.list?.forEach((item) => {
            if (item.status === "Pending") newList.push(item);
            if (!newCategories.some(category => category.name === item.category)) {
                newCategories.push({ name: item.category });
            }
        });

        setOrderData(() => ({
            ...newOrderData,
            item_list: {
                list: newList
            },
            category_list: {
                list: newCategories
            }
        }));
        // }
    }, [sb_data]);

    useEffect(() => {
        if (orderData.project) {
            const newData: DataType[] = [];
            orderData.category_list?.list?.forEach((cat) => {
                const items: DataType[] = [];

                orderData.item_list?.list?.forEach((item) => {
                    if (item.category === cat.name) {
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
                            quantity: item.quantity,
                            category: item.category,
                            tax: Number(item.tax),
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
            setData(newData)
        }
    }, [orderData, vendor_list, quote_data]);

    const [selectedItems, setSelectedItems] = useState()

    const rowSelection: TableRowSelection<DataType> = {
        onChange: (selectedRowKeys, selectedRows) => {
            // console.log(`selectedRowKeys: ${selectedRowKeys}`, 'selectedRows: ', selectedRows);
            setSelectedItems(selectedRows)
        },
        onSelect: (record, selected, selectedRows) => {
        },
        onSelectAll: (selected, selectedRows, changeRows) => {
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
    // const getProjectName = (projectName: string) => {
    //     return project_list?.find(project => project.name === projectName)?.project_name;
    // }
    // const getProjectAddress = (projectName: string) => {
    //     return project_list?.find(project => project.name === projectName)?.project_address;
    // }

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    const { updateDoc: updateDoc, loading: update_loading, isCompleted: update_submit_complete, error: update_submit_error } = useFrappeUpdateDoc()

    const { toast } = useToast()
    const [isLoading, setIsLoading] = useState<string | null>(null);

    const BATCH_SIZE = 10;

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

    const { mutate } = useSWRConfig()
    const userData = useUserData()

    const newHandleApprove = async () => {
        try {
            setIsLoading('newHandleApprove');
            const filteredData = selectedItems?.filter(item => {
                return item.unit !== null && item.quantity !== null
            });

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
                        category: item.category,
                        tax: item.tax,
                        unit: item.unit,
                        item: item.item
                    });
                }

            })
            // console.log("vendorItems", vendorItems)
            const docs = Object.entries(vendorItems)?.flatMap(([key, value]) => {

                const newProcurementOrder = {
                    procurement_request: orderData.procurement_request,
                    project: orderData.project,
                    project_name: project_data?.project_name,
                    project_address: project_data?.project_address,
                    vendor: getVendorId(key),
                    vendor_name: key,
                    vendor_address: getVendorAddress(getVendorId(key)),
                    vendor_gst: getVendorGST(getVendorId(key)),
                    order_list: {
                        list: value
                    }
                };

                return newProcurementOrder

            });

            for (let i = 0; i < docs.length; i += BATCH_SIZE) {
                const batch = docs.slice(i, i + BATCH_SIZE);
                await createDocBatch('Procurement Orders', batch);
            }

            // const currentState = sb_data?.workflow_state;
            // const allItemsApproved = filteredData.length === orderData.item_list.list.length;
            // const newWorkflowState = currentState === "Vendor Selected"
            //     ? allItemsApproved ? "Approved" : "Partially Approved"
            //     : currentState;

            // Update item statuses and workflow state
            const currentState = sb_data?.workflow_state;
            const totalItems = orderData.item_list.list.length;
            const approvedItems = filteredData.length;
            const allItemsApproved = approvedItems === totalItems;

            // Get count of items with status "Pending"
            const pendingItemsCount = orderData.item_list.list.filter(item => item.status === "Pending").length;
            const onlyPendingOrApproved = orderData.item_list.list.every(item =>
                item.status === "Pending" || item.status === "Approved"
            );

            let newWorkflowState;

            if (currentState === "Vendor Selected" && allItemsApproved) {
                newWorkflowState = "Approved";
            } else if (
                currentState === "Partially Approved" &&
                onlyPendingOrApproved &&
                approvedItems === pendingItemsCount
            ) {
                newWorkflowState = "Approved";
            } else {
                newWorkflowState = "Partially Approved";
            }

            const updatedItemList = JSON.parse(sb_data?.item_list).list.map(item => {
                if (filteredData.some(selectedItem => selectedItem.key === item.name)) {
                    return { ...item, status: "Approved" };
                }
                return item;
            });

            const filteredList = orderData.item_list?.list.filter(procItem =>
                !filteredData.some(setItem => setItem.key === procItem.name)
            );

            await updateDoc('Sent Back Category', sb_data?.name, {
                item_list: { list: updatedItemList },
                workflow_state: newWorkflowState,
            })

            toast({
                title: "Success!",
                description: "New PO(s) created Successfully!",
                variant: "success"
            });

            setSelectedItems(undefined)
            mutate("Sent Back Category(filters,in,Vendor Selected, Partially Approved)");
            sent_back_list_mutate()

            if (filteredList.length === 0) {
                navigate("/approve-sent-back")
            }

            document.getElementById("ApproveAlertClose")?.click()
        } catch (error) {
            console.log("error in newHandleApprove", error)
            toast({
                title: "Failed!",
                description: "Approving Items Failed!",
                variant: "destructive"
            });
        } finally {
            setIsLoading(null);
        }

    }

    const newHandleSentBack = async () => {
        try {
            setIsLoading('newHandleSentBack');
            const filteredData = selectedItems?.filter(item => {
                return item.unit !== null && item.quantity !== null
            });
            // console.log(filteredData)

            const itemList = [];
            filteredData?.map((value) => {
                // const price = getPrice(value.selectedVendor, value.key);
                itemList.push({
                    name: value.key,
                    item: value.item,
                    quantity: value.quantity,
                    quote: value.rate,
                    unit: value.unit,
                    tax: value.tax,
                    status: "Pending",
                    category: value.category
                })
            })

            const newCategories = Array.from(new Set(itemList.map(item => item.category)))
                .map(name => ({ name }));


            const newSendBack = {
                procurement_request: orderData.procurement_request,
                project: orderData.project,
                category_list: {
                    list: newCategories
                },
                item_list: {
                    list: itemList
                },
                // comments: comment,
                type: "Rejected"
            }

            if (itemList.length > 0) {
                const res = await createDoc("Sent Back Category", newSendBack)
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

            // const currentState = sb_data?.workflow_state;
            // const newWorkflowState = currentState === "Vendor Selected" && itemList.length > 0
            //     ? "Partially Approved"
            //     : currentState;

            // Workflow state logic
            const totalItems = orderData.item_list.list.length;
            const sentBackItems = filteredData.length;
            const allItemsSentBack = sentBackItems === totalItems;

            const currentState = sb_data?.workflow_state;

            // Check if no items are "Approved"
            const noApprovedItems = orderData.item_list.list.every(item => item.status !== "Approved");

            // Count the number of "Pending" items
            const pendingItemsCount = orderData.item_list.list.filter(item => item.status === "Pending").length;

            let newWorkflowState;

            if (currentState === "Vendor Selected" && allItemsSentBack) {
                newWorkflowState = "Sent Back";
            } else if (noApprovedItems && sentBackItems === pendingItemsCount) {
                newWorkflowState = "Sent Back";
            } else {
                newWorkflowState = "Partially Approved";
            }

            const updatedItemList = JSON.parse(sb_data?.item_list).list.map(item => {
                if (filteredData.some(selectedItem => selectedItem.key === item.name)) {
                    return { ...item, status: "Sent Back" };
                }
                return item;
            });

            const filteredList = orderData.item_list?.list.filter(procItem =>
                !filteredData.some(selItem => selItem.key === procItem.name)
            );

            await updateDoc('Sent Back Category', sb_data?.name, {
                item_list: { list: updatedItemList },
                workflow_state: newWorkflowState
            });

            setSelectedItems(undefined)

            toast({
                title: "Success!",
                description: "New Sent Back created Successfully!",
                variant: "success"
            });

            mutate("Sent Back Category(filters,in,Vendor Selected,Partially Approved)");
            sent_back_list_mutate()

            if (filteredList.length === 0) {
                navigate("/approve-sent-back")
            }

            document.getElementById("SendBackAlertClose")?.click()
        } catch (error) {
            console.log("error in newHandleSentBack", error)
            toast({
                title: "Failed!",
                description: "Rejecting Items Failed!",
                variant: "destructive"
            });
        } finally {
            setComment('');
            setIsLoading(null);
        }
    }

    // useEffect(() => {
    //     const newCategories = [];
    //     orderData?.item_list?.list.map((item) => {
    //         const isDuplicate = newCategories.some(category => category.name === item.category);
    //         if (!isDuplicate) {
    //             newCategories.push({ name: item.category })
    //         }
    //     })
    //     setOrderData((prevState) => ({
    //         ...prevState,
    //         category_list: {
    //             list: newCategories
    //         },
    //     }));
    // }, [orderData]);


    const getTotal = (cat: string) => {
        let total: number = 0;
        orderData.item_list?.list.map((item) => {
            if (item.category === cat) {
                const price = item.quote;
                total += (price ? parseFloat(price) : 0) * item.quantity
            }
        })
        return total
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

    return (
        <div className="flex-1 space-y-4">
                <div className="flex-1 space-y-4">
                    <div className="flex items-center">
                        {/* <ArrowLeft className='cursor-pointer' onClick={() => { navigate('/approve-sent-back') }} /> */}
                        <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">Approve/Send-Back <span className="italic">{orderData?.type} SB-{orderData?.name?.slice(-4)}</span></h2>
                    </div>
                    {/* <Card className="flex flex-wrap lg:grid lg:grid-cols-5 gap-4 border border-gray-100 rounded-lg p-4">
                        <div className="border-0 flex flex-col justify-center max-sm:hidden">
                            <p className="text-left py-1 font-light text-sm text-sm text-red-700">PR ID:</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.procurement_request?.slice(-4)}</p>
                        </div>
                        <div className="border-0 flex flex-col justify-center max-sm:hidden">
                            <p className="text-left py-1 font-light text-sm text-sm text-red-700">Date:</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{formatDate(orderData?.creation?.split(" ")[0])}</p>
                        </div>
                        <div className="border-0 flex flex-col justify-center">
                            <p className="text-left py-1 font-light text-sm text-sm text-red-700">Project:</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{project_data?.project_name}</p>
                        </div>
                        <div className="border-0 flex flex-col justify-center max-sm:hidden">
                            <p className="text-left py-1 font-light text-sm text-sm text-red-700">Project Location</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{`${project_data?.project_city}, ${project_data?.project_state}`}</p>
                        </div>
                        <div className="border-0 flex flex-col justify-center max-sm:hidden">
                            <p className="text-left py-1 font-light text-sm text-sm text-red-700">Procurement by</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{owner_data?.full_name}</p>
                        </div>
                    </Card> */}
                    <ProcurementActionsHeaderCard orderData={orderData} sentBack={true} />
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
                    {data.length > 0 &&
                        <Table
                            dataSource={data}
                            rowSelection={{ ...rowSelection, checkStrictly }}
                            expandable={{ defaultExpandAllRows: true }}
                            columns={columns}
                        />
                    }
                </ConfigProvider>
            </div>
            {selectedItems?.length > 0 && <div className="flex justify-end mr-2 gap-2 mt-2">
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
                                    Cancel</AlertDialogCancel>
                                <Button onClick={() => newHandleSentBack()} className="flex items-center gap-1">
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
                                    Cancel</AlertDialogCancel>
                                <Button onClick={() => newHandleApprove()} className="flex items-center gap-1">
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
        </div>
    )
}

export const Component = ApproveSentBack;