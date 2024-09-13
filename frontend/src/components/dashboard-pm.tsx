import { Breadcrumb, BreadcrumbItem, BreadcrumbLink } from "./breadcrumb";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { useFrappeGetDocCount, useFrappeGetDocList, useFrappeGetDoc, useFrappeCreateDoc, useFrappeUpdateDoc, useFrappeDocTypeEventListener } from "frappe-react-sdk";
import { HardHat, UserRound, PersonStanding, CirclePlus } from "lucide-react";
import { TailSpin } from "react-loader-spinner";
import { Link, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react"
import DropdownMenu from './dropdown';
import DropdownMenu2 from './dropdown2';
import { ArrowLeft } from 'lucide-react';
import ReactSelect from 'react-select';
import { useUserData } from "@/hooks/useUserData";

import imageUrl from "@/assets/user-icon.jpeg"
import { Button } from "./ui/button";
import { MainLayout } from "./layout/main-layout";
import NewMilestones from "./updates/NewMilestones";


export const ProjectManager = () => {
    const navigate = useNavigate();
    const userData = useUserData();

    // const { data: project_count, isLoading: project_count_loading, error: project_count_error } = useFrappeGetDocCount("Projects");
    // const { data: wp_list, isLoading: wp_list_loading, error: wp_list_error } = useFrappeGetDocList("Work Packages",
    //     {
    //         fields: ['work_package_name']
    //     });
    // const { data: category_list, isLoading: category_list_loading, error: category_list_error } = useFrappeGetDocList("Category",
    //     {
    //         fields: ['category_name', 'work_package']
    //     });
    // const { data: item_list, isLoading: item_list_loading, error: item_list_error } = useFrappeGetDocList("Items",
    //     {
    //         fields: ['name', 'item_name', 'unit_name', 'category'],
    //         limit: 1000
    //     });
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

    useFrappeDocTypeEventListener("Procurement Requests", () => {
        procurement_request_list_mutate()
    })
    useFrappeDocTypeEventListener("Projects", () => {
        project_list_mutate()
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
    const { data: project_work_milestones_list, isLoading: project_work_milestones_list_loading, error: project_work_milestones_list_error, mutate: project_work_milestones_list_mutate } = useFrappeGetDocList("Project Work Milestones",
        {
            fields: ['name', 'project', 'work_package', 'scope_of_work', 'milestone', 'start_date', 'end_date', 'status'],
            limit: 1000
        });

    interface Category {
        name: string;
    }

    const [page, setPage] = useState<string>('dashboard')
    // const [curItem, setCurItem] = useState<string>('')
    // const [curCategory, setCurCategory] = useState<string>('')
    // const [unit, setUnit] = useState<string>('')
    // const [quantity, setQuantity] = useState<number>()
    // const [item_id, setItem_id] = useState<string>('');
    // const [categories, setCategories] = useState<{ list: Category[] }>({ list: [] });
    const [curMilestone, setCurMilestone] = useState<string>('')
    // const [selectedOption, setSelectedOption] = useState('');

    const handleClick = (value: string) => {
        setPage(value);
    };

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

    const { updateDoc: updateDoc, loading: update_loading, isCompleted: update_submit_complete, error: update_submit_error } = useFrappeUpdateDoc()

    const handleMilestone = (value) => {
        const mile_data = project_work_milestones_list?.find(item => item.name === value)
        setCurMilestone(mile_data)
        setPage('milestone')
    }

    const handleMilestoneChange = (value, id) => {
        console.log('Selected:', value);
        setCurMilestone(prevData => ({
            ...prevData,
            status: value
        }))
        updateDoc('Project Work Milestones', id, {
            status: value,
        })
            .then(() => {
                console.log(id)
                project_work_milestones_list_mutate();
            }).catch(() => {
                console.log(update_submit_error)
            })
    };
    console.log(curMilestone)

    return (
        <>
            {/* <MainLayout> */}
            {page == 'dashboard' && <div className="flex">
                <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                    <div className="flex items-center space-y-2">
                        {/* <ArrowLeft className="cursor-pointer" onClick={() => navigate("/")} /> */}
                        <h2 className="text-xl pt-1 pl-2 pb-4 font-bold tracking-tight">Dashboard</h2>
                    </div>
                    <div className="grid grid-cols-2 gap-4 -lg py-4">
                        <div className="bg-red-600 rounded-lg flex flex-col items-center justify-center cursor-pointer" onClick={() => navigate("/procurement-request")}>
                            <p className="p-4 text-center py-6 font-bold text-white">Create Procurement Request</p>
                            {/* <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500"></p> */}
                        </div>
                        <div className="bg-red-600 rounded-lg flex flex-col items-center justify-center cursor-pointer" onClick={() => navigate("/milestone-update")}>
                            <p className="text-center py-6 font-bold text-white">Update Milestones</p>
                            {/* <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500"></p> */}
                        </div>
                        <div className="bg-red-600 rounded-lg flex flex-col items-center justify-center cursor-pointer" onClick={() => navigate("/delivery-notes")}>
                            <p className="text-center py-6 font-bold text-white">Update Delivery Notes</p>
                        </div>
                    </div>
                </div>
            </div>}
            {page == 'newprlist' && <div className="flex-1 md:space-y-4 p-4 md:p-8 pt-6">
                <div className="flex items-center pt-1 pb-4">
                    <ArrowLeft onClick={() => setPage('dashboard')} />
                    <h2 className="text-base pl-2  font-bold tracking-tight">Procurement Requests</h2>
                </div>
                <div className="gap-4 border border-gray-200 rounded-lg p-0.5 ">
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
            </div>}
            {/* {page == 'milestonelist' && <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                <div className="flex items-center space-y-2">
                    <ArrowLeft onClick={() => setPage('dashboard')} />
                    <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">Project Status Details</h2>
                </div>
                <div className="gap-4 rounded-lg">
                    //  <DropdownMenu2 items={project_lists} onSelect={handleProjectSelect} /> 
                    <ReactSelect options={project_options} onChange={handleChange} />

                    {orderData.project && <div className="container mx-0 px-0 pt-8">
                        <div className="text-lg pb-2 font-semibold">Today's Task</div>
                        <table className="table-auto w-full">
                            <thead>
                                <tr className="w-full border-b">
                                    <th className="px-1 py-1 text-sm text-gray-600">Milestone</th>
                                    <th className="px-1 py-1 text-sm text-gray-600">Package</th>
                                    <th className="px-1 py-1 text-sm text-gray-600">Status</th>
                                </tr>
                            </thead>
                            <tbody className="w-full">
                                {project_work_milestones_list?.map((item) => {
                                    console.log(item.start_date)
                                    const startDate = new Date(item.start_date);
                                    const today = new Date();
                                    const futureDate = new Date(today);
                                    futureDate.setDate(today.getDate() + 30);
                                    if (item.project === orderData.project && (startDate <= futureDate)) {
                                        return <tr key={item.name} >
                                            <td className="border-b-2 px- py-1 text-sm text-center text-blue-600 cursor-pointer" onClick={() => handleMilestone(item.name)}>{item.milestone}</td>
                                            <td className="border-b-2 px- py-1 text-sm text-center">{item.work_package}-({item.scope_of_work})</td>
                                            <td className="border-b-2 px- py-1 text-sm text-center">{item?.status ? item?.status : "Pending"}</td>
                                        </tr>
                                    }
                                })}
                            </tbody>
                        </table>
                    </div>}
                    {orderData.project && <div className="container mx-0 px-0 pt-8">
                        <div className="text-lg pb-2 font-semibold">All Task</div>
                        <table className="table-auto w-full">
                            <thead>
                                <tr className="w-full border-b">
                                    <th className="px-1 py-1 text-sm text-gray-600">Milestone</th>
                                    <th className="px-1 py-1 text-sm text-gray-600">Package</th>
                                    <th className="px-1 py-1 text-sm text-gray-600">Status</th>
                                </tr>
                            </thead>
                            <tbody className="w-full">
                                {project_work_milestones_list?.map((item) => {
                                    if (item.project === orderData.project) {
                                        return <tr key={item.name} >
                                            <td className="border-b-2 px- py-1 text-sm text-center">{item.milestone}</td>
                                            <td className="border-b-2 px- py-1 text-sm text-center">{item.work_package}-({item.scope_of_work})</td>
                                            <td className="border-b-2 px- py-1 text-sm text-center">{item?.status ? item?.status : "Pending"}</td>
                                        </tr>
                                    }
                                })}
                            </tbody>
                        </table>
                    </div>}
                </div>
            </div>
            } */}

            {/* {page == 'milestonelist' && <NewMilestones />} */}
            {/* {page == 'milestone' && <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                <div className="flex items-center space-y-2">
                    <ArrowLeft onClick={() => setPage("milestonelist")} />
                    <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">Milestone Details</h2>
                </div>
                <div className="gap-4 rounded-lg">
                    <div className="border-l border-green-400 pl-2 py-2 my-4">
                        <div className="flex justify-between space-x-6">
                            <div className="font-semibold text-sm">{curMilestone?.milestone}</div>
                            <div className="text-xs whitespace-nowrap text-gray-400">{curMilestone?.start_date} to {curMilestone?.end_date}</div>
                        </div>
                        <div className="text-sm text-gray-600">Scope - {curMilestone?.scope_of_work}</div>
                        <div className="text-sm text-gray-600">{curMilestone?.work_package}</div>
                        <div className="font-semibold text-sm my-2">Common Area</div>
                        <div className="flex justify-between border rounded-lg text-sm px-2 relative">
                            <div className="flex-1 text-center py-2">
                                <label className="flex items-center justify-center">
                                    <input
                                        type="radio"
                                        name="common area"
                                        value="wip"
                                        id="wip"
                                        checked={curMilestone?.status == 'wip'}
                                        onChange={() => handleMilestoneChange('wip', curMilestone.name)}
                                        className="text-center mr-1"
                                    />
                                    WIP
                                </label>
                            </div>
                            <div className="flex-1 text-center relative py-2">
                                <label className="flex items-center justify-center">
                                    <input
                                        type="radio"
                                        name="common area"
                                        value="completed"
                                        id="completed"
                                        checked={curMilestone?.status === 'completed'}
                                        onChange={() => handleMilestoneChange('completed', curMilestone.name)}
                                        className="text-center mr-1"
                                    />
                                    Completed
                                </label>
                                <span className="absolute left-0 top-0 bottom-0 w-px bg-gray-300"></span>
                            </div>
                            <div className="flex-1 text-center relative py-2">
                                <label className="flex items-center justify-center">
                                    <input
                                        type="radio"
                                        name="common area"
                                        value="halted"
                                        id="halted"
                                        checked={curMilestone?.status === 'halted'}
                                        onChange={() => handleMilestoneChange('halted', curMilestone.name)}
                                        className="text-center mr-1"
                                    />
                                    Halted
                                </label>
                                <span className="absolute left-0 top-0 bottom-0 w-px bg-gray-300"></span>
                            </div>
                        </div>
                        <div className="font-semibold text-sm my-2">Area 1</div>
                            <div className="flex justify-between border rounded-lg text-sm px-2 relative">
                                <div className="flex-1 text-center py-2">
                                <label  className="flex items-center justify-center">
                                    <input
                                        type="radio"
                                        name="Area 1"
                                        value="wip2"
                                        id="wip2"
                                        // checked={selectedOption === 'wip2'}
                                        onChange={() => handleChange('wip2', 'param1')}
                                        className="text-center mr-1"
                                    />
                                    WIP
                                </label>
                                </div>
                                <div className="flex-1 text-center relative py-2">
                                <label  className="flex items-center justify-center">
                                    <input
                                        type="radio"
                                        name="Area 1"
                                        value="completed2"
                                        id="completed2"
                                        // checked={selectedOption === 'completed2'}
                                        onChange={() => handleChange('completed2', 'param1')}
                                        className="text-center mr-1"
                                    />
                                    Completed
                                </label>
                                    <span className="absolute left-0 top-0 bottom-0 w-px bg-gray-300"></span>
                                </div>
                                <div className="flex-1 text-center relative py-2">
                                <label  className="flex items-center justify-center">
                                    <input
                                        type="radio"
                                        name="Area 1"
                                        value="halted2"
                                        id="halted2"
                                        // checked={selectedOption === 'halted2'}
                                        onChange={() => handleChange('halted2', 'param1')}
                                        className="text-center mr-1"
                                    />
                                    Halted
                                </label>
                                    <span className="absolute left-0 top-0 bottom-0 w-px bg-gray-300"></span>
                                </div>
                            </div>
                            <div className="font-semibold text-sm my-2">Area 2</div>
                            <div className="flex justify-between border rounded-lg text-sm px-2 relative">
                                <div className="flex-1 text-center py-2">
                                <label  className="flex items-center justify-center">
                                    <input
                                        type="radio"
                                        name="Area 2"
                                        value="wip3"
                                        id="wip3"
                                        // checked={selectedOption === 'wip3'}
                                        onChange={() => handleChange('wip3', 'param1')}
                                        className="text-center mr-1"
                                    />
                                    WIP
                                </label>
                                </div>
                                <div className="flex-1 text-center relative py-2">
                                <label  className="flex items-center justify-center">
                                    <input
                                        type="radio"
                                        name="Area 2"
                                        value="completed3"
                                        id="completed3"
                                        // checked={selectedOption === 'completed3'}
                                        onChange={() => handleChange('completed3', 'param1')}
                                        className="text-center mr-1"
                                    />
                                    Completed
                                </label>
                                    <span className="absolute left-0 top-0 bottom-0 w-px bg-gray-300"></span>
                                </div>
                                <div className="flex-1 text-center relative py-2">
                                <label  className="flex items-center justify-center">
                                    <input
                                        type="radio"
                                        name="Area 2"
                                        value="halted3"
                                        id="halted3"
                                        // checked={selectedOption === 'halted3'}
                                        onChange={() => handleChange('halted3', 'param1')}
                                        className="text-center mr-1"
                                    />
                                    Halted
                                </label>
                                    <span className="absolute left-0 top-0 bottom-0 w-px bg-gray-300"></span>
                                </div>
                            </div>
                    </div>
                </div>
                <div className="flex flex-col justify-end items-end fixed bottom-4 right-4">
                    <button className="bg-red-500 text-white font-normal py-2 px-6 rounded-lg" onClick={() => setPage("milestonelist")}>
                        Save
                    </button>
                </div>
            </div>} */}
            {/* </MainLayout> */}
        </>
    )
}

