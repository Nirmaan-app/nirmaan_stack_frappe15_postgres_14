import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogClose
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useFrappeCreateDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react"
import { ArrowLeft, SquareArrowDown } from 'lucide-react';
import imageUrl from "@/assets/user-icon.jpeg"
import { MainLayout } from "@/components/layout/main-layout";
import ReactSelect from 'react-select';
import { CirclePlus } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Pencil, X } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectValue, SelectTrigger } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";

import { formatDate } from "@/utils/FormatDate";

export const ProjectLeadComponent = () => {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()

    const { data: category_list, isLoading: category_list_loading, error: category_list_error } = useFrappeGetDocList("Category",
        {
            fields: ['category_name', 'work_package', 'image_url', 'tax'],
            orderBy: { field: 'category_name', order: 'asc' },
            limit: 1000
        });
    const { data: item_list, isLoading: item_list_loading, error: item_list_error, mutate: item_list_mutate } = useFrappeGetDocList("Items",
        {
            fields: ['name', 'item_name', 'make_name', 'unit_name', 'category', 'creation'],
            orderBy: { field: 'creation', order: 'desc' },
            limit: 1000
        });
    const { data: project_list, isLoading: project_list_loading, error: project_list_error } = useFrappeGetDocList("Projects",
        {
            fields: ['name', 'project_name', 'project_address']
        });
    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'creation', 'category_list'],
            limit: 1000
        });

    const { data: quote_data } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['item', 'quote'],
            limit: 2000
        });

    const { createDoc: createDoc, error: update_error } = useFrappeCreateDoc()


    interface Category {
        name: string;
    }

    const [page, setPage] = useState<string>('itemlist')
    const [curItem, setCurItem] = useState<string>('')
    const [curCategory, setCurCategory] = useState<string>('')
    const [unit, setUnit] = useState<string>('')
    const [quantity, setQuantity] = useState<number | string>('')
    const [item_id, setItem_id] = useState<string>('');
    const [categories, setCategories] = useState<{ list: Category[] }>({ list: [] });
    const [make, setMake] = useState('');
    const [tax, setTax] = useState<number | null>(null)

    // const [dialogVisible, setDialogVisible] = useState(false)
    const [dialogMessage, setDialogMessage] = useState("")


    const addCategory = (categoryName: string) => {
        setCurCategory(categoryName);
        setTax(category_list?.find((category) => category.category_name === categoryName).tax)
        const isDuplicate = categories.list.some(category => category.name === categoryName);
        if (!isDuplicate) {
            setCategories(prevState => ({
                ...prevState,
                list: [...prevState.list, { name: categoryName }]
            }));
        }
        console.log("categories2", categories)
    };
    const handleCategoryClick = (category: string, value: string) => {
        addCategory(category);
        setPage(value);

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
    useEffect(() => {
        if (!orderData.project) {
            procurement_request_list?.map(item => {
                if (item.name === id) {
                    setOrderData(item);
                    item.procurement_list.list.map((items) => {
                        const isDuplicate = categories.list.some(category => category.name === items.category);
                        if (!isDuplicate) {
                            setCategories(prevState => ({
                                ...prevState,
                                list: [...prevState.list, { name: items.category }]
                            }));
                        }
                    });
                }
            });
            setCategories(prevState => ({
                ...prevState,
                list: prevState.list.filter((category, index, self) =>
                    index === self.findIndex((c) => (
                        c.name === category.name
                    ))
                )
            }));
        }
    }, [procurement_request_list]);

    const item_lists: string[] = [];
    const item_options: string[] = [];

    if (curCategory) {
        item_list?.map((item) => {
            if (item.category === curCategory) item_options.push({ value: item.item_name, label: `${item.item_name}${item.make_name ? "-" + item.make_name : ""}` })
        })
    }

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
                if (isDuplicate) {
                    // setDialogVisible(true)
                    setDialogMessage(`${curItem} Already exists!!!`)
                    var button = document.getElementById('alert');
                    button.click();
                }
                else {
                    curRequest.push(curValue);
                }
                setOrderData((prevState) => ({
                    ...prevState,
                    procurement_list: {
                        list: curRequest,
                    },
                }));
                setUnit('');
                setQuantity('');
                setItem_id('');
                setCurItem('');
                setMake('');
            }
            const categoryIds = categories.list.map((cat) => cat.name);
            const curCategoryIds = orderData.category_list.list.map((cat) => cat.name);
            const newCategoryIds = categoryIds.filter((id) => !curCategoryIds.includes(id));
            const newCategories = categories.list.filter((cat) => newCategoryIds.includes(cat.name));

            setOrderData((prevState) => ({
                ...prevState,
                category_list: {
                    list: [...prevState.category_list.list, ...newCategories],
                },
            }));
        }
    };
    const handleSave = (itemName: string, newQuantity: number) => {
        let curRequest = orderData.procurement_list.list;
        curRequest = curRequest.map((curValue) => {
            if (curValue.item === itemName) {
                return { ...curValue, quantity: newQuantity };
            }
            return curValue;
        });
        setOrderData((prevState) => ({
            ...prevState,
            procurement_list: {
                list: curRequest,
            },
        }));
        setQuantity('')
        setCurItem('')
    };

    console.log("orderData", orderData)
    const handleDelete = (item: string) => {
        let curRequest = orderData.procurement_list.list;
        curRequest = curRequest.filter(curValue => curValue.item !== item);
        setOrderData(prevState => ({
            ...prevState,
            procurement_list: {
                list: curRequest
            }
        }));
        setQuantity('')
        setCurItem('')
    }

    const { toast } = useToast()
    const { updateDoc: updateDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeUpdateDoc()
    const handleSubmit = () => {

        updateDoc('Procurement Requests', orderData.name, {
            procurement_list: orderData.procurement_list,
            category_list: orderData.category_list,
            workflow_state: "Approved"
        })
            .then((res) => {
                console.log("orderData2", res)
                toast({
                    title: "Success!",
                    description: `PR: ${res?.name} is successfully approved!`,
                    variant: "success"
                })
                navigate("/")
            }).catch(() => {
                toast({
                    title: "Failed!",
                    description: `${submit_error?.message}`,
                    variant: "destructive"
                })
                console.log("submit_error", submit_error)
            })
    }

    const handleCreateItem = () => {
        setUnit('')
        setCurItem('')
        setMake('')
        setPage('additem')
    }

    const handleCategoryClick2 = (category: string) => {
        addCategory(category);
        setPage('additem');
    };

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
                console.log("submit_error", update_error)
            })
    }

    return (
        <>
            {page == 'categorylist' &&
                <div className="flex">
                    <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-6 pt-6">
                        <div className="flex items-center space-y-2">
                            <ArrowLeft className="cursor-pointer" onClick={() => setPage('itemlist')} />
                            <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">Select Category</h2>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-7 gap-4">
                            {category_list?.map((item) => {
                                if (item.work_package === orderData.work_package) {
                                    return <Card className="flex flex-col items-center shadow-none border border-grey-500 hover:animate-shadow-drop-center" onClick={() => handleCategoryClick(item.category_name, 'itemlist')}>
                                        <CardHeader className="flex flex-col items-center justify-center space-y-0 p-2">
                                            <CardTitle className="flex flex-col items-center text-sm font-medium text-center">
                                                <img className="h-32 md:h-36 w-32 md:w-36 rounded-lg p-0" src={item.image_url === null ? imageUrl : item.image_url} alt="Category" />
                                                <span>{item.category_name}</span>
                                            </CardTitle>
                                            {/* <HardHat className="h-4 w-4 text-muted-foreground" /> */}
                                        </CardHeader>
                                    </Card>
                                }
                            })}
                        </div>
                    </div></div>}
            {page == 'itemlist' &&
                <div className="flex">
                    <div className="flex-1 space-x-2 md:space-y-4 p-2 md:p-6 pt-6">
                        {/* <button className="font-bold text-md" onClick={() => setPage('categorylist')}>Add Items</button> */}
                        <div className="flex items-center pt-1  pb-4 ">
                            <ArrowLeft className="cursor-pointer" onClick={() => navigate("/approve-order")} />
                            <h2 className="text-base pl-2 font-bold tracking-tight">Add Items</h2>
                        </div>
                        <div className="flex justify-between md:justify-normal md:space-x-40 md:hidden">
                            <div className="">
                                <h5 className="text-gray-500 test-base">Project</h5>
                                <h3 className=" font-semibold text-lg">{project_list?.find(item => item.name === orderData?.project)?.project_name}</h3>
                            </div>
                            <div className="">
                                <h5 className="text-gray-500 test-base">Package</h5>
                                <h3 className=" font-semibold text-lg">{orderData.work_package}</h3>
                            </div>
                        </div>

                        {/* <Card className="md:grid grid-cols-5 gap-4 border border-gray-100 rounded-lg p-4">
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-red-300">Date</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{formatDate(orderData?.creation)}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-red-300">Project</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{project_list?.find(item => item.name === orderData?.project)?.project_name}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-red-300">Package</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.work_package}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-red-300">Project Lead</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.owner}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-red-300">PR Number</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.name?.slice(-4)}</p>
                            </div>

                        </Card> */}

                        {curCategory === '' && <button className="text-lg text-blue-400 flex p-2" onClick={() => setPage('categorylist')}><CirclePlus className="w-5 h-5 mt-1 pr-1" /> Add Missing Items</button>}

                        {curCategory && 
                        <Card className="p-4 max-sm:p-2 mt-4 border border-gray-100 rounded-lg">
                            <div className="flex justify-between">
                                <button onClick={() => setPage("categorylist")} className="text-blue-400 underline ml-2 mb-2">
                                    <div className="flex">
                                        <h3 className="font-bold pb-2">{curCategory}</h3>
                                        <Pencil className="w-4 h-4 ml-1 mt-1" />
                                    </div>
                                </button>
                                <button className="text-red-600 mb-1" onClick={() => setCurCategory('')}><X className="md:w-6 md:h-6 " /></button>
                            </div>

                            <div className="flex space-x-2">

                                <div className="w-1/2 md:w-2/3">
                                    <h5 className="text-xs text-gray-400">Items</h5>
                                    <ReactSelect value={{ value: curItem, label: `${curItem}${make ? "-" + make : ""}` }} options={item_options} onChange={handleChange} />
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
                            <div className="flex justify-between mt-4">
                                <div className="mt-3">
                                    <button className="text-sm  md:text-lg text-blue-400 flex items-center gap-1" onClick={() => handleCreateItem()}><CirclePlus className="w-4 h-4" />Create New Item</button>
                                </div>
                                {(curItem && quantity) ?
                                    <Button variant="outline" className="left-0 border rounded-lg py-1 border-red-500 px-8 text-red-500" onClick={() => handleAdd()}>Add</Button>
                                    :
                                    <Button disabled={true} variant="secondary" className="left-0 border rounded-lg py-1 border-red-500 px-8 text-red-500" >Add</Button>
                                }
                            </div>
                        </Card>
                        }
                        <AlertDialog>
                            <AlertDialogTrigger>
                                <button className="hidden" id="alert"></button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Oops</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        {dialogMessage}
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogAction >Continue</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                        <Card className="p-4 border border-gray-100 rounded-lg">
                            <div className="text-xs text-red-700 pb-2">Added Items</div>
                            {!orderData?.procurement_list?.list.length && <div className="text-sm">No Items to display, please reload the page to recover the deleted items or add at least an item to enable the "Next" button</div>}
                            {orderData.category_list.list?.map((cat) => {
                                return <div key={cat.name} className="">
                                    <h3 className="text-sm font-semibold py-2">{cat.name}</h3>
                                    <table className="table-auto md:w-full">
                                        <thead>
                                            <tr className="bg-gray-200">
                                                <th className="w-[60%] text-left px-4 py-1 text-xs">Item Name</th>
                                                <th className="w-[20%] px-4 py-1 text-xs">Unit</th>
                                                <th className="w-[10%] px-4 py-1 text-xs">Quantity</th>
                                                <th className="w-[10%] px-4 py-1 text-xs">Edit</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {orderData.procurement_list.list?.map((item) => {
                                                if (item.category === cat.name) {
                                                    return <tr key={item.item} >
                                                        <td className="w-[60%] text-left border-b-2 px-4 py-1 text-sm text-cent">{item.item}</td>
                                                        <td className="w-[20%] border-b-2 px-4 py-1 text-sm text-center">{item.unit}</td>
                                                        <td className="w-[10%] border-b-2 px-4 py-1 text-sm text-center">{item.quantity}</td>
                                                        <td className="w-[10%] border-b-2 px-4 py-1 text-sm text-center">
                                                            <Dialog className="border border-gray-200">
                                                                <DialogTrigger><Pencil className="w-4 h-4" /></DialogTrigger>
                                                                <DialogContent>
                                                                    <DialogHeader>
                                                                        <DialogTitle>Edit Item</DialogTitle>
                                                                        <DialogDescription className="flex flex-row">
                                                                            <div className="flex space-x-2">
                                                                                <div className="w-1/2 md:w-2/3">
                                                                                    <h5 className="text-base text-gray-400 text-left mb-1">Item Name</h5>
                                                                                    <div className="w-full  p-1 text-left">
                                                                                        {item.item}
                                                                                    </div>
                                                                                </div>
                                                                                <div className="w-[30%]">
                                                                                    <h5 className="text-base text-gray-400 text-left mb-1">UOM</h5>
                                                                                    <div className=" w-full  p-2 text-center justify-left flex">
                                                                                        {item.unit}
                                                                                    </div>
                                                                                </div>
                                                                                <div className="w-[25%]">
                                                                                    <h5 className="text-base text-gray-400 text-left mb-1">Qty</h5>
                                                                                    <input type="number" placeholder={item.quantity} className=" rounded-lg w-full border p-2" onChange={(e) => setQuantity(e.target.value)} />
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
                        </Card>
                        <div className="pt-10"></div>
                        <div className="flex flex-col justify-end items-end">
                            <Button disabled={!orderData.procurement_list.list.length} className="" onClick={() => setPage('approve')}>
                                Next
                            </Button>
                        </div>


                        {/* <button className="bottom-0 h-8 w-full bg-red-700 rounded-md text-sm text-white" onClick={()=>handleSubmit()}>Next</button> */}
                    </div>
                </div>}
            {page == 'approve' &&
                <div className="flex">
                    <div className="flex-1 space-x-2 md:space-y-4 p-2 md:p-6 pt-6">
                        {/* <button className="font-bold text-md" onClick={() => setPage('categorylist')}>Add Items</button> */}
                        <div className="flex items-center pt-1 pb-4">
                            <ArrowLeft onClick={() => setPage('itemlist')} />
                            <h2 className="text-base pl-2 font-bold tracking-tight">Orders</h2>
                        </div>
                        <Card className="grid grid-cols-5 gap-4 border border-gray-100 rounded-lg p-4">
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">Date</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.creation?.split(" ")[0]}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">Project</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{project_list?.find(item => item.name === orderData?.project)?.project_name}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">Package</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.work_package}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">Project Lead</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.owner}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">PR Number</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.name?.slice(-4)}</p>
                            </div>
                        </Card>
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-gray-200">
                                <thead className="border-b-2 border-black">
                                    <tr>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Items</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">UOM</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estimated Price</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {orderData.procurement_list?.list?.map(item => {
                                        const quotesForItem = quote_data
                                            ?.filter(value => value.item === item.name && value.quote != null)
                                            ?.map(value => value.quote);
                                        let minQuote;
                                        if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
                                        return <tr key={item.item}>
                                            <td className="px-6 py-4">{item.item}</td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                {item.category}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">{item.unit}</td>
                                            <td className="px-6 py-4 whitespace-nowrap">{item.quantity}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                                {minQuote ? minQuote * item.quantity : "N/A"}
                                            </td>
                                        </tr>
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex flex-col justify-end items-end">
                            <Dialog>
                                <DialogTrigger asChild>
                                    <Button>
                                        Approve
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="sm:max-w-[425px]">
                                    <DialogHeader>
                                        <DialogTitle>Are you Sure?</DialogTitle>
                                        <DialogDescription>
                                            Click on Confirm to Approve.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <DialogClose>
                                        <Button variant="default" onClick={() => handleSubmit()}>Confirm</Button>
                                    </DialogClose>
                                </DialogContent>
                            </Dialog>
                        </div>
                    </div>
                </div>}
            {page == 'additem' && <div className="flex-1 space-x-2 md:space-y-4 p-2 md:p-12 pt-6">
                {/* <button className="font-bold text-md" onClick={() => setPage('categorylist')}>Add Items</button> */}
                <div className="flex items-center pt-1 pb-4">
                    <ArrowLeft className="cursor-pointer" onClick={() => setPage('itemlist')} />
                    <h2 className="text-base pl-2 font-bold tracking-tight">Create new Item</h2>
                </div>
                <div className="mb-4">
                    <div className="flex">
                        <div className="text-lg font-bold py-2">Category: </div>
                        <button onClick={() => setPage("categorylist2")} className="text-blue-500 underline ml-1">
                            <div className="flex">
                                <div className="text-lg font-bold">{curCategory}</div>
                                <Pencil className="w-4 h-4 ml-1 mt-1.5" />
                            </div>
                        </button>

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
                <div className="py-10">
                    <div className="">
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
                    <ArrowLeft onClick={() => setPage('additem')} />
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
    )
}