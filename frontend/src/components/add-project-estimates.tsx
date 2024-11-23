import { ProjectEstimates as ProjectEstimatesType } from "@/types/NirmaanStack/ProjectEstimates";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { useFrappeCreateDoc, useFrappeDeleteDoc, useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useNavigate, useParams } from "react-router-dom";
import { Skeleton } from "./ui/skeleton";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Trash } from "lucide-react";
import { Button } from "./ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import ReactSelect from 'react-select';
import { Input } from "./ui/input";
import { toast } from "./ui/use-toast";
import { ConfigProvider, Radio, Table } from "antd";
import formatToIndianRupee from "@/utils/FormatPrice";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./ui/alert-dialog";
import { Separator } from "./ui/separator";
import { Pencil2Icon } from "@radix-ui/react-icons";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { TailSpin } from "react-loader-spinner";
import { Textarea } from "./ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Label, Pie, PieChart } from "recharts";
import {
    ChartConfig,
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from "@/components/ui/chart";

const chartConfig = {
    visitors: {
        label: "Visitors",
    },
    category1: {
        label: "Category 1",
        color: "hsl(var(--chart-1))",
    },
    category2: {
        label: "Category 2",
        color: "hsl(var(--chart-2))",
    },
    category3: {
        label: "Category 3",
        color: "hsl(var(--chart-3))",
    },
} satisfies ChartConfig;


const AddProjectEstimates = () => {
    const { projectId } = useParams()
    const { data: project_data, isLoading: project_loading, error: project_error } = useFrappeGetDoc<ProjectsType>("Projects", projectId)
    const { data: estimates_data, isLoading: estimates_loading, error: estimates_error, mutate: estimates_data_mutate } = useFrappeGetDocList<ProjectEstimatesType>("Project Estimates", {
        fields: ['*'],
        filters: [["project", "=", projectId]],
        limit: 10000
    })
    return (
        <div>
            {(project_loading || estimates_loading) && <Skeleton className="w-[30%] h-10" />}
            {(project_error || estimates_error) && <h1>Error</h1>}
            {(project_data && estimates_data) && <AddProjectEstimatesPage project_data={project_data} estimates_data={estimates_data} estimates_data_mutate={estimates_data_mutate} />}
        </div>
    )
}

interface AddProjectEstimatesPageProps {
    project_data: ProjectsType | undefined
    estimates_data: ProjectEstimatesType[] | undefined
    estimates_data_mutate?: any
}

type Category = {
    category_name: string;
    work_package: string;
    image_url: string;
    tax: number;
};

type WorkPackageCategoryList = {
    [workPackage: string]: Category[];
};

const AddProjectEstimatesPage = ({ project_data, estimates_data, estimates_data_mutate }: AddProjectEstimatesPageProps) => {
    const navigate = useNavigate()
    const [defaultValues, setDefaultValues] = useState<null | string[]>(null)
    const [workPackageCategoryList, setWorkPackageCategoryList] = useState<WorkPackageCategoryList>({});
    const [curCategory, setCurCategory] = useState({})
    const [categoryItemList, setCategoryItemList] = useState({});
    const [selectedItem, setSelectedItem] = useState({})
    const [enteredQuantities, setEnteredQuantities] = useState({})
    // const [enteredRates, setEnteredRates] = useState({})
    const [showRateDialog, setShowRateDialog] = useState(false);
    const [rateInput, setRateInput] = useState("");
    const [errorItem, setErrorItem] = useState(null);
    const [editEstimation, setEditEstimation] = useState({})
    const [allWorkPackages, setAllWorkPackages] = useState(null)

    const { createDoc, loading: create_loading } = useFrappeCreateDoc()
    const { updateDoc, loading: update_loading } = useFrappeUpdateDoc()
    const { deleteDoc, loading: delete_loading } = useFrappeDeleteDoc()
    const [deleteItem, setDeleteItem] = useState(null)
    const [serviceDesc, setServiceDesc] = useState(null)
    const [serviceUnit, setServiceUnit] = useState(null)
    const [loadingState, setLoadingState] = useState(null)
    const [options, setOptions] = useState(null)
    const [selectedPackage, setSelectedPackage] = useState("")
    const [categoryTotals, setCategoryTotals] = useState({})
    const [overAllCategoryTotals, setOverAllCategoryTotals] = useState({})
    const [categoryWisePieChartData, setCategoryWisePieChartData] = useState([])

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

    useEffect(() => {
        if (category_list) {
            const groupedData = category_list.reduce((acc, category) => {
                const { work_package } = category;
                if (!acc[work_package]) {
                    acc[work_package] = [];
                }
                acc[work_package].push({ label: category?.category_name, value: category?.category_name, tax: category?.tax });
                return acc;
            }, {});

            setWorkPackageCategoryList(groupedData);
        }
    }, [category_list]);

    useEffect(() => {
        if (item_list && estimates_data) {
            const groupedItems = item_list.reduce((acc, item) => {
                if (estimates_data.every((i) => i?.item !== item.name)) {
                    const { category } = item;
                    if (!acc[category]) {
                        acc[category] = [];
                    }
                    acc[category].push({
                        label: item.item_name,
                        value: item.name,
                        unit: item?.unit_name
                    });
                }
                return acc;
            }, {});

            setCategoryItemList(groupedItems);
        }
    }, [item_list, estimates_data]);

    const handleCategoryChange = (wp, value) => {
        setCurCategory(prevState => ({
            ...prevState,
            [wp]: value
        }))

        setSelectedItem(prevState => ({
            ...prevState,
            [wp]: null
        }));
    }

    const handleItemChange = (wp, cat, value) => {
        setSelectedItem(prevState => ({
            ...prevState,
            [wp]: value
        }))
    }

    const handleQuantityChange = (wp, cat, value) => {
        setEnteredQuantities(prevState => ({
            ...prevState,
            [wp]: value
        }))
    }

    //   const handleRateChange = (wp, cat, value) => {
    //     setEnteredRates(prevState => ({
    //         ...prevState,
    //         [wp] : value
    //     }))
    //   }

    const handleRateChange = (value) => {
        setRateInput(value);
    };

    const handleUnitChange = (value) => {
        setServiceUnit(value)
    }

    const groupItemsByWorkPackageAndCategory = (items) => {
        return items?.reduce((acc, item) => {

            if (!acc[item.work_package]) {
                acc[item.work_package] = {};
            }

            if (!acc[item.work_package][item.category]) {
                acc[item.work_package][item.category] = [];
            }
            acc[item.work_package][item.category].push({
                ...item
            });
            return acc;
        }, {});
    };

    useEffect(() => {
        if (project_data) {
            const wpList = JSON.parse(project_data.project_work_packages)?.work_packages
            wpList?.push({ work_package_name: "Tool & Equipments" })
            wpList?.push({ work_package_name: "Services" })
            setAllWorkPackages(wpList)
            const list: string[] = wpList?.map((wp) => wp.work_package_name)
            setDefaultValues(list)
            const options = []
            options.push({ label: "All", value: "All" })
            wpList?.forEach((wp) => {
                const option = { label: wp?.work_package_name, value: wp?.work_package_name }
                options?.push(option)
            })

            //   options?.push({ label: "Tool & Equipments", value: "Tool & Equipments" })
            //   options?.push({ label: "Services", value: "Services" })

            setOptions(options)
            setSelectedPackage("All")
        }
    }, [project_data])

    const categorizedData = useMemo(() => groupItemsByWorkPackageAndCategory(estimates_data), [estimates_data]);

    // useEffect(() => {
    //     if (groupedData) {
    //         setExpandedRowKeys(Object.keys(groupedData));
    //     }
    // }, [groupedData]);

    // console.log("groupedData", groupedData)

    const columns = [
        {
            title: "Category",
            dataIndex: "category",
            key: "category",
            render: (text) => <strong className="text-primary">{text}</strong>,
        },
    ];

    const innerColumns = [
        {
            title: "Item",
            dataIndex: "item_name",
            key: "item_name",
            render: (text) => <span className="italic">{text || "--"}</span>
        },
        {
            title: "UOM",
            dataIndex: "uom",
            key: "uom",
            width: "10%",
            render: (text) => <span>{text || "--"}</span>
        },
        {
            title: "Estd Qty",
            dataIndex: "quantity_estimate",
            key: "quantity_estimate",
            width: "10%",
        },
        {
            title: "Estd Rate",
            dataIndex: "rate_estimate",
            key: "rate_estimate",
            width: "15%",
            render: (text, record) => {
                return <span>{formatToIndianRupee(parseFloat(text))}</span>
            },
        },
        {
            title: "Estd Amount",
            key: "amount_estimate",
            width: "20%",
            render: (text, record) => {
                return <span>{formatToIndianRupee(record?.rate_estimate * record?.quantity_estimate)}</span>
            },
        },
        {
            title: "Edit/Delete",
            key: "edit-delete-actions",
            width: "10%",
            render: (text, record) => {
                console.log("recordeditdelete", record)
                return (
                    <div className="flex items-center gap-2">
                        <Dialog>
                            <DialogTrigger>
                                <Pencil2Icon onClick={() => {
                                    const estimation = { rate_estimate: record?.rate_estimate, quantity_estimate: record?.quantity_estimate, uom: record?.uom }
                                    setEditEstimation(estimation)
                                }} className="w-6 h-6" />
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>
                                        Edit <span className="text-primary">{record?.item_name}</span> estimation
                                    </DialogTitle>
                                </DialogHeader>
                                <DialogDescription className="flex gap-4 items-end w-full">
                                    <div className="flex flex-col gap-2">
                                        <h3 className="text-gray-500">Qty</h3>
                                        <Input type="number" placeholder="Enter Estimated Qty"
                                            value={editEstimation?.quantity_estimate}
                                            onChange={(e) => setEditEstimation({ ...editEstimation, quantity_estimate: e.target.value })}
                                        />
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <h3 className="text-gray-500">Unit</h3>
                                        <Input type="text"
                                            value={editEstimation?.uom}
                                            disabled
                                        />
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <h3 className="text-gray-500">Rate</h3>
                                        <Input type="number" placeholder="Enter Estimated Rate"
                                            value={editEstimation?.rate_estimate}
                                            onChange={(e) => setEditEstimation({ ...editEstimation, rate_estimate: e.target.value })}
                                        />
                                    </div>
                                    <div className="flex flex-col gap-4">
                                        <h3 className="text-gray-500">Amount</h3>
                                        <p className="text-primary">{formatToIndianRupee((editEstimation?.quantity_estimate || 0) * (editEstimation?.rate_estimate || 0))}</p>
                                    </div>
                                    <Button onClick={() => handleEditEstimate(record?.name, record?.item_name)}
                                        disabled={(record?.rate_estimate === editEstimation?.rate_estimate && record?.quantity_estimate === editEstimation?.quantity_estimate) || !editEstimation?.quantity_estimate || !editEstimation?.rate_estimate}>
                                        {update_loading ? "Updating..." : "Update"}
                                    </Button>
                                    <DialogClose id="estimateEditClose" className="hidden">Close</DialogClose>
                                </DialogDescription>
                            </DialogContent>
                        </Dialog>
                        <span>|</span>
                        {/* {(deleteItem && deleteItem === record?.name) ? <TailSpin color={"red"} width={20} height={20} /> : 
                            <Trash onClick={() => handleDeleteEstimate(record?.name, record?.item_name)} className="w-6 h-6 text-primary cursor-pointer" />
                        } */}

                        <Dialog>
                            <DialogTrigger>
                                <Trash className="w-6 h-6 text-primary cursor-pointer" />
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>
                                        Are you sure!
                                    </DialogTitle>
                                    <DialogDescription>Click on Confirm to proceed!</DialogDescription>
                                    <DialogDescription className="flex items-center justify-end gap-2">
                                        <DialogClose>
                                            <Button variant={"outline"}>Cancel</Button>
                                        </DialogClose>
                                        {(deleteItem && deleteItem === record?.name) ? <TailSpin color={"red"} width={20} height={20} /> :
                                            <Button onClick={() => handleDeleteEstimate(record?.name, record?.item_name)}>Confirm</Button>
                                        }
                                    </DialogDescription>
                                </DialogHeader>
                            </DialogContent>
                        </Dialog>
                    </div>
                )
            },
        },
    ];

    // console.log("categorizedData", categorizedData)

    const handleEditEstimate = async (id, item) => {
        try {
            await updateDoc("Project Estimates", id, editEstimation)
            await estimates_data_mutate()

            toast({
                title: "Success!",
                description: `${item} Estimation updated successfully!`,
                variant: "success",
            })
            document?.getElementById("estimateEditClose")?.click()
        } catch (error) {
            toast({
                title: "Failed!",
                description: `${item} Estimate updation failed!.`,
                variant: "destructive",
            });
            console.log("error while editing estimation", error)
        }
    }

    const handleDeleteEstimate = async (id, item) => {
        try {
            setDeleteItem(id)
            await deleteDoc("Project Estimates", id)
            await estimates_data_mutate()

            toast({
                title: "Success!",
                description: `${item} Estimation deleted successfully!`,
                variant: "success",
            })
        } catch (error) {
            toast({
                title: "Failed!",
                description: `${item} Estimate deletion failed!.`,
                variant: "destructive",
            });
            console.log("error while deleting estimation", error)
        } finally {
            setDeleteItem(null)
        }
    }


    const handleSubmit = async (wp) => {
        const category = curCategory[wp]?.value
        const tax = curCategory[wp]?.tax
        const item = selectedItem[wp]?.value
        const item_name = wp === "Services" ? serviceDesc : selectedItem[wp]?.label
        const uom = wp === "Services" ? serviceUnit : selectedItem[wp]?.unit
        const quantity = enteredQuantities[wp]
        const rate = wp === "Services" ? rateInput : undefined

        try {
            setLoadingState(wp)
            await createDoc("Project Estimates", {
                project: project_data.name,
                work_package: wp,
                category: category,
                item: item,
                item_name: item_name,
                uom: uom,
                quantity_estimate: quantity,
                item_tax: tax,
                rate_estimate: rate
            })

            await estimates_data_mutate()
            await item_list_mutate()

            setCurCategory({ ...curCategory, [wp]: null });
            setSelectedItem({ ...selectedItem, [wp]: null });
            setEnteredQuantities({ ...enteredQuantities, [wp]: '' });
            setRateInput('')
            setServiceDesc(null)
            // setEnteredRates({ ...enteredRates, [wp]: '' });

            toast({
                title: "Success!",
                description: `New Estimate created successfully!`,
                variant: "success",
            })

        } catch (error) {
            if (error?.exc_type === "QuotationNotExistError") {
                toast({
                    title: "Failed!",
                    description: `No quotes found, please enter manually!.`,
                    variant: "default"
                });
                setErrorItem({
                    work_package: wp,
                    category: category,
                    item: item,
                    item_name: item_name,
                    uom: uom,
                    quantity_estimate: quantity,
                    item_tax: tax
                });
                setShowRateDialog(true);
            } else {
                toast({
                    title: "Failed!",
                    description: `Estimate creation failed!.`,
                    variant: "destructive",
                });
                console.log("error while submitting estimation", error);
            }
        } finally {
            setLoadingState(null)
        }
    }

    const handleAlertSubmit = async () => {
        if (errorItem) {
            try {
                await createDoc("Project Estimates", {
                    ...errorItem,
                    project: project_data.name,
                    rate_estimate: rateInput,
                });

                setCurCategory({ ...curCategory, [errorItem.work_package]: null });
                setSelectedItem({ ...selectedItem, [errorItem.work_package]: null });
                setEnteredQuantities({ ...enteredQuantities, [errorItem.work_package]: '' });
                setRateInput("");
                await estimates_data_mutate();
                await item_list_mutate()

                toast({
                    title: "Success!",
                    description: `Estimate created with manual rate entry.`,
                    variant: "success",
                });

                setShowRateDialog(false);
                setRateInput('')

            } catch (error) {
                toast({
                    title: "Failed!",
                    description: `Estimate creation with manual rate failed!.`,
                    variant: "destructive",
                });
                console.log("error submitting with manual rate", error);
            }
        }
    };

    useEffect(() => {
        if (selectedPackage !== "All" && estimates_data) {
            const filteredEstimates = estimates_data?.filter((i) => i?.work_package === selectedPackage)
            const categoryTotals = filteredEstimates?.reduce((acc, item) => {
                const category = acc[item?.category] || { withoutGst: 0, withGst: 0 };

                const itemTotal = parseFloat(item?.quantity_estimate) * parseFloat(item?.rate_estimate);
                const itemTotalWithGst = itemTotal * (1 + parseFloat(item?.item_tax) / 100);

                category.withoutGst += itemTotal;
                category.withGst += itemTotalWithGst;

                acc[item.category] = category;
                return acc;
            }, {});

            const overallTotal = categoryTotals && Object.values(categoryTotals)?.reduce(
                (acc, totals) => ({
                    withoutGst: acc.withoutGst + totals.withoutGst,
                    withGst: acc.withGst + totals.withGst,
                }),
                { withoutGst: 0, withGst: 0 }
            );

            const pieChartData = categoryTotals && Object.keys(categoryTotals)?.map((category) => ({
                name: category,
                value: categoryTotals[category]?.withoutGst,
                fill: `#${Math.floor(Math.random() * 16777215).toString(16)}`, // Random colors
            }));

            setCategoryTotals(categoryTotals)

            setOverAllCategoryTotals(overallTotal)

            setCategoryWisePieChartData(pieChartData)
        }
    }, [selectedPackage, estimates_data])

    // const categoryTotals = estimates_data?.reduce((acc, item) => {
    //     const category = acc[item?.category] || { withoutGst: 0, withGst: 0 };

    //     const itemTotal = parseFloat(item?.quantity_estimate) * parseFloat(item?.rate_estimate);
    //     const itemTotalWithGst = itemTotal * (1 + parseFloat(item?.item_tax) / 100);

    //     category.withoutGst += itemTotal;
    //     category.withGst += itemTotalWithGst;

    //     acc[item.category] = category;
    //     return acc;
    // }, {});

    const workPackageTotals = estimates_data?.reduce((acc, item) => {
        const work_package = acc[item?.work_package] || { withoutGst: 0, withGst: 0 };

        const itemTotal = parseFloat(item?.quantity_estimate) * parseFloat(item?.rate_estimate);
        const itemTotalWithGst = itemTotal * (1 + parseFloat(item?.item_tax) / 100);

        work_package.withoutGst += itemTotal;
        work_package.withGst += itemTotalWithGst;

        acc[item?.work_package] = work_package;
        return acc;
    }, {});

    // console.log("workpackage", workPackageTotals)

    //   const overallTotal = categoryTotals && Object.values(categoryTotals)?.reduce(
    //     (acc, totals) => ({
    //       withoutGst: acc.withoutGst + totals.withoutGst,
    //       withGst: acc.withGst + totals.withGst,
    //     }),
    //     { withoutGst: 0, withGst: 0 }
    //   );

    const overallTotal = workPackageTotals && Object.values(workPackageTotals)?.reduce(
        (acc, totals) => ({
            withoutGst: acc.withoutGst + totals.withoutGst,
            withGst: acc.withGst + totals.withGst,
        }),
        { withoutGst: 0, withGst: 0 }
    );


    //   const pieChartData = categoryTotals && Object.keys(categoryTotals)?.map((category) => ({
    //     name: category,
    //     value: categoryTotals[category]?.withoutGst,
    //     fill: `#${Math.floor(Math.random() * 16777215).toString(16)}`, // Random colors
    //   }));

    const pieChartData = workPackageTotals && Object.keys(workPackageTotals)?.map((wp) => ({
        name: wp,
        value: workPackageTotals[wp]?.withoutGst,
        fill: `#${Math.floor(Math.random() * 16777215).toString(16)}`, // Random colors
    }));

    //   console.log("errorItems", errorItem)

    return (
        <>
            <div className="flex-1 md:space-y-4 pb-10">
                <div className="flex items-center pt-1 max-md:pb-4">
                    {/* <ArrowLeft className="cursor-pointer" onClick={() => navigate(`/projects/${project_data?.name}`)} /> */}
                    <h3 className="text-base pl-2 font-bold tracking-tight">
                        {/* <span className="text-primary">{project_data?.project_name}</span>  */} Estimations Overview</h3>
                </div>
                <div className="space-y-4">
                    <Card className="flex flex-col">
                        <CardHeader>
                            <CardTitle>
                                <Card className="flex flex-wrap md:grid md:grid-cols-4 gap-4 border border-gray-100 rounded-lg p-4">
                                    <div className="border-0 flex flex-col justify-center max-sm:hidden">
                                        <p className="text-left py-1 font-light text-sm text-red-700">Project Name:</p>
                                        <p className="text-left font-bold py-1 font-bold text-base text-black">{project_data?.project_name}</p>
                                    </div>
                                    <div className="border-0 flex flex-col justify-center">
                                        <p className="text-left py-1 font-light text-sm text-red-700">Project ID:</p>
                                        <p className="text-left font-bold py-1 font-bold text-base text-black">{project_data?.name}</p>
                                    </div>
                                    <div className="border-0 flex flex-col justify-center">
                                        <p className="text-left py-1 font-light text-sm text-red-700">Start_Date:</p>
                                        <p className="text-left font-bold py-1 font-bold text-base text-black">{project_data?.project_start_date}</p>
                                    </div>
                                    <div className="border-0 flex flex-col justify-center max-sm:hidden">
                                        <p className="text-left py-1 font-light text-sm text-red-700">End_Date:</p>
                                        <p className="text-left font-bold py-1 font-bold text-base text-black">{project_data?.project_end_date}</p>
                                    </div>
                                    {/* <div className="border-0 flex flex-col justify-center max-sm:hidden">
                            <p className="text-left py-1 font-light text-sm text-red-700">Location:</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{project_data?.project_city}, {project_data?.project_state}</p>
                        </div> */}
                                </Card>
                            </CardTitle>
                        </CardHeader>
                        {(selectedPackage && selectedPackage === "All") ? (Object.keys(workPackageTotals)?.length > 0 ? (
                            <CardContent className="flex max-md:flex-col items-center lg:mx-10">
                                <div className="flex-1">
                                    <p className="font-bold text-lg text-gray-700">
                                        Overall Total: <span className="font-medium">{formatToIndianRupee(overallTotal?.withoutGst)}</span>
                                    </p>
                                    <ul className="list-disc ml-6">
                                        {workPackageTotals && Object.keys(workPackageTotals)?.map((wp) => (
                                            <li>
                                                <span>{wp}: </span>
                                                <span>{formatToIndianRupee(workPackageTotals[wp]?.withoutGst)}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                                <ChartContainer
                                    config={chartConfig}
                                    className="mx-auto w-full min-h-[250px] max-h-[300px] flex-1 flex justify-center"
                                >
                                    <PieChart>
                                        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                                        <Pie data={pieChartData} dataKey="value" nameKey="name" innerRadius={60} strokeWidth={5}>
                                            <Label
                                                content={({ viewBox }) => {
                                                    if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                                                        return (
                                                            <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                                                                <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-3xl font-bold">
                                                                    {overallTotal?.withoutGst?.toLocaleString()}
                                                                </tspan>
                                                                <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 24} className="fill-muted-foreground">
                                                                    Total
                                                                </tspan>
                                                            </text>
                                                        );
                                                    }
                                                }}
                                            />
                                        </Pie>
                                    </PieChart>
                                </ChartContainer>
                            </CardContent>
                        ) : (
                            <CardContent className="flex items-center justify-center my-10 italic">
                                Please Start filling the estimates to show the totals overview!
                            </CardContent>
                        )) : (
                            Object.keys(categoryTotals)?.length > 0 ? (
                                <CardContent className="flex max-md:flex-col items-center lg:mx-10">
                                    <div className="flex-1">
                                        <p className="font-bold text-lg text-gray-700">
                                            Overall Total: <span className="font-medium">{formatToIndianRupee(overAllCategoryTotals?.withoutGst)}</span>
                                        </p>
                                        <ul className="list-disc ml-6">
                                            {categoryTotals && Object.keys(categoryTotals)?.map((cat) => (
                                                <li>
                                                    <span>{cat}: </span>
                                                    <span>{formatToIndianRupee(categoryTotals[cat]?.withoutGst)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                    <ChartContainer
                                        config={chartConfig}
                                        className="mx-auto w-full min-h-[250px] max-h-[300px] flex-1 flex justify-center"
                                    >
                                        <PieChart>
                                            <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                                            <Pie data={categoryWisePieChartData} dataKey="value" nameKey="name" innerRadius={60} strokeWidth={5}>
                                                <Label
                                                    content={({ viewBox }) => {
                                                        if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                                                            return (
                                                                <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                                                                    <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-3xl font-bold">
                                                                        {overAllCategoryTotals?.withoutGst?.toLocaleString()}
                                                                    </tspan>
                                                                    <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 24} className="fill-muted-foreground">
                                                                        Total
                                                                    </tspan>
                                                                </text>
                                                            );
                                                        }
                                                    }}
                                                />
                                            </Pie>
                                        </PieChart>
                                    </ChartContainer>
                                </CardContent>
                            ) : (
                                <CardContent className="flex items-center justify-center my-10 italic">
                                    Please Start filling the estimates to show the totals overview!
                                </CardContent>
                            )
                        )}
                    </Card>

                    {
                        options && (
                            <Radio.Group
                                block
                                options={options}
                                defaultValue="All"
                                optionType="button"
                                buttonStyle="solid"
                                onChange={(e) => setSelectedPackage(e.target.value)}
                            />
                        )
                    }
                    {(defaultValues && selectedPackage === "All") ?
                        (
                            <Accordion type="multiple" className="space-y-4" defaultValue={defaultValues?.slice(0, 2) || []}>
                                {allWorkPackages?.map((wp) => (
                                    <AccordionItem key={wp.work_package_name} value={wp.work_package_name} className="border-b rounded-lg shadow">
                                        <AccordionTrigger className="bg-[#FFD3CC] px-4 py-2 rounded-lg text-blue-900 flex justify-between items-center">
                                            <div className="flex space-x-4 text-sm text-gray-600">
                                                <span className="font-semibold">{wp.work_package_name}:</span>
                                                <span>Total Estd Amount: {formatToIndianRupee(workPackageTotals[wp.work_package_name]?.withoutGst)}</span>
                                            </div>
                                        </AccordionTrigger>
                                        <AccordionContent className="p-4">
                                            <div className="flex flex-col gap-6">
                                                <div className=" overflow-x-auto border-b border-gray-100">
                                                    <ConfigProvider
                                                        theme={{
                                                            components: {
                                                                Table: {
                                                                }
                                                            }
                                                        }}
                                                    >
                                                        <Table
                                                            dataSource={((categorizedData[wp.work_package_name] && Object.keys(categorizedData[wp.work_package_name])) || []).map((key) => ({
                                                                key,
                                                                category: key,
                                                                items: categorizedData[wp.work_package_name][key],
                                                            }))}
                                                            columns={columns}
                                                            expandable={{
                                                                expandedRowRender: (record) => (
                                                                    <Table
                                                                        dataSource={record.items}
                                                                        columns={innerColumns}
                                                                        pagination={false}
                                                                        rowKey={(item) => item.name}
                                                                    />
                                                                ),
                                                            }}
                                                            rowKey="category"
                                                        />
                                                    </ConfigProvider>
                                                </div>
                                                {/* <Separator /> */}
                                                <div className="flex flex-col gap-2">
                                                    <h2 className="font-semibold text-base underline">Submit New Estimation</h2>
                                                    <div className="flex justify-between items-end">
                                                        <div className="flex gap-2 items-end flex-wrap">
                                                            <div className="flex flex-col gap-2">
                                                                <h3 className="text-gray-500">Select Associated Category<sup className="text-sm text-red-600">*</sup></h3>
                                                                <ReactSelect
                                                                    className="w-64"
                                                                    value={curCategory[wp.work_package_name]}
                                                                    options={workPackageCategoryList[wp.work_package_name]}
                                                                    onChange={(value) => handleCategoryChange(wp.work_package_name, value)} />
                                                            </div>
                                                            {wp?.work_package_name !== "Services" ? (
                                                                <div className="flex flex-col gap-2">
                                                                    <h3 className="text-gray-500">Select Item<sup className="text-sm text-red-600">*</sup></h3>
                                                                    <ReactSelect
                                                                        className="w-64"
                                                                        value={selectedItem[wp.work_package_name]}
                                                                        options={categoryItemList[curCategory[wp.work_package_name]?.value]}
                                                                        onChange={(value) => handleItemChange(wp.work_package_name, curCategory[wp.work_package_name], value)}
                                                                        isDisabled={!curCategory[wp.work_package_name]}
                                                                    />
                                                                </div>
                                                            ) : (
                                                                <div className="flex flex-col gap-2">
                                                                    <h3 className="text-gray-500">Description (optional)</h3>
                                                                    <Textarea
                                                                        placeholder={`Add Description...`}
                                                                        id="description"
                                                                        className="w-64"
                                                                        disabled={!curCategory[wp.work_package_name]}
                                                                        onChange={(e) => setServiceDesc(e.target.value)}
                                                                        value={serviceDesc || ''}
                                                                    />
                                                                </div>
                                                            )}
                                                            <div className="flex flex-col gap-2">
                                                                <h3 className="text-gray-500">Qty<sup className="text-sm text-red-600">*</sup></h3>
                                                                <Input type="number" placeholder="Enter Estimated Qty"
                                                                    className="w-20"
                                                                    value={enteredQuantities[wp.work_package_name]}
                                                                    onChange={(e) => handleQuantityChange(wp.work_package_name, curCategory[wp.work_package_name], e.target.value)}
                                                                    disabled={wp?.work_package_name === "Services" ? !curCategory[wp.work_package_name] : !selectedItem[wp.work_package_name]}
                                                                />
                                                            </div>

                                                            <div className="flex flex-col gap-2">
                                                                <h3 className="text-gray-500">Unit{wp?.work_package_name === "Services" ? "(Opt)" : <sup className="text-sm text-red-600">*</sup>}</h3>
                                                                <Input type="text"
                                                                    className="w-20"
                                                                    value={wp?.work_package_name !== "Services" ? selectedItem[wp.work_package_name]?.unit : (serviceUnit || "")}
                                                                    onChange={(e) => handleUnitChange(e.target.value)}
                                                                    disabled={wp?.work_package_name !== "Services"}
                                                                />
                                                            </div>

                                                            {wp?.work_package_name === "Services" && (
                                                                <>
                                                                    <div className="flex flex-col gap-2">
                                                                        <h3 className="text-gray-500">Rate<sup className="text-sm text-red-600">*</sup></h3>
                                                                        <Input type="number" placeholder="Enter Estimated Rate"
                                                                            value={rateInput}
                                                                            onChange={(e) => handleRateChange(e.target.value)}
                                                                            disabled={!enteredQuantities[wp.work_package_name]}
                                                                        />
                                                                    </div>
                                                                    <div className="flex flex-col gap-4">
                                                                        <h3 className="text-gray-500">Amount</h3>
                                                                        <p className="text-primary">{formatToIndianRupee((enteredQuantities["Services"] || 0) * (rateInput || 0))}</p>
                                                                    </div>
                                                                </>
                                                            )}
                                                        </div>
                                                        <Button
                                                            onClick={() => handleSubmit(wp.work_package_name)}
                                                            disabled={!curCategory[wp.work_package_name] || (wp?.work_package_name !== "Services" && !selectedItem[wp.work_package_name]) || (wp?.work_package_name === "Services" && !rateInput) || !enteredQuantities[wp.work_package_name] || loadingState === wp.work_package_name}>
                                                            {loadingState === wp.work_package_name ? "Submitting.." : "Submit"}
                                                        </Button>
                                                        <AlertDialog open={showRateDialog} onOpenChange={setShowRateDialog}>
                                                            <AlertDialogContent>
                                                                <AlertDialogHeader>
                                                                    <AlertDialogTitle>
                                                                        No Quotes Found
                                                                    </AlertDialogTitle>
                                                                </AlertDialogHeader>
                                                                <AlertDialogDescription>
                                                                    <p>No quotes found for the item: <span className="text-primary italic">{errorItem?.item_name}</span> in the system. Please provide a rate:</p>
                                                                    <div className="flex items-center gap-6">
                                                                        <div className="flex flex-col gap-2">
                                                                            <h3 className="text-gray-500">Qty</h3>
                                                                            <Input type="number" placeholder="Enter Estimated Qty"
                                                                                value={errorItem?.quantity_estimate}
                                                                                onChange={(e) => setErrorItem({ ...errorItem, quantity_estimate: e.target.value })}
                                                                            />
                                                                        </div>
                                                                        <div className="flex flex-col gap-2">
                                                                            <h3 className="text-gray-500">Unit</h3>
                                                                            <Input type="text"
                                                                                value={errorItem?.uom}
                                                                                disabled
                                                                            />
                                                                        </div>
                                                                    </div>

                                                                    <div className="flex items-center gap-6 mt-4">
                                                                        <div className="flex flex-col gap-2">
                                                                            <h3 className="text-gray-500">Rate</h3>
                                                                            <Input
                                                                                type="number"
                                                                                placeholder="Enter Rate"
                                                                                value={rateInput}
                                                                                onChange={(e) => handleRateChange(e.target.value)}
                                                                                disabled={!errorItem?.quantity_estimate}
                                                                            />
                                                                        </div>
                                                                        <div className="flex flex-col gap-4">
                                                                            <h3 className="text-gray-500">Amount</h3>
                                                                            <p className="text-primary">{formatToIndianRupee((errorItem?.quantity_estimate || 0) * (rateInput || 0))}</p>
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex items-center justify-end gap-2 mt-4">
                                                                        <AlertDialogCancel>
                                                                            Cancel
                                                                        </AlertDialogCancel>
                                                                        <AlertDialogAction asChild>
                                                                            <Button
                                                                                disabled={!rateInput || !errorItem?.quantity_estimate}
                                                                                onClick={handleAlertSubmit}
                                                                            >
                                                                                {create_loading ? "Submitting.." : "Submit"}
                                                                            </Button>
                                                                        </AlertDialogAction>
                                                                    </div>
                                                                </AlertDialogDescription>
                                                            </AlertDialogContent>
                                                        </AlertDialog>
                                                    </div>
                                                </div>
                                            </div>
                                        </AccordionContent>
                                    </AccordionItem>
                                ))}
                            </Accordion>
                        ) : (
                            <CategoryWiseEstimateCard selectedPackage={selectedPackage} categorizedData={categorizedData} columns={columns} innerColumns={innerColumns}
                                curCategory={curCategory} workPackageCategoryList={workPackageCategoryList} handleCategoryChange={handleCategoryChange} selectedItem={selectedItem} categoryItemList={categoryItemList} handleItemChange={handleItemChange}
                                setServiceDesc={setServiceDesc} serviceDesc={serviceDesc} enteredQuantities={enteredQuantities} handleQuantityChange={handleQuantityChange} serviceUnit={serviceUnit} handleUnitChange={handleUnitChange} rateInput={rateInput}
                                handleRateChange={handleRateChange} loadingState={loadingState} handleSubmit={handleSubmit} showRateDialog={showRateDialog} setShowRateDialog={setShowRateDialog} errorItem={errorItem} setErrorItem={setErrorItem} handleAlertSubmit={handleAlertSubmit} create_loading={create_loading}
                            />
                        )}
                </div>

            </div>
        </>
    )
}

export const Component = AddProjectEstimates;

export const CategoryWiseEstimateCard = ({ selectedPackage, categorizedData, columns, innerColumns,
    curCategory, workPackageCategoryList, handleCategoryChange, selectedItem, categoryItemList, handleItemChange,
    setServiceDesc, serviceDesc, enteredQuantities, handleQuantityChange, serviceUnit, handleUnitChange, rateInput,
    handleRateChange, loadingState, handleSubmit, showRateDialog, setShowRateDialog, errorItem, setErrorItem, handleAlertSubmit, create_loading
}) => {
    return (
        <div className="flex flex-col gap-6">
            <div className=" overflow-x-auto border-b border-gray-100">
                <ConfigProvider
                    theme={{
                        components: {
                            Table: {
                            }
                        }
                    }}
                >
                    <Table
                        dataSource={((categorizedData[selectedPackage] && Object.keys(categorizedData[selectedPackage])) || []).map((key) => ({
                            key,
                            category: key,
                            items: categorizedData[selectedPackage][key],
                        }))}
                        columns={columns}
                        expandable={{
                            expandedRowRender: (record) => (
                                <Table
                                    dataSource={record.items}
                                    columns={innerColumns}
                                    pagination={false}
                                    rowKey={(item) => item.name}
                                />
                            ),
                        }}
                        rowKey="category"
                    />
                </ConfigProvider>
            </div>
            {/* <Separator /> */}
            <div className="flex flex-col gap-2">
                <h2 className="font-semibold text-base underline">Submit New Estimation</h2>
                <div className="flex justify-between items-end">
                    <div className="flex gap-2 items-end flex-wrap">
                        <div className="flex flex-col gap-2">
                            <h3 className="text-gray-500">Select Associated Category<sup className="text-sm text-red-600">*</sup></h3>
                            <ReactSelect
                                className="w-64"
                                value={curCategory[selectedPackage]}
                                options={workPackageCategoryList[selectedPackage]}
                                onChange={(value) => handleCategoryChange(selectedPackage, value)} />
                        </div>
                        {selectedPackage !== "Services" ? (
                            <div className="flex flex-col gap-2">
                                <h3 className="text-gray-500">Select Item<sup className="text-sm text-red-600">*</sup></h3>
                                <ReactSelect
                                    className="w-64"
                                    value={selectedItem[selectedPackage]}
                                    options={categoryItemList[curCategory[selectedPackage]?.value]}
                                    onChange={(value) => handleItemChange(selectedPackage, curCategory[selectedPackage], value)}
                                    isDisabled={!curCategory[selectedPackage]}
                                />
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2">
                                <h3 className="text-gray-500">Description (optional)</h3>
                                <Textarea
                                    placeholder={`Add Description...`}
                                    id="description"
                                    className="w-64"
                                    disabled={!curCategory[selectedPackage]}
                                    onChange={(e) => setServiceDesc(e.target.value)}
                                    value={serviceDesc || ''}
                                />
                            </div>
                        )}
                        <div className="flex flex-col gap-2">
                            <h3 className="text-gray-500">Qty<sup className="text-sm text-red-600">*</sup></h3>
                            <Input type="number" placeholder="Enter Estimated Qty"
                                className="w-20"
                                value={enteredQuantities[selectedPackage]}
                                onChange={(e) => handleQuantityChange(selectedPackage, curCategory[selectedPackage], e.target.value)}
                                disabled={selectedPackage === "Services" ? !curCategory[selectedPackage] : !selectedItem[selectedPackage]}
                            />
                        </div>

                        <div className="flex flex-col gap-2">
                            <h3 className="text-gray-500">Unit{selectedPackage === "Services" ? "(Opt)" : <sup className="text-sm text-red-600">*</sup>}</h3>
                            <Input type="text"
                                className="w-20"
                                value={selectedPackage !== "Services" ? selectedItem[selectedPackage]?.unit : (serviceUnit || "")}
                                onChange={(e) => handleUnitChange(e.target.value)}
                                disabled={selectedPackage !== "Services"}
                            />
                        </div>

                        {selectedPackage === "Services" && (
                            <>
                                <div className="flex flex-col gap-2">
                                    <h3 className="text-gray-500">Rate<sup className="text-sm text-red-600">*</sup></h3>
                                    <Input type="number" placeholder="Enter Estimated Rate"
                                        value={rateInput}
                                        onChange={(e) => handleRateChange(e.target.value)}
                                        disabled={!enteredQuantities[selectedPackage]}
                                    />
                                </div>
                                <div className="flex flex-col gap-4">
                                    <h3 className="text-gray-500">Amount</h3>
                                    <p className="text-primary">{formatToIndianRupee((enteredQuantities["Services"] || 0) * (rateInput || 0))}</p>
                                </div>
                            </>
                        )}
                    </div>
                    <Button
                        onClick={() => handleSubmit(selectedPackage)}
                        disabled={!curCategory[selectedPackage] || (selectedPackage !== "Services" && !selectedItem[selectedPackage]) || (selectedPackage === "Services" && !rateInput) || !enteredQuantities[selectedPackage] || loadingState === selectedPackage}>
                        {loadingState === selectedPackage ? "Submitting.." : "Submit"}
                    </Button>
                    <AlertDialog open={showRateDialog} onOpenChange={setShowRateDialog}>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>
                                    No Quotes Found
                                </AlertDialogTitle>
                            </AlertDialogHeader>
                            <AlertDialogDescription>
                                <p>No quotes found for the item: <span className="text-primary italic">{errorItem?.item_name}</span> in the system. Please provide a rate:</p>
                                <div className="flex items-center gap-6">
                                    <div className="flex flex-col gap-2">
                                        <h3 className="text-gray-500">Qty</h3>
                                        <Input type="number" placeholder="Enter Estimated Qty"
                                            value={errorItem?.quantity_estimate}
                                            onChange={(e) => setErrorItem({ ...errorItem, quantity_estimate: e.target.value })}
                                        />
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <h3 className="text-gray-500">Unit</h3>
                                        <Input type="text"
                                            value={errorItem?.uom}
                                            disabled
                                        />
                                    </div>
                                </div>

                                <div className="flex items-center gap-6 mt-4">
                                    <div className="flex flex-col gap-2">
                                        <h3 className="text-gray-500">Rate</h3>
                                        <Input
                                            type="number"
                                            placeholder="Enter Rate"
                                            value={rateInput}
                                            onChange={(e) => handleRateChange(e.target.value)}
                                            disabled={!errorItem?.quantity_estimate}
                                        />
                                    </div>
                                    <div className="flex flex-col gap-4">
                                        <h3 className="text-gray-500">Amount</h3>
                                        <p className="text-primary">{formatToIndianRupee((errorItem?.quantity_estimate || 0) * (rateInput || 0))}</p>
                                    </div>
                                </div>
                                <div className="flex items-center justify-end gap-2 mt-4">
                                    <AlertDialogCancel>
                                        Cancel
                                    </AlertDialogCancel>
                                    <AlertDialogAction asChild>
                                        <Button
                                            disabled={!rateInput || !errorItem?.quantity_estimate}
                                            onClick={handleAlertSubmit}
                                        >
                                            {create_loading ? "Submitting.." : "Submit"}
                                        </Button>
                                    </AlertDialogAction>
                                </div>
                            </AlertDialogDescription>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </div>
        </div>
    )
}