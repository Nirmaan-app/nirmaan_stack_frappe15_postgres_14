import { Breadcrumb, BreadcrumbItem, BreadcrumbLink } from "./breadcrumb";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { useFrappeGetDocCount,useFrappeGetDocList,useFrappeGetDoc,useFrappeCreateDoc } from "frappe-react-sdk";
import { HardHat, UserRound, PersonStanding } from "lucide-react";
import { TailSpin } from "react-loader-spinner";
import { Link } from "react-router-dom";
import { useState, useEffect } from "react"
import DropdownMenu from './dropdown';
import DropdownMenu2 from './dropdown2';
import { ArrowLeft } from 'lucide-react';

import imageUrl from "@/assets/user-icon.jpeg"
import { previousTuesday } from "date-fns";


export const ProjectManager = () => {

    const { data: project_count, isLoading: project_count_loading, error: project_count_error } = useFrappeGetDocCount("Projects");
    const { data: wp_list, isLoading: wp_list_loading, error: wp_list_error } = useFrappeGetDocList("Work Packages",
    {
        fields:['work_package_name']
    });
    const { data: category_list, isLoading: category_list_loading, error: category_list_error } = useFrappeGetDocList("Category",
    {
        fields:['category_name','work_package']
    });
    const { data: item_list, isLoading: item_list_loading, error: item_list_error } = useFrappeGetDocList("Items",
    {
        fields:['name','item_name','unit_name','category']
    });
    const { data: project_list, isLoading: project_list_loading, error: project_list_error } = useFrappeGetDocList("Projects",
    {
        fields:['name','project_name','project_address']
    });
    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
    {
        fields:['name','owner','project','work_package','procurement_list','creation']
    });

    // console.log(category_list);
    // console.log(item_list);
    // console.log(procurement_request_list?.length);

    interface Category {
        name: string;
    }

    const [page,setPage] = useState<string>('default')
    const [curItem,setCurItem] = useState<string>('')
    const [curCategory,setCurCategory] = useState<string>('')
    const [unit,setUnit] = useState<string>('')
    const [quantity,setQuantity] = useState<number>()
    const [item_id,setItem_id] = useState<string>('');
    const [categories, setCategories] = useState<{ list: Category[] }>({ list: [] });
    
    const addProject = (projectName: string) => {
        project_list?.map((project)=>{
            if(project.project_name === projectName){
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
        console.log(curCategory,categories)
    };

    const [orderData,setOrderData] = useState({
        project:'',
        work_package: '',
        procurement_list:{
            list:[]
        },
    })
    // const handleProjectClick = (project:string , value: string) => {
    //     addProject(project);
    //     setPage(value);
    //     console.log(page);
    //     console.log(orderData);
    // };
    const handleWPClick = (wp:string , value: string) => {
        addWorkPackage(wp);
        setPage(value);
        console.log(page);
        console.log(orderData);
    };
    const handleCategoryClick = (category:string , value: string) => {
        addCategory(category);
        setPage(value);
        console.log(page);
        console.log(orderData);
    };

    const handleClick = (value: string) => {
        setPage(value);
        console.log(page);
        console.log(orderData);
    };
    const item_lists:string[] = [];
    const project_lists:string[] = [];
    if(curCategory){
        item_list?.map((item) => {
            if(item.category === curCategory) item_lists.push(item.item_name)
        })
    }
    if(project_list?.length != project_lists.length){
        project_list?.map((item) => {
            project_lists.push(item.project_name)
        })
    }

      const handleSelect = (selectedItem: string) => {
        console.log('Selected item:', selectedItem);
        setCurItem(selectedItem)
        item_list?.map((item) => {
            if(item.item_name == selectedItem) {
                setUnit(item.unit_name)
            }
      })
      };
      const handleProjectSelect = (selectedItem: string) => {
            addProject(selectedItem);
      };

  
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
                    quantity: quantity,
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

      const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
      const handleSubmit = () => {
        console.log("orderData2",orderData)
        
        // const updatedOrderData = {
        //     ...orderData,
        //     procurement_list: JSON.stringify(orderData.procurement_list)
        // };
        // setOrderData(updatedOrderData);
        createDoc('Procurement Requests', orderData)
            .then(() => {
                console.log(orderData)
                setOrderData(prevState => ({
                    ...prevState,
                    project: '',
                    work_package: '',
                    procurement_list:{
                        list:[]
                    },
                }));
                setCurCategory('');
                setCurItem('');
                setQuantity(0);
                setUnit('');
                setCategories({ list: [] })
            }).catch(() => {
                console.log("submit_error",submit_error)
            })
      }

    return (
        <>
            {page=='default' && <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                <div className="flex items-center justify-between space-y-2">
                    <h2 className="text-3xl font-bold tracking-tight">Modules List</h2>
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
                    <Card className="hover:animate-shadow-drop-center" onClick={()=>handleClick('projectlist')}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    Create order
                                </CardTitle>
                                <HardHat className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">
                                    {(project_count_loading) ? (<TailSpin visible={true} height="30" width="30" color="#9C33FF" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                        : (project_count)}
                                    {project_count_error && <p>Error</p>}
                                </div>
                                <p className="text-xs text-muted-foreground">COUNT</p>
                            </CardContent>
                    </Card>
                    {/* <Card className="hover:animate-shadow-drop-center" >
                        <Link to="/projects">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    Add Projects
                                </CardTitle>
                                <HardHat className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">
                                    
                                </div>
                                <p className="text-xs text-muted-foreground">Add new projects</p>
                            </CardContent>
                        </Link>
                    </Card> */}
                </div>
            </div>}
            {/* {page=='projectlist' && <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                <div className="flex items-center space-y-2">
                    <ArrowLeft onClick={() => setPage('default')}/>
                    <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">Select Projects</h2>
                </div>
                <div className="grid gap-4">
                    {project_list?.map((project) => (
                        <Card className="flex shadow-none border border-grey-500 hover:animate-shadow-drop-center" onClick={()=>handleProjectClick(project.name,'wplist')}>
                            <CardHeader className="flex flex-row p-0">
                            <img className="h-16 md:h-24 w-16 md:w-24 p-2 rounded-lg p-0" src={imageUrl} alt="Project" />
                                
                            </CardHeader>
                            <CardContent className="p-2 pt-1 md:text-lg md:font-bold">
                                {project.project_name}
                                <p className="text-xs font-normal md:text-sm text-muted-foreground bottom-2 truncate">{project.project_address}</p>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>} */}
            {page=='projectlist' && <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                <div className="flex items-center space-y-2">
                    <ArrowLeft onClick={() => setPage('default')}/>
                    <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">Procurement Request</h2>
                </div>
                <div className="gap-4 border border-gray-200 rounded-lg">
                <DropdownMenu2 items={project_lists} onSelect={handleProjectSelect} />
                <div className="container mx-0 px-0">
                    <table className="table-auto w-full">
                        <thead>
                        <tr className="w-full border-b">
                            <th className="px-4 py-1 text-xs text-gray-600">PR number</th>
                            <th className="px-4 py-1 text-xs text-gray-600">Package</th>
                            <th className="px-4 py-1 text-xs text-gray-600">Status</th>
                        </tr>
                        </thead>
                        <tbody className="w-full">
                        {procurement_request_list?.map((item) => {
                            if(item.project === orderData.project){return <tr key={item.name} >
                            <td className="border-b-2 px-4 py-1 text-sm text-center">{item.name.slice(-4)}</td>
                            <td className="border-b-2 px-4 py-1 text-sm text-center">{item.work_package}</td>
                            <td className="border-b-2 px-4 py-1 text-sm text-center">Approved</td>
                            </tr>}
                        })}
                        </tbody>
                    </table>
                </div>
                <div className="flex flex-col h-full justify-end items-end fixed bottom-4 right-4">
                <button className="bg-red-500 text-white font-normal py-2 px-6 rounded-lg" onClick={()=>setPage('wplist')}>
                    + Add
                </button>
                </div>
                </div>
            </div>}
            {page=='wplist' && <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                
                <div className="flex items-center space-y-2">
                    <ArrowLeft onClick={() => setPage('projectlist')}/>
                    <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">Select Work Package</h2>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-7 gap-4">
                    {wp_list?.map((item) => (
                        <Card className="flex shadow-none border border-grey-500 hover:animate-shadow-drop-center" onClick={()=>handleWPClick(item.work_package_name,'categorylist')}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-2">
                                <CardTitle className="text-sm font-medium">
                                <img className="h-32 md:h-36 w-32 md:w-36 p-2 rounded-lg p-0 text-sm" src={imageUrl} alt="Project" />
                                    {item.work_package_name}
                                </CardTitle>
                                {/* <HardHat className="h-4 w-4 text-muted-foreground" /> */}
                            </CardHeader>
                        </Card>
                    ))}
                </div>
            </div>}
            {page=='categorylist' && <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                <div className="flex items-center space-y-2">
                    <ArrowLeft onClick={() => setPage('wplist')}/>
                    <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">Select Category</h2>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-7 gap-4">
                    {category_list?.map((item) => {
                        if(item.work_package === orderData.work_package){
                        return <Card className="flex shadow-none border border-grey-500 hover:animate-shadow-drop-center" onClick={()=>handleCategoryClick(item.category_name,'itemlist')}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-2">
                                <CardTitle className="text-sm font-medium">
                                <img className="h-32 md:h-36 w-32 md:w-36 p-2 rounded-lg p-0 text-sm" src={imageUrl} alt="Project" />
                                    {item.category_name}
                                </CardTitle>
                                {/* <HardHat className="h-4 w-4 text-muted-foreground" /> */}
                            </CardHeader>
                        </Card>}
                    })}
                </div>
            </div>}
            {page=='itemlist' && <div className="flex-1 space-x-2 md:space-y-4 p-2 md:p-12 pt-6">
                {/* <button className="font-bold text-md" onClick={() => setPage('categorylist')}>Add Items</button> */}
                <div className="flex items-center space-y-2">
                    <ArrowLeft onClick={() => setPage('categorylist')}/>
                    <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">Add Items</h2>
                </div>
                <div className="flex justify-center md:justify-normal md:space-x-40">
                    <div className="p-2">
                        <h5 className="text-gray-500 text-xs md:test-base">Project</h5>
                        <h3 className="pl-2 font-semibold text-sm md:text-lg">{orderData.project}</h3>
                    </div>
                    <div className="p-2">
                        <h5 className="text-gray-500 text-xs md:test-base">Package</h5>
                        <h3 className="pl-2 font-semibold text-sm md:text-lg">{orderData.work_package}</h3>
                    </div>
                </div>
                <button className="text-sm md:text-lg text-blue-400" onClick={() => setPage('categorylist')}>+ Add Category</button>
                <h3 className="font-bold">{curCategory}</h3>
                <div className="flex space-x-2">
                <div className="flex-shrink-0">
                    <h5 className="text-xs text-gray-400">Items</h5>
                    <DropdownMenu items={item_lists} onSelect={handleSelect} />
                </div>
                <div className="flex-1  min-w-14 ">
                    <h5 className="text-xs text-gray-400">UOM</h5>
                    <input className="h-[37px] w-full border rounded-lg" type="text" placeholder={unit} value={unit} />
                </div>
                <div className="flex-1 min-w-14 ">
                    <h5 className="text-xs text-gray-400">Qty</h5>
                    <input className="h-[37px] w-full border rounded-lg" onChange={(e)=>setQuantity(e.target.value)} value={quantity} type="number" />
                </div>
                </div>
                <div className="flex space-x-48 md:space-x-0 mt-2">
                    <div></div>
                    <button className="left-0 border rounded-lg py-1 border-red-500 px-8" onClick={()=>handleAdd()}>Add</button>
                </div>
                <div className="text-sm text-gray-700">Added Items</div>
                {categories.list?.map((cat) => {
                return <div className="container mx-0 px-0">
                    <h3 className="text-sm font-semibold py-2">{cat.name}</h3>
                    <table className="table-auto md:w-full">
                        <thead>
                        <tr className="bg-gray-200">
                            <th className="px-4 py-1 text-xs">Item Name</th>
                            <th className="px-4 py-1 pl-16 text-xs">Unit</th>
                            <th className="px-4 py-1 text-xs">Quantity</th>
                        </tr>
                        </thead>
                        <tbody>
                        {orderData.procurement_list.list?.map((item) => {
                            if(item.category === cat.name){return <tr key={item.item} >
                            <td className="border-b-2 px-4 py-1 text-sm text-center">{item.item}</td>
                            <td className="border-b-2 px-4 py-1 pl-16 text-sm text-center">{item.unit}</td>
                            <td className="border-b-2 px-4 py-1 text-sm text-center">{item.quantity}</td>
                            </tr>}
                        })}
                        </tbody>
                    </table>
                </div>})}
                <button className="bottom-0 h-8 w-[280px] md:w-full bg-red-700 rounded-md text-sm text-white" onClick={()=>handleSubmit()}>Confirm and Submit</button>
            </div>}
        </>
    )
}