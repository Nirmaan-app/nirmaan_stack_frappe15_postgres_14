import { Breadcrumb, BreadcrumbItem, BreadcrumbLink } from "./breadcrumb";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { useFrappeGetDocCount, useFrappeGetDocList, useFrappeGetDoc, useFrappeCreateDoc } from "frappe-react-sdk";
import { HardHat, UserRound, PersonStanding, PackagePlus } from "lucide-react";
import { TailSpin } from "react-loader-spinner";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useState, useEffect } from "react"
import DropdownMenu from './dropdown';
import DropdownMenu2 from './dropdown2';
import { ArrowLeft } from 'lucide-react';
import ReactSelect from 'react-select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "./ui/dialog"
import { Button } from "./ui/button"
import { CirclePlus } from 'lucide-react';


import imageUrl from "@/assets/user-icon.jpeg"
import { MainLayout } from "./layout/main-layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export const NewPR = () => {

    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate();

    const { data: project_count, isLoading: project_count_loading, error: project_count_error } = useFrappeGetDocCount("Projects");
    const { data: wp_list, isLoading: wp_list_loading, error: wp_list_error } = useFrappeGetDocList("Work Packages",
        {
            fields: ['work_package_name', "work_package_image"]
        });
    const { data: category_list, isLoading: category_list_loading, error: category_list_error } = useFrappeGetDocList("Category",
        {
            fields: ['category_name', 'work_package']
        });
    const { data: item_list, isLoading: item_list_loading, error: item_list_error, mutate: item_list_mutate } = useFrappeGetDocList("Items",
        {
            fields: ['name', 'item_name', 'unit_name', 'category']
        });
    const { data: project_list, isLoading: project_list_loading, error: project_list_error } = useFrappeGetDocList("Projects",
        {
            fields: ['name', 'project_name', 'project_address', 'project_lead', 'procurement_lead']
        });
    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'owner', 'project', 'work_package', 'procurement_list', 'creation', 'workflow_state']
        });

    // console.log(category_list);
    // console.log(item_list);
    // console.log(procurement_request_list?.length);

    interface Category {
        name: string;
    }

    const [page, setPage] = useState<string>('wplist')
    const [curItem, setCurItem] = useState<string>('')
    const [curCategory, setCurCategory] = useState<string>('')
    const [unit, setUnit] = useState<string>('')
    const [quantity, setQuantity] = useState<number>()
    const [item_id, setItem_id] = useState<string>('');
    const [categories, setCategories] = useState<{ list: Category[] }>({ list: [] });

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
        project: id,
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
        setOrderData({
            project: id,
            procurement_list: {
                list: []
            },
            category_list: {
                list: []
            }
        });
        setCategories({ list: [] });

        addWorkPackage(wp);
        setPage(value);

    };
    const handleCategoryClick = (category: string, value: string) => {
        addCategory(category);
        setPage(value);
        setUnit('')

    };

    const handleCategoryClick2 = (category: string) => {
        addCategory(category);
        setPage('additem');
    };

    const handleClick = (value: string) => {
        setPage(value);
    };
    const item_lists: string[] = [];
    const item_options: string[] = [];
    const project_lists: string[] = [];
    if (curCategory) {
        item_list?.map((item) => {
            if (item.category === curCategory) item_options.push({ value: item.item_name, label: item.item_name })
        })
    }
    if (project_list?.length != project_lists.length) {
        project_list?.map((item) => {
            project_lists.push(item.project_name)
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
        // setCurItem(selectedItem.value)
        // item_list?.map((item) => {
        //     if (item.item_name == selectedItem) {
        //         setUnit(item.unit_name)
        //     }
        // })
    };
    const handleChange = (selectedItem) => {
        console.log('Selected item:', selectedItem);
        setCurItem(selectedItem.value)
        item_list?.map((item) => {
            if (item.item_name == selectedItem.value) {
                setUnit(item.unit_name)
            }
        })
    }

    const handleAdd = () => {
        if (curItem && Number(quantity)) {
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
                newCategories.push({ name: item.category })
            }
        })
        setOrderData((prevState) => ({
            ...prevState,
            category_list: {
                list: newCategories
            },
        }));
    }, [orderData.procurement_list]);

    useEffect(() => {
        const curProject = project_list?.find(proj => proj.name === id);

        if (curProject) {
            setOrderData(prevData => ({
                ...prevData,
                project_lead: curProject.project_lead,
                procurement_executive: curProject.procurement_lead
            }));
        }
    }, [project_list, orderData]);


    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    const handleSubmit = () => {
        console.log("orderData2", orderData)
        createDoc('Procurement Requests', orderData)
            .then(() => {
                console.log(orderData)
                navigate("/")
            }).catch(() => {
                console.log("submit_error", submit_error)
            })
    }
    const handleAddItem = () => {
        const itemData = {
            category: curCategory,
            unit_name: unit,
            item_name: curItem
        }
        console.log("itemData", itemData)
        createDoc('Items', itemData)
            .then(() => {
                console.log(itemData)
                setUnit('')
                setCurItem('')
                setPage('itemlist')
                item_list_mutate()
            }).catch(() => {
                console.log("submit_error", submit_error)
            })
    }

    const handleCreateItem = () => {
        setUnit('')
        setCurItem('')
        setPage('additem')
    }

    return (
        <MainLayout>
            {page == 'wplist' && <div className="flex-1 md:space-y-4 p-4 md:p-8 pt-6">
                <div className="flex-col items-center pt-1 pb-4">
                    {/* <ArrowLeft onClick={() => setPage('projectlist')} /> */}
                    <h3 className="text-base pl-2 font-bold tracking-tight">Select Work Package</h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-7 gap-4">
                    {wp_list?.map((item) => (
                        <Card className="flex flex-col items-center shadow-none text-center border border-grey-500 hover:animate-shadow-drop-center" onClick={() => handleWPClick(item.work_package_name, 'categorylist')}>
                            <CardHeader className="flex flex-col items-center justify-center space-y-0 p-2">
                                <CardTitle className="flex flex-col items-center text-sm font-medium text-center">
                                    <img className="h-32 md:h-36 w-32 md:w-36 rounded-lg p-0" src={item.work_package_image === null ? imageUrl : item.work_package_image} alt="Project" />
                                    <span>{item.work_package_name}</span>
                                </CardTitle>
                                {/* <HardHat className="h-4 w-4 text-muted-foreground" /> */}
                            </CardHeader>
                        </Card>
                    ))}
                </div>
            </div>}
            {page == 'categorylist' && <div className="flex-1 md:space-y-4 p-4 md:p-8 pt-6">
                <div className="flex items-center pt-1 pb-4">
                    <ArrowLeft onClick={() => setPage('wplist')} />
                    <h2 className="text-base pl-2 font-bold tracking-tight">Select Category</h2>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-7 gap-4">
                    {category_list?.map((item) => {
                        if (item.work_package === orderData.work_package) {
                            return (
                                <Card className="flex flex-col items-center shadow-none border border-grey-500 hover:animate-shadow-drop-center" onClick={() => handleCategoryClick(item.category_name, 'itemlist')}>
                                    <CardHeader className="flex flex-col items-center justify-center space-y-0 p-2">
                                        <CardTitle className="flex flex-col items-center text-sm font-medium text-center">
                                            <img className="h-32 md:h-36 w-32 md:w-36 rounded-lg p-0" src={imageUrl} alt="Project" />
                                            <span>{item.category_name}</span>
                                        </CardTitle>
                                        {/* <HardHat className="h-4 w-4 text-muted-foreground" /> */}
                                    </CardHeader>
                                </Card>
                            );
                        }
                    })}
                </div>
            </div>}
            {page == 'itemlist' && <div className="flex-1 space-x-2 space-y-2.5 md:space-y-4 p-2 md:p-12 pt-6">
                {/* <button className="font-bold text-md" onClick={() => setPage('categorylist')}>Add Items</button> */}
                <div className="flex items-center pt-1 pb-4">
                    <ArrowLeft onClick={() => setPage('categorylist')} />
                    <h2 className="text-base pl-2 font-bold tracking-tight">Add Items</h2>
                </div>
                <div className="flex justify-between md:justify-normal md:space-x-40">
                    <div className="">
                        <h5 className="text-gray-500 text-xs md:test-base">Project</h5>
                        <h3 className=" font-semibold text-sm md:text-lg">{project_list?.find((item) => item.name === id).project_name}</h3>
                    </div>
                    <div className="">
                        <h5 className="text-gray-500 text-xs md:test-base">Package</h5>
                        <h3 className=" font-semibold text-sm md:text-lg">{orderData.work_package}</h3>
                    </div>
                </div>
                <div className="flex justify-between">
                    <button className="text-sm py-2 md:text-lg text-blue-400 flex" onClick={() => setPage('categorylist')}><PackagePlus className="w-5 h-5 mt- pr-1" />Change Category</button>
                </div>
                <h3 className="font-bold">{curCategory}</h3>
                <div className="flex space-x-2">
                    <div className="w-1/2 md:w-2/3">
                        <h5 className="text-xs text-gray-400">Items</h5>
                        {/* <DropdownMenu items={item_lists} onSelect={handleSelect} /> */}
                        <ReactSelect options={item_options} onChange={handleChange} />
                    </div>
                    <div className="flex-1">
                        <h5 className="text-xs text-gray-400">UOM</h5>
                        <input className="h-[37px] w-full" type="text" placeholder={unit || "Unit"} value={unit} />
                    </div>
                    <div className="flex-1">
                        <h5 className="text-xs text-gray-400">Qty</h5>
                        <input className="h-[37px] w-full border rounded-lg" onChange={(e) => setQuantity(e.target.value)} value={quantity} type="number" />
                    </div>
                </div>
                <div className="flex justify-between  md:space-x-0 mt-2">
                    <div><button className="text-sm py-2 md:text-lg text-blue-400 flex " onClick={() => handleCreateItem()}><CirclePlus className="w-5 h-5 mt- pr-1" />Create new item</button></div>
                    {(curItem && quantity) ?
                        <Button variant="outline" className="left-0 border rounded-lg py-1 border-red-500 px-8" onClick={() => handleAdd()}>Add</Button>
                        :
                        <Button disabled={true} variant="secondary" className="left-0 border rounded-lg py-1 border-red-500 px-8" >Add</Button>}
                    {/* <Button variant="outline" className="left-0 border rounded-lg py-1 border-red-500 px-8" onClick={() => handleAdd()}>Add</Button> */}
                </div>
                <div className="text-xs font-thin text-rose-700">Added Items</div>
                {categories.list?.map((cat) => {
                    return <div className="container mx-0 px-0">
                        <h3 className="text-sm font-semibold py-2">{cat.name}</h3>
                        <table className="table-auto w-[95%]">
                            <thead>
                                <tr className="bg-gray-200">
                                    <th className="px-4 py-1 text-xs">Item Name</th>
                                    <th className="px-4 py-1 pl-10 text-xs">Unit</th>
                                    <th className="px-4 py-1 text-xs">Quantity</th>
                                </tr>
                            </thead>
                            <tbody>
                                {orderData.procurement_list.list?.map((item) => {
                                    if (item.category === cat.name) {
                                        return <tr key={item.item} >
                                            <td className="border-b-2 px-4 py-1 text-xs text-gray-700 text-center">{item.item}</td>
                                            <td className="border-b-2 px-4 py-1 pl-10 text-xs text-gray-700 text-center">{item.unit}</td>
                                            <td className="border-b-2 px-4 py-1 text-xs text-gray-700 text-center">{item.quantity}</td>
                                        </tr>
                                    }
                                })}
                            </tbody>
                        </table>
                    </div>
                })}
                <Dialog>
                    <DialogTrigger asChild>
                        {Object.keys(orderData.procurement_list.list).length !== 0 ?
                            <Button className="bottom-0 h-8 w-[95%] mt-4 md:w-full bg-red-700 rounded-md text-sm text-white">Confirm and Submit</Button>
                            :
                            <Button disabled={true} variant="secondary" className="bottom-0 h-8 w-[95%] mt-4 md:w-full rounded-md text-sm">Confirm and Submit</Button>}
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                            <DialogTitle>Are you Sure</DialogTitle>
                            <DialogDescription>
                                Click on Confirm to create new PR.
                            </DialogDescription>
                        </DialogHeader>
                        <Button variant="secondary" onClick={() => handleSubmit()}>Confirm</Button>
                    </DialogContent>
                </Dialog>
            </div>}
            {page == 'additem' && <div className="flex-1 space-x-2 md:space-y-4 p-2 md:p-12 pt-6">
                {/* <button className="font-bold text-md" onClick={() => setPage('categorylist')}>Add Items</button> */}
                <div className="flex items-center pt-1 pb-4">
                    <ArrowLeft onClick={() => setPage('itemlist')} />
                    <h2 className="text-base pl-2 font-bold tracking-tight">Create new Item</h2>
                </div>
                <div className="mb-4">
                    <div className="flex justify-between">
                        <div className="text-lg font-bold py-2">Category: {curCategory}</div>
                        <button onClick={() => setPage("categorylist2")} className="text-blue-500 underline">Change Category</button>
                    </div>
                    <label htmlFor="itemName" className="block text-sm font-medium text-gray-700">Item Name</label>
                    <Input
                        type="text"
                        id="itemName"
                        value={curItem}
                        onChange={(e) => setCurItem(e.target.value)}
                        className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                </div>
                {/* <div className="mb-4">
                    <label htmlFor="itemUnit" className="block text-sm font-medium text-gray-700">Item Unit</label>
                    <input
                        type="text"
                        id="itemUnit"
                        value={unit}
                        onChange={(e) => setUnit(e.target.value)}
                        className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                </div> */}
                <div className="mb-4">
                    <label htmlFor="itemUnit" className="block text-sm font-medium text-gray-700">Item Unit</label>
                    <Select onValueChange={(value) => setUnit(value)}>
                        <SelectTrigger className="w-[180px]">
                            <SelectValue className="text-gray-200" placeholder="Select Unit" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="kgs">Kilogram</SelectItem>
                            <SelectItem value="mts">Metres</SelectItem>
                            <SelectItem value="nos">Nos</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                {/* <label htmlFor="itemUnit" className="block text-sm font-medium text-gray-700">Item Image</label>
                    <input
                        type="text"
                        id="itemUnit"
                        value={unit}
                        onChange={(e) => setUnit(e.target.value)}
                        className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    /> */}
                <Dialog>
                    <DialogTrigger asChild>
                        {(curItem && unit) ?
                            <Button className="fixed bottom-2 h-8 left-2 right-2 md:w-full bg-red-700 rounded-md text-sm text-white">Confirm and Submit</Button>
                            :
                            <Button disabled={true} variant="secondary" className="fixed bottom-2 h-8 left-2 right-2 md:w-full rounded-md text-sm">Confirm and Submit</Button>
                        }

                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                            <DialogTitle>Are you Sure</DialogTitle>
                            <DialogDescription>
                                Click on Confirm to create new Item.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogClose>
                            <Button variant="secondary" onClick={() => handleAddItem()}>Confirm</Button>
                        </DialogClose>
                    </DialogContent>
                </Dialog>
            </div>}
            {page == 'categorylist2' && <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                <div className="flex items-center space-y-2">
                    {/* <ArrowLeft onClick={() => setPage('wplist')} /> */}
                    <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">Select Category</h2>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-7 gap-4">
                    {category_list?.map((item) => {
                        if (item.work_package === orderData.work_package) {
                            return (
                                <Card className="flex flex-col items-center shadow-none border border-grey-500 hover:animate-shadow-drop-center" onClick={() => handleCategoryClick2(item.category_name)}>
                                    <CardHeader className="flex flex-col items-center justify-center space-y-0 p-2">
                                        <CardTitle className="flex flex-col items-center text-sm font-medium text-center">
                                            <img className="h-32 md:h-36 w-32 md:w-36 rounded-lg p-0" src={imageUrl} alt="Project" />
                                            <span>{item.category_name}</span>
                                        </CardTitle>
                                        {/* <HardHat className="h-4 w-4 text-muted-foreground" /> */}
                                    </CardHeader>
                                </Card>
                            );
                        }
                    })}
                </div>
            </div>}
        </MainLayout>
    )
}