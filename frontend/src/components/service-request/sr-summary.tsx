import { ServiceRequests as ServiceRequestsType } from "@/types/NirmaanStack/ServiceRequests";
import { useFrappeDeleteDoc, useFrappeGetDoc, useFrappeGetDocList, useSWRConfig } from "frappe-react-sdk";
import { useNavigate, useParams } from "react-router-dom"
import { NewPRSkeleton } from "../ui/skeleton";
import { useEffect, useState } from "react";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { useUserData } from "@/hooks/useUserData";
import { ArrowLeft, ListChecks, MessageCircleMore, Settings2, Trash2, Undo2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { toast } from "../ui/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Label } from "../ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { NirmaanComments as NirmaanCommentsType } from "@/types/NirmaanStack/NirmaanComments";
import { NirmaanUsers as NirmaanUsersType } from "@/types/NirmaanStack/NirmaanUsers";
import { formatDate } from "@/utils/FormatDate";
import { Timeline } from "antd";

const SrSummary = () => {

    const { id } = useParams<{ id: any }>();

    const [project, setProject] = useState<string | undefined>()


    const { data: sr_data, isLoading: sr_loading, error: sr_error } = useFrappeGetDoc<ServiceRequestsType>("Service Requests", id);

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

    useEffect(() => {
        if (sr_data) {
            setProject(sr_data?.project)
        }
    }, [sr_data])

    const { data: project_data, error: project_data_error, isLoading: project_data_loading } = useFrappeGetDoc<ProjectsType>("Projects", project);

    return (
        <>  {(sr_loading || project_data_loading || userLoading || universalCommentsLoading) ? <NewPRSkeleton /> : <SrSummaryPage sr_data={sr_data} project_data={project_data} universalComments={universalComments} usersList={usersList} />}
            {(sr_error || project_data_error || userError || universalCommentsError) && <h1>Errro</h1>}
        </>
    )
};

interface SrSummaryPageProps {
    sr_data: ServiceRequestsType | undefined
    project_data: ProjectsType | undefined
    usersList: NirmaanUsersType[] | undefined
    universalComments: NirmaanCommentsType[] | undefined
}

export const SrSummaryPage = ({ sr_data, project_data, usersList, universalComments }: SrSummaryPageProps) => {
    const navigate = useNavigate();
    const sr_no = sr_data?.name.split("-").slice(-1)
    const userData = useUserData()

    const { mutate } = useSWRConfig()
    const { deleteDoc } = useFrappeDeleteDoc()

    const getFullName = (id: string) => {
        return usersList?.find((user) => user.name === id)?.full_name
    }

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


    const handleDeleteSr = async () => {
        try {
            await deleteDoc("Service Requests", sr_data?.name)
            await mutate("Service Requests,orderBy(creation-desc)")
            toast({
                title: "Success!",
                description: `SR: ${sr_data?.name} deleted successfully!`,
                variant: "success"
            })
            navigate("/service-request")
        } catch (error) {
            console.log("error while deleting SR", error)
            toast({
                title: "Failed!",
                description: `SR: ${sr_data?.name} deletion Failed!`,
                variant: "destructive"
            })
        }
    }

    return (
        <>
            <div className="flex-1 space-y-2 md:space-y-4">
                <>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 flex-wrap">
                            <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} />
                            <h2 className="text-xl max-md:text-lg font-bold tracking-tight">Summary: </h2>
                            <span className="text-red-500 text-2xl max-md:text-xl">SR-{sr_no}</span>
                        </div>
                        <div className="flex gap-4 items-center">
                            {
                                ["Created", userData?.role === "Nirmaan Procurement Executive Profile" ? "Vendor Selected" : ""].includes(sr_data?.status) && (
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
                                                    <AlertDialogAction className="flex items-center gap-1" onClick={handleDeleteSr}>
                                                        <ListChecks className="h-4 w-4" />
                                                        Confirm
                                                    </AlertDialogAction>
                                                </div>
                                            </AlertDialogDescription>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                )
                            }
                            {sr_data?.status === "Rejected" && (

                                <Button className="flex items-center gap-1">
                                    <Settings2 className="h-4 w-4" />
                                    Resolve</Button>
                            )}
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <Card className="w-full">
                            <CardHeader>
                                <CardTitle className="text-xl text-red-600 flex items-center justify-between">
                                    SR Details
                                    {/* <Badge variant={`${["RFQ Generated", "Quote Updated", "Vendor Selected"].includes(pr_data?.workflow_state) ? "orange" : ["Partially Approved", "Vendor Approved"].includes(pr_data?.workflow_state) ? "green" : (["Delayed", "Sent Back"].includes(pr_data?.workflow_state) && checkPoToPr(pr_data?.name)) ? "green" : (["Delayed", "Sent Back"].includes(pr_data.workflow_state) && !checkPoToPr(pr_data.name)) ? "orange" : pr_data.workflow_state === "Rejected" ? "red" : "yellow"}`}>
                                            {["RFQ Generated", "Quote Updated", "Vendor Selected"].includes(pr_data?.workflow_state) ? "In Progress" : ["Partially Approved", "Vendor Approved"].includes(pr_data?.workflow_state) ? "Ordered" : (["Delayed", "Sent Back"].includes(pr_data?.workflow_state) && checkPoToPr(pr_data?.name)) ? "Ordered" : (["Delayed", "Sent Back"].includes(pr_data.workflow_state) && !checkPoToPr(pr_data.name)) ? "In Progress" : pr_data.workflow_state === "Pending" ? "Approval Pending" : pr_data.workflow_state}
                                        </Badge> */}
                                    {sr_data?.status}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="flex flex-col gap-4">
                                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                                    <div className="space-y-1">
                                        <Label className="text-slim text-red-300">Project:</Label>
                                        <p className="font-semibold">{project_data?.project_name}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-slim text-red-300">Package:</Label>
                                        <p className="font-semibold">Services</p>
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-slim text-red-300">Date Created:</Label>
                                        <p className="font-semibold">{new Date(sr_data?.creation).toDateString()}</p>
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
                                    {JSON.parse(sr_data?.service_category_list).list.map((cat: any) => {
                                        return <div className="p-5">
                                            {/* <div className="text-base font-semibold text-black p-2">{cat.name}</div> */}
                                            <Table>
                                                <TableHeader>
                                                    <TableRow className="bg-red-100">
                                                        <TableHead className="w-[80%]"><span className="text-red-700 pr-1 font-extrabold">{cat.name}</span></TableHead>
                                                        <TableHead className="w-[20%]">Status</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {JSON.parse(sr_data?.service_order_list).list.map((item: any) => {
                                                        // console.log(item)
                                                        if (item.category === cat.name) {
                                                            return (
                                                                <TableRow key={item.description}>
                                                                    <TableCell>{item.description}</TableCell>
                                                                    <TableCell>
                                                                        {/* <Badge variant="outline">{item.status === "Pending" ? "Pending" : getItemStatus(item)}</Badge> */}
                                                                        {sr_data?.status}
                                                                    </TableCell>
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
                        {/* {userData.role !== "Nirmaan Project Manager Profile" && <Card className="w-full">
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
                            </Card>} */}
                    </div>
                </>
            </div>
        </>
    )
}

export const Component = SrSummary