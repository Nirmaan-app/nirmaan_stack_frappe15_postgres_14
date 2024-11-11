import { ArrowLeft, CirclePlus } from "lucide-react"
import { Link, useNavigate } from "react-router-dom";
import ProjectSelect from "@/components/custom-select/project-select";
import { useContext, useState } from "react";
import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { useUserData } from "@/hooks/useUserData";
import { Badge } from "../ui/badge";
import { ProcurementRequestsSkeleton } from "../ui/skeleton";
import { useNotificationStore } from "@/zustand/useNotificationStore";
import { ServiceRequests as ServiceRequestsType } from "@/types/NirmaanStack/ServiceRequests";
import { ProjectTypes } from "@/types/NirmaanStack/ProjectTypes";

export default function ListSR() {

    const navigate = useNavigate();
    const userData = useUserData()
    const [project, setProject] = useState<string | undefined>(() => {
        // Initialize state from session storage
        const savedProject = sessionStorage.getItem('selectedProject');
        return savedProject ? JSON.parse(savedProject) : null;
    });

    // const {notifications, mark_seen_notification} = useNotificationStore()

    const { data: service_request_list, isLoading: service_request_list_loading, error: service_request_list_error, mutate: srListMutate } = useFrappeGetDocList<ServiceRequestsType>("Service Requests",
        {
            fields: ["*"],
            orderBy: { field: "creation", order: "desc" },
            limit: 1000
        },
        project ? undefined : null
    );

    useFrappeDocTypeEventListener("Service Requests", async (event) => {
        await srListMutate()
    })

    // const {data : procurementOrdersList} = useFrappeGetDocList("Procurement Orders", {
    //     fields: ["*"],
    //     limit: 1000
    // },
    // "Procurement Orders"
    // )

    // const checkPoToPr = (prId) => {
    //     return procurementOrdersList?.some((po) => po.procurement_request === prId)
    // }

    const handleChange = (selectedItem: any) => {
        setProject(selectedItem ? selectedItem.value : null);
        sessionStorage.setItem('selectedProject', JSON.stringify(selectedItem.value));
    };

    const { db } = useContext(FrappeContext) as FrappeConfig
    // const handleRejectPRSeen = (notification) => {
    //     console.log("running", notification)
    //     if(notification) {
    //         mark_seen_notification(db, notification)
    //     }
    // }

    if (service_request_list_loading) return <ProcurementRequestsSkeleton />
    if (service_request_list_error) return <h1>ERROR</h1>;

    return (
        <div className="flex-1 space-y-4">
            <div className="flex items-center gap-1">
                <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} />
                <h2 className="text-xl  font-bold tracking-tight">Service Requests</h2>
            </div>

            <div className="gap-4 border border-gray-200 rounded-lg p-0.5 ">
                <ProjectSelect onChange={handleChange} />
                {project && <div className="mx-0 px-0 pt-4">
                    <h2 className="text-lg pl-2 font-semibold tracking-normal py-2">Created By {userData?.full_name}</h2>
                    <Table>
                        <TableHeader className="bg-red-100">
                            <TableRow>
                                <TableHead className="w-[30%] text-center font-extrabold">SR no.</TableHead>
                                {/* <TableHead className="w-[35%] text-center font-extrabold">Package</TableHead> */}
                                <TableHead className="w-[35%] text-center font-extrabold">Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {service_request_list?.map((item) => {
                                if (item.project === project && item.owner === userData.user_id) {
                                    // const isNew = notifications.find(
                                    //     (i) =>  i.docname === item?.name && i.seen === "false" && i.event_id === "pr:rejected"
                                    // )
                                    return <TableRow key={item.name}>
                                        <TableCell className="text-sm text-center">
                                            <Link to={`${item.name}`} className="text-blue-500 underline-offset-1 relative">
                                                {/* {item.workflow_state === "Rejected" && isNew && (
                                                        <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 sm:-left-10  animate-pulse" />
                                                    )} */}
                                                <span>{item.name.slice(-4)}</span>
                                                {/* <span onClick={() => handleRejectPRSeen(isNew)}>{item.name.slice(-4)}</span> */}
                                            </Link>
                                        </TableCell>
                                        {/* <TableCell className="text-sm text-center">{item.work_package}</TableCell> */}
                                        <TableCell className="text-sm text-center">
                                            {/* <Badge variant={`${["RFQ Generated", "Quote Updated", "Vendor Selected"].includes(item.workflow_state) ? "orange" : ["Partially Approved", "Vendor Approved"].includes(item.workflow_state) ? "green" : (["Delayed", "Sent Back"].includes(item.workflow_state) && checkPoToPr(item.name)) ? "green" : (["Delayed", "Sent Back"].includes(item.workflow_state) && !checkPoToPr(item.name)) ? "orange" : item.workflow_state === "Rejected" ? "red" : "yellow"}`}>
                                                    {["RFQ Generated", "Quote Updated", "Vendor Selected"].includes(item.workflow_state) ? "In Progress" : ["Partially Approved", "Vendor Approved"].includes(item.workflow_state) ? "Ordered" : (["Delayed", "Sent Back"].includes(item.workflow_state) && checkPoToPr(item.name)) ? "Ordered" : (["Delayed", "Sent Back"].includes(item.workflow_state) && !checkPoToPr(item.name)) ? "In Progress" : item.workflow_state === "Pending" ? "Approval Pending" : item.workflow_state}
                                                </Badge> */}
                                            <span>{item.status}</span>
                                        </TableCell>
                                    </TableRow>
                                }
                            })}
                        </TableBody>
                    </Table>
                </div>}

                {project && <div className="mx-0 px-0 pt-4">
                    <h2 className="text-lg pl-2 font-semibold tracking-normal py-2">Created By Others</h2>
                    <Table>
                        <TableHeader className="bg-red-100">
                            <TableRow>
                                <TableHead className="w-[30%] text-center font-extrabold">SR no.</TableHead>
                                {/* <TableHead className="w-[35%] text-center font-extrabold">Package</TableHead> */}
                                <TableHead className="w-[35%] text-center font-extrabold">Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {service_request_list?.map((item) => {
                                if (item.project === project && item.owner !== userData.user_id) {
                                    // const isNew = notifications.find(
                                    //     (i) =>  i.docname === item?.name && i.seen === "false" && i.event_id === "pr:rejected"
                                    // )
                                    return <TableRow key={item.name}>
                                        <TableCell className="text-sm text-center">
                                            <Link to={`${item.name}`} className="text-blue-500 underline-offset-1">
                                                {/* {item.workflow_state === "Rejected" && isNew && (
                                                        <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 sm:-left-10  animate-pulse" />
                                                )} */}
                                                <span>{item.name.slice(-4)}</span>
                                                {/* <span onClick={() => handleRejectPRSeen(isNew)}>{item.name.slice(-4)}</span> */}
                                            </Link></TableCell>
                                        {/* <TableCell className="text-sm text-center">{item.work_package}</TableCell> */}
                                        <TableCell className="text-sm text-center">
                                            {/* <Badge variant={`${["RFQ Generated", "Quote Updated", "Vendor Selected"].includes(item.workflow_state) ? "orange" : ["Partially Approved", "Vendor Approved"].includes(item.workflow_state) ? "green" : (["Delayed", "Sent Back"].includes(item.workflow_state) && checkPoToPr(item.name)) ? "green" : (["Delayed", "Sent Back"].includes(item.workflow_state) && !checkPoToPr(item.name)) ? "orange" : item.workflow_state === "Rejected" ? "red" : "yellow"}`}>
                                                    {["RFQ Generated", "Quote Updated", "Vendor Selected"].includes(item.workflow_state) ? "In Progress" : ["Partially Approved", "Vendor Approved"].includes(item.workflow_state) ? "Ordered" : (["Delayed", "Sent Back"].includes(item.workflow_state) && checkPoToPr(item.name)) ? "Ordered" : (["Delayed", "Sent Back"].includes(item.workflow_state) && !checkPoToPr(item.name)) ? "In Progress" : item.workflow_state === "Pending" ? "Approval Pending" : item.workflow_state}
                                                </Badge> */}
                                            <span>{item.status}</span>
                                        </TableCell>
                                    </TableRow>
                                }
                            })}
                        </TableBody>
                    </Table>
                </div>}

                <div className="flex flex-col justify-end items-end fixed bottom-10 right-4">
                    {project && <Button className="font-normal py-2 px-6 shadow-red-950">
                        <Link to={`${project}/new`}>
                            <div className="flex">
                                <CirclePlus className="w-5 h-5 mt- pr-1" />
                                Create SR
                            </div>

                        </Link>
                    </Button>}
                </div>
            </div>
            <div className="pt-10"></div>
        </div>
    );
}