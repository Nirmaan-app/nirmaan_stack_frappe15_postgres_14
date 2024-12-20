import { ArrowLeft, CheckCheck, ListChecks, ListX, Undo2 } from "lucide-react"
import { useNavigate, useParams } from "react-router-dom"
import { Card } from "../ui/card"
import { useFrappeCreateDoc, useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk"
import { formatDate } from "@/utils/FormatDate"
import { useEffect, useMemo, useState } from "react"
import { ConfigProvider, Table, TableColumnsType } from "antd"
import formatToIndianRupee from "@/utils/FormatPrice"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../ui/alert-dialog"
import { Button } from "../ui/button"
import { toast } from "../ui/use-toast"
import { useUserData } from "@/hooks/useUserData"
import { TailSpin } from "react-loader-spinner"
import { ProcurementActionsHeaderCard } from "../ui/ProcurementActionsHeaderCard"

export const ApproveServiceRequest = () => {
    const { srId: id } = useParams<{ srId: string }>()
    const navigate = useNavigate()
    const [project, setProject] = useState()
    const [owner, setOwner] = useState()
    const [serviceOrderData, setServiceOrderData] = useState(null)
    const [isLoading, setIsLoading] = useState<string | null>(null);
    const [comment, setComment] = useState('')
    const userData = useUserData()
    const [expandedRowKeys, setExpandedRowKeys] = useState([]);

    const { data: service_request, isLoading: service_request_loading, error: service_request_error, mutate: service_request_mutate } = useFrappeGetDoc("Service Requests", id)
    const { data: project_data, isLoading: project_loading, error: project_error } = useFrappeGetDoc("Projects", project, project ? undefined : null);
    const { data: owner_data, isLoading: owner_loading, error: owner_error } = useFrappeGetDoc("Nirmaan Users", owner, owner ? (owner === "Administrator" ? null : undefined) : null);
    const { data: serviceVendor } = useFrappeGetDoc("Vendors", service_request?.vendor, service_request ? service_request?.vendor : null)

    const { data: usersList, isLoading: usersListLoading, error: usersListError } = useFrappeGetDocList("Nirmaan Users", {
        fields: ["name", "full_name"],
        limit: 1000
    })

    const { createDoc: createDoc, loading: create_loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    const { updateDoc: updateDoc, loading: update_loading, isCompleted: update_complete, error: update_error } = useFrappeUpdateDoc()

    // const getUserName = (id) => {
    //     if (usersList) {
    //         return usersList.find((user) => user?.name === id)?.full_name
    //     }
    // }

    useEffect(() => {
        if (service_request) {
            setProject(service_request?.project)
            setOwner(service_request?.modified_by)
            setServiceOrderData(JSON.parse(service_request?.service_order_list)?.list)
        }
    }, [service_request])

    // const groupedData = useMemo(() => {
    //     return serviceOrderData?.reduce((acc, item) => {
    //         acc[item.category] = acc[item.category] || [];
    //         acc[item.category].push(item);
    //         return acc;
    //     }, {});
    // }, [serviceOrderData]);

    const groupedData = useMemo(() => {
        return serviceOrderData?.reduce((acc, item) => {
            const category = item.category
            acc[category] = acc[category] || { items: [], total: 0, totalWithGST: 0 }
            acc[category].items.push(item)
            acc[category].total += parseFloat(item.rate) * parseFloat(item.quantity)
            acc[category].totalWithGST += parseFloat(item.rate) * parseFloat(item.quantity) * 1.18 // Assuming 18% GST
            return acc
        }, {})
    }, [serviceOrderData])

    useEffect(() => {
        if (groupedData) {
            setExpandedRowKeys(Object.keys(groupedData));
        }
    }, [groupedData]);

    // console.log("groupedData", groupedData)

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
            render: () => <span className="font-semibold text-primary">{serviceVendor?.vendor_name}</span>,
        },
    ];

    // Inner table columns
    const innerColumns = [
        {
            title: "Description",
            dataIndex: "description",
            key: "description",
            width: "50%",
            render: (text) => <span className="italic whitespace-pre-wrap">{text}</span>
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
            render: (text, record) => <span className={`italic ${record?.id === undefined ? "font-semibold text-green-700" : ""}`}>{formatToIndianRupee(record?.id === undefined ? text : record.rate * record.quantity)}</span>,
        },
        {
            title: "Amt inc. tax",
            dataIndex: "amount",
            key: "amountinctax",
            width: "20%",
            render: (text, record) => {
                return <span className={`italic ${record?.id === undefined ? "font-semibold text-green-700" : ""}`}>{formatToIndianRupee(parseFloat(record?.id === undefined ? text : record.rate * record.quantity) * 1.18)}</span>
            },
        },
    ];

    const handleApprove = async () => {
        try {
            setIsLoading("approveSR")
            await updateDoc("Service Requests", id, {
                status: "Approved"
            })

            toast({
                title: "Success!",
                description: `SR: ${id} Approved successfully!`,
                variant: "success",
            });

            document.getElementById("ApproveSRAlertCancel")?.click()

            navigate("/approve-service-request");

        } catch (error) {
            toast({
                title: "Failed!",
                description: `Unable to approve services!`,
                variant: "destructive",
            });
            console.log("error while approving sr", error)
        } finally {
            setIsLoading(null);
        }
    }

    const handleReject = async () => {
        try {
            setIsLoading("rejectSR")
            await updateDoc("Service Requests", id, {
                status: "Rejected"
            })

            if (comment) {
                await createDoc("Nirmaan Comments", {
                    comment_type: "Comment",
                    reference_doctype: "Service Requests",
                    reference_name: id,
                    comment_by: userData?.user_id,
                    content: comment,
                    subject: "rejecting sr"
                })
            }

            toast({
                title: "Success!",
                description: `SR: ${id} Rejected successfully!`,
                variant: "success",
            });

            document.getElementById("RejectSRAlertCancel")?.click()

            navigate("/approve-service-request");

        } catch (error) {
            toast({
                title: "Failed!",
                description: `Unable to reject services!`,
                variant: "destructive",
            });
            console.log("error while rejecting sr", error)
        } finally {
            setIsLoading(null);
            setComment('')
        }
    }

    const getUserName = (id) => {
        if (usersList) {
            return usersList.find((user) => user?.name === id)?.full_name
        }
    }


    if (service_request?.status !== "Vendor Selected") return (
        <div className="flex items-center justify-center h-screen">
            <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center space-y-4">
                <h2 className="text-2xl font-semibold text-gray-800">
                    Heads Up!
                </h2>
                <p className="text-gray-600 text-lg">
                    Hey there, the SR:{" "}
                    <span className="font-medium text-gray-900">{service_request?.name}</span>{" "}
                    is no longer available for{" "}
                    <span className="italic">Reviewing</span>. The current state is{" "}
                    <span className="font-semibold text-blue-600">
                        {service_request?.status}
                    </span>{" "}
                    And the last modification was done by <span className="font-medium text-gray-900">
                        {service_request?.modified_by === "Administrator" ? service_request?.modified_by : getUserName(service_request?.modified_by)}
                    </span>
                    !
                </p>
                <button
                    className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors duration-300"
                    onClick={() => navigate("/approve-service-request")}
                >
                    Go Back
                </button>
            </div>
        </div>
    );

    return (
        <>
            <div className="flex-1 space-y-4">
                <div className="flex items-center">
                    {/* <ArrowLeft onClick={() => { navigate('/approve-service-request') }} /> */}
                    <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">Approve/Reject</h2>
                </div>
                {/* <Card className="flex flex-wrap lg:grid lg:grid-cols-4 gap-4 border border-gray-100 rounded-lg p-4">
                    <div className="border-0 flex flex-col justify-center max-sm:hidden">
                        <p className="text-left py-1 font-light text-sm text-sm text-red-700">Date:</p>
                        <p className="text-left font-bold py-1 font-bold text-base text-black">{formatDate(service_request?.creation?.split(" ")[0])}</p>
                    </div>
                    <div className="border-0 flex flex-col justify-center">
                        <p className="text-left py-1 font-light text-sm text-sm text-red-700">Project:</p>
                        <p className="text-left font-bold py-1 font-bold text-base text-black">{service_request?.project}</p>
                    </div>
                    <div className="border-0 flex flex-col justify-center max-sm:hidden">
                        <p className="text-left py-1 font-light text-sm text-sm text-red-700">Project Location</p>
                        <p className="text-left font-bold py-1 font-bold text-base text-black">{`${project_data?.project_city}, ${project_data?.project_state}`}</p>
                    </div>
                    <div className="border-0 flex flex-col justify-center max-sm:hidden">
                        <p className="text-left py-1 font-light text-sm text-sm text-red-700">Created by</p>
                        <p className="text-left font-bold py-1 font-bold text-base text-black">{owner_data?.full_name || "Administrator"}</p>
                    </div>
                </Card> */}
                <ProcurementActionsHeaderCard orderData={service_request} sr={true} />

            <div className="overflow-x-auto">
                <ConfigProvider
                    theme={{
                        components: {
                            Table: {
                                // headerBg: "#FFD3CC"
                            }
                        }
                    }}
                >
                    <Table
                        dataSource={((groupedData && Object.keys(groupedData)) || []).map((key) => ({
                            key,
                            category: key,
                            items: groupedData[key].items,
                            total: groupedData[key].total,
                            totalWithGST: groupedData[key].totalWithGST,
                        }))}
                        columns={columns}
                        expandable={{
                            expandedRowKeys,
                            onExpandedRowsChange: setExpandedRowKeys,
                            expandedRowRender: (record) => (
                                <Table
                                    dataSource={[
                                        ...record.items,
                                        {
                                            description: <strong>Total</strong>,
                                            amount: record.total,
                                            amountinctax: record.totalWithGST,
                                        },
                                    ]}
                                    columns={innerColumns}
                                    pagination={false}
                                    rowKey={(item) => item.id || 'total'}
                                // rowClassName={(record) => record?.id === undefined ? "bg-gray-200" : ""}
                                />
                            ),
                        }}
                    />
                </ConfigProvider>
            </div>

            <div className="flex justify-end gap-2 mr-2 mt-2">
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant={"outline"} className="text-red-500 border-red-500 flex items-center gap-1">
                            <ListX className="h-4 w-4" />
                            Reject
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="sm:max-w-[425px]">
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you Sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                                Add Comments and Reject.
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
                        {isLoading === "rejectSR" ? <div className='flex items-center justify-center'><TailSpin width={80} color='red' /> </div> : (
                            <AlertDialogFooter className="flex flex-row justify-center gap-2 items-center">
                                <AlertDialogCancel className="flex items-center gap-1">
                                    <Undo2 className="h-4 w-4" />
                                    Cancel
                                </AlertDialogCancel>
                                <Button onClick={handleReject} className="flex items-center gap-1">
                                    <CheckCheck className="h-4 w-4" />
                                    Confirm
                                </Button>
                            </AlertDialogFooter>
                        )}
                        <AlertDialogCancel id='RejectSRAlertCancel' className="hidden">
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
                            <AlertDialogTitle>Are you Sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                                Click on Confirm to Approve.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        {isLoading === "approveSR" ? <div className='flex items-center justify-center'><TailSpin width={80} color='red' /> </div> : (
                            <AlertDialogFooter className="flex flex-row justify-center gap-2 items-center">
                                <AlertDialogCancel className="flex items-center gap-1">
                                    <Undo2 className="h-4 w-4" />
                                    Cancel
                                </AlertDialogCancel>
                                <Button onClick={handleApprove} className="flex items-center gap-1">
                                    <CheckCheck className="h-4 w-4" />
                                    Confirm
                                </Button>
                            </AlertDialogFooter>
                        )}
                        <AlertDialogCancel id='ApproveSRAlertCancel' className="hidden">
                            Cancel
                        </AlertDialogCancel>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
            </div>
        </>

    )
}