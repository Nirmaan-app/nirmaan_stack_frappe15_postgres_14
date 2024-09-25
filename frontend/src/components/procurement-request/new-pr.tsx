import { Card, CardHeader, CardTitle } from "../ui/card";
import { useFrappeGetDocList, useFrappeGetDoc, useFrappeCreateDoc, useFrappeUpdateDoc, useSWRConfig } from "frappe-react-sdk";
import { MessageCircleMore, PackagePlus } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useState, useEffect } from "react"
import { ArrowLeft } from 'lucide-react';
import ReactSelect from 'react-select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "../ui/dialog"
import { Button } from "../ui/button"
import { CirclePlus } from 'lucide-react';
import { Pencil } from 'lucide-react';
import imageUrl from "@/assets/user-icon.jpeg"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Input } from "../ui/input";
import { useUserData } from "@/hooks/useUserData";
import { useToast } from "../ui/use-toast";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { NewPRSkeleton } from "../ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

const NewPR = () => {

    const { id } = useParams<{ id: string }>();


    const { data: project, isLoading: project_loading, error: project_error } = useFrappeGetDoc<ProjectsType>("Projects", id);

    return (
        <>  {project_loading ? <NewPRSkeleton /> : <NewPRPage project={project} />}
            {project_error && <h1>{project_error.message}</h1>}
        </>
    )
};

export const NewPRPage = ({ project=undefined, rejected_pr_data= undefined, setSection }) => {

    const navigate = useNavigate();
    const userData = useUserData()
    const { toast } = useToast()

    const [page, setPage] = useState<string>('wplist')
    const [curItem, setCurItem] = useState<string>('')
    const [curCategory, setCurCategory] = useState<string>('')
    const [unit, setUnit] = useState<string>('')
    const [quantity, setQuantity] = useState<number | null | string>(null)
    const [item_id, setItem_id] = useState<string>('');
    const [categories, setCategories] = useState<{ list: Category[] }>({ list: [] });
    const [make, setMake] = useState('');
    const [tax, setTax] = useState<number | null>(null)
    const [comments, setComments] = useState({});
    const [universalComment, setUniversalComment] = useState<string | null>(null)

    const handleCommentChange = (e) => {
        setUniversalComment(e.target.value === "" ? null : e.target.value)
    }


    const handleItemCommentChange = (item, e) => {
        setComments((prevComments) => ({
            ...prevComments,
            [item.item]: e.target.value,
        }));
    };

    const [orderData, setOrderData] = useState({
        project: project.name,
        work_package: '',
        procurement_list: {
            list: []
        },
        category_list: {
            list: []
        }
    })

    useEffect(() => {
        if(rejected_pr_data) {
            setOrderData(rejected_pr_data)
            setPage("itemlist")
        }
    }, [])

    const {data: universalComments} = useFrappeGetDocList("Comment", {
        fields: ["*"],
        filters: [["reference_name", "=", rejected_pr_data?.name]],
        orderBy: {field: "creation", order: "desc"}
    },
    `${rejected_pr_data ? `Comment,filters(reference_name,${rejected_pr_data.name})` : null}`
    )

    const { data: wp_list, isLoading: wp_list_loading, error: wp_list_error } = useFrappeGetDocList("Procurement Packages",
        {
            fields: ['work_package_name', "work_package_image"],
            orderBy: { field: 'work_package_name', order: 'asc' },
            limit: 100
        });
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
            limit: 10000
        });

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    const {updateDoc, error: update_error} = useFrappeUpdateDoc()

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


    interface Category {
        name: string;
    }

    const addWorkPackage = (wpName: string) => {
        setOrderData(prevData => ({
            ...prevData,
            work_package: wpName
        }));
    };
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
        console.log(curCategory, categories)
    };


    const handleWPClick = (wp: string, value: string) => {
        setOrderData({
            project: project.name,
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

    const item_options: string[] = [];
    if (curCategory) {
        item_list?.map((item) => {
            if (item.category === curCategory) item_options.push({ value: item.item_name, label: `${item.item_name}${item.make_name ? "-" + item.make_name : ""}` })
        })
    }

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
                    setOrderData((prevState) => ({
                        ...prevState,
                        procurement_list: {
                            list: curRequest,
                        },
                    }));
                } else {
                    toast({
                        title : "Invalid Request!",
                        description: (<span>You are trying to add the <b>item: {curItem}</b> multiple times which is not allowed, instead edit the quantity directly!</span>)
                    })
                }
                setQuantity('');
                setCurItem('');
                setUnit('');
                setItem_id('');
                setMake('');
            }
        }
    };

    const {mutate} = useSWRConfig()

    // console.log("quantity", quantity)

    const handleSubmit = async () => {
        if (
            userData?.role === "Nirmaan Project Manager Profile" || 
            userData?.role === "Nirmaan Admin Profile" || 
            userData?.role === "Nirmaan Procurement Executive Profile" || 
            userData?.role === "Nirmaan Project Lead Profile"
        ) {
            try {
                const res = await createDoc('Procurement Requests', orderData);

                if(universalComment) {
                    await createDoc("Comment", {
                        comment_type : "Comment",
                        reference_doctype : "Procurement Requests",
                        reference_name : res.name,
                        comment_by : userData?.user_id,
                        content: universalComment
                    })
                }
                console.log("newPR", res);
                await mutate("Procurement Requests, orderBy(creation-desc)");
                await mutate("Procurement Orders");
    
                toast({
                    title: "Success!",
                    description: `New PR: ${res?.name} created successfully!`,
                    variant: "success",
                });
    
                navigate("/procurement-request");
            } catch (error) {
                console.log("submit_error", error);
    
                toast({
                    title: "Failed!",
                    description: `PR Creation failed!`,
                    variant: "destructive",
                });
            }
        }
    };
    

    const handleResolvePR = async () => {
        try {
            const res = updateDoc("Procurement Requests", orderData.name, {
                category_list : orderData.category_list,
                procurement_list: orderData.procurement_list,
                comment: orderData.comment,
                workflow_state: "Pending"
            })

            if(universalComment) {
                await createDoc("Comment", {
                    comment_type : "Comment",
                    reference_doctype : "Procurement Requests",
                    reference_name : res.name,
                    comment_by : userData?.user_id,
                    content: universalComment
                })
            }
            console.log("newPR", res)
            mutate("Procurement Requests, orderBy(creation-desc)")
            mutate("Procurement Orders")
            mutate(`Procurement Requests ${orderData.name}`)
            toast({
                title: "Success!",
                description: `PR: ${orderData?.name} Resolved successfully and Sent for Approval!`,
                variant: "success"
            })
            navigate("/procurement-request")
        } catch (error) {
            console.log("Error while resolving Rejected PR", error, update_error)
            toast({
                title: "Failed!",
                description: `Resolving PR: ${orderData.name} Failed!`,
                variant: "destructive"
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

    const handleSave = (itemName: string, newQuantity: string) => {
        let curRequest = orderData.procurement_list.list;

        console.log("comments of item name", comments[itemName])
        curRequest = curRequest.map((curValue) => {
            if (curValue.item === itemName) {
                return { ...curValue, quantity: parseInt(newQuantity), comment : comments[itemName] === undefined ? curValue.comment || "" :  comments[itemName] || "" };
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
        setQuantity('')
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
        setQuantity('')
        setCurItem('')
    }

    return (
        <>
            {(page == 'wplist' && !rejected_pr_data)  && <div className="flex-1 md:space-y-4 p-4">
                <div className="flex items-center pt-1 pb-4">
                    <ArrowLeft className="cursor-pointer" onClick={() => navigate("/procurement-request")} />
                    <h3 className="text-base pl-2 font-bold tracking-tight">Select Procurement Package</h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {wp_list?.filter((item) => {
                        let wp_arr = JSON.parse(project.project_work_packages).work_packages.map((item) => item.work_package_name)
                        if (item.work_package_name === "Tool & Equipments" || wp_arr.includes(item.work_package_name)) return true
                    }).map((item) => (
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
            {page == 'categorylist' && <div className="flex-1 md:space-y-4 p-4">
                <div className="flex items-center pt-1 pb-4">
                {!rejected_pr_data && (
                    <Dialog>
                    <DialogTrigger asChild>
                        <ArrowLeft className="cursor-pointer" />
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                            <DialogTitle>Reset Order List?</DialogTitle>
                            <DialogDescription>
                                Going back to work package selection will clear your current order list. Are you sure?
                            </DialogDescription>
                        </DialogHeader>
                        <DialogClose>
                            <Button onClick={() => setPage('wplist')}>Yes</Button>
                            <Button variant="secondary" className="ml-3">No</Button>
                        </DialogClose>
                    </DialogContent>
                </Dialog>
                )}
                    <h2 className="text-base pl-2 font-bold tracking-tight">Select Category</h2>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {category_list?.map((item) => {
                        if (item.work_package === orderData.work_package) {
                            return (
                                <Card className="flex flex-col items-center shadow-none border border-grey-500 hover:animate-shadow-drop-center" onClick={() => handleCategoryClick(item.category_name, 'itemlist')}>
                                    <CardHeader className="flex flex-col items-center justify-center space-y-0 p-2">
                                        <CardTitle className="flex flex-col items-center text-sm font-medium text-center">
                                            <img className="h-32 md:h-36 w-32 md:w-36 rounded-lg p-0" src={item.image_url === null ? imageUrl : item.image_url} alt="Category" />
                                            <span>{item.category_name}</span>
                                        </CardTitle>
                                    </CardHeader>
                                </Card>
                            );
                        }
                    })}
                </div>
            </div>}
            {page == 'itemlist' && <div className="flex-1 md:space-y-4 p-4">
                <div className="flex items-center pt-1 pb-4">
                    {
                        !rejected_pr_data ? (
                            <ArrowLeft className="cursor-pointer" onClick={() => {
                                setCurItem("")
                                setMake("")
                                setQuantity(null)
                                setPage('categorylist')
                            }} />
                        ) : (
                            <ArrowLeft className="cursor-pointer" onClick={() => {
                                setCurItem("")
                                setMake("")
                                setQuantity(null)
                                setSection("pr-summary")
                            }} />
                        )
                    }
                    
                    <h2 className="text-base pl-2 font-bold tracking-tight">Add Items</h2>
                </div>
                <div className="flex justify-between max-md:pr-10 md:justify-normal md:space-x-40 pl-4">
                    <div className="">
                        <h5 className="text-gray-500 text-xs md:test-base">Project</h5>
                        <h3 className=" font-semibold text-sm md:text-lg">{project && project?.project_name}</h3>
                    </div>
                    <div className="">
                        <h5 className="text-gray-500 text-xs md:test-base">Package</h5>
                        <h3 className=" font-semibold text-sm md:text-lg">{orderData.work_package}</h3>
                    </div>
                </div>
                <div className="flex justify-between">
                    <button className="text-sm py-2 md:text-lg text-blue-400 flex" onClick={() => {
                        setCurItem("")
                        setMake("")
                        setQuantity(null)
                        setPage('categorylist')
                    }}><PackagePlus className="w-5 h-5 mt- pr-1" />Change Category</button>
                </div>
                <h3 className="font-bold">{curCategory}</h3>
                <div className="flex space-x-2">
                    <div className="w-1/2 md:w-2/3">
                        <h5 className="text-xs text-gray-400">Items</h5>
                        <ReactSelect value={{ value: curItem, label: `${curItem}${make ? "-" + make : ""}` }} options={item_options} onChange={handleChange} />
                    </div>
                    <div className="flex-1">
                        <h5 className="text-xs text-gray-400">UOM</h5>
                        <input className="h-[37px] w-[60%] border p-2 rounded-lg" disabled={true} type="text" placeholder={unit || "Unit"} value={unit} />
                    </div>
                    <div className="flex-1">
                        <h5 className="text-xs text-gray-400">Qty</h5>
                        <input className="h-[37px] w-full border p-2 rounded-lg outline-none" onChange={(e) => setQuantity(e.target.value === "" ? null : parseInt(e.target.value))} value={quantity} type="number" />
                    </div>
                </div>
                <div className="flex justify-between md:space-x-0 mt-2">
                    <div><button className="text-sm py-2 md:text-lg text-blue-400 flex " onClick={() => handleCreateItem()}><CirclePlus className="w-5 h-5 mt- pr-1" />Create new item</button></div>
                    {(curItem && Number(quantity)) ?
                        <Button variant="outline" className="left-0 border rounded-lg py-1 border-red-500 px-8 text-red-500" onClick={() => handleAdd()}>Add</Button>
                        :
                        <Button disabled={true} variant="secondary" className="left-0 border rounded-lg py-1 border-red-500 px-8 text-red-500" >Add</Button>}
                    {/* <Button variant="outline" className="left-0 border rounded-lg py-1 border-red-500 px-8" onClick={() => handleAdd()}>Add</Button> */}
                </div>
                <div className="max-md:text-xs text-rose-700">Added Items</div>
                {
                    orderData.category_list.list.length ? (
                        orderData.category_list?.list?.map((cat) => {
                            return <div className="container mb-4 mx-0 px-0">
                                <h3 className="text-sm font-semibold py-2">{cat.name}</h3>
                                <table className="table-auto md:w-full">
                                    <thead>
                                        <tr className="bg-gray-200">
                                            <th className="w-[60%] text-left px-4 py-1 text-xs">Item Name</th>
                                            <th className="w-[20%] px-4 py-1 text-xs text-center">Unit</th>
                                            <th className="w-[10%] px-4 py-1 text-xs text-center">Quantity</th>
                                            <th className="w-[10%] px-4 py-1 text-xs text-center">Edit</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {orderData.procurement_list.list?.map((item) => {
                                            if (item.category === cat.name) {
                                                return <tr key={item.item} >
                                                    <td className="w-[60%] text-left border-b-2 px-4 py-1 text-sm">
                                                        {item.item}
                                                            {item.comment && 
                                                            <div className="flex gap-1 items-center">
                                                                <MessageCircleMore className="w-6 h-6" />
                                                                <input disabled type="text" value={item.comment} className="block border rounded-md p-1 md:w-[60%]" />
                                                            </div>
                                                            }
                                                    </td>
                                                    <td className="w-[20%] border-b-2 px-4 py-1 text-sm text-center">{item.unit}</td>
                                                    <td className="w-[10%] border-b-2 px-4 py-1 text-sm text-center">{item.quantity}</td>
                                                    <td className="w-[10%] border-b-2 px-4 py-1 text-sm text-center">
                                                        <AlertDialog>
                                                                <AlertDialogTrigger onClick={() => setQuantity(parseInt(item.quantity))}><Pencil className="w-4 h-4" /></AlertDialogTrigger>
                                                                <AlertDialogContent>
                                                                    <AlertDialogHeader>
                                                                        <AlertDialogTitle className="flex justify-between">Edit Item
                                                                            <AlertDialogCancel onClick={() => setQuantity('')} className="border-none shadow-none p-0">X</AlertDialogCancel>
                                                                        </AlertDialogTitle>
                                                                        <AlertDialogDescription className="flex flex-col gap-2">
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
                                                                                    <input type="number" defaultValue={item.quantity} className=" rounded-lg w-full border p-2" onChange={(e) => setQuantity(e.target.value !== "" ? parseInt(e.target.value) : null)} />
                                                                                </div>
                                                                            </div>
                                                                            <div className="flex gap-1 items-center pt-1">
                                                                                <MessageCircleMore className="h-8 w-8"  />
                                                                                <textarea
                                                                                    className="block p-2 border-gray-300 border rounded-md w-full"
                                                                                    placeholder="Add comment..."
                                                                                    onChange={(e) => handleItemCommentChange(item, e)}
                                                                                    defaultValue={item.comment || ""}
                                                                                />
                                                                            </div>
                                                                        </AlertDialogDescription>
                                                                        <AlertDialogDescription className="flex justify-end">
                                                                            <div className="flex gap-2">
                                                                                <AlertDialogAction className="bg-gray-100 text-black" onClick={() => handleDelete(item.item)}>Delete</AlertDialogAction>
                                                                                <AlertDialogAction disabled={!quantity} onClick={() => handleSave(item.item, quantity)}>Save</AlertDialogAction>
                                                                            </div>
                                                                        </AlertDialogDescription>
                                                                    </AlertDialogHeader>
                                                                </AlertDialogContent>
                                                            </AlertDialog>
                                                    </td>
                                                </tr>
                                            }
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        })
                    ) : <div className="text-center bg-gray-100 p-2 text-gray-600">
                        No Items Added!
                    </div>
                }

                <Card className="flex flex-col items-start shadow-none border border-grey-500 p-3">
                    <h3 className="font-bold py-1 flex"><MessageCircleMore className="w-5 h-5 mt-0.5" />Comments</h3>
                    {rejected_pr_data && (
                        <div className="relative py-4">
                            <h4 className="text-sm font-semibold">Comments by {universalComments?.filter((comment) => ["Nirmaan Project Lead Profile", "Nirmaan Admin Profile"].includes(comment.comment_by))[0]?.comment_by}</h4>
                            <span className="relative left-[15%] text-sm">-{universalComments?.filter((comment) => ["Nirmaan Project Lead Profile", "Nirmaan Admin Profile"].includes(comment.comment_by))[0]?.content}</span>
                        </div>
                    )}
                    <textarea className="w-full border rounded-lg p-2 min-h-12" placeholder="Write comments here..." defaultValue={orderData.comment || ""} onChange={(e) => handleCommentChange(e)} />
                </Card>
                <Dialog>
                    <DialogTrigger asChild>
                            <Button disabled={!orderData.procurement_list.list.length ? true : false} variant={`${!orderData.procurement_list.list.length ? "secondary" : "destructive"}`} className="h-8 w-full mt-4 w-full rounded-md text-sm">{!rejected_pr_data ? "Confirm and Submit" : "Resolve PR"}</Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                            <DialogTitle>Are you Sure</DialogTitle>
                            <DialogDescription>
                                {!rejected_pr_data ? "Click on Confirm to create new PR." : "Click on Confirm to resolve and send the PR for Approval"}
                            </DialogDescription>
                        </DialogHeader>
                        <DialogClose>
                            {!rejected_pr_data ? (
                                <Button onClick={() => handleSubmit()}>Confirm</Button>
                            ) : (
                                <Button onClick={handleResolvePR}>Confirm</Button>
                            )}
                        </DialogClose>
                    </DialogContent>
                </Dialog>
            </div>}
            {page == 'additem' && <div className="flex-1 md:space-y-4 p-4">
                <div className="flex items-center pt-1 pb-4">
                    <ArrowLeft className="cursor-pointer" onClick={() => {
                        setCurItem("")
                        setMake("")
                        setQuantity(null)
                        setPage('itemlist')
                    }} />
                    <h2 className="text-base pl-2 font-bold tracking-tight">Create new Item</h2>
                </div>
                <div className="mb-4">
                    <div className="flex">
                        <div className="text-lg font-bold py-2">Category: </div>
                        <button onClick={() => setPage("categorylist2")} className="text-blue-400 underline ml-1">
                            <div className="flex">
                                <div className="text-lg font-bold mt-0.5">{curCategory}</div>
                                <Pencil className="w-4 h-4 md:w-6 md:h-6 ml-1 mt-1.5" />
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
                    <label htmlFor="makeName" className="block text-sm font-medium text-gray-700">Make Name(N/A)</label>
                    <Input
                        type="text"
                        id="makeName"
                        disabled={true}
                        value={make}
                        placeholder="disabled"
                        onChange={(e) => setMake(e.target.value)}
                        className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                </div>
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
                            <SelectItem value="SQMTR">SQMTR</SelectItem>
                            <SelectItem value="LTR">LTR</SelectItem>
                            <SelectItem value="BUNDLE">BUNDLE</SelectItem>
                            <SelectItem value="FEET">FEET</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="py-8">
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
            </div>}
            {page == 'categorylist2' && <div className="flex-1 md:space-y-4 p-4">
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
    )
}

export const Component = NewPR;