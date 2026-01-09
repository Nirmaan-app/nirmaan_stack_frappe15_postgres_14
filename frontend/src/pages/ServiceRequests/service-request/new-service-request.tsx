import imageUrl from "@/assets/user-icon.jpeg";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NewPRSkeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { Category as CategoryType } from "@/types/NirmaanStack/Category";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { useFrappeCreateDoc, useFrappeGetDoc, useFrappeGetDocList, useSWRConfig } from "frappe-react-sdk";
import { ArrowLeft, CheckCheck, CirclePlus, ListChecks, MessageCircleMore, Pencil, Trash2, Undo } from "lucide-react";
import { useEffect, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate, useParams } from "react-router-dom";
import { v4 as uuidv4 } from 'uuid'; // Import uuid for unique IDs

const NewSR = () => {

    const { project } = useParams<{ project: string }>();

    const { data: project_data, isLoading: project_loading, error: project_error } = useFrappeGetDoc<ProjectsType>("Projects", project, project ? undefined : null);

    const { data: category_data, isLoading: category_loading, error: category_error } = useFrappeGetDocList<CategoryType>("Category", {
        fields: ["*"],
        filters: [['work_package', '=', 'Services']],
        orderBy: { field: 'name', order: 'asc' }
    })

    return (
        <>  {(project_loading || category_loading) ? <NewPRSkeleton /> : <NewSRPage project={project_data} category={category_data} />}
            {(project_error || category_error) && <h1>ERROR</h1>}
        </>
    )
};

interface NewSRPageProps {
    project?: ProjectsType | undefined
    category?: any
}

const NewSRPage = ({ project, category }: NewSRPageProps) => {
    const userData = useUserData();
    const { toast } = useToast();
    const navigate = useNavigate();

    const [page, setPage] = useState<string>('categorylist');
    const [categories, setCategories] = useState<{ list: { name: string }[] }>({ list: [] });
    const [curCategory, setCurCategory] = useState<string>("");
    const [curEntry, setCurEntry] = useState({ description: "", uom: "", quantity: 0 });
    const [editEntry, setEditEntry] = useState({ description: "", uom: "", quantity: 0 });
    const [orderList, setOrderList] = useState<{ list: { id: string, category: string, description: string, uom: string, quantity: number }[] }>({ list: [] });
    const [universalComment, setUniversalComment] = useState<string | null>(null);
    const [stack, setStack] = useState<any[]>([]);

    const { createDoc, loading: createLoading } = useFrappeCreateDoc();

    const { mutate } = useSWRConfig();

    useEffect(() => {
        const newCategories: { name: string }[] = [];
        orderList.list.forEach((item) => {
            const isDuplicate = newCategories.some(category => category.name === item.category);
            if (!isDuplicate) {
                newCategories.push({ name: item.category });
            }
        });
        setCategories({ list: newCategories });
    }, [orderList]);

    const addCategory = (categoryName: string) => {
        setCurCategory(categoryName);
        const isDuplicate = categories.list.some(category => category.name === categoryName);
        if (!isDuplicate) {
            setCategories(prevState => ({
                ...prevState,
                list: [...prevState.list, { name: categoryName }]
            }));
        }
    };

    const handleCategoryClick = (category: string, value: string) => {
        addCategory(category);
        setPage(value);
    };

    const handleAdd = () => {
        const serviceObject = {
            id: uuidv4(), // Generate a unique ID
            category: curCategory,
            description: curEntry.description,
            uom: curEntry.uom,
            quantity: curEntry.quantity
        };
        setOrderList(prevState => ({ list: [...prevState.list, serviceObject] }));
        setCurEntry({ description: "", uom: "", quantity: 0 });
    };

    const handleDelete = (id: string) => {
        const itemToPush = orderList.list.find(curValue => curValue.id === id);

        setStack(prevStack => [...prevStack, itemToPush]);
        const updatedList = orderList.list.filter(curValue => curValue.id !== id);
        setOrderList({ list: updatedList });
    };

    const handleCommentChange = (e: any) => {
        setUniversalComment(e.target.value === "" ? null : e.target.value);
    };

    const handleSave = (itemId: string) => {
        setOrderList(prevState => ({
            list: prevState.list.map(item =>
                item.id === itemId
                    ? { ...item, ...editEntry }
                    : item
            )
        }));
        setEditEntry({ description: "", uom: "", quantity: 0 });
        document?.getElementById("editDialogCloseSR")?.click();
    };

    const handleSubmit = async () => {
        if (
            ["Nirmaan Project Manager Profile", "Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Procurement Executive Profile", "Nirmaan Project Lead Profile"]
                .includes(userData?.role)
        ) {
            try {
                let projectGstToSet = null;

                // --- 1. PROJECT GST LOGIC (Frontend Implementation) ---
                if (project?.project_gst_number) {
                    try {
                        let gstData = project.project_gst_number;
                        console.log("gstData", gstData);
                        // Check if it's a string (e.g., if field type is Data/Text and stores JSON string)
                        if (typeof gstData === 'string') {
                            gstData = JSON.parse(gstData);
                        }

                        // Drill down to the actual list under the "list" key
                        const gstList = gstData?.list;
                        console.log("gstList", gstList);

                        // Apply the business logic: update ONLY if the list has exactly one entry
                        if (Array.isArray(gstList) && gstList.length === 1) {
                            // Assuming the item structure is { location: "...", gst: "..." }
                            projectGstToSet = gstList[0]?.gst;
                        }
console.log("projectGstToSet", projectGstToSet);

                    } catch (e) {
                        console.error("Failed to parse project_gst_number:", e);
                        // Log the error but proceed with SR creation
                    }
                }


                // --- END PROJECT GST LOGIC ---
                const res = await createDoc('Service Requests', {
                    project: project?.name,
                    service_order_list: orderList,
                    service_category_list: categories,
                    status: "Created",
                    project_gst:projectGstToSet? projectGstToSet : undefined,
                });

                if (universalComment) {
                    await createDoc("Nirmaan Comments", {
                        comment_type: "Comment",
                        reference_doctype: "Service Requests",
                        reference_name: res.name,
                        comment_by: userData?.user_id,
                        content: universalComment,
                        subject: "creating sr"
                    });
                }

                await mutate("Service Requests,orderBy(creation-desc)");

                document.getElementById("dialogCloseforNewSR")?.click();
                toast({
                    title: "Success!",
                    description: `New SR: ${res?.name} created successfully!`,
                    variant: "success",
                });

                await navigate(`/service-requests/${res.name}`);
            } catch (error) {
                console.log("submit_error", error);
                toast({
                    title: "Failed!",
                    description: `SR Creation failed!`,
                    variant: "destructive",
                });
            }
        }
    };

    const UndoDeleteOperation = () => {
        const itemToRestore = stack.pop();
        if (itemToRestore) {
            setOrderList(prevState => ({ list: [...prevState.list, itemToRestore] }));
            setStack([...stack]);
        }
    };

    return (
        <>
            {(page == 'categorylist') && <div className="flex-1 md:space-y-4 px-4">
                <div className="flex items-center pt-1 pb-4">
                    <Dialog>
                        <DialogTrigger asChild>
                            <ArrowLeft className="cursor-pointer" />
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>Are you sure?</DialogHeader>
                            <DialogDescription>This action will clear out the service order list. Are you sure you want to continue?</DialogDescription>
                            <DialogFooter>
                                <DialogClose asChild><Button>Cancel</Button></DialogClose>
                                <Button onClick={() => navigate(-1)} >Continue</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                    <h3 className="text-base pl-2 font-bold tracking-tight">Select Service Category</h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {category?.map((item: CategoryType) => (
                        <Card className="flex flex-col items-center shadow-none text-center border border-grey-500 hover:animate-shadow-drop-center" onClick={() => handleCategoryClick(item.name, 'orderlist')} key={item.name}>
                            <CardHeader className="flex flex-col items-center justify-center space-y-0 p-2">
                                <CardTitle className="flex flex-col items-center text-sm font-medium text-center">
                                    <img className="h-32 md:h-36 w-32 md:w-36 rounded-lg p-0" src={item.name === null ? imageUrl : item.image_url} alt="Category" />
                                    <span>{item.name}</span>
                                </CardTitle>
                            </CardHeader>
                        </Card>
                    ))}
                </div>
            </div>}
            {/* {page === 'order' && (categories.list.map((item) => { return (<div>Hello <b>{item.name}</b></div>) }))} */}
            {page == 'orderlist' && <div className="flex-1 space-y-2 md:space-y-4 px-4">
                {/* <div className="flex items-center gap-1 pb-4">
                    <ArrowLeft className="cursor-pointer" onClick={() => {
                        setCurEntry({ description: "", uom: "", quantity: "" });
                        setPage('categorylist');
                    }} />

                    <h2 className="text-base pl-2 font-bold tracking-tight">Add Services</h2>

                </div> */}
                {/* <div className="flex justify-between max-md:pr-10 md:justify-normal md:space-x-40">
                    <div className="">
                        <h5 className="text-gray-500 text-xs md:test-base">Project</h5>
                        <h3 className=" font-semibold text-sm md:text-lg">{project && project?.project_name}</h3>
                    </div>
                    <div className="">
                        <h5 className="text-gray-500 text-xs md:test-base">Package</h5>
                        <h3 className=" font-semibold text-sm md:text-lg">Services</h3>
                    </div>
                </div> */}
                {/* <div className="flex justify-between">
                    <button className="text-sm py-2 md:text-lg text-blue-400 flex items-center gap-1" onClick={() => {
                        setCurEntry({ description: "", uom: "", quantity: "" });
                        setPage('categorylist');
                    }}>
                        <Replace className="w-5 h-5" />
                        {curCategory && curCategory !== "" ? "Change Category" : "Choose Category"}
                    </button>
                </div> */}
                {curCategory && curCategory !== "" && (
                    <>
                        <div className="flex items-center gap-1">
                            <h3 className="font-bold">{curCategory}</h3>
                            <Pencil className="w-4 h-4 text-blue-600 cursor-pointer"
                                onClick={() => {
                                    setCurEntry({ description: "", uom: "", quantity: 0 });
                                    setPage('categorylist');
                                }}
                            />
                        </div>
                        <div className="">
                            <Label htmlFor="description">Service Description</Label>
                            <Textarea
                                placeholder={`Add ${curCategory} Description...`}
                                id="description"
                                onChange={(e) => setCurEntry({ ...curEntry, description: e.target.value })}
                                value={curEntry.description}
                            />
                        </div>
                        <div className="flex w-full items-end justify-between">
                            <div className="w-[30%]">
                                <Label htmlFor="uom">Unit</Label>
                                <Input
                                    placeholder="Enter Unit"
                                    id="uom"
                                    type="text"
                                    onChange={(e) => setCurEntry({ ...curEntry, uom: e.target.value })}
                                    value={curEntry.uom}
                                />
                            </div>
                            <div className="w-[30%]">
                                <Label htmlFor="quantity">Quantity</Label>
                                <Input
                                    placeholder="Enter Quantity"
                                    id="quantity"
                                    type="number"
                                    onChange={(e) => setCurEntry({ ...curEntry, quantity: parseFloat(e.target.value) })}
                                    value={curEntry.quantity}
                                />
                            </div>
                            <Button
                                variant="default"
                                className="flex items-center gap-1"
                                onClick={handleAdd}
                                disabled={!curEntry.description || !curEntry.uom || !curEntry.quantity}
                            >
                                <CirclePlus className="w-4 h-4" /> Add
                            </Button>
                        </div>
                    </>
                )}
                <div className="flex justify-between items-center max-md:py-4">
                    <p className="max-md:text-xs text-rose-700">Added Services</p>
                    {stack.length !== 0 && (
                        <div className="flex items-center space-x-2">
                            <HoverCard>
                                <HoverCardTrigger>
                                    <button
                                        onClick={() => UndoDeleteOperation()}
                                        className="flex items-center max-md:text-sm max-md:px-2 max-md:py-1  px-4 py-2 bg-blue-500 text-white font-semibold rounded-full shadow-md hover:bg-blue-600 transition duration-200 ease-in-out"
                                    >
                                        <Undo className="mr-2 max-md:w-4 max-md:h-4" />
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
                    orderList?.list?.length ? (
                        <div className="mb-4 mx-0 px-0">
                            {/* <h3 className="text-sm font-semibold py-2">{item?.category}</h3> */}
                            <table className="table-auto md:w-full">
                                <thead>
                                    <tr className="bg-gray-200">
                                        {/* <th className="w-[15%] text-left px-4 py-1 text-xs">Category</th> */}
                                        <th className="w-[70%] px-4 py-1 text-xs text-left">Service Description</th>
                                        <th className="w-[5%] px-4 py-1 text-xs text-center">Unit</th>
                                        <th className="w-[5%] px-4 py-1 text-xs text-center">Qty</th>
                                        <th className="w-[5%] px-4 py-1 text-xs text-center">Edit</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {orderList?.list?.map((item, index) => (
                                        <tr key={item.id} >
                                            {/* <td className="w-[15%] text-left border-b-2 px-4 py-1 text-sm">
                                                {item.category}
                                            </td>
                                            <td className="w-[70%] border-b-2 px-4 py-1 text-sm text-left">{item.description}</td> */}
                                            <td className="px-4 py-2 border-b-2 text-sm whitespace-nowrap text-wrap w-[80%]">
                                                <div className="flex items-center gap-4 mb-1">
                                                    <div className='flex items-center gap-2'>
                                                        <div className='w-1 h-1 rounded-full bg-black' />
                                                        <p className='text-sm font-semibold'>{index > 9 ? '' : 0}{index + 1}</p>
                                                    </div>
                                                    <p className="font-semibold">{item?.category}</p>
                                                </div>
                                                <span className="whitespace-pre-wrap">{item?.description}</span>
                                            </td>
                                            <td className="w-[5%] border-b-2 px-4 py-1 text-sm text-center">{item.uom}</td>
                                            <td className="w-[5%] border-b-2 px-4 py-1 text-sm text-center">{item.quantity}</td>
                                            <td className="w-[5%] border-b-2 px-4 py-1 text-sm text-center">
                                                <Dialog>
                                                    <DialogTrigger><Pencil className="w-4 h-4" onClick={() => setEditEntry(item)} /></DialogTrigger>
                                                    <DialogContent>
                                                        <DialogHeader>
                                                            <DialogTitle className="">Edit <span className="text-primary font-semibold">{item.category}</span> Line Entry:</DialogTitle>
                                                            <DialogDescription className="flex flex-col gap-2">
                                                                <div className="space-y-2">
                                                                    <Label htmlFor="edit-description">Service Description</Label>
                                                                    <Textarea
                                                                        id="edit-description"
                                                                        onChange={(e) => setEditEntry({ ...editEntry, description: e.target.value })}
                                                                        value={editEntry.description}
                                                                    />
                                                                    <Label htmlFor="edit-uom">UOM</Label>
                                                                    <Input
                                                                        id="edit-uom"
                                                                        onChange={(e) => setEditEntry({ ...editEntry, uom: e.target.value })}
                                                                        value={editEntry.uom}
                                                                    />
                                                                    <Label htmlFor="edit-quantity">Quantity</Label>
                                                                    <Input
                                                                        id="edit-quantity"
                                                                        onChange={(e) => setEditEntry({ ...editEntry, quantity: parseFloat(e.target.value) })}
                                                                        value={editEntry.quantity}
                                                                    />
                                                                </div>
                                                            </DialogDescription>
                                                            <DialogDescription className="flex justify-end">
                                                                <div className="flex gap-2">
                                                                    <Button className="bg-gray-100 text-black hover:text-white flex items-center gap-1" onClick={() => handleDelete(item.id)}>
                                                                        <Trash2 className="h-4 w-4" /> Delete</Button>
                                                                    <Button onClick={() => handleSave(item.id)}
                                                                        className="flex items-center gap-1"
                                                                    ><ListChecks className="h-4 w-4" />Update</Button>
                                                                </div>
                                                            </DialogDescription>
                                                            <DialogClose id="editDialogCloseSR" className="hidden">Close</DialogClose>
                                                        </DialogHeader>
                                                    </DialogContent>
                                                </Dialog>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : <div className="text-center bg-gray-100 p-2 text-gray-600">
                        Empty!
                    </div>
                }

                <Card className="flex flex-col items-start shadow-none border border-grey-500 p-3">
                    <h3 className="font-bold flex items-center gap-1"><MessageCircleMore className="w-5 h-5" />Comments</h3>
                    <textarea className="w-full border rounded-lg p-2 min-h-12" placeholder={"Write comments here..."} value={universalComment || ""} onChange={(e) => handleCommentChange(e)} />
                </Card>
                <Dialog>
                    <DialogTrigger asChild>
                        <Button disabled={!orderList.list.length ? true : false} variant={`${!orderList.list.length ? "secondary" : "destructive"}`} className="h-8 mt-4 w-full"><div className="flex items-center gap-1"><ListChecks className="h-4 w-4" />Submit</div></Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                            <DialogTitle>Are you Sure?</DialogTitle>
                            <DialogDescription>
                                This action will create a new Service Request. Are you sure you want to continue?"
                            </DialogDescription>
                        </DialogHeader>
                        <DialogDescription className="flex justify-center">
                            {
                                createLoading ? <TailSpin width={60} color={"red"} /> :
                                    <Button onClick={handleSubmit} className="flex items-center gap-1">
                                        <CheckCheck className="h-4 w-4" />
                                        Confirm</Button>
                            }
                        </DialogDescription>

                        <DialogClose className="hidden" id="dialogCloseforNewSR">Close</DialogClose>
                    </DialogContent>
                </Dialog>
            </div>}
        </>
    )
}

export const Component = NewSR;