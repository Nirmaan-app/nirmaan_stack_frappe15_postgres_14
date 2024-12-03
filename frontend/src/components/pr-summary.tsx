import { useFrappeDeleteDoc, useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc, useSWRConfig } from "frappe-react-sdk";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, FileSliders, ListChecks, MessageCircleMore, MessageCircleWarning, Settings2, Trash2, Undo2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ProcurementRequests as ProcurementRequestsType } from "@/types/NirmaanStack/ProcurementRequests";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { Label } from "./ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { PRSummarySkeleton } from "./ui/skeleton";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { useEffect, useState } from "react";
import { NewPRPage } from "./procurement-request/new-pr";
import { Timeline } from "antd";
import { formatDate } from "@/utils/FormatDate";
import { toast } from "./ui/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./ui/alert-dialog";
import { ProcurementOrders as ProcurementOrdersType } from "@/types/NirmaanStack/ProcurementOrders";
import { NirmaanUsers as NirmaanUsersType } from "@/types/NirmaanStack/NirmaanUsers";
import { useUserData } from "@/hooks/useUserData";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { TailSpin } from "react-loader-spinner";

const PRSummary = () => {

    const { id } = useParams<{ id: string }>();

    const project_id = id?.split('-')[1];

    const [project, setProject] = useState()
    // const [projectAddress, setProjectAddress] = useState()

    const { data: pr_data, error: pr_error, isLoading: prLoading, mutate: pr_data_mutate } = useFrappeGetDoc<ProcurementRequestsType>("Procurement Requests", id, `Procurement Requests ${id}`);

    const { data: usersList, isLoading: userLoading, error: userError } = useFrappeGetDocList<NirmaanUsersType>("Nirmaan Users", {
        fields: ["*"],
        limit: 1000,
    })

    const { data: universalComments } = useFrappeGetDocList("Nirmaan Comments", {
        fields: ["*"],
        limit: 1000,
        filters: [["reference_name", "=", id]],
        orderBy: { field: "creation", order: "desc" }
    }, `Nirmaan Comments ${id}`)

    const { data: project_data, error: project_data_error, isLoading: project_data_loading } = useFrappeGetDoc<ProjectsType>("Projects", project);

    // const { data: address, error: address_error, isLoading: addressLoading } = useFrappeGetDoc("Address", project_address);
    const { data: procurementOrdersList, error: procurementOrdersError, isLoading: procurementOrdersLoading } = useFrappeGetDocList<ProcurementOrdersType>("Procurement Orders", {
        fields: ["*"],
        filters: [['procurement_request', '=', id], ["merged", "!=", "true"]],
        limit: 1000
    })


    useEffect(() => {
        if (pr_data) {
            setProject(pr_data?.project)
        }
    }, [pr_data])

    return (
        <>
            {pr_error && <h1>{pr_error.message}</h1>}
            {project_data_error && <h1>{project_data_error.message}</h1>}
            {/* {address_error && <h1>{address_error.message}</h1>} */}
            {procurementOrdersError && <h1>{procurementOrdersError.message}</h1>}
            {userError && <h1>{userError.message}</h1>}
            {(prLoading || project_data_loading || procurementOrdersLoading || userLoading) ? <PRSummarySkeleton /> : <PRSummaryPage pr_data={pr_data} project={project_data} po_data={procurementOrdersList} universalComments={universalComments || []} usersList={usersList} pr_data_mutate={pr_data_mutate} />}
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
    pr_data_mutate?: any
}

const PRSummaryPage = ({ pr_data, project, po_data, universalComments, usersList, pr_data_mutate }: PRSummaryPageProps) => {
    const navigate = useNavigate();
    const pr_no = pr_data?.name.split("-").slice(-1)
    const userData = useUserData()

    const orderData = { name: pr_data?.name, work_package: pr_data?.work_package, comment: pr_data?.comment, project: pr_data?.project, category_list: JSON.parse(pr_data?.category_list), procurement_list: JSON.parse(pr_data?.procurement_list) }

    const [section, setSection] = useState("pr-summary")
    const { deleteDoc } = useFrappeDeleteDoc()


    const getFullName = (id: string) => {
        return usersList?.find((user) => user.name === id)?.full_name
    }

    const { role } = useUserData()

    // const checkPoToPr = (prId: string) => {
    //     return po_data?.some((po) => po.procurement_request === prId)
    // }

    const getPOItemStatus = (item: any, filteredPOs: any[]) => {
        return filteredPOs.some(po =>
            po.order_list?.list.some(poItem => poItem.name === item.name)
        );
    };

    const statusRender = (status: string) => {

        const itemList = pr_data?.procurement_list?.list || [];

        if (["Approved", "RFQ Generated", "Quote Updated", "Vendor Selected"].includes(status)) {
            return "Open PR";
        }

        if(itemList?.some((i) => i?.status === "Deleted")) {
            return "Open PR"
          }

        const allItemsApproved = itemList.every(item => { return getPOItemStatus(item, po_data); });

        return allItemsApproved ? "Approved PO" : "Open PR";
    };

    const itemsTimelineList = universalComments?.map((cmt: any) => ({
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

    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc()
    const { mutate } = useSWRConfig()

    const handleDeletePr = async () => {
        try {
            await deleteDoc("Procurement Requests", pr_data?.name)
            await mutate(`Procurement Requests ${pr_data?.project}`)
            toast({
                title: "Success!",
                description: `PR: ${pr_data?.name} deleted successfully!`,
                variant: "success"
            })
            navigate("/prs&milestones/procurement-requests")
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

    const getItemStatus = (itemJson: any) => {
        // console.log(po_data)
        for (let i = 0; i < po_data?.length; i++) {
            // console.log(i, ":", po_data[i])
            for (let j = 0; j < po_data[i].order_list.list.length; j++) {
                // console.log(j, ": ", po_data[i].order_list.list[j])
                if (po_data[i].order_list.list[j].name === itemJson.name) {
                    // if (po_data[i].status === "PO Approved") {
                    //     return "PO WIP"
                    // } else return "Ordered"
                    return "Ordered"
                }
            }
        }
        return "In Progress"
    }

    const handleMarkDraftPR = async () => {
        try {
            await updateDoc("Procurement Requests", pr_data?.name, {
                workflow_state: "Draft"
            })

            await pr_data_mutate()
            navigate("edit")
        } catch (error) {
            console.log("error while marking pr as draft", error)
            toast({
                title: "Failed!",
                description: `Marking PR: ${pr_data?.name} as Draft failed!`,
                variant: "destructive"
            })
        }
    }

    const handleSendForAppr = async () => {
        try {
            await updateDoc("Procurement Requests", pr_data?.name, {
                workflow_state: "Pending"
            })
            await pr_data_mutate()

            toast({
                title: "Success!",
                description: `PR: ${pr_data?.name} Sent for approval!`,
                variant: "success"
            })

        } catch (error) {
            console.log("error while sending pr for approval", error)
            toast({
                title: "Failed!",
                description: `Sending PR: ${pr_data?.name} for approval failed!`,
                variant: "destructive"
            })
        }
    }

    return (
        <>
            <div className={`${section === "pr-summary" ? "flex-1 space-y-2 md:space-y-4" : ""}`}>
                {section === "pr-summary" && (
                    <>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1 flex-wrap ml-2">
                                {/* <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} /> */}
                                <h2 className="text-xl max-md:text-lg font-bold tracking-tight text-pageheader">Summary</h2>
                                {/* <span className="text-red-500 text-2xl max-md:text-xl">PR-{pr_no}</span> */}
                            </div>
                            <div className="flex gap-4 items-center">
                                {pr_data?.workflow_state === "Pending" && (
                                    <HoverCard>
                                        <HoverCardTrigger>
                                            <Button disabled={updateLoading} onClick={handleMarkDraftPR} className="items-center gap-2 flex" variant="secondary">{updateLoading ? <TailSpin width={20} height={16} color="white" /> : <><FileSliders className="w-4 h-4" /><span>Edit</span></>}</Button>
                                        </HoverCardTrigger>
                                        <HoverCardContent className="bg-gray-800 text-white rounded-md shadow-lg text-center">
                                            Mark as <span className="text-primary underline">Draft</span> and Edit!
                                        </HoverCardContent>
                                    </HoverCard>
                                )}

                                {pr_data?.workflow_state === "Draft" && (
                                    <Button disabled={updateLoading} onClick={handleSendForAppr}>{updateLoading ? <TailSpin width={20} height={16} color="white" /> : "Send for Approval"}</Button>
                                )}
                                {
                                    [...((!["Nirmaan Project Lead Profile", "Nirmaan Admin Profile"].includes(role) && userData?.user_id === pr_data?.owner) ? ["Rejected", "Pending"] : []), ...(["Nirmaan Project Lead Profile", "Nirmaan Admin Profile"].includes(role) ? ["Approved", "Rejected", "Pending"] : []),].includes(pr_data?.workflow_state) && (
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
                                {pr_data?.workflow_state === "Rejected" && (

                                    <Button className="flex items-center gap-1" onClick={() => navigate("resolve")}>
                                        <Settings2 className="h-4 w-4" />
                                        Resolve</Button>
                                )}
                            </div>
                        </div>
                        {/* {pr_data?.workflow_state === "Pending" && (
                            <div>
                                <Alert variant="warning" className="">
                                    <AlertTitle className="text-sm flex items-center gap-2"><MessageCircleWarning className="h-4 w-4" />Heads Up</AlertTitle>
                                    <AlertDescription>This PR can be edited by marking the same as draft by clicking on the "Mark as Draft" button which will show the edit button!</AlertDescription>
                                </Alert>
                            </div>
                        )} */}
                        <div className="flex max-lg:flex-col gap-4">
                            <div className="flex flex-col gap-4 flex-1">
                                <Card className="w-full">
                                    <CardHeader>
                                        <CardTitle className="text-xl text-red-600 flex items-center justify-between">
                                            PR Details
                                            <Badge variant={`${pr_data?.workflow_state === "Rejected" ? "red" : pr_data?.workflow_state === "Pending" ? "yellow" : pr_data?.workflow_state === "Draft" ? "indigo" : statusRender(pr_data?.workflow_state) === "Open PR" ? "orange" : statusRender(pr_data?.workflow_state) === "Approved PO" ? "green" : undefined}`}>
                                                {pr_data?.workflow_state === "Rejected" ? "Rejected" : pr_data?.workflow_state === "Pending" ? "Approval Pending" : pr_data?.workflow_state === "Draft" ? "Draft" : statusRender(pr_data?.workflow_state) === "Open PR" ? "In Progress" : statusRender(pr_data?.workflow_state) === "Approved PO" ? "Ordered" : ""}
                                            </Badge>
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="flex flex-col gap-4">
                                        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                                            <div className="space-y-1">
                                                <Label className="text-slim text-red-300">Project:</Label>
                                                <p className="font-semibold">{project?.project_name}</p>
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-slim text-red-300">Package:</Label>
                                                <p className="font-semibold">{pr_data?.work_package}</p>
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-slim text-red-300">Date Created:</Label>
                                                <p className="font-semibold">{new Date(pr_data?.creation).toDateString()}</p>
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
                                {userData.role !== "Nirmaan Project Manager Profile" && 
                                <Card className="w-full">
                                    <CardHeader>
                                        <CardTitle className="text-xl text-red-600">Associated POs:</CardTitle>
                                        <div className="overflow-x-auto">
                                            <div className="min-w-full inline-block align-middle">
                                            </div>
                                            {po_data?.length === 0 ? <p>No POs generated as of now</p>
                                                :
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow className="bg-red-100">
                                                            <TableHead className="w-[40%]">PO Number</TableHead>
                                                            <TableHead className="w-[30%]">Date Created</TableHead>
                                                            <TableHead className="w-[30%]">Status</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {po_data?.map((po) => {
                                                            return (
                                                                <TableRow key={po.name}>
                                                                    <TableCell>
                                                                        <Link to={po?.name.replaceAll("/", "&=")} className="text-blue-500 underline">{po?.name}</Link>
                                                                    </TableCell>
                                                                    <TableCell>{formatDate(po.creation)}</TableCell>
                                                                    <TableCell><Badge variant="outline">{po.status}</Badge></TableCell>
                                                                </TableRow>
                                                            )
                                                        })}
                                                    </TableBody>
                                                </Table>}
                                        </div>
                                    </CardHeader>
                                </Card>}
                                <Card className="w-full">
                                    <CardHeader>
                                        <CardTitle className="text-xl text-red-600">Associated Delivery Notes:</CardTitle>
                                        <div className="overflow-x-auto">
                                            <div className="min-w-full inline-block align-middle">
                                            </div>
                                            {po_data?.filter(item => ["Dispatched", "Delivered", "Partially Delivered"].includes(item.status)).length === 0 ? <p>No DNs generated as of now</p>
                                                :
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow className="bg-red-100">
                                                            <TableHead className="w-[40%]">DN No.</TableHead>
                                                            <TableHead className="w-[30%]">Date Created</TableHead>
                                                            <TableHead className="w-[30%]">Status</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {po_data?.filter(item => ["Dispatched", "Delivered", "Partially Delivered"].includes(item.status)).map((po) => {
                                                            return (
                                                                <TableRow key={po.name}>
                                                                    <TableCell>
                                                                        <Link to={`dn/${po?.name.replaceAll("/", "&=")}`} className="text-blue-500 underline">DN-{po?.name.split("/")[1]}</Link>
                                                                    </TableCell>
                                                                    <TableCell>{formatDate(po.creation)}</TableCell>
                                                                    <TableCell><Badge variant="outline">{po.status}</Badge></TableCell>
                                                                </TableRow>
                                                            )
                                                        })}
                                                    </TableBody>
                                                </Table>}
                                        </div>
                                    </CardHeader>
                                </Card>
                            </div>
                            <div className="flex flex-col flex-1">
                                <Card className="w-full">
                                    <CardHeader>
                                        <CardTitle className="text-xl text-red-600">Order Details</CardTitle>
                                    </CardHeader>

                                    <div className="overflow-x-auto">

                                        <div className="min-w-full inline-block align-middle">
                                            {JSON.parse(pr_data?.category_list).list.map((cat: any) => {
                                                return <div className="p-5">
                                                    {/* <div className="text-base font-semibold text-black p-2">{cat.name}</div> */}
                                                    <Table>
                                                        <TableHeader>
                                                            <TableRow className="bg-red-100">
                                                                <TableHead className="w-[50%]"><span className="text-red-700 pr-1 font-extrabold">{cat.name}</span></TableHead>
                                                                <TableHead className="w-[15%]">UOM</TableHead>
                                                                <TableHead className="w-[15%]">Qty</TableHead>
                                                                <TableHead className="w-[20%]">Status</TableHead>
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {JSON.parse(pr_data?.procurement_list).list.map((item: any) => {
                                                                // console.log(item)
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
                                                                            <TableCell><Badge variant="outline">{item.status === "Pending" ? "Pending" : item.status === "Deleted" ? "Deleted" : getItemStatus(item)}</Badge></TableCell>
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
                                <div />
                            </div>
                        </div>
                    </>
                )}

                {(section === "resolve-pr" || section === "edit-pr") && <NewPRPage project={project} rejected_pr_data={orderData} setSection={setSection} section={section} />}

            </div>
        </>
    );

}

export const Component = PRSummary;
