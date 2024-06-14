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
import { useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react"
import { ArrowLeft } from 'lucide-react';
import imageUrl from "@/assets/user-icon.jpeg"
import { MainLayout } from "@/components/layout/main-layout";
import ReactSelect from 'react-select';
import { CirclePlus } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Pencil } from 'lucide-react';

export const ProjectLeadComponent = () => {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()

    const { data: category_list, isLoading: category_list_loading, error: category_list_error } = useFrappeGetDocList("Category",
        {
            fields: ['category_name', 'work_package']
        });
    const { data: item_list, isLoading: item_list_loading, error: item_list_error } = useFrappeGetDocList("Items",
        {
            fields: ['name', 'item_name', 'unit_name', 'category'],
            limit: 1000
        });
    const { data: project_list, isLoading: project_list_loading, error: project_list_error } = useFrappeGetDocList("Projects",
        {
            fields: ['name', 'project_name', 'project_address']
        });
    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'creation', 'category_list'],
            limit: 100
        });

    const { data: quote_data } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['item', 'quote'],
            limit: 1000
        });


    interface Category {
        name: string;
    }

    const [page, setPage] = useState<string>('itemlist')
    const [curItem, setCurItem] = useState<string>('')
    const [curCategory, setCurCategory] = useState<string>('')
    const [unit, setUnit] = useState<string>('')
    const [quantity, setQuantity] = useState<number>(0)
    const [item_id, setItem_id] = useState<string>('');
    const [categories, setCategories] = useState<{ list: Category[] }>({ list: [] });

    // const [dialogVisible, setDialogVisible] = useState(false)
    const [dialogMessage, setDialogMessage] = useState("")


    const addCategory = (categoryName: string) => {
        setCurCategory(categoryName);
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
            if (item.category === curCategory) item_options.push({ value: item.item_name, label: item.item_name })
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
                setQuantity(0);
                setItem_id('');
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
    const { updateDoc: updateDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeUpdateDoc()
    const handleSubmit = () => {

        updateDoc('Procurement Requests', orderData.name, {
            procurement_list: orderData.procurement_list,
            category_list: orderData.category_list,
            workflow_state: "Approved"
        })
            .then(() => {
                console.log("orderData2", orderData)
                navigate("/")
            }).catch(() => {
                console.log("submit_error", submit_error)
            })
    }

    return (
        <MainLayout>
            {page == 'categorylist' &&
                <div className="flex">
                    <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-6 pt-6">
                        <div className="flex items-center space-y-2">
                            {/* <ArrowLeft /> */}
                            <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">Select Category</h2>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-7 gap-4">
                            {category_list?.map((item) => {
                                if (item.work_package === orderData.work_package) {
                                    return <Card className="flex flex-col items-center shadow-none border border-grey-500 hover:animate-shadow-drop-center" onClick={() => handleCategoryClick(item.category_name, 'itemlist')}>
                                        <CardHeader className="flex flex-col items-center justify-center space-y-0 p-2">
                                            <CardTitle className="flex flex-col items-center text-sm font-medium text-center">
                                                <img className="h-32 md:h-36 w-32 md:w-36 rounded-lg p-0" src={imageUrl} alt="Project" />
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
                            <ArrowLeft onClick={() => navigate("/approve-order")} />
                            <h2 className="text-base pl-2 font-bold tracking-tight">Add Items</h2>
                        </div>
                        <div className="flex justify-between md:justify-normal md:space-x-40 md:hidden">
                            <div className="">
                                <h5 className="text-gray-500 test-base">Project</h5>
                                <h3 className=" font-semibold text-lg">{orderData?.project}</h3>
                            </div>
                            <div className="">
                                <h5 className="text-gray-500 test-base">Package</h5>
                                <h3 className=" font-semibold text-lg">{orderData.work_package}</h3>
                            </div>
                        </div>

                        <Card className="md:grid grid-cols-5 gap-4 border border-gray-100 rounded-lg p-4 hidden ">
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">Date</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.creation?.split(" ")[0]}</p>
                            </div>
                            <div className="border-0 flex flex-col items-center justify-center">
                                <p className="text-left py-1 font-semibold text-sm text-gray-300">Project</p>
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.project}</p>
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

                        <button className="text-lg text-blue-400 flex p-2" onClick={() => setPage('categorylist')}><CirclePlus className="w-5 h-5 mt-1 pr-1" /> Add Missing Items</button>

                        {curCategory && <Card className="p-5">
                            <h3 className="font-bold pb-2">{curCategory}</h3>
                            <div className="flex space-x-2">

                                <div className="w-1/2 md:w-2/3">
                                    <h5 className="text-xs text-gray-400">Items</h5>
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
                            <div className="flex space-x-48 md:space-x-0 mt-2 ">
                                {(curItem && quantity) ?
                                    <Button variant="outline" className="left-0 border rounded-lg py-1 border-red-500 px-8" onClick={() => handleAdd()}>Add</Button>
                                    :
                                    <Button disabled={true} variant="secondary" className="left-0 border rounded-lg py-1 border-red-500 px-8" >Add</Button>}
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
                        <Card className="p-4">
                            <div className="text-sm text-gray-700">Added Items</div>
                            {categories.list?.map((cat) => {
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
                                                                                    <h5 className="text-xs text-gray-400 text-left">Items</h5>
                                                                                    <div className=" w-full border rounded-lg px-1 pt-1 text-left">
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
                        </Card>
                        <div className="pt-10"></div>
                        <div className="flex flex-col justify-end items-end fixed bottom-4 right-4">
                            <button className="bg-red-500 text-white font-normal py-2 px-6 rounded-lg" onClick={() => setPage('approve')}>
                                Next
                            </button>
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
                                <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.project}</p>
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
                                            <td className="px-6 py-4 whitespace-nowrap">{item.item}</td>
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
                        <div className="flex flex-col justify-end items-end fixed bottom-4 right-4">
                            <Dialog>
                                <DialogTrigger asChild>
                                    <Button>
                                        Approve
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="sm:max-w-[425px]">
                                    <DialogHeader>
                                        <DialogTitle>Are you Sure</DialogTitle>
                                        <DialogDescription>
                                            Click on Confirm to Approve.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <Button variant="secondary" onClick={() => handleSubmit()}>Confirm</Button>
                                </DialogContent>
                            </Dialog>
                        </div>
                    </div>
                </div>}
        </MainLayout>
    )
}