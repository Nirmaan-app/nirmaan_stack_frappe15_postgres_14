import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { useFrappeGetDocCount, useFrappeGetDocList, useFrappeGetDoc, useFrappeCreateDoc, useFrappeUpdateDoc } from "frappe-react-sdk";
import { HardHat, UserRound, PersonStanding, PackagePlus, Workflow } from "lucide-react";
import { TailSpin } from "react-loader-spinner";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useState, useEffect } from "react"

import { ArrowLeft } from 'lucide-react';
import ReactSelect from 'react-select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "../ui/dialog"
import { Button } from "../ui/button"
import { CirclePlus } from 'lucide-react';
import { Pencil } from 'lucide-react';


import imageUrl from "@/assets/user-icon.jpeg"
import { MainLayout } from "../layout/main-layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { useUserData } from "@/hooks/useUserData";

export const NewPR = () => {

    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate();
    const userData = useUserData()

    const { data: wp_list, isLoading: wp_list_loading, error: wp_list_error } = useFrappeGetDocList("Work Packages",
        {
            fields: ['work_package_name', "work_package_image"]
        });
    const { data: category_list, isLoading: category_list_loading, error: category_list_error } = useFrappeGetDocList("Category",
        {
            fields: ['category_name', 'work_package', 'image_url', 'tax'],
            limit: 100
        });
    const { data: item_list, isLoading: item_list_loading, error: item_list_error, mutate: item_list_mutate } = useFrappeGetDocList("Items",
        {
            fields: ['name', 'item_name', 'make_name', 'unit_name', 'category'],
            limit: 1000
        });
    const { data: project_list, isLoading: project_list_loading, error: project_list_error } = useFrappeGetDocList("Projects",
        {
            fields: ['name', 'project_name', 'project_address', 'project_lead', 'procurement_lead']
        });

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
    const [make, setMake] = useState('');
    const [tax, setTax] = useState<number | null>(null)

    const addWorkPackage = (wpName: string) => {
        setOrderData(prevData => ({
            ...prevData,
            work_package: wpName
        }));
    };
    const addCategory = (categoryName: string) => {
        setCurCategory(categoryName);
        setTax(category_list?.find((category) => category.category_name === categoryName ).tax)
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
            if (item.category === curCategory) item_options.push({ value: item.item_name, label: `${item.item_name}${item.make_name ? "-" + item.make_name : ""}` })
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
    };
    const handleChange = (selectedItem) => {
        console.log('Selected item:', selectedItem);
        setCurItem(selectedItem.value)


        item_list?.map((item) => {
            if (item.item_name == selectedItem.value) {
                setUnit(item.unit_name)
                setMake(item.make_name)
            }
        })
    }

    const handleAdd = () => {
        if (curItem && Number(quantity)) {
            let itemIdToUpdate = null;
            let itemMake = null;
            item_list.forEach((item) => {
                if (item.item_name === curItem) {
                    itemIdToUpdate = item.name;
                    itemMake = item.make_name;
                }
            });
            if (itemIdToUpdate) {
                const curRequest = [...orderData.procurement_list.list];
                const curValue = {
                    item: `${curItem}${itemMake ? "-" + itemMake : ""}`,
                    name: itemIdToUpdate,
                    unit: unit,
                    quantity: Number(quantity),
                    category: curCategory,
                    tax: Number(tax),
                    status: "Pending"
                };
                const isDuplicate = curRequest.some((item) => item.name === curValue.name);
                if (!isDuplicate) {
                    curRequest.push(curValue);
                }
                setOrderData((prevState) => ({
                    ...prevState,
                    procurement_list: {
                        list: curRequest,
                    },
                }));
                setCurItem('');
                setUnit('');
                setQuantity(0);
                setItem_id('');
                setMake('');
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

    const handleCommentChange = (e) => {
        setOrderData((prevState) => ({
            ...prevState,
            comment: e.target.value,
        }));
    }

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()

    const { updateDoc: updateDoc, loading: update_loading, isCompleted: update_submit_complete, error: update_submit_error } = useFrappeUpdateDoc()

    const handleSubmit = () => {
        console.log(userData)
        if (userData?.role === "Nirmaan Project Manager Profile" || userData?.role === "Nirmaan Admin Profile" || userData.user_id == "Administrator") {
            createDoc('Procurement Requests', orderData)
                .then(() => {
                    console.log(orderData)
                    navigate("/procurement-request")
                }).catch(() => {
                    console.log("submit_error", submit_error)
                })
        }
        if (userData?.role === "Nirmaan Procurement Executive Profile") {
            createDoc('Procurement Requests', orderData)
                .then((doc) => {
                    updateDoc('Procurement Requests', doc.name, {
                        workflow_state: "Approved",
                    })
                        .then(() => {
                            console.log("doc", doc)
                            navigate("/")
                        }).catch(() => {
                            console.log("update_submit_error", update_submit_error)
                        })
                }).catch(() => {
                    console.log("submit_error", submit_error)
                })
        }
    }
    const handleAddItem = () => {
        const itemData = {
            category: curCategory,
            unit_name: unit,
            item_name: curItem,
            make_name: make
        }
        console.log("itemData", itemData)
        createDoc('Items', itemData)
            .then(() => {
                console.log(itemData)
                setUnit('')
                setCurItem('')
                setMake('')
                setPage('itemlist')
                item_list_mutate()
            }).catch(() => {
                console.log("submit_error", submit_error)
            })
    }

    const handleCreateItem = () => {
        setUnit('')
        setCurItem('')
        setMake('')
        setPage('additem')
    }

    const handleSave = (itemName: string, newQuantity: number) => {
        let curRequest = orderData.procurement_list.list;
        curRequest = curRequest.map((curValue) => {
            if (curValue.item === itemName) {
                return { ...curValue, quantity: newQuantity };
            }
            return curValue;
        });
        if (quantity) {
            setOrderData((prevState) => ({
                ...prevState,
                procurement_list: {
                    list: curRequest,
                },
            }));
        }
        setQuantity(0)
        setCurItem('')
    };
    const handleDelete = (item: string) => {
        let curRequest = orderData.procurement_list.list;
        curRequest = curRequest.filter(curValue => curValue.item !== item);
        setOrderData(prevState => ({
            ...prevState,
            procurement_list: {
                list: curRequest
            }
        }));
        setQuantity(0)
        setCurItem('')
    }

    return (
        // <MainLayout>
        <>
            {page == 'wplist' && <div className="flex-1 md:space-y-4 p-4 md:p-8 pt-6">
                <div className="flex items-center pt-1 pb-4">
                    <ArrowLeft className="cursor-pointer" onClick={() => navigate("/procurement-request")} />
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
                                {/* {console.log("FROM WP:", item.work_package_image)} */}
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
                                            <img className="h-32 md:h-36 w-32 md:w-36 rounded-lg p-0" src={item.image_url === null ? imageUrl : item.image_url} alt="Category" />
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
                        <ReactSelect value={{ value: curItem, label: `${curItem}${make ? "-" + make : ""}` }} options={item_options} onChange={handleChange} />
                    </div>
                    <div className="flex-1">
                        <h5 className="text-xs text-gray-400">UOM</h5>
                        <input className="h-[37px] w-[60%] border p-2 rounded-lg" disabled="true" type="text" placeholder={unit || "Unit"} value={unit} />
                    </div>
                    <div className="flex-1">
                        <h5 className="text-xs text-gray-400">Qty</h5>
                        <input className="h-[37px] w-full border p-2 rounded-lg outline-none" onChange={(e) => setQuantity(e.target.value)} value={quantity} type="number" />
                    </div>
                </div>
                <div className="flex justify-between md:space-x-0 mt-2">
                    <div><button className="text-sm py-2 md:text-lg text-blue-400 flex " onClick={() => handleCreateItem()}><CirclePlus className="w-5 h-5 mt- pr-1" />Create new item</button></div>
                    {(curItem && quantity) ?
                        <Button variant="outline" className="left-0 border rounded-lg py-1 border-red-500 px-8" onClick={() => handleAdd()}>Add</Button>
                        :
                        <Button disabled={true} variant="secondary" className="left-0 border rounded-lg py-1 border-red-500 px-8" >Add</Button>}
                    {/* <Button variant="outline" className="left-0 border rounded-lg py-1 border-red-500 px-8" onClick={() => handleAdd()}>Add</Button> */}
                </div>
                <div className="text-xs font-thin text-rose-700">Added Items</div>
                {orderData.category_list?.list?.map((cat) => {
                    return <div className="container mb-4 mx-0 px-0">
                        <h3 className="text-sm font-semibold py-2">{cat.name}</h3>
                        <table className="table-auto w-[95%]">
                            <thead>
                                <tr className="bg-gray-200">
                                    <th className="px-4 py-1 text-xs">Item Name</th>
                                    <th className="px-4 py-1 pl-10 text-xs">Unit</th>
                                    <th className="px-4 py-1 text-xs">Quantity</th>
                                    <th className="px-4 py-1 text-xs">Edit</th>
                                </tr>
                            </thead>
                            <tbody>
                                {orderData.procurement_list.list?.map((item) => {
                                    if (item.category === cat.name) {
                                        return <tr key={item.item} >
                                            <td className="border-b-2 px-4 py-1 text-xs text-gray-700 text-center">{item.item}</td>
                                            <td className="border-b-2 px-4 py-1 pl-10 text-xs text-gray-700 text-center">{item.unit}</td>
                                            <td className="border-b-2 px-4 py-1 text-xs text-gray-700 text-center">{item.quantity}</td>
                                            <td className="border-b-2 px-4 py-1 text-xs text-gray-700 text-center">
                                                <Dialog className="border border-gray-200">
                                                    <DialogTrigger><Pencil className="w-4 h-4" /></DialogTrigger>
                                                    <DialogContent>
                                                        <DialogHeader>
                                                            <DialogTitle className="text-left py-2">Edit Item</DialogTitle>
                                                            <DialogDescription className="flex flex-row">
                                                            </DialogDescription>
                                                            <DialogDescription className="flex flex-row">
                                                                <div className="flex space-x-2">
                                                                    <div className="w-1/2 md:w-2/3">
                                                                        <h5 className="text-xs text-gray-400 text-left">Items</h5>
                                                                        <div className=" w-full border rounded-lg px-1 py-2 text-left">
                                                                            {item.item}
                                                                        </div>
                                                                    </div>
                                                                    <div className="w-[30%]">
                                                                        <h5 className="text-xs text-gray-400 text-left">UOM</h5>
                                                                        <div className="h-[37px] w-full pt-1 text-left">
                                                                            {item.unit}
                                                                        </div>
                                                                    </div>
                                                                    <div className="w-[25%]">
                                                                        <h5 className="text-xs text-gray-400 text-left">Qty</h5>
                                                                        <input type="number" placeholder={item.quantity} className="min-h-[30px] rounded-lg w-full border p-2" onChange={(e) => setQuantity(e.target.value)} />
                                                                    </div>
                                                                </div>
                                                            </DialogDescription>
                                                            <DialogDescription className="flex flex-row justify-between">
                                                                <div></div>
                                                                <div className="flex botton-4 right-4 gap-2">
                                                                    <Button className="bg-gray-100 text-black" onClick={() => handleDelete(item.item)}>Delete</Button>
                                                                    <DialogClose><Button onClick={() => handleSave(item.item, quantity)}>Save</Button></DialogClose>
                                                                </div>
                                                            </DialogDescription>
                                                        </DialogHeader>
                                                    </DialogContent>
                                                </Dialog>
                                            </td>
                                        </tr>
                                    }
                                })}
                            </tbody>
                        </table>
                    </div>
                })}

                <Card className="flex flex-col items-start shadow-none border border-grey-500 p-3">
                    <h3 className="font-bold py-1">Include Comments</h3>
                    <textarea className="w-full border rounded-lg p-2 min-h-12" placeholder="Comments" onChange={handleCommentChange} />
                </Card>
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
                        <DialogClose>
                            <Button variant="secondary" onClick={() => handleSubmit()}>Confirm</Button>
                        </DialogClose>
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
                    <label htmlFor="makeName" className="block text-sm font-medium text-gray-700">Make Name</label>
                    <Input
                        type="text"
                        id="makeName"
                        value={make}
                        onChange={(e) => setMake(e.target.value)}
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
                            {/* <SelectItem value="PCS">PCS</SelectItem> */}
                            <SelectItem value="BOX">BOX</SelectItem>
                            <SelectItem value="ROLL">ROLL</SelectItem>
                            {/* <SelectItem value="PKT">PKT</SelectItem> */}
                            <SelectItem value="LENGTH">LTH</SelectItem>
                            <SelectItem value="MTR">MTR</SelectItem>
                            <SelectItem value="NOS">NOS</SelectItem>
                            <SelectItem value="KGS">KGS</SelectItem>
                            <SelectItem value="PAIRS">PAIRS</SelectItem>
                            <SelectItem value="PACKS">PACKS</SelectItem>
                            <SelectItem value="DRUM">DRUM</SelectItem>
                            {/* <SelectItem value="COIL">COIL</SelectItem> */}
                            <SelectItem value="SQMTR">SQMTR</SelectItem>
                            <SelectItem value="LTR">LTR</SelectItem>
                            {/* <SelectItem value="PAC">PAC</SelectItem> */}
                            {/* <SelectItem value="BAG">BAG</SelectItem> */}
                            <SelectItem value="BUNDLE">BUNDLE</SelectItem>
                            <SelectItem value="FEET">FEET</SelectItem>
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
                <div className="mb-4">
                    <div className=" mt-72">
                        <Dialog>
                            <DialogTrigger asChild>
                                {(curItem && unit) ?
                                    <Button className="mt-15 h-8 w-full bg-red-700 rounded-md text-sm text-white">Confirm and Submit</Button>
                                    :
                                    <Button disabled={true} variant="secondary" className="h-8 w-full rounded-md text-sm">Confirm and Submit</Button>
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
                    </div>

                </div>
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
                                            <img className="h-32 md:h-36 w-32 md:w-36 rounded-lg p-0" src={item.image_url === null ? imageUrl : item.image_url} alt="Category" />
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
        </>
        // </MainLayout>
    )
}