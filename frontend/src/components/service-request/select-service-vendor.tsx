import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { ServiceRequests as ServiceRequestsType } from "@/types/NirmaanStack/ServiceRequests";
import {
  useFrappeCreateDoc,
  useFrappeGetDoc,
  useFrappeGetDocList,
  useFrappeUpdateDoc,
  useSWRConfig,
} from "frappe-react-sdk";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { NewPRSkeleton } from "../ui/skeleton";
import { NirmaanUsers as NirmaanUsersType } from "@/types/NirmaanStack/NirmaanUsers";
import { NirmaanComments as NirmaanCommentsType } from "@/types/NirmaanStack/NirmaanComments";
import {
  ArrowBigUpDash,
  ArrowLeft,
  CheckCheck,
  CirclePlus,
  Settings2,
  Trash2,
  Undo2,
} from "lucide-react";
import { ProcurementHeaderCard } from "../ui/ProcurementHeaderCard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { formatDate } from "@/utils/FormatDate";
import ReactSelect from "react-select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet";
import { NewVendor } from "@/pages/vendors/new-vendor";
import { Button } from "../ui/button";
import { Table as AntTable, ConfigProvider, TableColumnsType } from "antd";
import formatToIndianRupee from "@/utils/FormatPrice";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import { useUserData } from "@/hooks/useUserData";
import { toast } from "../ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectValue, SelectTrigger } from "../ui/select";
import { v4 as uuidv4 } from 'uuid'; // Import uuid for unique IDs

const SelectServiceVendor = () => {
  const { srId: id }: any = useParams();
  const [project, setProject] = useState<string>();

  const {
    data: sr_data,
    isLoading: sr_data_loading,
    error: sr_data_error,
  } = useFrappeGetDoc<ServiceRequestsType>("Service Requests", id);

  useEffect(() => {
    if (sr_data) {
      setProject(sr_data?.project);
    }
  }, [sr_data]);

  const {
    data: project_data,
    isLoading: project_loading,
    error: project_error,
  } = useFrappeGetDoc<ProjectsType>("Projects", project);

  const {
    data: usersList,
    isLoading: userLoading,
    error: userError,
  } = useFrappeGetDocList<NirmaanUsersType>("Nirmaan Users", {
    fields: ["*"],
    limit: 1000,
  });

  const {
    data: universalComments,
    isLoading: universalCommentsLoading,
    error: universalCommentsError,
  } = useFrappeGetDocList<NirmaanCommentsType>("Nirmaan Comments", {
    fields: ["*"],
    limit: 1000,
    filters: [["reference_name", "=", id]],
    orderBy: { field: "creation", order: "desc" },
  });

  // console.log("universalComments", universalComments)

  return (
    <>
      {" "}
      {sr_data_loading ||
        project_loading ||
        userLoading ||
        universalCommentsLoading ? (
        <NewPRSkeleton />
      ) : (
        <SelectServiceVendorPage
          sr_data={sr_data}
          project_data={project_data}
          universalComments={universalComments}
          usersList={usersList}
        />
      )}
      {(sr_data_error ||
        project_error ||
        userError ||
        universalCommentsError) && <h1>Error</h1>}
    </>
  );
};

interface SelectServiceVendorPageProps {
  sr_data: ServiceRequestsType | undefined
  usersList?: NirmaanUsersType[] | undefined
  universalComments: NirmaanCommentsType[] | undefined
}

interface DataType {
  key: React.ReactNode;
  category: string | null;
  description: string;
  rate: number | null;
  selectedVendor: string;
  amount: number;
  children?: DataType[];
}

export const SelectServiceVendorPage = ({ sr_data, usersList, universalComments }: SelectServiceVendorPageProps) => {
  const navigate = useNavigate();
  const userData = useUserData();

  const [comment, setComment] = useState<any>(null);
  const [section, setSection] = useState("choose-vendor");
  const [vendorOptions, setVendorOptions] = useState<
    { label: string; value: string }[]
  >([]);
  const [selectedVendor, setSelectedvendor] = useState();
  const [amounts, setAmounts] = useState<{ [key: string]: string }>({}); // New state for amounts
  const [order, setOrder] = useState(
    sr_data && JSON.parse(sr_data?.service_order_list)?.list
  );
  const [isNextEnabled, setIsNextEnabled] = useState(false);
  const [expandedRowKeys, setExpandedRowKeys] = useState([]);

  // console.log("sr_data", JSON.parse(sr_data?.service_order_list))

  const groupedData = useMemo(() => {
    return order?.reduce((acc, item) => {
      acc[item.category] = acc[item.category] || [];
      acc[item.category].push(item);
      return acc;
    }, {});
  }, [order]);

  // console.log("groupedData, ", groupedData)

  useEffect(() => {
    if (groupedData) {
      setExpandedRowKeys(Object.keys(groupedData));
    }
  }, [groupedData]);

  // Main table columns
  const columns = [
    {
      title: "Service",
      dataIndex: "category",
      key: "category",
      width: "55%",
      render: (text) => <strong className="text-primary">{text}</strong>,
    },
    {
      title: "Selected Vendor",
      key: "vendor",
      width: "45%",
      render: () => (
        <span className="font-semibold text-primary">
          {selectedVendor?.label}
        </span>
      ),
    },
  ];

  // Inner table columns
  const innerColumns = [
    {
      title: "Description",
      dataIndex: "description",
      key: "description",
      width: "60%",
      render: (text) => (
        <span className="italic whitespace-pre-wrap">{text}</span>
      ),
    },
    {
      title: "Unit",
      dataIndex: "uom",
      key: "uom",
      width: "10%",
      render: (text) => <span>{text}</span>,
    },
    {
      title: "Quantity",
      dataIndex: "quantity",
      key: "quantity",
      width: "10%",
      render: (text) => <span>{text}</span>,
    },
    {
      title: "Rate",
      dataIndex: "rate",
      key: "rate",
      width: "10%",
      render: (text) => (
        <span className="italic">{formatToIndianRupee(text)}</span>
      ),
    },
    {
      title: "Amount",
      dataIndex: "amount",
      key: "amount",
      width: "10%",
      render: (text, record) => (
        <span className="italic">
          {formatToIndianRupee(record.rate * record.quantity)}
        </span>
      ),
    },
    // {
    //     title: "Amt inc. tax",
    //     dataIndex: "amount",
    //     key: "amountinctax",
    //     width: "20%",
    //     render: (text) => <span className="italic">{formatToIndianRupee(parseFloat(text) * 1.18)}</span>,
    // },
  ];

  const { data: category_data, isLoading: category_loading, error: category_error } = useFrappeGetDocList("Category", {
    fields: ["*"],
    filters: [['work_package', '=', 'Services']],
    orderBy: { field: 'name', order: 'asc' }
  })

  console.log("category_data", category_data)

  const {
    data: vendor_list,
    isLoading: vendor_list_loading,
    error: vendor_list_error,
    mutate: vendor_list_mutate,
  } = useFrappeGetDocList(
    "Vendors",
    {
      fields: ["*"],
      filters: [["vendor_type", "=", "Service"]],
      limit: 10000,
    },
    "Service Vendors"
  );

  // console.log("vendor_list", vendor_list)

  useEffect(() => {
    if (vendor_list) {
      const currOptions = vendor_list?.map((item) => ({
        value: item.name,
        vendor_name: item.vendor_name,
        city: item?.vendor_city,
        state: item?.vendor_state,
      }));
      setVendorOptions(currOptions);
    }
  }, [vendor_list]);

  const { mutate } = useSWRConfig();
  const {
    createDoc: createDoc,
    loading: create_loading,
    isCompleted: submit_complete,
    error: submit_error,
  } = useFrappeCreateDoc();

  const {
    updateDoc: updateDoc,
    loading: update_loading,
    isCompleted: update_complete,
    error: update_error,
  } = useFrappeUpdateDoc();

  console.log("orderData", order)

  // const { data: category_list, isLoading: category_list_loading, error: category_list_error } = useFrappeGetDocList("Category",
  //     {
  //         fields: ['category_name', 'work_package'],
  //         orderBy: { field: 'category_name', order: 'asc' },
  //         limit: 100,
  //         filters: [['work_package', '=', 'Services']]
  //     });

  // useEffect(() => {
  //     if (universalComments) {
  //         const comment = universalComments?.find((cmt) => cmt.subject === "approving sr")
  //         setComment(comment)
  //     }
  // }, [universalComments])

  // const getTotal = (cat: string) => {
  //     let total: number = 0;
  //     order.map((item) => {
  //         if (item.category === cat) {
  //             const price = item.amount;
  //             total += (price ? parseFloat(price) : 0) * 1.18;
  //         }
  //     })
  //     return total
  // }

  // useEffect(() => {
  //     if (sr_data?.project) {
  //         const newData: DataType[] = [];
  //         console.log(JSON.parse(sr_data.service_category_list).list)
  //         JSON.parse(sr_data.service_category_list).list.map((cat: any) => {
  //             const items: DataType[] = [];
  //             console.log(order)
  //             order.forEach((item: any) => {
  //                 if (item.category === cat.name) {
  //                     items.push({
  //                         description: item.description,
  //                         key: item.description,
  //                         category: item.category,
  //                         rate: item.amount,
  //                         amount: item.amount * 1.18,
  //                         selectedVendor: selectedVendor ? selectedVendor : "",
  //                     });
  //                 }
  //             });

  //             if (items.length) {
  //                 const node: DataType = {
  //                     description: cat.name,
  //                     key: cat.name,
  //                     category: null,
  //                     rate: null,
  //                     amount: getTotal(cat.name),
  //                     selectedVendor: selectedVendor ? selectedVendor : "",
  //                     children: items,
  //                 };
  //                 newData.push(node);
  //             }
  //         });
  //         setData(newData)
  //     }
  // }, [order, selectedVendor]);

  const getFullName = (id: any) => {
    return usersList?.find((user) => user?.name == id)?.full_name;
  };

  const handleChange = () => (vendor: any) => {
    // console.log("vendor", vendor)
    setSelectedvendor(vendor);
  };

  const handleAmountChange = (id: string, value: string) => {
    const numericValue = value.replace(/₹\s*/, "");
    setAmounts((prev) => ({ ...prev, [id]: numericValue }));
  };

  // console.log("amounts", amounts)

  const handleSaveAmounts = () => {
    // console.log("Amounts to save:", amounts);
    let newOrderData = [];
    for (let item of order) {
      // console.log("item", item)
      let entry: any = {};
      entry.id = item.id;
      entry.category = item.category;
      entry.description = item.description;
      entry.uom = item.uom;
      entry.quantity = item.quantity;
      entry.rate = amounts[item.id] || 0;
      newOrderData.push(entry);
    }
    setOrder(newOrderData);
    setSection("summary");
  };

  useEffect(() => {
    const allAmountsFilled = Object.values(amounts).every(
      (amount) => amount && parseFloat(amount) > 0
    );
    const allAmountsCount = Object.keys(amounts)?.length === order?.length;
    setIsNextEnabled(allAmountsFilled && allAmountsCount);
  }, [amounts]);

  // console.log("selecedVendor", selectedVendor)

  useEffect(() => {
    if (sr_data?.status === "Rejected" && vendor_list) {
      const vendor = vendor_list?.find((ven) => ven?.name === sr_data?.vendor);
      const selectedVendor = {
        value: vendor?.name,
        vendor_name: vendor?.vendor_name,
        city: vendor?.vendor_city,
        state: vendor?.vendor_state,
      };
      setSelectedvendor(selectedVendor);
    }
    if (sr_data?.status === "Rejected") {
      let amounts = {};
      JSON.parse(sr_data?.service_order_list)?.list?.forEach((item) => {
        amounts = { ...amounts, [item.id]: item?.rate };
      });
      setAmounts(amounts);
    }
  }, [sr_data, vendor_list]);

  // console.log("amounts", amounts)
  // console.log("sr_data", sr_data)

  // console.log("selected vendor", selectedVendor)

  const handleSubmit = async () => {
    try {
      if (comment) {
        await createDoc("Nirmaan Comments", {
          comment_type: "Comment",
          reference_doctype: "Service Requests",
          reference_name: sr_data?.name,
          comment_by: userData?.user_id,
          content: comment,
          subject: "sending sr for appr",
        });
      }
      await updateDoc("Service Requests", sr_data?.name, {
        vendor: selectedVendor?.value,
        service_order_list: { list: order },
        status: "Vendor Selected",
      });

      toast({
        title: "Success!",
        description: `Services Sent for Approval`,
        variant: "success",
      });

      navigate("/choose-service-vendor");
    } catch (error) {
      toast({
        title: "Failed!",
        description: `Unable to send services for approval`,
        variant: "destructive",
      });
      console.log("error while sending SR for approval", error);
    }
  };

  const handleResolveSR = async () => {
    try {
      if (comment) {
        await createDoc("Nirmaan Comments", {
          comment_type: "Comment",
          reference_doctype: "Service Requests",
          reference_name: sr_data?.name,
          comment_by: userData?.user_id,
          content: comment,
          subject: "resolving sr",
        });
      }
      await updateDoc("Service Requests", sr_data?.name, {
        vendor: selectedVendor?.value,
        service_order_list: { list: order },
        status: "Vendor Selected",
      });

      await mutate(`Service Requests ${sr_data?.name}`);

      toast({
        title: "Success!",
        description: `SR: ${sr_data?.name} successfully resolved and sent for approval`,
        variant: "success",
      });

      if (sr_data?.status === "Rejected") {
        navigate(`/service-requests/${sr_data?.name}`);
      } else {
        navigate("/choose-service-vendor");
      }
    } catch (error) {
      toast({
        title: "Failed!",
        description: `Unable to resolve SR: ${sr_data?.name}`,
        variant: "destructive",
      });
      console.log("error while resolving SR", error);
    }
  };

  const handleInputChange = (id: string, field: string, value: string) => {
    if (field) {
      const updatedOrder = order.map((item: any) =>
        item.id === id ? { ...item, [field]: value } : item
      );
      setOrder(updatedOrder);
    }
  };
  // console.log("selectedVendor", selectedVendor)

  // console.log("orderData", order)

  return (
    <>
      {section === "choose-vendor" && (
        <>
          <div className="flex-1 space-y-4">
            <div className="flex items-center">
              {/* {resolve && (
                            <ArrowLeft className='cursor-pointer' onClick={() => setPage("Summary")} />
                        )} */}
              {/* {sr_data?.status === "Rejected" ? (
                            <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">Resolve</h2>
                        ) : (
                            <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">Choose Service Vendor </h2>
                        )} */}
            </div>
            <ProcurementHeaderCard orderData={sr_data} sr={true} />

            <div className="flex justify-between items-center">
              <div className="text-lg text-gray-400">
                Select vendor for this SR:
              </div>
              <Sheet>
                <SheetTrigger className="text-blue-500">
                  <div className="text-base text-blue-400 text-center">
                    <CirclePlus className="w-4 h-4 inline-block" />{" "}
                    <span>Add New Vendor</span>
                  </div>
                </SheetTrigger>
                <SheetContent className="overflow-auto">
                  <SheetHeader className="text-start">
                    <SheetTitle>
                      <div className="flex-1">
                        <span className="underline">Add Service Vendor</span>
                        <p className=" text-xs font-light text-slate-500 p-1">
                          Add a new service vendor here
                        </p>
                      </div>
                    </SheetTitle>
                    <NewVendor
                      renderCategorySelection={false}
                      navigation={false}
                      service={true}
                    />
                  </SheetHeader>
                </SheetContent>
              </Sheet>
            </div>
            <ReactSelect
              className="w-full"
              value={selectedVendor}
              options={vendorOptions}
              onChange={handleChange()}
              components={{
                SingleValue: CustomSingleValue,
                Option: CustomOption,
              }}
            />
            <div className="overflow-x-auto">
              <div className="min-w-full inline-block align-middle">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-red-100">
                      <TableHead className="w-[10%] text-red-700 font-extrabold">
                        Service
                      </TableHead>
                      <TableHead className="w-[50%]">Description</TableHead>
                      <TableHead className="w-[10%]">Unit</TableHead>
                      <TableHead className="w-[10%]">Quantity</TableHead>
                      <TableHead className="w-[20%]">Rate</TableHead>
                      <TableHead className="w-[10%]">Amount</TableHead>
                      <TableHead className="w-[10%]">Delete</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order?.map((item: any) => (
                      <TableRow key={item.id}>
                        <TableCell className="w-[10%] font-semibold">
                          {/* {item.category} */}
                          <Select
                            value={item.category}
                            onValueChange={(value) => handleInputChange(item.id, "category", value)}
                          >
                            <SelectTrigger >
                              <SelectValue className="text-gray-200" placeholder="Select Category" />
                            </SelectTrigger>
                            <SelectContent>
                              {category_data
                                ?.map((cat) => (
                                  <SelectItem value={cat?.name}>{cat?.name}</SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        {/* Description Field */}
                        <TableCell className="w-[50%] whitespace-pre-wrap">
                          <Textarea
                            value={item?.description || ""}
                            onChange={(e) =>
                              handleInputChange(
                                item.id,
                                "description",
                                e.target.value
                              )
                            }
                          />
                        </TableCell>

                        {/* UOM Field */}
                        <TableCell className="w-[10%]">
                          <Input
                            type="text"
                            value={item?.uom || ""}
                            onChange={(e) =>
                              handleInputChange(item.id, "uom", e.target.value)
                            }
                          />
                        </TableCell>

                        {/* Quantity Field */}
                        <TableCell className="w-[10%]">
                          <Input
                            type="number"
                            value={item?.quantity || ""}
                            onChange={(e) =>
                              handleInputChange(
                                item.id,
                                "quantity",
                                e.target.value
                              )
                            }
                          />
                        </TableCell>
                        <TableCell className="w-[20%]">
                          <Input
                            type="text"
                            value={
                              amounts[item.id] ? `₹ ${amounts[item.id]}` : "₹"
                            }
                            onChange={(e) =>
                              handleAmountChange(item.id, e.target.value)
                            }
                            disabled={!selectedVendor}
                          />
                        </TableCell>
                        <TableCell className="w-[10%] text-primary">
                          {formatToIndianRupee(
                            item?.quantity * (amounts[item.id] || 0)
                          )}
                        </TableCell>
                        <TableCell className="w-[10%]">
                          <Trash2 className="text-red-500 cursor-pointer" onClick={() => {
                            setOrder(prev => prev.filter(i => i.id !== item.id))
                            const updatedAmounts = { ...amounts }
                            delete updatedAmounts[item.id]
                            setAmounts(updatedAmounts)
                          }} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            <div className="flex justify-between items-center mt-4 pl-2">
              <Button onClick={() => setOrder(prev => [...prev, { id: uuidv4(), category: "", description: "", quantity: "", uom: "", rate: "" }])}>New Service</Button>
              <Button
                disabled={
                  !isNextEnabled ||
                  order?.some(
                    (i) =>
                      !parseFloat(i?.quantity) || !i?.uom || !i?.description || !i?.category
                  ) || order.length === 0
                }
                onClick={handleSaveAmounts}
              >
                Next
              </Button>
            </div>
            <div className="flex items-center space-y-2">
              <h2 className="text-base pt-1 pl-2 font-bold tracking-tight">
                SR Comments
              </h2>
            </div>
            <div className="border border-gray-200 rounded-lg p-4 flex flex-col gap-2">
              {universalComments?.length ? (
                universalComments?.map((comment) => (
                  <div
                    key={comment.name}
                    className="flex items-start space-x-4 bg-gray-50 p-4 rounded-lg"
                  >
                    <Avatar>
                      <AvatarImage
                        src={`https://api.dicebear.com/6.x/initials/svg?seed=${comment?.comment_by}`}
                      />
                      <AvatarFallback>{comment?.comment_by[0]}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <p className="font-medium text-sm text-gray-900">
                        {comment?.content}
                      </p>
                      <div className="flex justify-between items-center mt-2">
                        <p className="text-sm text-gray-500">
                          {comment.comment_by === "Administrator"
                            ? "Administrator"
                            : getFullName(comment?.comment_by)}
                        </p>
                        <p className="text-xs text-gray-400">
                          {formatDate(comment?.creation?.split(" ")[0])}{" "}
                          {comment.creation.split(" ")[1].substring(0, 5)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <span className="text-xs font-semibold">No Comments Found</span>
              )}
            </div>
          </div>
        </>
      )}
      {section == "summary" && (
        <>
          <div className="flex-1 space-y-4">
            <div className="flex items-center">
              <ArrowLeft
                className="cursor-pointer"
                onClick={() => setSection("choose-vendor")}
              />
              <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">
                Comparison
              </h2>
            </div>
            <ProcurementHeaderCard orderData={sr_data} sr={true} />
          </div>
          {/* <div className='pt-6 overflow-x-auto'>
                        <ConfigProvider
                            // theme={{
                            //     token: {
                            //         colorPrimary: '#FF2828',
                            //         borderRadius: 4,
                            //         colorBgContainer: '#FFFFFF',
                            //     },
                            // }}
                        >
                            <AntTable
                                dataSource={order}
                                columns={columns}
                            />
                        </ConfigProvider>
                    </div> */}

          <div className="mt-6 overflow-x-auto">
            <ConfigProvider>
              <AntTable
                dataSource={(
                  (groupedData && Object.keys(groupedData)) ||
                  []
                ).map((key) => ({
                  key,
                  category: key,
                  items: groupedData[key],
                }))}
                columns={columns}
                expandable={{
                  expandedRowKeys,
                  onExpandedRowsChange: setExpandedRowKeys,
                  expandedRowRender: (record) => (
                    <AntTable
                      dataSource={record.items}
                      columns={innerColumns}
                      pagination={false}
                      rowKey={(item) => item.id}
                    />
                  ),
                }}
              />
            </ConfigProvider>
          </div>
          <div className="flex flex-col justify-end items-end mr-2 mb-4 mt-4">
            <Dialog>
              <DialogTrigger asChild>
                <Button className="flex items-center gap-1">
                  {sr_data?.status === "Rejected" ? (
                    <Settings2 className="h-4 w-4" />
                  ) : (
                    <ArrowBigUpDash className="" />
                  )}
                  {sr_data?.status === "Rejected"
                    ? "Resolve"
                    : "Send for Approval"}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>Are you sure?</DialogTitle>
                  <DialogDescription>
                    Click on Confirm to{" "}
                    {sr_data?.status === "Rejected"
                      ? "resolve and send for approval"
                      : "Submit"}
                    !
                    <Textarea
                      className="mt-4"
                      placeholder={`Optional`}
                      onChange={(e: any) =>
                        setComment(
                          e.target.value === "" ? null : e.target.value
                        )
                      }
                      value={comment || ""}
                    />
                  </DialogDescription>
                </DialogHeader>
                <DialogDescription className="flex items-center justify-center gap-2">
                  <DialogClose>
                    <Button
                      variant="secondary"
                      className="flex items-center gap-1"
                    >
                      <Undo2 className="h-4 w-4" />
                      Cancel
                    </Button>
                  </DialogClose>
                  {sr_data?.status === "Rejected" ? (
                    <Button
                      variant="default"
                      className="flex items-center gap-1"
                      onClick={handleResolveSR}
                      disabled={create_loading || update_loading}
                    >
                      {create_loading || update_loading ? (
                        <TailSpin width={20} height={20} color="white" />
                      ) : (
                        <>
                          <CheckCheck className="h-4 w-4" />
                          Confirm
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      className="flex items-center gap-1"
                      onClick={handleSubmit}
                      disabled={create_loading || update_loading}
                    >
                      {create_loading || update_loading ? (
                        <TailSpin width={20} height={20} color="white" />
                      ) : (
                        <>
                          <CheckCheck className="h-4 w-4" />
                          Confirm
                        </>
                      )}
                    </Button>
                  )}
                </DialogDescription>
              </DialogContent>
            </Dialog>
          </div>
        </>
      )}
    </>
  );
};

export const Component = SelectServiceVendor;

const CustomSingleValue = ({ data }) => (
  <div>
    <strong>{data.vendor_name}</strong>{" "}
    <i>
      ({data.city}, {data.state})
    </i>
  </div>
);

const CustomOption = (props) => {
  const { data, innerRef, innerProps } = props;
  return (
    <div
      ref={innerRef}
      {...innerProps}
      style={{ padding: "5px", cursor: "pointer" }}
    >
      <strong className="text-primary">{data.vendor_name}</strong>{" "}
      <i>
        ({data.city}, {data.state})
      </i>
    </div>
  );
};