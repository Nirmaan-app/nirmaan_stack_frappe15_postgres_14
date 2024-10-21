import { useFrappeGetDocList, useFrappeDocTypeEventListener } from "frappe-react-sdk";
import { CirclePlus, Milestone, PackagePlus, ShoppingCart, Truck } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react"
import { ArrowLeft } from 'lucide-react';
import ReactSelect from 'react-select';
import { Button } from "./ui/button";

function DashboardCard({ title, icon, onClick, className, beta = false }: any) {
    return (
        <Button
            variant="ghost"
            className={`h-[150px] w-full p-0 ${className}`}
            onClick={onClick}
        >
            <div className="flex h-full w-full flex-col justify-between p-6">
                <div className="text-left">
                    <p className="text-lg font-semibold text-white text-wrap">{title}</p>
                    {beta && <span className="text-xs text-white/70">*(beta)</span>}
                </div>
                <div className="self-end">{icon}</div>
            </div>
        </Button>
    )
}


export const ProjectManager = () => {
    const navigate = useNavigate();

    const { data: project_list, isLoading: project_list_loading, error: project_list_error, mutate: project_list_mutate } = useFrappeGetDocList("Projects",
        {
            fields: ['name', 'project_name', 'project_address', "project_manager"],
            limit: 1000
        });
    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error, mutate: procurement_request_list_mutate } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'owner', 'project', 'work_package', 'procurement_list', 'creation', 'workflow_state'],
            limit: 1000
        });

    useFrappeDocTypeEventListener("Procurement Requests",async () => {
        await procurement_request_list_mutate()
    })
    useFrappeDocTypeEventListener("Projects",async () => {
        await project_list_mutate()
    })

    const [orderData, setOrderData] = useState({
        project: '',
        work_package: '',
        procurement_list: {
            list: []
        },
        category_list: {
            list: []
        }
    })

    const [page, setPage] = useState<string>('dashboard')

    const project_options = [];

    const handleChange = (selectedItem) => {
        console.log('Selected item:', selectedItem);
        setOrderData(prevData => ({
            ...prevData,
            project: selectedItem.value
        }));
    }

    if (project_list?.length != project_options.length) {
        project_list?.map((proj) => {
            project_options.push({ value: proj.name, label: proj.project_name })
        })
    }


    return (
        <>
            {page == 'dashboard' &&
                <div className="flex-1 space-y-4 p-8 max-md:p-4">
                    <div className="flex items-center justify-between space-y-2">
                        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
                    </div>
                    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-3">
                        <DashboardCard
                            title="Create Procurement Request"
                            icon={<ShoppingCart className="h-8 w-8 text-white" />}
                            onClick={() => navigate("/procurement-request")}
                            className="bg-red-600"
                        />
                        {/* <DashboardCard
                            title="Update Milestones"
                            icon={<Milestone className="h-8 w-8 text-white" />}
                            onClick={() => navigate("/milestone-update")}
                            className="bg-red-600"
                        /> */}
                        <DashboardCard
                            title="Update Delivery Notes"
                            icon={<Truck className="h-8 w-8 text-white" />}
                            onClick={() => navigate("/delivery-notes")}
                            className="bg-red-600"
                        />
                    </div>
                </div>}
            {
                page == 'newprlist' && <div className="flex-1 md:space-y-4">
                    <div className="flex items-center gap-1">
                        <ArrowLeft onClick={() => setPage('dashboard')} />
                        <h2 className="text-base font-bold tracking-tight">Procurement Requests</h2>
                    </div>
                    <div className="gap-4 border border-gray-200 rounded-lg p-0.5">
                        {/* <DropdownMenu2 items={project_lists} onSelect={handleProjectSelect} /> */}
                        <ReactSelect options={project_options} onChange={handleChange} placeholder="Select Project" />
                        {orderData.project && <div className="container mx-0 px-0 pt-4">

                            <table className="table-auto w-full">
                                <thead>
                                    <tr className="w-full border-b">
                                        <th className="px-4 py-1 text-xs text-gray-600">PR no.</th>
                                        <th className="px-4 py-1 text-xs text-gray-600">Package</th>
                                        <th className="px-4 py-1 text-xs text-gray-600">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="w-full">
                                    {procurement_request_list?.map((item) => {
                                        if (item.project === orderData.project) {
                                            return <tr key={item.name} >
                                                <td className="border-b-2 px-4 py-1 text-sm text-center text-blue-500"><Link to={`/pr-summary/${item.name}`}>{item.name.slice(-4)}</Link></td>
                                                <td className="border-b-2 px-4 py-1 text-sm text-center">{item.work_package}</td>
                                                <td className="border-b-2 px-4 py-1 text-sm text-center">{item.workflow_state}</td>
                                            </tr>
                                        }
                                    })}
                                </tbody>
                            </table>

                        </div>}
                        <div className="flex flex-col justify-end items-end fixed bottom-4 right-4">
                            {orderData.project && <Button className="font-normal py-2 px-6">
                                <Link to={`/new-pr/${orderData.project}`}>
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
            }
        </>
    )
}

