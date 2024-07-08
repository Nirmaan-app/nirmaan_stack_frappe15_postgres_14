import { ArrowLeft, CirclePlus } from "lucide-react"
import { Link, useNavigate } from "react-router-dom";
import ProjectSelect from "@/components/custom-select/project-select";
import { useState } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Button } from "@/components/ui/button";
import { ProcurementRequests } from "@/types/NirmaanStack/ProcurementRequests";
import { MainLayout } from "../layout/main-layout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { useUserData } from "@/hooks/useUserData";

export default function ListPR() {

    const navigate = useNavigate();
    const userData = useUserData()
    const [project, setProject] = useState();

    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList<ProcurementRequests>("Procurement Requests",
        {
            fields: ['name', 'owner', 'project', 'work_package', 'procurement_list', 'creation', 'workflow_state'],
            orderBy: { field: "creation", order: "desc" },
            limit: 1000
        });

    const handleChange = (selectedItem: any) => {
        console.log('Selected item:', selectedItem);
        setProject(selectedItem ? selectedItem.value : null);
    };

    if (procurement_request_list_loading) return <h1>LOADING</h1>;
    if (procurement_request_list_error) return <h1>ERROR</h1>;
    return (
        <MainLayout>
            <div className="flex-1 md:space-y-4 p-4 md:p-6 pt-6">
                <div className="flex items-center pt-1 pb-4">
                    <ArrowLeft onClick={() => navigate('/')} />
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
                                            <TableCell className="text-sm text-center">{item.workflow_state}</TableCell>
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
                                            <TableCell className="text-sm text-center">{item.workflow_state}</TableCell>
                                        </TableRow>
                                    }
                                })}
                            </TableBody>
                        </Table>
                    </div>}

                    <div className="flex flex-col justify-end items-end fixed bottom-4 right-4">
                        {project && <Button className="font-normal py-2 px-6">
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
        </MainLayout>
    );
}