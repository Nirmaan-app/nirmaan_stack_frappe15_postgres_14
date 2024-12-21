import { ArrowLeft, CirclePlus } from "lucide-react"
import { Link, useNavigate } from "react-router-dom";
import ProjectSelect from "@/components/custom-select/project-select";
import { useContext, useState } from "react";
import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import { Button } from "@/components/ui/button";
import { ProcurementRequests } from "@/types/NirmaanStack/ProcurementRequests";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { useUserData } from "@/hooks/useUserData";
import { Badge } from "../ui/badge";
import { ProcurementRequestsSkeleton } from "../ui/skeleton";
import { useNotificationStore } from "@/zustand/useNotificationStore";
import { UserContext } from "@/utils/auth/UserProvider";

export default function ListPR() {

    const navigate = useNavigate();
    const userData = useUserData()

    const { setSelectedProject, selectedProject } = useContext(UserContext)

    const { notifications, mark_seen_notification } = useNotificationStore()

    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error, mutate: prListMutate } = useFrappeGetDocList<ProcurementRequests>("Procurement Requests",
        {
            fields: ["*"],
            filters: [["project", "=", selectedProject]],
            orderBy: { field: "modified", order: "desc" },
            limit: 1000
        },
        selectedProject ? `Procurement Requests ${selectedProject}` : null
    );

    useFrappeDocTypeEventListener("Procurement Requests", async (event) => {
        await prListMutate()
    })

    const { data: procurementOrdersList } = useFrappeGetDocList("Procurement Orders", {
        fields: ["*"],
        filters: [["project", "=", selectedProject]],
        limit: 1000
    },
        selectedProject ? `Procurement Orders ${selectedProject}` : null
    )

    const checkPoToPr = (prId) => {
        return procurementOrdersList?.some((po) => po.procurement_request === prId)
    }

    const handleChange = (selectedItem: any) => {
        setSelectedProject(selectedItem ? selectedItem.value : null)
        sessionStorage.setItem('selectedProject', JSON.stringify(selectedItem.value));
    };

    const { db } = useContext(FrappeContext) as FrappeConfig
    const handleRejectPRSeen = (notification) => {
        // console.log("running", notification)
        if (notification) {
            mark_seen_notification(db, notification)
        }
    }

    if (procurement_request_list_loading) return <ProcurementRequestsSkeleton />
    if (procurement_request_list_error) return <h1>ERROR</h1>;

    return (
        <div className="flex-1 space-y-4">
            {/* <div className="flex items-center gap-1">
                <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} />
                <h2 className="text-xl  font-bold tracking-tight">Procurement Requests</h2>
            </div> */}

            <div className="gap-4 border border-gray-200 rounded-lg p-0.5">
                <ProjectSelect onChange={handleChange} />
                {selectedProject && <div className="mx-0 px-0 pt-4">
                    <h2 className="text-lg pl-2 font-semibold tracking-normal py-2">Created By {userData?.full_name}</h2>
                    <Table>
                        <TableHeader className="bg-red-100">
                            <TableRow>
                                <TableHead className="w-[30%] text-center font-extrabold">PR no.</TableHead>
                                <TableHead className="w-[35%] text-center font-extrabold">Package</TableHead>
                                <TableHead className="w-[35%] text-center font-extrabold">Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {procurement_request_list?.map((item) => {
                                if (item.owner === userData.user_id) {
                                    const isNew = notifications.find(
                                        (i) => i.docname === item?.name && i.seen === "false" && i.event_id === "pr:rejected"
                                    )
                                    return <TableRow key={item.name}>
                                        <TableCell className="text-sm text-center">
                                            <Link to={`${item.name}`} className="text-blue-500 underline-offset-1 relative">
                                                {item.workflow_state === "Rejected" && isNew && (
                                                    <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 sm:-left-10  animate-pulse" />
                                                )}
                                                <span onClick={() => handleRejectPRSeen(isNew)}>{item.name.slice(-4)}</span>
                                            </Link>
                                        </TableCell>
                                        <TableCell className="text-sm text-center">{item.work_package}</TableCell>
                                        <TableCell className="text-sm text-center">
                                            <Badge variant={`${["RFQ Generated", "Quote Updated", "Vendor Selected"].includes(item.workflow_state) ? "orange" : ["Partially Approved", "Vendor Approved"].includes(item.workflow_state) ? "darkGreen" : (["Delayed", "Sent Back"].includes(item.workflow_state) && checkPoToPr(item.name)) ? "darkGreen" : (["Delayed", "Sent Back"].includes(item.workflow_state) && !checkPoToPr(item.name)) ? "orange" : item.workflow_state === "Rejected" ? "red" : item.workflow_state === "Pending" ?  "yellow" : item.workflow_state === "Approved" ? "green" : "secondary"}`}>
                                                {["RFQ Generated", "Quote Updated", "Vendor Selected"].includes(item.workflow_state) ? "In Progress" : ["Partially Approved", "Vendor Approved"].includes(item.workflow_state) ? "Ordered" : (["Delayed", "Sent Back"].includes(item.workflow_state) && checkPoToPr(item.name)) ? "Ordered" : (["Delayed", "Sent Back"].includes(item.workflow_state) && !checkPoToPr(item.name)) ? "In Progress" : item.workflow_state === "Pending" ? "Approval Pending" : item.workflow_state}
                                            </Badge>
                                        </TableCell>
                                    </TableRow>
                                }
                            })}
                        </TableBody>
                    </Table>
                </div>}

                {selectedProject && <div className="mx-0 px-0 pt-4">
                    <h2 className="text-lg pl-2 font-semibold tracking-normal py-2">Created By Others</h2>
                    <Table>
                        <TableHeader className="bg-red-100">
                            <TableRow>
                                <TableHead className="w-[30%] text-center font-extrabold">PR no.</TableHead>
                                <TableHead className="w-[35%] text-center font-extrabold">Package</TableHead>
                                <TableHead className="w-[35%] text-center font-extrabold">Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {procurement_request_list?.map((item) => {
                                if (item.owner !== userData.user_id) {
                                    const isNew = notifications.find(
                                        (i) => i.docname === item?.name && i.seen === "false" && i.event_id === "pr:rejected"
                                    )
                                    return <TableRow key={item.name}>
                                        <TableCell className="text-sm text-center">
                                            <Link to={`${item.name}`} className="text-blue-500 underline-offset-1">
                                                {item.workflow_state === "Rejected" && isNew && (
                                                    <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 sm:-left-10  animate-pulse" />
                                                )}
                                                <span onClick={() => handleRejectPRSeen(isNew)}>{item.name.slice(-4)}</span>
                                            </Link></TableCell>
                                        <TableCell className="text-sm text-center">{item.work_package}</TableCell>
                                        <TableCell className="text-sm text-center">
                                            <Badge variant={`${["RFQ Generated", "Quote Updated", "Vendor Selected"].includes(item.workflow_state) ? "orange" : ["Partially Approved", "Vendor Approved"].includes(item.workflow_state) ? "darkGreen" : (["Delayed", "Sent Back"].includes(item.workflow_state) && checkPoToPr(item.name)) ? "darkGreen" : (["Delayed", "Sent Back"].includes(item.workflow_state) && !checkPoToPr(item.name)) ? "orange" : item.workflow_state === "Rejected" ? "red" : item.workflow_state === "Pending" ?  "yellow" : item.workflow_state === "Approved" ? "green" : "secondary"}`}>
                                                {["RFQ Generated", "Quote Updated", "Vendor Selected"].includes(item.workflow_state) ? "In Progress" : ["Partially Approved", "Vendor Approved"].includes(item.workflow_state) ? "Ordered" : (["Delayed", "Sent Back"].includes(item.workflow_state) && checkPoToPr(item.name)) ? "Ordered" : (["Delayed", "Sent Back"].includes(item.workflow_state) && !checkPoToPr(item.name)) ? "In Progress" : item.workflow_state === "Pending" ? "Approval Pending" : item.workflow_state}
                                            </Badge>
                                        </TableCell>
                                    </TableRow>
                                }
                            })}
                        </TableBody>
                    </Table>
                </div>}

                {/* <div className="flex flex-col justify-end items-end fixed bottom-10 right-4">
                    {project && <Button className="font-normal py-2 px-6 shadow-red-950">
                        <Link to={`${project}/new-pr`}>
                            <div className="flex">
                                <CirclePlus className="w-5 h-5 mt- pr-1" />
                                Create New PR
                            </div>

                        </Link>
                    </Button>}
                </div> */}
            </div>
            <div className="pt-10"></div>
        </div>
    );
}