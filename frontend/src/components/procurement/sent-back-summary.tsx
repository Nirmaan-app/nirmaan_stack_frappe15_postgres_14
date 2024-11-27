import { Badge } from "../ui/badge"
import { ProcurementHeaderCard } from "../ui/ProcurementHeaderCard"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Button } from "../ui/button";
import { ArrowBigRightDash } from "lucide-react";
import { formatDate } from "@/utils/FormatDate";
import { useEffect, useState } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { useNavigate, useParams } from "react-router-dom";
import { TailSpin } from "react-loader-spinner";

export const SentBackSummary = () => {

    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate();

    const { data: sent_back_list, isLoading: sent_back_list_loading, error: sent_back_list_error } = useFrappeGetDocList("Sent Back Category",
        {
            fields: ['*'],
            limit: 1000
        });

    const { data: universalComments } = useFrappeGetDocList("Nirmaan Comments", {
        fields: ["*"],
        filters: [["reference_name", "=", id]],
        orderBy: { field: "creation", order: "desc" }
    })

    const { data: usersList } = useFrappeGetDocList("Nirmaan Users", {
        fields: ["*"],
        limit: 1000,
    })

    const getFullName = (id) => {
        return usersList?.find((user) => user.name == id)?.full_name
    }

    const [orderData, setOrderData] = useState({
        project: ''
    })

    useEffect(() => {
        sent_back_list?.map(item => {
            if (item.name === id) {
                setOrderData(item)
            }
        })
    }, [sent_back_list]);

    if (sent_back_list_loading) return <div className="flex items-center h-[90vh] w-full justify-center"><TailSpin color={"red"} /> </div>

    if (orderData?.workflow_state !== "Pending") {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center space-y-4">
                    <h2 className="text-2xl font-semibold text-gray-800">
                        Heads Up!
                    </h2>
                    <p className="text-gray-600 text-lg">
                        Hey there, the SB:{" "}
                        <span className="font-medium text-gray-900">{orderData?.name}</span>{" "}
                        is no longer available in the{" "}
                        <span className="italic">Pending</span> state. The current state is{" "}
                        <span className="font-semibold text-blue-600">
                            {orderData?.workflow_state}
                        </span>{" "}
                        And the last modification was done by <span className="font-medium text-gray-900">
                            {orderData?.modified_by === "Administrator" ? orderData?.modified_by : getFullName(orderData?.modified_by)}
                        </span>
                        !
                    </p>
                    <button
                        className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors duration-300"
                        onClick={() => navigate(-1)}
                    >
                        Go Back
                    </button>
                </div>
            </div>
        );
    }

    return (
            <div className="flex-1 space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center">
                        {/* <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} /> */}
                        <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">Summary</h2>
                    </div>
                    <Badge variant={orderData?.type === "Rejected" ? "destructive" : orderData?.type === "Delayed" ? "orange" : "gray"}>{orderData?.type}</Badge>
                </div>
                <ProcurementHeaderCard orderData={orderData} sentBack />
                <div className="pt-5 text-red-700 font-light text-base underline">{orderData?.type} Items</div>
                <div className="overflow-x-auto">
                    <Table className="min-w-full divide-gray-200">
                        <TableHeader className="bg-red-100">
                            <TableRow>
                                <TableHead className="w-[60%]">Items</TableHead>
                                <TableHead className="w-[10%]">UOM</TableHead>
                                <TableHead className="w-[10%]">Quantity</TableHead>
                                {/* <TableHead className="w-[10%]">Rate</TableHead>
                                    <TableHead className="w-[10%]">Amount</TableHead> */}
                            </TableRow>
                        </TableHeader>
                        <TableBody className="bg-white divide-y divide-gray-200">
                            {orderData.item_list?.list.map(item => (
                                <TableRow key={item.name}>
                                    <TableCell>{item.item}</TableCell>
                                    <TableCell>{item.unit}</TableCell>
                                    <TableCell>{item.quantity}</TableCell>
                                    {/* <TableCell>{item.quote}</TableCell>
                                        <TableCell>{item.quote * item.quantity}</TableCell> */}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
                <div className="flex items-center space-y-2">
                    <h2 className="text-base pt-4 pl-2 font-bold tracking-tight text-pageheader">Sent Back Comments</h2>
                </div>
                <div className="border border-gray-200 rounded-lg p-4">
                    {/* {universalComments && (universalComments[0]?.content ? universalComments[0].content : "No Comments")} */}
                    {
                        universalComments?.length ? (
                            <div className="flex items-start space-x-4 bg-gray-50 p-4 rounded-lg">
                                <Avatar>
                                    <AvatarImage src={`https://api.dicebear.com/6.x/initials/svg?seed=${universalComments[0]?.comment_by}`} />
                                    <AvatarFallback>{universalComments[0]?.comment_by[0]}</AvatarFallback>
                                </Avatar>
                                <div className="flex-1">
                                    <p className="font-medium text-sm text-gray-900">{universalComments[0]?.content}</p>
                                    <div className="flex justify-between items-center mt-2">
                                        <p className="text-sm text-gray-500">
                                            {universalComments[0]?.comment_by === "Administrator" ? "Administrator" : getFullName(universalComments[0]?.comment_by)}
                                        </p>
                                        <p className="text-xs text-gray-400">
                                            {formatDate(universalComments[0]?.creation.split(" ")[0])} {universalComments[0]?.creation.split(" ")[1].substring(0, 5)}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <span className="font-semibold text-xs">No Comments Found</span>
                        )
                    }
                </div>
                <div className="flex flex-col justify-end items-end">
                    <Button onClick={() => navigate(`update-quote`)} className="flex items-center gap-1">
                        Next
                        <ArrowBigRightDash className="max-md:w-4 max-md:h-4" />
                    </Button>
                </div>
            </div>
    )
}