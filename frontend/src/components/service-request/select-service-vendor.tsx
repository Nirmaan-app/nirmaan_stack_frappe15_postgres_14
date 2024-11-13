import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects"
import { ServiceRequests as ServiceRequestsType } from "@/types/NirmaanStack/ServiceRequests"
import { useFrappeCreateDoc, useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc, useSWRConfig } from "frappe-react-sdk"
import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { NewPRSkeleton } from "../ui/skeleton"
import { NirmaanUsers as NirmaanUsersType } from "@/types/NirmaanStack/NirmaanUsers"
import { NirmaanComments as NirmaanCommentsType } from "@/types/NirmaanStack/NirmaanComments"
import { ArrowBigUpDash, ArrowLeft, CheckCheck, CirclePlus, Settings2, Undo2 } from "lucide-react"
import { ProcurementHeaderCard } from "../ui/ProcurementHeaderCard"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table"
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar"
import { formatDate } from "@/utils/FormatDate"
import Select from 'react-select'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "../ui/sheet"
import { NewVendor } from "@/pages/vendors/new-vendor"
import { Button } from "../ui/button"
import { Table as AntTable, ConfigProvider, TableColumnsType } from "antd"
import formatToIndianRupee from "@/utils/FormatPrice"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog"
import { Textarea } from "../ui/textarea"
import { useUserData } from "@/hooks/useUserData"
import { toast } from "../ui/use-toast"
import { TailSpin } from "react-loader-spinner"

const SelectServiceVendor = () => {
    const { id }: any = useParams()
    const [project, setProject] = useState<string>()

    const { data: sr_data, isLoading: sr_data_loading, error: sr_data_error } = useFrappeGetDoc<ServiceRequestsType>("Service Requests", id)

    useEffect(() => {
        if (sr_data) {
            setProject(sr_data?.project)
        }
    }, [sr_data])

    const { data: project_data, isLoading: project_loading, error: project_error } = useFrappeGetDoc<ProjectsType>("Projects", project)

    const { data: usersList, isLoading: userLoading, error: userError } = useFrappeGetDocList<NirmaanUsersType>("Nirmaan Users", {
        fields: ["*"],
        limit: 1000,
    })

    const { data: universalComments, isLoading: universalCommentsLoading, error: universalCommentsError } = useFrappeGetDocList<NirmaanCommentsType>("Nirmaan Comments", {
        fields: ["*"],
        limit: 1000,
        filters: [["reference_name", "=", id]],
        orderBy: { field: "creation", order: "desc" }
    })

    console.log("universalComments", universalComments)

    return (
        <>  {(sr_data_loading || project_loading || userLoading || universalCommentsLoading) ? <NewPRSkeleton /> : <SelectServiceVendorPage sr_data={sr_data} project_data={project_data} universalComments={universalComments} usersList={usersList} />}
            {(sr_data_error || project_error || userError || universalCommentsError) && <h1>Error</h1>}
        </>
    )
};

interface SelectServiceVendorPageProps {
    sr_data: ServiceRequestsType | undefined
    project_data?: ProjectsType | undefined
    usersList?: NirmaanUsersType[] | undefined
    universalComments: NirmaanCommentsType[] | undefined
    resolve?: boolean
    setPage?: any
}

interface DataType {
    key: React.ReactNode;
    category: string | null;
    description: string;
    rate: number | null;
    selectedVendor: string;
    amount: number;
    children?: DataType[];
}

export const SelectServiceVendorPage = ({ sr_data, project_data, usersList, universalComments, resolve = false, setPage }: SelectServiceVendorPageProps) => {

    const navigate = useNavigate()
    const userData = useUserData()

    const [comment, setComment] = useState<any>(null)
    const [section, setSection] = useState('choose-vendor')
    const [vendorOptions, setVendorOptions] = useState<{ label: string; value: string }[]>([]);
    const [selectedVendor, setSelectedvendor] = useState()
    const [amounts, setAmounts] = useState<{ [key: string]: string }>({}); // New state for amounts
    const [order, setOrder] = useState(JSON.parse(sr_data?.service_order_list).list);
    const [isNextEnabled, setIsNextEnabled] = useState(false);
    const [expandedRowKeys, setExpandedRowKeys] = useState([]);

    console.log("sr_data", JSON.parse(sr_data?.service_order_list))

    const groupedData = useMemo(() => {
        return order?.reduce((acc, item) => {
            acc[item.category] = acc[item.category] || [];
            acc[item.category].push(item);
            return acc;
        }, {});
    }, [order]);

    console.log("groupedData, ", groupedData)

    useEffect(() => {
        if (groupedData) {
            setExpandedRowKeys(Object.keys(groupedData));
        }
    }, [groupedData]);

    // Main table columns
    const columns = [
        {
            title: "Service",
            dataIndex: "category",
            key: "category",
            width: "55%",
            render: (text) => <strong className="text-primary">{text}</strong>,
        },
        {
            title: "Selected Vendor",
            key: "vendor",
            width: "45%",
            render: () => <span className="font-semibold text-primary">{selectedVendor?.label}</span>,
        },
    ];

    // Inner table columns
    const innerColumns = [
        {
            title: "Description",
            dataIndex: "description",
            key: "description",
            width: "60%",
            render: (text) => <span className="italic">{text}</span>
        },
        {
            title: "Unit",
            dataIndex: "uom",
            key: "uom",
            width: "10%",
            render: (text) => <span>{text}</span>,
        },
        {
            title: "Quantity",
            dataIndex: "quantity",
            key: "quantity",
            width: "10%",
            render: (text) => <span>{text}</span>,
        },
        {
            title: "Rate",
            dataIndex: "rate",
            key: "rate",
            width: "10%",
            render: (text) => <span className="italic">{formatToIndianRupee(text)}</span>,
        },
        {
            title: "Amount",
            dataIndex: "amount",
            key: "amount",
            width: "10%",
            render: (text, record) => <span className="italic">{formatToIndianRupee(record.rate * record.quantity)}</span>,
        },
        // {
        //     title: "Amt inc. tax",
        //     dataIndex: "amount",
        //     key: "amountinctax",
        //     width: "20%",
        //     render: (text) => <span className="italic">{formatToIndianRupee(parseFloat(text) * 1.18)}</span>,
        // },
    ];

    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error, mutate: vendor_list_mutate } = useFrappeGetDocList("Vendors",
        {
            fields: ["*"],
            filters: [['vendor_type', '=', 'Service']],
            limit: 10000
        },
        "Vendors"
    );

    useEffect(() => {
        if (vendor_list) {
            const currOptions = vendor_list?.map((item) => ({
                value: item.name,
                label: item.vendor_name
            }))
            setVendorOptions(currOptions);
        }
    }, [vendor_list]);

    const { mutate } = useSWRConfig()
    const { createDoc: createDoc, loading: create_loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    const { updateDoc: updateDoc, loading: update_loading, isCompleted: update_complete, error: update_error } = useFrappeUpdateDoc()

    // const { data: category_list, isLoading: category_list_loading, error: category_list_error } = useFrappeGetDocList("Category",
    //     {
    //         fields: ['category_name', 'work_package'],
    //         orderBy: { field: 'category_name', order: 'asc' },
    //         limit: 100,
    //         filters: [['work_package', '=', 'Services']]
    //     });

    // useEffect(() => {
    //     if (universalComments) {
    //         const comment = universalComments?.find((cmt) => cmt.subject === "approving sr")
    //         setComment(comment)
    //     }
    // }, [universalComments])

    // const getTotal = (cat: string) => {
    //     let total: number = 0;
    //     order.map((item) => {
    //         if (item.category === cat) {
    //             const price = item.amount;
    //             total += (price ? parseFloat(price) : 0) * 1.18;
    //         }
    //     })
    //     return total
    // }

    // useEffect(() => {
    //     if (sr_data?.project) {
    //         const newData: DataType[] = [];
    //         console.log(JSON.parse(sr_data.service_category_list).list)
    //         JSON.parse(sr_data.service_category_list).list.map((cat: any) => {
    //             const items: DataType[] = [];
    //             console.log(order)
    //             order.forEach((item: any) => {
    //                 if (item.category === cat.name) {
    //                     items.push({
    //                         description: item.description,
    //                         key: item.description,
    //                         category: item.category,
    //                         rate: item.amount,
    //                         amount: item.amount * 1.18,
    //                         selectedVendor: selectedVendor ? selectedVendor : "",
    //                     });
    //                 }
    //             });

    //             if (items.length) {
    //                 const node: DataType = {
    //                     description: cat.name,
    //                     key: cat.name,
    //                     category: null,
    //                     rate: null,
    //                     amount: getTotal(cat.name),
    //                     selectedVendor: selectedVendor ? selectedVendor : "",
    //                     children: items,
    //                 };
    //                 newData.push(node);
    //             }
    //         });
    //         setData(newData)
    //     }
    // }, [order, selectedVendor]);

    const getFullName = (id: any) => {
        return usersList?.find((user) => user?.name == id)?.full_name
    }

    const handleChange = () => (vendor: any) => {
        setSelectedvendor(vendor)
    }

    const handleAmountChange = (id: string, value: string) => {
        const numericValue = value.replace(/₹\s*/, '');
        setAmounts((prev) => ({ ...prev, [id]: numericValue }));
    };

    // console.log("amounts", amounts)

    const handleSaveAmounts = () => {
        console.log("Amounts to save:", amounts);
        let newOrderData = []
        for (let item of order) {
            console.log("item", item)
            let entry: any = {}
            entry.id = item.id
            entry.category = item.category
            entry.description = item.description
            entry.uom = item.uom
            entry.quantity = item.quantity
            entry.rate = amounts[item.id] || 0
            newOrderData.push(entry)
        }
        setOrder(newOrderData)
        setSection('summary')
    };

    useEffect(() => {
        const allAmountsFilled = Object.values(amounts).every((amount) =>
            amount && parseFloat(amount) > 0
        );
        const allAmountsCount = Object.keys(amounts)?.length === order?.length
        setIsNextEnabled(allAmountsFilled && allAmountsCount);
    }, [amounts]);

    useEffect(() => {
        if ((resolve || sr_data?.status === "Rejected") && vendor_list) {
            const vendor = vendor_list?.find((ven) => ven?.name === sr_data?.vendor)
            const selectedVendor = { value: vendor?.name, label: vendor?.vendor_name }
            setSelectedvendor(selectedVendor)
        }
        if ((resolve || sr_data?.status === "Rejected")) {
            let amounts = {}
            JSON.parse(sr_data?.service_order_list)?.list?.forEach((item) => {
                amounts = { ...amounts, [item.id]: item?.rate }
            })
            setAmounts(amounts)
        }
    }, [resolve, sr_data, vendor_list])

    console.log("amounts", amounts)
    console.log("sr_data", sr_data)

    // console.log("selected vendor", selectedVendor)

    const handleSubmit = async () => {
        try {
            if (comment) {
                await createDoc("Nirmaan Comments", {
                    comment_type: "Comment",
                    reference_doctype: "Service Requests",
                    reference_name: sr_data?.name,
                    comment_by: userData?.user_id,
                    content: comment,
                    subject: "sending sr for appr"
                })
            }
            await updateDoc("Service Requests", sr_data?.name, {
                vendor: selectedVendor?.value,
                service_order_list: { list: order },
                status: "Vendor Selected"
            })

            toast({
                title: "Success!",
                description: `Services Sent for Approval`,
                variant: "success",
            });

            navigate("/select-service-vendor");
        } catch (error) {
            toast({
                title: "Failed!",
                description: `Unable to send services for approval`,
                variant: "destructive",
            });
            console.log("error while sending SR for approval", error)
        }
    }

    const handleResolveSR = async () => {
        try {
            if (comment) {
                await createDoc("Nirmaan Comments", {
                    comment_type: "Comment",
                    reference_doctype: "Service Requests",
                    reference_name: sr_data?.name,
                    comment_by: userData?.user_id,
                    content: comment,
                    subject: "resolving sr"
                })
            }
            await updateDoc("Service Requests", sr_data?.name, {
                vendor: selectedVendor?.value,
                service_order_list: { list: order },
                status: "Vendor Selected"
            })

            await mutate(`Service Requests ${sr_data?.name}`)

            toast({
                title: "Success!",
                description: `SR: ${sr_data?.name} successfully resolved and sent for approval`,
                variant: "success",
            });
            setPage("Summary")

        } catch (error) {
            toast({
                title: "Failed!",
                description: `Unable to resolve SR: ${sr_data?.name}`,
                variant: "destructive",
            });
            console.log("error while resolving SR", error)
        }
    }

    // console.log("selectedVendor", selectedVendor)

    // console.log("orderData", order)

    return (
        <>
            {section === 'choose-vendor' && <>
                <div className="flex-1 md:space-y-4">
                    <div className="flex items-center pt-1 pb-4">
                        <ArrowLeft className='cursor-pointer' onClick={() => {
                            if (resolve) {
                                setPage("Summary")
                            } else {
                                navigate(-1)
                            }
                        }} />
                        {resolve ? (
                            <h2 className="text-base pl-2 font-bold tracking-tight">Resolve: <span className="text-red-700">SR-{sr_data?.name?.slice(-4)}</span></h2>
                        ) : (
                            <h2 className="text-base pl-2 font-bold tracking-tight"><span className="text-red-700">SR-{sr_data?.name?.slice(-4)}</span>: Choose Service Vendor </h2>
                        )}
                    </div>
                    <ProcurementHeaderCard orderData={sr_data} sr={true} />

                    <div>
                        <div className="flex m-2 justify-left gap-2">

                            <div className="text-lg text-gray-400 mt-1">Select vendors for this SR:</div>
                            <Select className="w-72" value={selectedVendor} options={vendorOptions} onChange={handleChange()} />
                            <Sheet>
                                <SheetTrigger className="text-blue-500">
                                    <div className="text-base text-blue-400 flex items-center gap-1" >
                                        <CirclePlus className="w-5 h-5" />Add New Vendor
                                    </div>
                                </SheetTrigger>
                                <SheetContent className='overflow-auto'>
                                    <SheetHeader className="text-start">
                                        <SheetTitle>
                                            <div className="flex-1">
                                                <span className="underline">Add Service Vendor</span>
                                                <p className=" text-xs font-light text-slate-500 p-1">Add a new service vendor here</p>
                                            </div>
                                        </SheetTitle>
                                        <NewVendor renderCategorySelection={false} navigation={false} service={true} />
                                    </SheetHeader>
                                </SheetContent>
                            </Sheet>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <div className="min-w-full inline-block align-middle">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-red-100">
                                        <TableHead className="w-[10%]"><span className="text-red-700 pr-1 font-extrabold">Service</span></TableHead>
                                        <TableHead className="w-[50%]">Description</TableHead>
                                        <TableHead className="w-[10%]">Unit</TableHead>
                                        <TableHead className="w-[10%]">Quantity</TableHead>
                                        <TableHead className="w-[10%]">Rate</TableHead>
                                        <TableHead className="w-[10%]">Amount</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sr_data && JSON.parse(sr_data?.service_order_list)?.list?.map((item: any) => (
                                        <TableRow key={item.id}>
                                            <TableCell className="w-[10%] font-semibold">{item.category}</TableCell>
                                            <TableCell className="w-[50%]">{item.description}</TableCell>
                                            <TableCell className="w-[10%]">{item.uom}</TableCell>
                                            <TableCell className="w-[10%]">{item.quantity}</TableCell>
                                            <TableCell className="w-[10%]">
                                                <input
                                                    type="text"
                                                    className="border p-1 w-full rounded-md"
                                                    value={amounts[item.id] ? `₹ ${amounts[item.id]}` : "₹"}
                                                    onChange={(e) => handleAmountChange(item.id, e.target.value)}
                                                    disabled={!selectedVendor}
                                                />
                                            </TableCell>
                                            <TableCell className="w-[10%] text-primary">{formatToIndianRupee(item?.quantity * (amounts[item.id] || 0))}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                    <div className="flex justify-end mt-4">
                        <Button disabled={!isNextEnabled} onClick={handleSaveAmounts}>Next</Button>
                    </div>
                    <div className="flex items-center space-y-2">
                        <h2 className="text-base pt-1 pl-2 font-bold tracking-tight">SR Comments</h2>
                    </div>
                    <div className="border border-gray-200 rounded-lg p-4 flex flex-col gap-2">
                        {universalComments?.length ? (
                            universalComments?.map((comment) => (
                                <div key={comment.name} className="flex items-start space-x-4 bg-gray-50 p-4 rounded-lg">
                                    <Avatar>
                                        <AvatarImage src={`https://api.dicebear.com/6.x/initials/svg?seed=${comment?.comment_by}`} />
                                        <AvatarFallback>{comment?.comment_by[0]}</AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1">
                                        <p className="font-medium text-sm text-gray-900">{comment?.content}</p>
                                        <div className="flex justify-between items-center mt-2">
                                            <p className="text-sm text-gray-500">
                                                {comment.comment_by === "Administrator" ? "Administrator" : getFullName(comment?.comment_by)}
                                            </p>
                                            <p className="text-xs text-gray-400">
                                                {formatDate(comment?.creation?.split(" ")[0])} {comment.creation.split(" ")[1].substring(0, 5)}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <span className="text-xs font-semibold">No Comments Found</span>
                        )
                        }
                    </div>
                </div>
            </>}
            {section == 'summary' &&
                <>
                    <div className="flex-1 md:space-y-4">
                        <div className="flex items-center pt-1 pb-4">
                            <ArrowLeft className='cursor-pointer' onClick={() => setSection('choose-vendor')} />
                            <h2 className="text-base pl-2 font-bold tracking-tight">Comparison</h2>
                        </div>
                        <ProcurementHeaderCard orderData={sr_data} sr={true} />
                    </div>
                    {/* <div className='pt-6 overflow-x-auto'>
                        <ConfigProvider
                            // theme={{
                            //     token: {
                            //         colorPrimary: '#FF2828',
                            //         borderRadius: 4,
                            //         colorBgContainer: '#FFFFFF',
                            //     },
                            // }}
                        >
                            <AntTable
                                dataSource={order}
                                columns={columns}
                            />
                        </ConfigProvider>
                    </div> */}

                    <div className="pt-6 overflow-x-auto">
                        <ConfigProvider
                        >
                            <AntTable
                                dataSource={((groupedData && Object.keys(groupedData)) || []).map((key) => ({
                                    key,
                                    category: key,
                                    items: groupedData[key],
                                }))}
                                columns={columns}
                                expandable={{
                                    expandedRowKeys,
                                    onExpandedRowsChange: setExpandedRowKeys,
                                    expandedRowRender: (record) => (
                                        <AntTable
                                            dataSource={record.items}
                                            columns={innerColumns}
                                            pagination={false}
                                            rowKey={(item) => item.id}
                                        />
                                    ),
                                }}
                            />
                        </ConfigProvider>
                    </div>
                    <div className="flex flex-col justify-end items-end mr-2 mb-4 mt-4">
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button className="flex items-center gap-1">
                                    {resolve ?
                                        <Settings2 className="h-4 w-4" /> :
                                        <ArrowBigUpDash className="" />
                                    }
                                    {resolve ? "Resolve" : "Send for Approval"}
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[425px]">
                                <DialogHeader>
                                    <DialogTitle>Are you sure?</DialogTitle>
                                    <DialogDescription>
                                        Click on Confirm to {resolve ? "resolve and send for approval" : "Submit"}!
                                        <Textarea className="mt-4" placeholder={`Optional`} onChange={(e: any) => setComment(e.target.value === "" ? null : e.target.value)} value={comment || ""} />
                                    </DialogDescription>
                                </DialogHeader>
                                <DialogDescription className='flex items-center justify-center gap-2'>
                                    <DialogClose><Button variant="secondary" className="flex items-center gap-1">
                                        <Undo2 className="h-4 w-4" />
                                        Cancel</Button>
                                    </DialogClose>
                                    {resolve ? (
                                        <Button variant="default" className="flex items-center gap-1" onClick={handleResolveSR} disabled={create_loading || update_loading}>
                                            {create_loading || update_loading ? (
                                                <TailSpin width={20} height={20} color="white" />
                                            ) : (
                                                <>
                                                <CheckCheck className="h-4 w-4" />
                                                Confirm
                                                 </>
                                            )}
                                        </Button>
                                    ) : (
                                        <Button variant="default" className="flex items-center gap-1" onClick={handleSubmit} disabled={create_loading || update_loading}>
                                            {create_loading || update_loading ? (
                                                <TailSpin width={20} height={20} color="white" />
                                            ) : (
                                                <>
                                                <CheckCheck className="h-4 w-4" />
                                                Confirm
                                                 </>
                                            )}
                                        </Button>
                                    )}
                                </DialogDescription>
                            </DialogContent>
                        </Dialog>
                    </div>
                </>}
        </>


    )
}

export const Component = SelectServiceVendor