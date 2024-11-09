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
import { ConfigProvider, Table } from "antd";
import formatToIndianRupee from "@/utils/FormatPrice";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./ui/alert-dialog";
import { Separator } from "./ui/separator";
import { Pencil2Icon } from "@radix-ui/react-icons";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { TailSpin } from "react-loader-spinner";


const AddProjectEstimates = () => {
    const { projectId } = useParams()
    const { data: project_data, isLoading: project_loading, error: project_error } = useFrappeGetDoc<ProjectsType>("Projects", projectId)
    const { data: estimates_data, isLoading: estimates_loading, error: estimates_error, mutate : estimates_data_mutate } = useFrappeGetDocList<ProjectEstimatesType>("Project Estimates", {
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

    const {createDoc, loading: create_loading} = useFrappeCreateDoc()
    const {updateDoc, loading: update_loading} = useFrappeUpdateDoc()
    const {deleteDoc, loading: delete_loading} = useFrappeDeleteDoc()
    const [deleteItem, setDeleteItem] = useState(null)

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
        acc[work_package].push({label : category?.category_name, value : category?.category_name, tax : category?.tax});
        return acc;
      }, {});

      setWorkPackageCategoryList(groupedData);
    }
  }, [category_list]);

  useEffect(() => {
    if (item_list && estimates_data) {
      const groupedItems = item_list.reduce((acc, item) => {
        if(estimates_data.every((i) => i?.item !== item.name)) {
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
        [wp] : value
    }))

    setSelectedItem(prevState => ({
        ...prevState,
        [wp]: null
      }));
  }

  const handleItemChange = (wp, cat, value) => {
    setSelectedItem(prevState => ({
        ...prevState,
        [wp] : value
    }))
  }

  const handleQuantityChange = (wp, cat, value) => {
    setEnteredQuantities(prevState => ({
        ...prevState,
        [wp] : value
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
            const list: string[] = JSON.parse(project_data.project_work_packages)?.work_packages?.map((wp) => wp.work_package_name)
            setDefaultValues(list)
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

    console.log("estimations", editEstimation)

    const innerColumns = [
        {   title: "Item", 
            dataIndex: "item_name", 
            key: "item_name", 
            render: (text) => <span className="italic">{text}</span>
        },
        {
            title: "UOM",
            dataIndex: "uom",
            key: "uom",
            width: "10%",
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
                return  <span>{formatToIndianRupee(parseFloat(text))}</span>
            },
        },
        {
            title: "Estd Amount",
            key: "amount_estimate",
            width: "20%",
            render: (text, record) => {
                return  <span>{formatToIndianRupee(record?.rate_estimate * record?.quantity_estimate)}</span>
            },
        },
        {
            title: "Edit/Delete",
            key: "edit-delete-actions",
            width: "10%",
            render: (text, record) => {
                // console.log("recordeditdelete", record)
                return  (
                    <div className="flex items-center gap-2">
                        <Dialog>
                            <DialogTrigger>
                                <Pencil2Icon onClick={() => {
                                    const estimation = {rate_estimate : record?.rate_estimate, quantity_estimate : record?.quantity_estimate}
                                    setEditEstimation(estimation)
                                }}  className="w-6 h-6" />
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
                                                onChange={(e) => setEditEstimation({...editEstimation, quantity_estimate : e.target.value})} 
                                            />
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <h3 className="text-gray-500">Rate</h3>
                                            <Input type="number" placeholder="Enter Estimated Rate" 
                                                value={editEstimation?.rate_estimate} 
                                                onChange={(e) => setEditEstimation({...editEstimation, rate_estimate : e.target.value})} 
                                            />
                                        </div>
                                        <Button onClick={() => handleEditEstimate(record?.name, record?.item_name)} disabled={(record?.rate_estimate === editEstimation?.rate_estimate && record?.quantity_estimate === editEstimation?.quantity_estimate) || Object.values(editEstimation || [])?.some((i) => !i)}>
                                            {update_loading ? "Updating..." : "Update"}
                                        </Button>
                                        <DialogClose id="estimateEditClose" className="hidden">Close</DialogClose>
                                    </DialogDescription>
                            </DialogContent>
                        </Dialog>
                        <span>|</span>
                        {(deleteItem && deleteItem === record?.name) ? <TailSpin color={"red"} width={20} height={20} /> : 
                            <Trash onClick={() => handleDeleteEstimate(record?.name, record?.item_name)} className="w-6 h-6 text-primary cursor-pointer" />
                        }
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
        const item_name = selectedItem[wp]?.label
        const uom = selectedItem[wp]?.unit
        const quantity = enteredQuantities[wp]
        // const rate = enteredRates[wp] || ''

        try {

            await createDoc("Project Estimates", {
                project : project_data.name,
                work_package : wp,
                category : category,
                item : item,
                item_name : item_name,
                uom : uom,
                quantity_estimate : quantity,
                item_tax : tax
            })

            await estimates_data_mutate()
            await item_list_mutate()

            setCurCategory({ ...curCategory, [wp]: null });
            setSelectedItem({ ...selectedItem, [wp]: null });
            setEnteredQuantities({ ...enteredQuantities, [wp]: '' });
            // setEnteredRates({ ...enteredRates, [wp]: '' });

            toast({
                title: "Success!",
                description: `New Estimate created successfully!`,
                variant: "success",
            })

        } catch (error) {
            if(error?.exc_type === "QuotationNotExistError") {
                toast({
                    title: "Failed!",
                    description: `No quotes found, please enter manually!.`,
                    variant: "default"
                });
                setErrorItem({ 
                    work_package : wp,
                    category : category,
                    item : item,
                    item_name : item_name,
                    uom : uom,
                    quantity_estimate : quantity,
                    item_tax : tax  
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

    return (
        <>
            <div className="flex-1 md:space-y-4">
                <div className="flex items-center pt-1 pb-4">
                    <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} />
                    <h3 className="text-base pl-2 font-bold tracking-tight"><span className="text-primary">{project_data?.project_name}</span> Estimations</h3>
                </div>
                <div>
                    {defaultValues && (
                    <Accordion type="multiple" className="space-y-4" defaultValue={defaultValues || []}>
                        {JSON.parse(project_data?.project_work_packages)?.work_packages?.map((wp) => (
                            <AccordionItem key={wp.work_package_name} value={wp.work_package_name} className="border-b rounded-lg shadow">
                            <AccordionTrigger className="bg-[#FFD3CC] px-4 py-2 rounded-lg text-blue-900 flex justify-between items-center">
                              {wp.work_package_name}
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
                                                        <h3 className="text-gray-500">Select Associated Category</h3>
                                                        <ReactSelect 
                                                            className="w-64"
                                                            value={curCategory[wp.work_package_name]} 
                                                            options={workPackageCategoryList[wp.work_package_name]} 
                                                            onChange={(value) => handleCategoryChange(wp.work_package_name, value)} />
                                                    </div>
                                                    <div className="flex flex-col gap-2">
                                                        <h3 className="text-gray-500">Select Item</h3>
                                                        <ReactSelect 
                                                            className="w-64"
                                                            value={selectedItem[wp.work_package_name]} 
                                                            options={categoryItemList[curCategory[wp.work_package_name]?.value]} 
                                                            onChange={(value) => handleItemChange(wp.work_package_name, curCategory[wp.work_package_name], value)}
                                                            isDisabled={!curCategory[wp.work_package_name]}
                                                             />
                                                    </div>
                                                    <div className="flex flex-col gap-2">
                                                        <h3 className="text-gray-500">Qty</h3>
                                                        <Input type="number" placeholder="Enter Estimated Qty" 
                                                        value={enteredQuantities[wp.work_package_name]} 
                                                        onChange={(e) => handleQuantityChange(wp.work_package_name, curCategory[wp.work_package_name],  e.target.value)} 
                                                        disabled={!selectedItem[wp.work_package_name]}
                                                        />
                                                    </div>
                                                    {/* <div className="flex flex-col gap-2">
                                                        <h3 className="text-gray-500">Rate</h3>
                                                        <Input type="number" placeholder="Enter Estimated Rate" 
                                                        value={enteredRates[wp.work_package_name]} 
                                                        onChange={(e) => handleRateChange(wp.work_package_name, curCategory[wp.work_package_name],  e.target.value)}  
                                                        disabled={!selectedItem[wp.work_package_name]}
                                                        />
                                                    </div> */}
                                                    </div>
                                                        <Button
                                                             onClick={() => handleSubmit(wp.work_package_name)}
                                                            disabled={!curCategory[wp.work_package_name] || !selectedItem[wp.work_package_name] || !enteredQuantities[wp.work_package_name]}>
                                                            {create_loading ? "Submitting.." : "Submit"}
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
                                                                    <Input
                                                                        type="number"
                                                                        placeholder="Enter Rate"
                                                                        value={rateInput}
                                                                        onChange={(e) => handleRateChange(e.target.value)}
                                                                        className="mt-4"
                                                                    />
                                                                    <div className="flex items-center justify-end gap-2 mt-4">
                                                                        <AlertDialogCancel>
                                                                            Cancel
                                                                        </AlertDialogCancel>
                                                                        <AlertDialogAction asChild>
                                                                            <Button
                                                                                disabled={!rateInput}
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
                    )}
                </div>

            </div>
        </>
    )
}

export const Component = AddProjectEstimates;