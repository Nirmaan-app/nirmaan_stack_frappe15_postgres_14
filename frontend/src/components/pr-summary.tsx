import { useFrappeDeleteDoc, useFrappeGetDoc, useFrappeGetDocList, useSWRConfig } from "frappe-react-sdk";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, ListChecks, MessageCircleMore, Settings2, Trash2, Undo2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ProcurementRequests as ProcurementRequestsType } from "@/types/NirmaanStack/ProcurementRequests";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { Label } from "./ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { PRSummarySkeleton } from "./ui/skeleton";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { useState } from "react";
import { NewPRPage } from "./procurement-request/new-pr";
import { Timeline } from "antd";
import { formatDate } from "@/utils/FormatDate";
import { toast } from "./ui/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./ui/alert-dialog";
import { ProcurementOrders as ProcurementOrdersType } from "@/types/NirmaanStack/ProcurementOrders";
import { NirmaanUsers as NirmaanUsersType } from "@/types/NirmaanStack/NirmaanUsers";

const PRSummary = () => {

    const { id } = useParams<{ id: string }>();

    const project_id = id?.split('-')[1];

    const { data: pr_data, error: pr_error, isLoading: prLoading } = useFrappeGetDoc<ProcurementRequestsType>("Procurement Requests", id, `Procurement Requests ${id}`);

    const { data: usersList, isLoading: userLoading, error: userError } = useFrappeGetDocList<NirmaanUsersType>("Nirmaan Users", {
        fields: ["*"],
        limit: 1000,
    })

    const { data: universalComments } = useFrappeGetDocList("Nirmaan Comments", {
        fields: ["*"],
        limit: 1000,
        filters: [["reference_name", "=", id]],
        orderBy: { field: "creation", order: "desc" }
    })

    const { data: project, error: project_error, isLoading: projectLoading } = useFrappeGetDocList<ProjectsType>("Projects", {
        fields: ['name', 'project_name', 'project_address'],
        filters: [['name', 'like', `%${project_id}`]]
    });
    console.log("data", project)

    const project_address = project && project[0]?.project_address

    // const { data: address, error: address_error, isLoading: addressLoading } = useFrappeGetDoc("Address", project_address);
    const { data: procurementOrdersList, error: procurementOrdersError, isLoading: procurementOrdersLoading } = useFrappeGetDocList<ProcurementOrdersType>("Procurement Orders", {
        fields: ["*"],
        limit: 1000
    },
        "Procurement Orders"
    )


    return (
        <>
            {pr_error && <h1>{pr_error.message}</h1>}
            {project_error && <h1>{project_error.message}</h1>}
            {/* {address_error && <h1>{address_error.message}</h1>} */}
            {procurementOrdersError && <h1>{procurementOrdersError.message}</h1>}
            {userError && <h1>{userError.message}</h1>}
            {(prLoading || projectLoading || procurementOrdersLoading || userLoading) ? <PRSummarySkeleton /> : <PRSummaryPage pr_data={pr_data} project={project[0]} po_data={procurementOrdersList} universalComments={universalComments || []} usersList={usersList} />}
        </>
    )
};

interface PRSummaryPageProps {
    pr_data: ProcurementRequestsType | undefined
    project: ProjectsType | undefined
    address?: any
    po_data: ProcurementOrdersType[] | undefined
    universalComments: any
    usersList: NirmaanUsersType[] | undefined
}

const PRSummaryPage = ({ pr_data, project, po_data, universalComments, usersList }: PRSummaryPageProps) => {
    const navigate = useNavigate();
    const pr_no = pr_data.name.split("-").slice(-1)

    const orderData = { name: pr_data.name, work_package: pr_data.work_package, comment: pr_data.comment, project: pr_data.project, category_list: JSON.parse(pr_data.category_list), procurement_list: JSON.parse(pr_data.procurement_list) }

    const [section, setSection] = useState("pr-summary")
    const { deleteDoc } = useFrappeDeleteDoc()


    const getFullName = (id: string) => {
        return usersList?.find((user) => user.name === id)?.full_name
    }

    const checkPoToPr = (prId: string) => {
        return po_data?.some((po) => po.procurement_request === prId)
    }

    const itemsTimelineList = universalComments?.map((cmt) => ({
        label: (
            <span className="max-sm:text-wrap text-xs m-0 p-0">{formatDate(cmt.creation.split(" ")[0])} {cmt.creation.split(" ")[1].substring(0, 5)}</span>
        ), children: (
            <Card>
                <CardHeader className="p-2">
                    <CardTitle>
                        {cmt.comment_by === "Administrator" ? (
                            <span className="text-sm">Administrator</span>
                        ) : (
                            <span className="text-sm">{getFullName(cmt.comment_by)}</span>
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0">
                    {cmt.content}
                </CardContent>
            </Card>
        ), color:
            cmt.subject ? (cmt.subject === "creating pr" ? "green" : cmt.subject === "rejecting pr" ? "red" : "blue") : 'gray'
    }))

    const { mutate } = useSWRConfig()

    const handleDeletePr = async () => {
        try {
            await deleteDoc("Procurement Requests", pr_data.name)
            await mutate("Procurement Requests,orderBy(creation-desc)")
            toast({
                title: "Success!",
                description: `PR: ${pr_data.name} deleted successfully!`,
                variant: "success"
            })
            navigate("/procurement-request")
        } catch (error) {
            console.log("error while deleting PR", error)
            toast({
                title: "Failed!",
                description: `PR: ${pr_data.name} deletion Failed!`,
                variant: "destructive"
            })
        }
    }

    // console.log("itemsTimeLineList", itemsTimelineList)

    // console.log("universalComments", universalComments)

    return (
        <>
            <div className={`${section === "pr-summary" ? "flex-1 space-y-2 md:space-y-4" : ""}`}>
                {section === "pr-summary" && (
                    <>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1 flex-wrap">
                                <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} />
                                <h2 className="text-xl max-md:text-lg font-bold tracking-tight">Summary: </h2>
                                <span className="text-red-500 text-2xl max-md:text-xl">PR-{pr_no}</span>
                            </div>
                            <div className="flex gap-4 items-center">
                                {
                                    ["Rejected", "Pending", "Approved"].includes(pr_data.workflow_state) && (
                                        <AlertDialog>
                                            <AlertDialogTrigger>
                                                <Button className="flex items-center gap-1">
                                                    <Trash2 className="h-4 w-4" />
                                                    Delete</Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle className="text-center">
                                                        Are you sure, you want to delete this PR?
                                                    </AlertDialogTitle>
                                                </AlertDialogHeader>
                                                <AlertDialogDescription className="">
                                                    This action will delete this pr from the system. Are you sure you want to continue?
                                                    <div className="flex gap-2 items-center justify-center">
                                                        <AlertDialogCancel className="flex items-center gap-1">
                                                            <Undo2 className="h-4 w-4" />
                                                            Cancel
                                                        </AlertDialogCancel>
                                                        <AlertDialogAction className="flex items-center gap-1" onClick={handleDeletePr}>
                                                            <ListChecks className="h-4 w-4" />
                                                            Confirm
                                                        </AlertDialogAction>
                                                    </div>
                                                </AlertDialogDescription>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    )
                                }
                                {pr_data.workflow_state === "Rejected" && (

                                    <Button className="flex items-center gap-1" onClick={() => setSection("resolve-pr")}>
                                        <Settings2 className="h-4 w-4" />
                                        Resolve</Button>
                                )}
                            </div>
                        </div>
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <Card className="w-full">
                                <CardHeader>
                                    <CardTitle className="text-xl text-red-600 flex items-center justify-between">
                                        PR Details
                                        <Badge variant={`${["RFQ Generated", "Quote Updated", "Vendor Selected"].includes(pr_data.workflow_state) ? "orange" : ["Partially Approved", "Vendor Approved"].includes(pr_data.workflow_state) ? "green" : (["Delayed", "Sent Back"].includes(pr_data.workflow_state) && checkPoToPr(pr_data.name)) ? "green" : (["Delayed", "Sent Back"].includes(pr_data.workflow_state) && !checkPoToPr(pr_data.name)) ? "orange" : pr_data.workflow_state === "Rejected" ? "red" : "yellow"}`}>
                                            {["RFQ Generated", "Quote Updated", "Vendor Selected"].includes(pr_data.workflow_state) ? "In Progress" : ["Partially Approved", "Vendor Approved"].includes(pr_data.workflow_state) ? "Ordered" : (["Delayed", "Sent Back"].includes(pr_data.workflow_state) && checkPoToPr(pr_data.name)) ? "Ordered" : (["Delayed", "Sent Back"].includes(pr_data.workflow_state) && !checkPoToPr(pr_data.name)) ? "In Progress" : pr_data.workflow_state === "Pending" ? "Approval Pending" : pr_data.workflow_state}
                                        </Badge>
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col gap-4">
                                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                                        <div className="space-y-1">
                                            <Label className="text-slim text-red-300">Project:</Label>
                                            <p className="font-semibold">{project.project_name}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-slim text-red-300">Package:</Label>
                                            <p className="font-semibold">{pr_data.work_package}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-slim text-red-300">Date Created:</Label>
                                            <p className="font-semibold">{new Date(pr_data.creation).toDateString()}</p>
                                        </div>
                                    </div>

                                    <div className="space-y-1 flex flex-col items-start justify-start">
                                        <Label className="text-slim text-red-300 mb-4 block">Comments:</Label>
                                        <Timeline
                                            className="w-full"
                                            mode={'left'}
                                            items={itemsTimelineList}
                                        />
                                    </div>
                                </CardContent>
                            </Card>
                            <Card className="w-full">
                                <CardHeader>
                                    <CardTitle className="text-xl text-red-600">Order Details</CardTitle>
                                </CardHeader>

                                <div className="overflow-x-auto">

                                    <div className="min-w-full inline-block align-middle">
                                        {JSON.parse(pr_data.category_list).list.map((cat: any) => {
                                            return <div className="p-5">
                                                {/* <div className="text-base font-semibold text-black p-2">{cat.name}</div> */}
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow className="bg-red-100">
                                                            <TableHead className="w-[60%]"><span className="text-red-700 pr-1 font-extrabold">{cat.name}</span></TableHead>
                                                            <TableHead className="w-[25%]">UOM</TableHead>
                                                            <TableHead className="w-[15%]">Qty</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {JSON.parse(pr_data.procurement_list).list.map((item: any) => {
                                                            if (item.category === cat.name) {
                                                                return (
                                                                    <TableRow key={item.item}>
                                                                        <TableCell>{item.item}
                                                                            <div className="flex gap-1 pt-2 items-start">
                                                                                <MessageCircleMore className="w-6 h-6 text-blue-400 flex-shrink-0" />
                                                                                <p className={`text-xs ${!item.comment ? "text-gray-400" : "tracking-wide"}`}>{item.comment || "No Comments"}</p>
                                                                            </div>
                                                                        </TableCell>
                                                                        <TableCell>{item.unit}</TableCell>
                                                                        <TableCell>{item.quantity}</TableCell>
                                                                    </TableRow>
                                                                )
                                                            }
                                                        })}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        })}
                                    </div>
                                </div>
                            </Card>
                        </div>
                    </>
                )}

                {section === "resolve-pr" && <NewPRPage project={project} rejected_pr_data={orderData} setSection={setSection} />}

            </div>
        </>
    );

}

export const Component = PRSummary;
