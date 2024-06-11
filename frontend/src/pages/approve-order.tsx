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
import { useState,useEffect } from "react"
import { ArrowLeft } from 'lucide-react';
import imageUrl from "@/assets/user-icon.jpeg"
import { MainLayout } from "@/components/layout/main-layout";
import ReactSelect from 'react-select';
import { CirclePlus } from 'lucide-react';

export const ProjectLeadComponent = () => {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()

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
            fields: ['name', 'project_name', 'project_address']
        });
    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'creation','category_list']
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
            if (item.category === curCategory) item_options.push({value:item.item_name , label:item.item_name})
        })
    }

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
                    <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                        <div className="flex items-center space-y-2">
                            {/* <ArrowLeft /> */}
                            <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">Select Category</h2>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-7 gap-4">
                            {category_list?.map((item) => {
                                if (item.work_package === orderData.work_package) {
                                    return <Card className="flex shadow-none border border-grey-500 hover:animate-shadow-drop-center" onClick={() => handleCategoryClick(item.category_name, 'itemlist')}>
                                        <CardHeader className="flex flex-row items-center justify-between space-y-0 p-2">
                                            <CardTitle className="text-sm font-medium">
                                                <img className="h-32 md:h-36 w-32 md:w-36 p-2 rounded-lg p-0 text-sm" src={imageUrl} alt="Project" />
                                                {item.category_name}
                                            </CardTitle>
                                        </CardHeader>
                                    </Card>
                                }
                            })}
                        </div>
                    </div></div>}
            {page == 'itemlist' &&
                <div className="flex">
                    <div className="flex-1 space-x-2 md:space-y-4 p-2 md:p-12 pt-6">
                        {/* <button className="font-bold text-md" onClick={() => setPage('categorylist')}>Add Items</button> */}
                        <div className="flex items-center space-y-2">
                            <ArrowLeft onClick={() => navigate("/approve-order")} />
                            <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">Add Items</h2>
                        </div>
                        <div className="flex justify-center md:justify-normal md:space-x-40">
                            <div className="p-2">
                                <h5 className="text-gray-500 text-xs md:test-base">Project</h5>
                                <h3 className="pl-2 font-semibold text-sm md:text-lg">{orderData?.project}</h3>
                            </div>
                            <div className="p-2">
                                <h5 className="text-gray-500 text-xs md:test-base">Package</h5>
                                <h3 className="pl-2 font-semibold text-sm md:text-lg">{orderData?.work_package}</h3>
                            </div>
                        </div>
                        <button className="text-sm md:text-lg text-blue-400 flex" onClick={() => setPage('categorylist')}><CirclePlus className="w-5 h-5 mt-1 pr-1"/> Select Category</button>
                        <h3 className="font-bold">{curCategory}</h3>
                        {curCategory && <><div className="flex space-x-2">
                            <div className="w-1/2 md:w-2/3">
                                <h5 className="text-xs text-gray-400">Items</h5>
                                <ReactSelect options={item_options} onChange={handleChange} />
                            </div>
                            <div className="flex-1">
                                <h5 className="text-xs text-gray-400">UOM</h5>
                                <input className="h-[37px] w-full border rounded-lg" type="text" placeholder={unit} value={unit} />
                            </div>
                            <div className="flex-1">
                                <h5 className="text-xs text-gray-400">Qty</h5>
                                <input className="h-[37px] w-full border rounded-lg" onChange={(e) => setQuantity(e.target.value)} value={quantity} type="number" />
                            </div>
                        </div>
                        <div className="flex space-x-48 md:space-x-0 mt-2">
                            <div></div>
                            <button className="left-0 border rounded-lg py-1 border-red-500 px-8" onClick={() => handleAdd()}>Add</button>
                        </div></>
                        }
                        
                        <div className="text-sm text-gray-700">Added Items</div>
                        {categories.list?.map((cat) => {
                            return <div key={cat.name} className="container mx-0 px-0">
                                <h3 className="text-sm font-semibold py-2">{cat.name}</h3>
                                <table className="table-auto md:w-full">
                                    <thead>
                                        <tr className="bg-gray-200">
                                            <th className="w-[50%] text-left px-4 py-1 text-xs">Item Name</th>
                                            <th className="px-4 py-1 text-xs">Unit</th>
                                            <th className="px-4 py-1 text-xs">Quantity</th>
                                            <th className="px-4 py-1 text-xs"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {orderData.procurement_list.list?.map((item) => {
                                            if (item.category === cat.name) {
                                                return <tr key={item.item} >
                                                    <td className="w-[50%] text-left border-b-2 px-4 py-1 text-sm text-cent">{item.item}</td>
                                                    <td className="border-b-2 px-4 py-1 text-sm text-center">{item.unit}</td>
                                                    <td className="border-b-2 px-4 py-1 text-sm text-center">{item.quantity}</td>
                                                    <td className="border-b-2 px-4 py-1 text-sm text-right">
                                                        <Dialog className="border border-gray-200">
                                                            <DialogTrigger>Edit</DialogTrigger>
                                                            <DialogContent>
                                                                <DialogHeader>
                                                                    <DialogTitle>Edit Item</DialogTitle>
                                                                    <DialogDescription className="flex flex-row">
                                                                        <h3>{item.item}</h3>
                                                                    </DialogDescription>
                                                                    <DialogDescription className="flex flex-row">
                                                                        <label htmlFor="">Edit Quantity</label>
                                                                    </DialogDescription>
                                                                    <DialogDescription className="flex flex-row">
                                                                        <input type="number" placeholder={item.quantity} className="min-h-[30px] rounded-lg border my-4 p-2" onChange={(e) => setQuantity(e.target.value)} />
                                                                    </DialogDescription>
                                                                    <DialogDescription className="flex flex-row">
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
                    <div className="flex-1 space-x-2 md:space-y-4 p-2 md:p-12 pt-6">
                        {/* <button className="font-bold text-md" onClick={() => setPage('categorylist')}>Add Items</button> */}
                        <div className="flex items-center space-y-2">
                            <ArrowLeft onClick={() => setPage('itemlist')} />
                            <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">Orders</h2>
                        </div>
                        <div className="grid grid-cols-5 gap-4 border border-gray-100 rounded-lg p-4">
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
                        </div>
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
                                    {orderData.procurement_list?.list?.map(item => (
                                        <tr key={item.item}>
                                            <td className="px-6 py-4 whitespace-nowrap">{item.item}</td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                {item.category}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">{item.unit}</td>
                                            <td className="px-6 py-4 whitespace-nowrap">{item.quantity}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                                N/A
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex flex-col h-full justify-end items-end fixed bottom-4 right-4">
                        <Dialog>
                            <DialogTrigger asChild>
                                <button className="bg-red-500 text-white font-normal py-2 px-6 rounded-lg">
                                    Approve
                                </button>
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