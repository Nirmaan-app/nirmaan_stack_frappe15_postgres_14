import { Breadcrumb, BreadcrumbItem, BreadcrumbLink } from "./breadcrumb";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { useFrappeGetDocCount, useFrappeGetDocList, useFrappeGetDoc, useFrappeCreateDoc } from "frappe-react-sdk";
import { HardHat, UserRound, PersonStanding } from "lucide-react";
import { TailSpin } from "react-loader-spinner";
import { Link,useNavigate } from "react-router-dom";
import { useState, useEffect } from "react"
import DropdownMenu from './dropdown';
import DropdownMenu2 from './dropdown2';
import { ArrowLeft } from 'lucide-react';
import ReactSelect from 'react-select';
import { useUserData } from "@/hooks/useUserData";

import imageUrl from "@/assets/user-icon.jpeg"


export const ProjectManager = () => {
    const navigate = useNavigate();
    const userData = useUserData();

    const { data: project_count, isLoading: project_count_loading, error: project_count_error } = useFrappeGetDocCount("Projects");
    const { data: wp_list, isLoading: wp_list_loading, error: wp_list_error } = useFrappeGetDocList("Work Packages",
        {
            fields: ['work_package_name']
        });
    const { data: category_list, isLoading: category_list_loading, error: category_list_error } = useFrappeGetDocList("Category",
        {
            fields: ['category_name', 'work_package']
        });
    const { data: item_list, isLoading: item_list_loading, error: item_list_error } = useFrappeGetDocList("Items",
        {
            fields: ['name', 'item_name', 'unit_name', 'category']
        });
    const { data: project_list, isLoading: project_list_loading, error: project_list_error } = useFrappeGetDocList("Projects",
        {
            fields: ['name', 'project_name', 'project_address',"project_manager"],
            filters: [["project_manager","=",userData.user_id]]
        });
    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'owner', 'project', 'work_package', 'procurement_list', 'creation','workflow_state']
        });

    interface Category {
        name: string;
    }
    console.log("project_list",project_list,item_list)

    const [page, setPage] = useState<string>('projectlist')
    const [curItem, setCurItem] = useState<string>('')
    const [curCategory, setCurCategory] = useState<string>('')
    const [unit, setUnit] = useState<string>('')
    const [quantity, setQuantity] = useState<number>()
    const [item_id, setItem_id] = useState<string>('');
    const [categories, setCategories] = useState<{ list: Category[] }>({ list: [] });

    const addProject = (projectName: string) => {
        project_list?.map((project) => {
            if (project.project_name === projectName) {
                setOrderData(prevData => ({
                    ...prevData,
                    project: project.name
                }));
            }
        })
    };
    const addWorkPackage = (wpName: string) => {
        setOrderData(prevData => ({
            ...prevData,
            work_package: wpName
        }));
    };
    const addCategory = (categoryName: string) => {
        setCurCategory(categoryName);
        const isDuplicate = categories.list.some(category => category.name === categoryName);
        if (!isDuplicate) {
            setCategories(prevState => ({
                ...prevState,
                list: [...prevState.list, { name: categoryName }]
            }));
        }
        console.log(curCategory, categories)
    };

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
    // const handleProjectClick = (project:string , value: string) => {
    //     addProject(project);
    //     setPage(value);
    //     console.log(page);
    //     console.log(orderData);
    // };
    const handleWPClick = (wp: string, value: string) => {
        addWorkPackage(wp);
        setPage(value);
    };
    const handleCategoryClick = (category: string, value: string) => {
        addCategory(category);
        setPage(value);
    };

    const handleClick = (value: string) => {
        setPage(value);
    };
    const item_options: string[] = [];
    const project_options = [];
    if (curCategory) {
        item_list?.map((item) => {
            if (item.category === curCategory) item_options.push({value:item.item_name , label:item.item_name})
        })
    }

    const handleSelect = (selectedItem: string) => {
        console.log('Selected item:', selectedItem);
        setCurItem(selectedItem)
        item_list?.map((item) => {
            if (item.item_name == selectedItem) {
                setUnit(item.unit_name)
            }
        })
    };
    const handleChange = (selectedItem) => {
        console.log('Selected item:', selectedItem);
        setOrderData(prevData => ({
            ...prevData,
            project: selectedItem.value
        }));
    }
    const handleProjectSelect = (selectedItem: string) => {
        addProject(selectedItem);
    };

    if(project_list?.length != project_options.length){
        project_list?.map((proj) => {
            project_options.push({value:proj.name , label:proj.project_name})
        })
    }

    const handleAdd = () => {
        if (curItem) {
            let itemIdToUpdate = null;
            item_list.forEach((item) => {
                if (item.item_name === curItem) {
                    itemIdToUpdate = item.name;
                }
            });
            if (itemIdToUpdate) {
                const curRequest = [...orderData.procurement_list.list];
                const curValue = {
                    item: curItem,
                    name: itemIdToUpdate,
                    unit: unit,
                    quantity: Number(quantity),
                    category: curCategory,
                };
                const isDuplicate = curRequest.some((item) => item.item === curItem);
                if (!isDuplicate) {
                    curRequest.push(curValue);
                }
                setOrderData((prevState) => ({
                    ...prevState,
                    procurement_list: {
                        list: curRequest,
                    },
                }));
                setUnit('');
                setQuantity(0);
                setItem_id('');
            }
        }
    };

    useEffect(() => {
        const newCategories = [];
        orderData.procurement_list.list.map((item) => {
            const isDuplicate = newCategories.some(category => category.name === item.category);
            if (!isDuplicate) {
                newCategories.push({name: item.category})
            }
        })
        setOrderData((prevState) => ({
            ...prevState,
            category_list: {
                list: newCategories
            },
        }));
      }, [orderData.procurement_list]);
      

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    const handleSubmit = () => {
        console.log("orderData2", orderData)
        createDoc('Procurement Requests', orderData)
            .then(() => {
                console.log(orderData)
                navigate("/")
                setPage('projectlist')
            }).catch(() => {
                console.log("submit_error", submit_error)
            })
    }

    return (
        <>
            {page == 'projectlist' && <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                <div className="flex items-center space-y-2">
                    {/* <ArrowLeft onClick={() => setPage('default')} /> */}
                    <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">Procurement Request</h2>
                </div>
                <div className="gap-4 border border-gray-200 rounded-lg">
                    {/* <DropdownMenu2 items={project_lists} onSelect={handleProjectSelect} /> */}
                    <ReactSelect options={project_options} onChange={handleChange} />
                    {orderData.project && <div className="container mx-0 px-0 pt-8">
                        <table className="table-auto w-full">
                            <thead>
                                <tr className="w-full border-b">
                                    <th className="px-4 py-1 text-sm text-gray-600">PR number</th>
                                    <th className="px-4 py-1 text-sm text-gray-600">Package</th>
                                    <th className="px-4 py-1 text-sm text-gray-600">Status</th>
                                </tr>
                            </thead>
                            <tbody className="w-full">
                                {procurement_request_list?.map((item) => {
                                    if (item.project === orderData.project) {
                                        return <tr key={item.name} >
                                            <td className="border-b-2 px-4 py-1 text-sm text-center"><Link to={`/pr-summary/${item.name}`}>{item.name.slice(-4)}</Link></td>
                                            <td className="border-b-2 px-4 py-1 text-sm text-center">{item.work_package}</td>
                                            <td className="border-b-2 px-4 py-1 text-sm text-center">{item.workflow_state}</td>
                                        </tr>
                                    }
                                })}
                            </tbody>
                        </table>
                    </div>}
                    <div className="flex flex-col justify-end items-end fixed bottom-4 right-4">
                        <button className="bg-red-500 text-white font-normal py-2 px-6 rounded-lg">
                            <Link to={`/new-pr/${orderData.project}`}>
                            + Add
                            </Link>
                        </button>
                    </div>
                </div>
            </div>}
        </>
    )
}