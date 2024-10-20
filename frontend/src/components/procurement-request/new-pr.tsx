import { Card, CardHeader, CardTitle } from "../ui/card";
import { useFrappeGetDocList, useFrappeGetDoc, useFrappeCreateDoc, useFrappeUpdateDoc, useSWRConfig } from "frappe-react-sdk";
import { CheckCheck, ListChecks, MessageCircleMore, PackagePlus, Replace, Settings2, Trash2, Undo } from "lucide-react";
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
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../ui/hover-card";
import { formatDate } from "@/utils/FormatDate";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";

const NewPR = () => {

    const { id } = useParams<{ id: string }>();


    const { data: project, isLoading: project_loading, error: project_error } = useFrappeGetDoc<ProjectsType>("Projects", id);

    return (
        <>  {project_loading ? <NewPRSkeleton /> : <NewPRPage project={project} />}
            {project_error && <h1>{project_error.message}</h1>}
        </>
    )
};

export const NewPRPage = ({ project = undefined, rejected_pr_data = undefined, setSection }) => {

    const navigate = useNavigate();
    const userData = useUserData()
    const { toast } = useToast()

    const { data: usersList } = useFrappeGetDocList("Nirmaan Users", {
        fields: ["*"],
        limit: 1000,
        filters: [["role_profile", "=", "Nirmaan Project Lead Profile"]]
    })

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
    const [managersIdList, setManagersIdList] = useState(null)
    const [stack, setStack] = useState([]);

    useEffect(() => {
        if (usersList) {
            let ids = usersList.map((user) => user.name)
            setManagersIdList(ids)
        }
    }, [usersList])

    const getFullName = (id) => {
        return usersList?.find((user) => user.name == id)?.full_name
    }

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
        project: project?.name,
        work_package: '',
        procurement_list: {
            list: []
        },
        category_list: {
            list: []
        }
    })

    useEffect(() => {
        if (rejected_pr_data) {
            setOrderData(rejected_pr_data)
            setPage("itemlist")
        }
    }, [])

    const { data: universalComments } = useFrappeGetDocList("Nirmaan Comments", {
        fields: ["*"],
        filters: [["reference_name", "=", rejected_pr_data?.name]],
        orderBy: { field: "creation", order: "desc" }
    },
        rejected_pr_data ? ("Comment,filters(reference_name=" + rejected_pr_data.name + ")") : null
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
    const { updateDoc, error: update_error } = useFrappeUpdateDoc()

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

            // Find item ID and make
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

                // Check if item exists in the current list
                const isDuplicate = curRequest.some((item) => item.name === curValue.name);

                if (!isDuplicate) {
                    // Check if the stack has this item and remove it
                    const itemInStackIndex = stack.findIndex((stackItem) => stackItem?.name === curValue.name);

                    if (itemInStackIndex > -1) {
                        stack.splice(itemInStackIndex, 1);
                        setStack([...stack]);  // Update stack state after removal
                    }

                    // Add item to the current request list
                    curRequest.push(curValue);
                    setOrderData((prevState) => ({
                        ...prevState,
                        procurement_list: {
                            list: curRequest,
                        },
                    }));
                } else {
                    toast({
                        title: "Invalid Request!",
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


    const { mutate } = useSWRConfig()

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

                if (universalComment) {
                    await createDoc("Nirmaan Comments", {
                        comment_type: "Comment",
                        reference_doctype: "Procurement Requests",
                        reference_name: res.name,
                        comment_by: userData?.user_id,
                        content: universalComment,
                        subject: "creating pr"
                    })
                }
                console.log("newPR", res);
                await mutate("Procurement Requests,orderBy(creation-desc)");
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
            const res = await updateDoc("Procurement Requests", orderData.name, {
                category_list: orderData.category_list,
                procurement_list: orderData.procurement_list,
                workflow_state: "Pending"
            })

            if (universalComment) {
                await createDoc("Nirmaan Comments", {
                    comment_type: "Comment",
                    reference_doctype: "Procurement Requests",
                    reference_name: orderData.name,
                    comment_by: userData?.user_id,
                    content: universalComment,
                    subject: "resolving pr"
                })
            }
            console.log("newPR", res)
            await mutate("Procurement Requests,orderBy(creation-desc)")
            await mutate("Procurement Orders")
            await mutate(`Procurement Requests ${orderData.name}`)
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
        // console.log("comments of item name", comments[itemName])
        curRequest = curRequest.map((curValue) => {
            if (curValue.item === itemName) {
                return { ...curValue, quantity: parseInt(newQuantity), comment: comments[itemName] === undefined ? curValue.comment || "" : comments[itemName] || "" };
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

    const handleDelete = (item: string) => {
        let curRequest = orderData.procurement_list.list;
        let itemToPush = curRequest.find(curValue => curValue.item === item);

        setStack(prevStack => [...prevStack, itemToPush]);
        curRequest = curRequest.filter(curValue => curValue.item !== item);
        setOrderData(prevState => ({
            ...prevState,
            procurement_list: {
                list: curRequest
            }
        }));
        setComments(prev => {
            delete prev[item]
            return prev
        })
        setQuantity('')
        setCurItem('')
    }

    const UndoDeleteOperation = () => {
        let curRequest = orderData.procurement_list.list;
        let itemToRestore = stack.pop();

        curRequest.push(itemToRestore);

        setOrderData(prevState => ({
            ...prevState,
            procurement_list: {
                list: curRequest
            }
        }));

        setStack([...stack]);
    };

    // console.log("userData", userData)

    return (
        <>
            {(page == 'wplist' && !rejected_pr_data) && <div className="flex-1 md:space-y-4">
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
            {page == 'categorylist' && <div className="flex-1 md:space-y-4">
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
            {page == 'itemlist' && <div className="flex-1 space-y-2 md:space-y-4">
                <div className="flex items-center gap-1 pb-4">
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
                    {
                        rejected_pr_data ? (
                            <h2 className="text-2xl max-md:text-xl font-semibold flex items-center gap-1"> Resolve PR: <span className="text-primary">{rejected_pr_data.name}</span></h2>
                        ) : (
                            <h2 className="text-base pl-2 font-bold tracking-tight">Add Items</h2>
                        )
                    }
                </div>
                <div className="flex justify-between max-md:pr-10 md:justify-normal md:space-x-40">
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
                    <button className="text-sm py-2 md:text-lg text-blue-400 flex items-center gap-1" onClick={() => {
                        setCurItem("")
                        setMake("")
                        setQuantity(null)
                        setPage('categorylist')
                    }}><Replace className="w-5 h-5" />Change Category</button>
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
                    <button className="text-sm py-2 md:text-lg text-blue-400 flex items-center gap-1" onClick={() => handleCreateItem()}><CirclePlus className="w-5 h-5" />Create new item</button>
                    {(curItem && Number(quantity)) ?
                        <Button variant="default" className="flex items-center gap-1" onClick={() => handleAdd()}> <CirclePlus className="w-4 h-4" />Add</Button>
                        :
                        <Button disabled={true} variant="outline" className="border-primary flex items-center gap-1 disabled:opacity-[30%]"><CirclePlus className="w-4 h-4" /> Add</Button>}
                    {/* <Button variant="outline" className="left-0 border rounded-lg py-1 border-red-500 px-8" onClick={() => handleAdd()}>Add</Button> */}
                </div>
                {/* <div className="max-md:text-xs text-rose-700">Added Items</div> */}
                <div className="flex justify-between items-center max-md:py-4">
                    <p className="max-md:text-xs text-rose-700">Added Items</p>
                    {stack.length !== 0 && (
                        <div className="flex items-center space-x-2">
                            <HoverCard>
                                <HoverCardTrigger>
                                    <button
                                        onClick={() => UndoDeleteOperation()}
                                        className="flex items-center max-md:text-sm max-md:px-2 max-md:py-1  px-4 py-2 bg-blue-500 text-white font-semibold rounded-full shadow-md hover:bg-blue-600 transition duration-200 ease-in-out"
                                    >
                                        <Undo className="mr-2 max-md:w-4 max-md:h-4" /> {/* Undo Icon */}
                                        Undo
                                    </button>
                                </HoverCardTrigger>
                                <HoverCardContent className="bg-gray-800 text-white p-2 rounded-md shadow-lg mr-[100px]">
                                    Click to undo the last deleted operation
                                </HoverCardContent>
                            </HoverCard>
                        </div>
                    )}
                </div>
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
                                                            <div className="flex gap-1 items-start block border rounded-md p-1 md:w-[60%]">
                                                                <MessageCircleMore className="w-4 h-4 flex-shrink-0" />
                                                                <div className="text-xs ">{item.comment}</div>
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
                                                                            <MessageCircleMore className="h-8 w-8" />
                                                                            <textarea
                                                                                // disabled={userData?.role === "Nirmaan Project Manager Profile"}
                                                                                className="block p-2 border-gray-300 border rounded-md w-full"
                                                                                placeholder="Add comment..."
                                                                                onChange={(e) => handleItemCommentChange(item, e)}
                                                                                defaultValue={item.comment || ""}
                                                                            />
                                                                        </div>
                                                                    </AlertDialogDescription>
                                                                    <AlertDialogDescription className="flex justify-end">
                                                                        <div className="flex gap-2">
                                                                            <AlertDialogAction className="bg-gray-100 text-black hover:text-white flex items-center gap-1" onClick={() => handleDelete(item.item)}><Trash2 className="h-4 w-4" /> Delete</AlertDialogAction>
                                                                            <AlertDialogAction disabled={!quantity} onClick={() => handleSave(item.item, quantity)}
                                                                                className="flex items-center gap-1"
                                                                            ><ListChecks className="h-4 w-4" />Update</AlertDialogAction>
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
                        Empty!
                    </div>
                }

                <Card className="flex flex-col items-start shadow-none border border-grey-500 p-3">
                    <h3 className="font-bold flex items-center gap-1"><MessageCircleMore className="w-5 h-5" />Comments</h3>
                    {rejected_pr_data && (
                        <div className="py-4 w-full flex flex-col gap-2">
                            {/* <h4 className="text-sm font-semibold">Comments by {universalComments?.filter((comment) => ["Nirmaan Project Lead Profile", "Nirmaan Admin Profile"].includes(comment.comment_by))[0]?.comment_by}</h4>
                            <span className="relative left-[15%] text-sm">-{universalComments?.filter((comment) => ["Nirmaan Project Lead Profile", "Nirmaan Admin Profile"].includes(comment.comment_by))[0]?.content}</span> */}
                            {
                                universalComments?.filter((comment) => managersIdList?.includes(comment.comment_by) || (comment.comment_by === "Administrator" && comment.subject === "rejecting pr")).map((cmt) => (
                                    <>
                                        <div key={cmt.name} className="flex items-start space-x-4 bg-gray-50 p-4 rounded-lg">
                                            <Avatar>
                                                <AvatarImage src={`https://api.dicebear.com/6.x/initials/svg?seed=${cmt.comment_by}`} />
                                                <AvatarFallback>{cmt.comment_by[0]}</AvatarFallback>
                                            </Avatar>
                                            <div className="flex-1">
                                                <p className="font-medium text-sm text-gray-900">{cmt.content}</p>
                                                <div className="flex justify-between items-center mt-2">
                                                    <p className="text-sm text-gray-500">
                                                        {cmt.comment_by === "Administrator" ? "Administrator" : getFullName(cmt.comment_by)}
                                                    </p>
                                                    <p className="text-xs text-gray-400">
                                                        {formatDate(cmt.creation.split(" ")[0])} {cmt.creation.split(" ")[1].substring(0, 5)}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                        {/* <div className="flex flex-col px-3 py-1 shadow-sm rounded-lg">
                                        <p className="font-semibold text-[15px] mb-1">{cmt.content}</p>
                                        <div className="flex justify-between items-center text-sm text-gray-600 italic">
                                                {cmt.comment_by === "Administrator" ? (
                                                  <span>- Administrator</span>
                                                ) : (
                                                  <span>- {getFullName(cmt.comment_by)}</span>
                                                )}

                                                <span className="text-xs text-gray-500">
                                                  {formatDate(cmt.creation.split(" ")[0])} {cmt.creation.split(" ")[1].substring(0, 5)}
                                                </span>
                                        </div>
                                    </div> */}
                                    </>
                                ))}
                        </div>
                    )}
                    <textarea className="w-full border rounded-lg p-2 min-h-12" placeholder={`${rejected_pr_data ? "Write Resolving Comments here..." : "Write comments here..."}`} value={universalComment || ""} onChange={(e) => handleCommentChange(e)} />
                </Card>
                <Dialog>
                    <DialogTrigger asChild>
                        <Button disabled={!orderData.procurement_list.list.length ? true : false} variant={`${!orderData.procurement_list.list.length ? "secondary" : "destructive"}`} className="h-8 mt-4 w-full">{!rejected_pr_data ? (<div className="flex items-center gap-1"><ListChecks className="h-4 w-4" />Submit</div>) : (<div className="flex items-center gap-1"><Settings2 className="h-4 w-4" />Resolve PR</div>)}</Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                            <DialogTitle>Are you Sure?</DialogTitle>
                            <DialogDescription>
                                {!rejected_pr_data ? "If there is any pending PR created by you with the same Project & Package, then the older PRs will be merged with this PR. Are you sure you want to continue?" : "Click on Confirm to resolve and send the PR for Approval"}
                            </DialogDescription>
                        </DialogHeader>
                        <DialogClose className="flex justify-center">
                            {!rejected_pr_data ? (
                                <Button onClick={handleSubmit} className="flex items-center gap-1">
                                    <CheckCheck className="h-4 w-4" />
                                    Confirm</Button>
                            ) : (
                                <Button onClick={handleResolvePR} className="flex items-center gap-1">
                                    <CheckCheck className="h-4 w-4" />
                                    Confirm</Button>
                            )}
                        </DialogClose>
                    </DialogContent>
                </Dialog>
            </div>}
            {page == 'additem' && <div className="flex-1 md:space-y-4">
                <div className="flex items-center gap-1">
                    <ArrowLeft className="cursor-pointer" onClick={() => {
                        setCurItem("")
                        setMake("")
                        setQuantity(null)
                        setPage('itemlist')
                    }} />
                    <h2 className="text-base font-bold tracking-tight">Create new Item</h2>
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
                                <Button variant={"default"} className="mt-15 w-full flex items-center gap-1"><ListChecks className="h-4 w-4" /> Submit</Button>
                                :
                                <Button disabled={true} variant="secondary" className="h-8 w-full flex items-center gap-1"> <ListChecks className="h-4 w-4" /> Submit</Button>
                            }

                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[425px]">
                            <DialogHeader>
                                <DialogTitle>Are you Sure</DialogTitle>
                                <DialogDescription>
                                    Click on Confirm to create new Item.
                                </DialogDescription>
                            </DialogHeader>
                            <DialogClose className="flex justify-center">
                                <Button variant="default" className="flex items-center gap-1" onClick={() => handleAddItem()}><CheckCheck className="h-4 w-4" /> Confirm</Button>
                            </DialogClose>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>}
            {page == 'categorylist2' && <div className="flex-1 md:space-y-4">
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