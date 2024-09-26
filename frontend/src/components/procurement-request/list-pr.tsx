import { ArrowLeft, CirclePlus } from "lucide-react"
import { Link, useNavigate } from "react-router-dom";
import ProjectSelect from "@/components/custom-select/project-select";
import { useState } from "react";
import {  useFrappeGetDocList } from "frappe-react-sdk";
import { Button } from "@/components/ui/button";
import { ProcurementRequests } from "@/types/NirmaanStack/ProcurementRequests";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { useUserData } from "@/hooks/useUserData";
import { Badge } from "../ui/badge";
import { ProcurementRequestsSkeleton } from "../ui/skeleton";

export default function ListPR() {

    const navigate = useNavigate();
    const userData = useUserData()
    const [project, setProject] = useState(() => {
        // Initialize state from session storage
        const savedProject = sessionStorage.getItem('selectedProject');
        return savedProject ? JSON.parse(savedProject) : null;
    });

    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList<ProcurementRequests>("Procurement Requests",
        {
            fields: ["*"],
            orderBy: { field: "creation", order: "desc" },
            limit: 1000
        },
        "Procurement Requests, orderBy(creation-desc)"
    );

    const {data : procurementOrdersList} = useFrappeGetDocList("Procurement Orders", {
        fields: ["*"],
        limit: 1000
    },
    "Procurement Orders"
    )

    const checkPoToPr = (prId) => {
        return procurementOrdersList?.some((po) => po.procurement_request === prId)
    }

    const handleChange = (selectedItem: any) => {
        console.log('Selected item:', selectedItem);
        setProject(selectedItem ? selectedItem.value : null);
        sessionStorage.setItem('selectedProject', JSON.stringify(selectedItem.value));
    };

    if (procurement_request_list_loading ) return <ProcurementRequestsSkeleton />
    if (procurement_request_list_error) return <h1>ERROR</h1>;

    return (
            <div className="flex-1 md:space-y-4 p-4">
                <div className="flex items-center pt-1 pb-4">
                    <ArrowLeft className="cursor-pointer" onClick={() => navigate('/prs&milestones')} />
                    <h2 className="text-xl pl-2  font-bold tracking-tight">Procurement Requests</h2>
                </div>
                <div className="gap-4 border border-gray-200 rounded-lg p-0.5 ">

                    <ProjectSelect onChange={handleChange} />
                    {project && <div className="mx-0 px-0 pt-4">
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
                                    if (item.project === project && item.owner === userData.user_id) {
                                        return <TableRow key={item.name}>
                                            <TableCell className="text-sm text-center"><Link to={`${item.name}`} className="text-blue-500 underline-offset-1">{item.name.slice(-4)}</Link></TableCell>
                                            <TableCell className="text-sm text-center">{item.work_package}</TableCell>
                                            <TableCell className="text-sm text-center">
                                                <Badge variant={`${["RFQ Generated", "Quote Updated", "Vendor Selected"].includes(item.workflow_state) ? "orange" : ["Partially Approved", "Vendor Approved"].includes(item.workflow_state) ? "green" : (["Delayed", "Sent Back"].includes(item.workflow_state) && checkPoToPr(item.name)) ? "green" : (["Delayed", "Sent Back"].includes(item.workflow_state) && !checkPoToPr(item.name)) ? "orange" : item.workflow_state === "Rejected" ? "red" : "yellow"}`}>
                                                    {["RFQ Generated", "Quote Updated", "Vendor Selected"].includes(item.workflow_state) ? "In Progress" : ["Partially Approved", "Vendor Approved"].includes(item.workflow_state) ? "Ordered" : (["Delayed", "Sent Back"].includes(item.workflow_state) && checkPoToPr(item.name)) ? "Ordered" : (["Delayed", "Sent Back"].includes(item.workflow_state) && !checkPoToPr(item.name)) ? "In Progress" : item.workflow_state}
                                                </Badge>
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
                                    <TableHead className="w-[30%] text-center font-extrabold">PR no.</TableHead>
                                    <TableHead className="w-[35%] text-center font-extrabold">Package</TableHead>
                                    <TableHead className="w-[35%] text-center font-extrabold">Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {procurement_request_list?.map((item) => {
                                    if (item.project === project && item.owner !== userData.user_id) {
                                        return <TableRow key={item.name}>
                                            <TableCell className="text-sm text-center"><Link to={`${item.name}`} className="text-blue-500 underline-offset-1">{item.name.slice(-4)}</Link></TableCell>
                                            <TableCell className="text-sm text-center">{item.work_package}</TableCell>
                                            <TableCell className="text-sm text-center">
                                                <Badge variant={`${["RFQ Generated", "Quote Updated", "Vendor Selected"].includes(item.workflow_state) ? "orange" : ["Partially Approved", "Vendor Approved"].includes(item.workflow_state) ? "green" : (["Delayed", "Sent Back"].includes(item.workflow_state) && checkPoToPr(item.name)) ? "green" : (["Delayed", "Sent Back"].includes(item.workflow_state) && !checkPoToPr(item.name)) ? "orange" : item.workflow_state === "Rejected" ? "red" : "yellow"}`}>
                                                    {["RFQ Generated", "Quote Updated", "Vendor Selected"].includes(item.workflow_state) ? "In Progress" : ["Partially Approved", "Vendor Approved"].includes(item.workflow_state) ? "Ordered" : (["Delayed", "Sent Back"].includes(item.workflow_state) && checkPoToPr(item.name)) ? "Ordered" : (["Delayed", "Sent Back"].includes(item.workflow_state) && !checkPoToPr(item.name)) ? "In Progress" : item.workflow_state}
                                                </Badge>
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
                                    Create New PR
                                </div>

                            </Link>
                        </Button>}
                    </div>
                </div>
                <div className="pt-10"></div>
            </div>
    );
}