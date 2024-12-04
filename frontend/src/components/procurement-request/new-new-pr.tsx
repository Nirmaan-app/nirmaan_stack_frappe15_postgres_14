import ReactSelect, {components} from 'react-select';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { useEffect, useState } from 'react';
import { useFrappeCreateDoc, useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc, useSWRConfig } from 'frappe-react-sdk';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCheck, CircleX, ListChecks, MessageCircleMore, MessageCircleWarning, Pencil, Trash2, Undo } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from '../ui/use-toast';
import { useUserData } from '@/hooks/useUserData';
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../ui/hover-card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogClose, DialogFooter } from "../ui/dialog"
import { TailSpin } from 'react-loader-spinner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Card } from '../ui/card';
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { formatDate } from '@/utils/FormatDate';
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";

export const NewProcurementRequest = ({resolve = false, edit = false}) => {
    const { workPackage, projectId, id } = useParams();
    const userData = useUserData();
    const {mutate} = useSWRConfig()
    const navigate = useNavigate()

    const [selectedWP, setSelectedWP] = useState('');
    const [curItem, setCurItem] = useState('');
    const [curCategory, setCurCategory] = useState('');
    const [itemOptions, setItemOptions] = useState([]);
    const [catOptions, setCatOptions] = useState([]);
    const [procList, setProcList] = useState([])
    const [stack, setStack] = useState([]);
    const [selectedCategories, setSelectedCategories] = useState([])
    const [editItem, setEditItem] = useState({})
    const [newPRComment, setNewPRComment] = useState("")
    const [newItem, setNewItem] = useState({})
    const [open, setOpen] = useState(false)

    const toggleSidebar = () => {
        setOpen(prevState => !prevState)
        setNewItem({})
    }

    const {data : dynamic_pr, mutate : dynamic_pr_mutate} = useFrappeGetDoc("Procurement Requests", id, id ? undefined : null)

    const { data: universalComments } = useFrappeGetDocList("Nirmaan Comments", {
        fields: ["*"],
        filters: [["reference_name", "=", id]],
        orderBy: { field: "creation", order: "desc" }
    },
        id ? undefined : null
    )

    const { data: usersList } = useFrappeGetDocList("Nirmaan Users", {
        fields: ["*"],
        limit: 1000,
        // filters: [["role_profile", "=", "Nirmaan Project Lead Profile"]]
    })

    // console.log("universalCommnets", universalComments)

    // console.log("dynamic_Pr", dynamic_pr)

    const { data: category_list } = useFrappeGetDocList('Category', {
        fields: ['category_name', 'work_package', 'image_url', 'tax'],
        orderBy: { field: 'category_name', order: 'asc' },
        limit: 1000,
    });

    const { data: item_list, mutate: item_list_mutate } = useFrappeGetDocList('Items', {
        fields: ['name', 'item_name', 'make_name', 'unit_name', 'category', 'creation'],
        orderBy: { field: 'creation', order: 'desc' },
        limit: 10000,
    });

    const { createDoc, loading: createLoading } = useFrappeCreateDoc();
    const { updateDoc, loading: updateLoading, error: update_error } = useFrappeUpdateDoc()

    useEffect(() => {
        if((resolve || edit) && dynamic_pr) {
            setSelectedWP(dynamic_pr?.work_package)
            setProcList(JSON.parse(dynamic_pr?.procurement_list)?.list)
            setSelectedCategories(JSON.parse(dynamic_pr?.category_list)?.list)
        } else if (!resolve && !edit && workPackage) {
            setSelectedWP(workPackage);
        }
    }, [workPackage,dynamic_pr, id, resolve, edit]);

    useEffect(() => {
        if (curCategory && item_list) {
            const options = [];
            item_list?.map((item) => {
                if (item.category === curCategory?.value) {
                    options.push({
                        value: item.name,
                        label: `${item.item_name}${item.make_name ? '-' + item.make_name : ''}`,
                        unit: item?.unit_name,
                    });
                }
            });
            setItemOptions(options);
        }
    }, [curCategory, item_list]);

    useEffect(() => {
        if (selectedWP && category_list) {
            const options = [];
            category_list?.map((item) => {
                if (item?.work_package === selectedWP) {
                    options.push({
                        value: item.category_name,
                        label: item.category_name,
                        tax: parseFloat(item?.tax),
                    });
                }
            });
            setCatOptions(options);
        }
    }, [category_list, selectedWP]);

    const handleCommentChange = (e) => {
        const value = e.target.value;
        setCurItem((prev) => ({
            ...prev,
            comment: value,
        }));
    };

    const handleQuantityChange = (e) => {
        const value = e.target.value;
        setCurItem((prev) => ({
            ...prev,
            quantity: value === "" ? 0 : parseFloat(value),
        }));
    };


    useEffect(() => {
        const categoriesInProcList = procList.map((item) => item.category);

        setSelectedCategories((prevCategories) =>
            prevCategories.filter((category) => categoriesInProcList.includes(category.name))
        );
    }, [procList]);

    const getFullName = (id) => {
        return usersList?.find((user) => user.name == id)?.full_name
    }

    const handleUpdateItem = (item) => {
        const updateItem = procList?.find((i) => i?.name === item);
    
        if (updateItem) {
            if (updateItem?.comment !== editItem?.comment || updateItem?.quantity !== editItem?.quantity) {
                setProcList((prevList) =>
                    prevList.map((i) =>
                        i?.name === item
                            ? {
                                  ...i,
                                  comment: editItem?.comment,
                                  quantity: editItem?.quantity,
                              }
                            : i
                    )
                );
            }
        }
    };

    const handleAddNewItem = () => {
                const curProcList = [...procList];
                const itemToAdd = {
                    item: curItem?.label,
                    name: curItem?.value,
                    unit: curItem?.unit,
                    quantity: curItem?.quantity,
                    category: curCategory?.value,
                    tax: curCategory?.tax,
                    comment: curItem?.comment,
                    status: "Pending"
                }
                // Check if item exists in the current list
                const isDuplicate = curProcList.some((item) => item?.name === itemToAdd.name);

                if (!isDuplicate) {
                    // Check if the stack has this item and remove it
                    const itemInStackIndex = stack.findIndex((stackItem) => stackItem?.name === itemToAdd.name);

                    if (itemInStackIndex > -1) {
                        stack.splice(itemInStackIndex, 1);
                        setStack([...stack]);  // Update stack state after removal
                    }

                    if(selectedCategories?.every((i) => i?.name !== curCategory?.value)) {
                        setSelectedCategories([...selectedCategories, {"name" : curCategory?.value}])
                    }

                    // Add item to the current request list
                    curProcList.push(itemToAdd);
                    setProcList(curProcList)
                } else {
                    toast({
                        title: "Invalid Request!",
                        description: (<span>You are trying to add the <b>item: {curItem?.label}</b> multiple times which is not allowed, instead edit the quantity directly!</span>),
                    })
                }
                setCurItem('');
    }

    const handleDeleteItem = (item: string) => {
        let curRequest = procList;
        let itemToPush = curRequest.find(curValue => curValue.name === item);

        setStack(prevStack => [...prevStack, itemToPush]);
        curRequest = curRequest.filter(curValue => curValue.name !== item);
        setProcList(curRequest);
    }

    const UndoDeleteOperation = () => {
        let curRequest = procList;
        let itemToRestore = stack.pop();

        curRequest.push(itemToRestore);

        setProcList(curRequest);
        if (selectedCategories?.every((i) => i?.name !== itemToRestore?.category)) {
            setSelectedCategories([...selectedCategories, { name: itemToRestore?.category }]);
        }

        setStack([...stack]);
    };

    const handleSubmit = async () => {
        if (
            userData?.role === "Nirmaan Project Manager Profile" ||
            userData?.role === "Nirmaan Admin Profile" ||
            userData?.role === "Nirmaan Procurement Executive Profile" ||
            userData?.role === "Nirmaan Project Lead Profile"
        ) {
            try {
                const res = await createDoc('Procurement Requests', {
                    project : projectId,
                    work_package : workPackage,
                    category_list: {list : selectedCategories},
                    procurement_list : {list : procList}
                });

                if (newPRComment) {
                    await createDoc("Nirmaan Comments", {
                        comment_type: "Comment",
                        reference_doctype: "Procurement Requests",
                        reference_name: res.name,
                        comment_by: userData?.user_id,
                        content: newPRComment,
                        subject: "creating pr"
                    })
                }
                // console.log("newPR", res);
                await mutate(`Procurement Requests ${projectId}`);
                await mutate(`Procurement Orders ${projectId}`);

                toast({
                    title: "Success!",
                    description: `New PR: ${res?.name} created successfully!`,
                    variant: "success",
                });

                navigate("/prs&milestones/procurement-requests");
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

    const handleResolve = async () => {
        try {
            const res = await updateDoc("Procurement Requests", id, {
                category_list: {list : selectedCategories},
                procurement_list: {list : procList},
                workflow_state: "Pending"
            })

            if (newPRComment) {
                await createDoc("Nirmaan Comments", {
                    comment_type: "Comment",
                    reference_doctype: "Procurement Requests",
                    reference_name: id,
                    comment_by: userData?.user_id,
                    content: newPRComment,
                    subject: edit ? "editing pr" : "resolving pr"
                })
            }
            // console.log("newPR", res)
            await mutate(`Procurement Requests ${res?.project}`)
            await mutate(`Procurement Orders ${res?.project}`)
            await mutate(`Procurement Requests ${id}`)
            await mutate(`Nirmaan Comments ${id}`)

            navigate(`/prs&milestones/procurement-requests/${id}`)

            toast({
                title: "Success!",
                description: `PR: ${id} Resolved successfully and Sent for Approval!`,
                variant: "success"
            })
        } catch (error) {
            console.log(`Error while resolving Rejected PR`, error, update_error)
            toast({
                title: "Failed!",
                description: `Resolving PR: ${id} Failed!`,
                variant: "destructive"
            })
        }
    }


    const handleAddItem = async () => {
        try {
            const itemData = {...newItem, category: curCategory.value}

            const res = await createDoc('Items', itemData)

            await item_list_mutate()

            toggleSidebar()

            setNewItem({})

            toast({
                title: "Success!",
                description: `New Item: ${res?.item_name} created successfully!`,
                variant: "success",
            });
        } catch (error) {
            console.log("error", error)
            toast({
                title: "Failed!",
                description: `Item Creation failed!`,
                variant: "destructive",
            });
        }
    }

    const handleCancelDraft = async () => {
        try {
            await updateDoc("Procurement Requests", id, {
                workflow_state: "Pending"
            })

            await mutate(`Procurement Requests ${id}`)

            navigate(-1)

            toast({
                title: "Success!",
                description: `PR: ${id} Draft Cancelled!`,
                variant: "success"
            })

        } catch (error) {
            console.log("error while cancelling pr draft", error)
            toast({
                title: "Failed!",
                description: `PR: ${id} Draft Cancellation failed!`,
                variant: "destructive"
            })
        }
    }
    // console.log("selectedCategories", selectedCategories)

    // console.log("curItem", curItem)

    // console.log("curCategory", curCategory)

    // console.log("procList", procList)

    // console.log("editItem", editItem)

    return (
        <div className="flex-1 space-y-4 px-4">
            {edit && (
                    <div>
                        <Alert variant="warning" className="">
                            <AlertTitle className="text-sm flex items-center gap-2"><MessageCircleWarning className="h-4 w-4" />Heads Up</AlertTitle>
                            <AlertDescription className="py-2 px-4 flex justify-between items-center">
                                This PR is now marked as "Draft", please either cancel or update!
                                <Button disabled={updateLoading} onClick={handleCancelDraft} className="flex items-center gap-2">{updateLoading ? <TailSpin width={20} height={16} color="white" /> : <><CircleX className="w-4 h-4" /><span>Cancel Draft</span></>}</Button>
                            </AlertDescription>
                        </Alert>
                    </div>
            )}
            <div className="flex items-center justify-between">
                <div className="space-y-1">
                    <h3 className="text-sm">Package</h3>
                    <p className="font-semibold">{selectedWP}</p>
                </div>
                <div className="w-1/2">
                    <ReactSelect
                        isDisabled={!selectedWP}
                        value={curCategory}
                        options={catOptions}
                        onChange={(e) => {
                            setCurItem('');
                            setCurCategory(e);
                        }}
                    />
                </div>
            </div>
            <ReactSelect
                value={curItem}
                isDisabled={!curCategory}
                options={itemOptions}
                onChange={(e) => setCurItem(e)}
                components={{ MenuList: CustomMenuList }}
                onAddItemClick={toggleSidebar} // Pass handler as a prop
            />
            <div className="flex items-center gap-4">
                <div className="w-1/2">
                    <h3>Comment</h3>
                    <Input
                        type="text"
                        value={curItem?.comment || ''}
                        onChange={handleCommentChange}
                        disabled={!curItem}
                    />
                </div>
                <div className="flex-1">
                    <h3>Unit</h3>
                    <Input type="text" disabled value={curItem?.unit || ''} />
                </div>
                <div className="flex-1">
                    <h3>
                        Qty<sup className="text-sm text-red-600">*</sup>
                    </h3>
                    <Input
                        type="number"
                        value={curItem?.quantity || ""}
                        onChange={handleQuantityChange}
                        disabled={!curItem}
                    />
                </div>
            </div>
            <Button onClick={handleAddNewItem} disabled={!curItem?.quantity} variant={'outline'} className="w-full border border-primary text-primary">
                Add Item
            </Button>
            <div className='flex flex-col justify-between h-[65vh]'>
            <div>
                <div className="flex justify-between items-center max-md:py-2 py-4">
                    <h2 className='font-semibold'>Order List</h2>
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
                <div className='max-h-[40vh] overflow-y-auto'>
                {procList.length !== 0 ? (
                    selectedCategories?.map((cat, index) => {
                        return <div className="mb-4">
                            <div className='flex items-center gap-4 ml-4'>
                                <div className='flex items-center gap-2'>
                                    <div className='w-1 h-1 rounded-full bg-black' />
                                    <p className='text-sm font-semibold'>{index > 9 ? '' : 0}{index + 1}</p>
                                </div>
                                <h3 className="text-sm font-semibold py-2">{cat.name}</h3>
                            </div>
                            <table className="table-auto w-full">
                                <thead>
                                    <tr className="bg-gray-200">
                                        <th className="w-[60%] text-left px-4 py-1 text-xs">Item Name</th>
                                        <th className="w-[20%] px-4 py-1 text-xs text-center">Unit</th>
                                        <th className="w-[10%] px-4 py-1 text-xs text-center">Qty</th>
                                        <th className="w-[10%] px-4 py-1 text-xs text-center">Edit</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {procList?.map((item) => {
                                        if (item.category === cat?.name) {
                                            return <tr key={item.name} >
                                                <td className="w-[60%] text-left border-b-2 px-4 py-1 text-sm">
                                                    {item.item}
                                                    {item?.comment &&
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
                                                        <AlertDialogTrigger onClick={() => setEditItem({"item" : item.name, "quantity" : item?.quantity, "comment" : item?.comment || ""})}><Pencil className="w-4 h-4 text-black" /></AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle className="flex justify-between">Edit Item
                                                                    <AlertDialogCancel className="border-none shadow-none p-0">X</AlertDialogCancel>
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
                                                                            <Input type="number" value={editItem?.quantity || ""} onChange={(e) => setEditItem({...editItem, "quantity" : e.target.value === "" ? 0 : parseFloat(e.target.value)})} />
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex gap-1 items-center pt-1">
                                                                        <MessageCircleMore className="h-8 w-8" />
                                                                        <textarea
                                                                            // disabled={userData?.role === "Nirmaan Project Manager Profile"}
                                                                            className="block p-2 border-gray-300 border rounded-md w-full"
                                                                            placeholder="Add comment..."
                                                                            value={editItem?.comment || ""}
                                                                            onChange={(e) => setEditItem({...editItem, "comment" : e.target.value})}
                                                                        />
                                                                    </div>
                                                                </AlertDialogDescription>
                                                                <AlertDialogDescription className="flex justify-end">
                                                                    <div className="flex gap-2">
                                                                        <AlertDialogAction onClick={() => handleDeleteItem(item.name)} className="bg-gray-100 text-black hover:text-white flex items-center gap-1">
                                                                            <Trash2 className="h-4 w-4" /> 
                                                                            Delete
                                                                        </AlertDialogAction>
                                                                        <AlertDialogAction
                                                                            className="flex items-center gap-1"
                                                                            disabled={!editItem?.quantity}
                                                                            onClick={() => handleUpdateItem(item.name)}
                                                                        >
                                                                            <ListChecks className="h-4 w-4" />
                                                                            Update
                                                                        </AlertDialogAction>
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
                ) : (
                    <div className="text-center bg-gray-100 p-2 text-gray-600">
                        Empty!
                    </div>
                )}
                </div>
            </div>
            <div>
                {(resolve || edit) && (
                <Card className="flex flex-col items-start shadow-none border border-grey-500 p-3">
                    <h3 className="font-bold flex items-center gap-1"><MessageCircleMore className="w-5 h-5" />Previous Comments</h3>
                    {universalComments?.filter((comment) => comment?.subject === (resolve ? "rejecting pr" : "creating pr"))?.map((cmt) => (
                    <div key={cmt.name} className="flex items-start space-x-4 bg-gray-50 p-4 rounded-lg w-full">
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
                    ))}
                </Card>
                )}
                <Dialog>
                    <DialogTrigger asChild>
                        <Button disabled={!procList.length} variant={`${!procList.length ? "secondary" : "destructive"}`} className="h-8 mt-4 w-full">
                            <div className="flex items-center gap-1"><ListChecks className="h-4 w-4" />
                            {resolve ? "Resolve" : edit ? "Update" : "Submit"}</div>
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                            <DialogTitle>Are you Sure?</DialogTitle>
                            <DialogDescription>
                            {resolve ? "Click on Confirm to resolve and send the PR for Approval" 
                            : edit ? "Click on Confirm to update and send the PR for Approval" :  "If there is any pending PR created by you with the same Project & Package, then the older PRs will be merged with this PR. Are you sure you want to continue?"}
                            </DialogDescription>
                        </DialogHeader>
                        <textarea className="w-full border rounded-lg p-2 min-h-12" placeholder={`${resolve ? "Write Resolving Comments here..." : edit ? "Write Editing Comments here..." : "Write Comments here..."}`} value={newPRComment} onChange={(e) => setNewPRComment(e.target.value)} />
                        <DialogDescription className="flex justify-center">
                            {(resolve || edit) ? (
                                (updateLoading || createLoading) ? <TailSpin width={60} color={"red"} /> : (
                                    <Button onClick={handleResolve} className="flex items-center gap-1">
                                        <CheckCheck className="h-4 w-4" />
                                        Confirm
                                    </Button>
                                )
                            ) : ( 
                                createLoading ? <TailSpin width={60} color={"red"} /> :
                                    <Button onClick={handleSubmit} className="flex items-center gap-1">
                                        <CheckCheck className="h-4 w-4" />
                                        Confirm
                                    </Button>
                            )}
                        </DialogDescription>

                        {/* <DialogClose className="hidden" id="dialogCloseforNewPR">Close</DialogClose> */}
                    </DialogContent>
                </Dialog>
            </div>

                <AlertDialog open={open} onOpenChange={toggleSidebar}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Create New <span className='text-primary'>{curCategory.value}</span> Item</AlertDialogTitle>
                            <AlertDialogDescription>
                <div className='flex flex-col gap-2'>
                    <div className='flex flex-col gap-1'>
                        <label htmlFor="itemName" className="block text-sm font-medium text-gray-700">Item Name<sup className="text-sm text-red-600">*</sup></label>
                        <Input
                            type="text"
                            id="itemName"
                            value={newItem?.item_name || ""}
                            onChange={(e) => setNewItem(prevState => ({...prevState, "item_name" : e.target.value}))}
                        />
                    </div>
                   <div className='flex flex-col gap-1'> 
                        <label htmlFor="makeName" className="block text-sm font-medium text-gray-700">Make Name(N/A)</label>
                        <Input
                            type="text"
                            id="makeName"
                            disabled={true}
                            value={newItem?.make_name || ""}
                            placeholder="disabled"
                            onChange={(e) => setNewItem(prevState => ({...prevState, "make_name" : e.target.value}))}
                        />
                    </div>
                
                <div className="flex flex-col gap-1">
                    <label htmlFor="itemUnit" className="block text-sm font-medium text-gray-700">Item Unit<sup className="text-sm text-red-600">*</sup></label>
                    <Select onValueChange={(value) => setNewItem(prevState => ({...prevState, "unit_name" : value}))}>
                        <SelectTrigger>
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
                </div>
                         </AlertDialogDescription>
                        </AlertDialogHeader>
                        <div className='flex gap-2 justify-end items-center'>
                            {createLoading ? <TailSpin width={30} height={30} color={"red"} /> :
                            (
                            <>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            {(newItem?.item_name && newItem?.unit_name) ?
                                <Button variant={"default"} onClick={handleAddItem} className=" flex items-center gap-1"><ListChecks className="h-4 w-4" /> Submit</Button>
                                :
                                <Button disabled={true} variant="secondary" className="flex items-center gap-1"> <ListChecks className="h-4 w-4" /> Submit</Button>
                            }
                            </>
                            )}
                        </div>
                    </AlertDialogContent>
            </AlertDialog>
            </div>
        </div>
    );
};


const CustomMenuList = (props) => {
    const {
        children, // options rendered as children
        selectProps: { onAddItemClick }, // custom handler for "Add Item"
    } = props;

    return (
        <div>
            <div className='sticky top-0 z-10 bg-white'>
                <Button
                    variant={"outline"}
                    className='w-full border-primary rounded-none'
                    onClick={onAddItemClick}
                >
                    Create New Item
                </Button>
            </div>
            {/* Scrollable options */}
            <components.MenuList {...props}>
                <div>{children}</div>
            </components.MenuList>
        </div>
    );
};