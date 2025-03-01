import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import {
  Sheet,
  SheetContent,
  SheetTrigger
} from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { formatDate } from '@/utils/FormatDate';
import formatToIndianRupee from "@/utils/FormatPrice";
import { ColumnDef } from "@tanstack/react-table";
import { useFrappeCreateDoc, useFrappeGetDocList, useFrappeUpdateDoc, useSWRConfig } from "frappe-react-sdk";
import { ArrowBigRightDash, CirclePlus, MessageCircleMore } from 'lucide-react';
import { useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate, useParams } from "react-router-dom";
import { AddVendorCategories } from "../forms/addvendorcategories";
import { ProcurementHeaderCard } from "../ui/ProcurementHeaderCard";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../ui/hover-card";
import { toast } from "../ui/use-toast";

export const ProcurementOrder = () => {

  const { prId: orderId } = useParams<{ prId: string }>()
  const navigate = useNavigate();
  const { mutate } = useSWRConfig()

  const [categoryOptions, setCategoryOptions] = useState<{ label: string; value: string }[]>([]); // State for dynamic category options

  // const [page, setPage] = useState<string>('approve')

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
  const [categories, setCategories] = useState({})
  const [selectedCategories, setSelectedCategories] = useState(null)

  const [comments, setComments] = useState([])

  const { data: category_data } = useFrappeGetDocList("Category", {
    fields: ["*"],
    filters: [["work_package", "!=", "Services"]],
    limit: 10000
  })

  const { data: procurement_request_list, isLoading: procurement_request_list_loading, mutate: prMutate } = useFrappeGetDocList("Procurement Requests",
    {
      fields: ["*"],
      filters: [["name", "=", orderId]],
      limit: 1000
    },
    `Procurement Requests ${orderId}`
  );
  const { data: vendor_category_list, isLoading: vendor_category_list_loading } = useFrappeGetDocList("Vendor Category",
    {
      fields: ["*"],
      filters: [["category", "in", orderData?.category_list?.list?.map(i => i?.name)]],
      limit: 100000
    },
    orderData?.project ? "Vendor Category" : null
  );

  console.log("procurement_request_list", procurement_request_list)

  const {
    data: vendor_list,
    isLoading: vendor_list_loading,
  } = useFrappeGetDocList(
    "Vendors",
    {
      fields: ["*"],
      filters: [["vendor_type", "in", ["Material", "Material & Service"]]],
      limit: 10000,
    },
    "Material Vendors"
  );

  const { data: quote_data } = useFrappeGetDocList("Approved Quotations",
    {
      fields: ["*"],
      limit: 10000
    },
    `Quotation Requests`
  );

  const { data: universalComments } = useFrappeGetDocList("Nirmaan Comments", {
    fields: ["*"],
    filters: [["reference_name", "=", orderId]],
    orderBy: { field: "creation", order: "desc" },
    limit: 1000,
  }
  )

  const { data: usersList } = useFrappeGetDocList("Nirmaan Users", {
    fields: ["*"],
    limit: 1000,
    // filters: [["role_profile", "=", "Nirmaan Project Lead Profile"]]
  })

  const getFullName = (id) => {
    return usersList?.find((user) => user?.name == id)?.full_name
  }

  // console.log("universalcomments", universalComments)

  const { createDoc: createDoc, loading: loading, error: submit_error } = useFrappeCreateDoc()
  const { updateDoc: updateDoc, loading: update_loading } = useFrappeUpdateDoc()


  useEffect(() => {
    if (procurement_request_list) {
      setOrderData(procurement_request_list[0])
    }
  }, [procurement_request_list])

  useEffect(() => {
    if (universalComments) {
      const comments = universalComments?.filter((cmt) => ["approving pr", "creating pr"].includes(cmt.subject))
      setComments(comments)
    }
  }, [universalComments])


  const { data: category_list, isLoading: category_list_loading } = useFrappeGetDocList("Category",
    {
      fields: ['category_name', 'work_package'],
      orderBy: { field: 'category_name', order: 'asc' },
      limit: 100,
      filters: [['work_package', '=', orderData.work_package]]
    });

  // Extract unique categories from the data dynamically
  useEffect(() => {
    if (category_data) {
      const currOptions = category_data.map((item) => ({
        value: item.name,
        label: item.name + "(" + item.work_package.slice(0, 4).toUpperCase() + ")"
      }))
      setCategoryOptions(currOptions);
    }
  }, [category_data]);

  const getVendorAddr = (name) => {
    if (vendor_list) {
      const vendor = vendor_list?.find((ven) => ven?.vendor_name === name)
      return { city: vendor?.vendor_city, state: vendor?.vendor_state }
    }
  }

  const columns: ColumnDef<ProjectsType>[] = useMemo(
    () => [
      {
        accessorKey: "vendor_name",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader column={column} title="Vendor Name" />
          )
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium">
              {row.getValue("vendor_name")}
            </div>
          )
        }
      },
      {
        accessorKey: "creation",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader column={column} title="Date Created" />
          )
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium">
              {formatDate(row.getValue("creation")?.split(" ")[0])}
            </div>
          )
        }
      },
      {
        accessorKey: "vendor_category",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader column={column} title="Vendor Categories" />
          )
        },
        cell: ({ row }) => {
          const categories = row.getValue("vendor_category")
          return (
            <div className="space-x-1 space-y-1">
              {categories?.categories.map((cat) => (
                <Badge key={cat} >{cat}</Badge>
              ))}
              <Sheet>
                <SheetTrigger>
                  <button className="px-2 border flex gap-1 items-center rounded-md hover:bg-gray-200">
                    <CirclePlus className="w-3 h-3" />
                    <span>Add Category</span>
                  </button>
                </SheetTrigger>
                <SheetContent>
                  <AddVendorCategories vendor_id={row.original.name} isSheet={true} />
                </SheetContent>
              </Sheet>
            </div>
          )
        },
        // Implement filtering for the categories
        filterFn: (row, _columnId, filterValue: string[]) => {
          const categories = row.getValue<string[]>("vendor_category")['categories'] || [];
          return filterValue.every((filter) => categories.includes(filter));
        },
      },
      {
        id: "vendor_address",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Address" />,
        cell: ({ row }) => {
          const id = row.getValue("vendor_name")
          const address = getVendorAddr(id)
          return (
            <div>
              <span>{address?.city}, </span>
              <span>{address?.state}</span>
            </div>
          )
        }
      }
    ],
    [vendor_list]
  )

  useEffect(() => {
    if (vendor_category_list && vendor_list) {
      const updatedCategories = {};

      vendor_category_list?.forEach((item) => {
        const fieldName = `${item.category}`;
        if (!Array.isArray(updatedCategories[fieldName])) {
          updatedCategories[fieldName] = [];
        }
        const exists = updatedCategories[fieldName].some(
          (entry) => entry?.value === item.vendor
        );
        if (!exists) {
          const venAddr = getVendorAddr(item.vendor_name)
          updatedCategories[fieldName].push({
            value: item.vendor,
            label: item.vendor_name + ` (${venAddr?.city}, ${venAddr?.state})`,
            vendor_name: item.vendor_name,
            city: venAddr?.city,
            state: venAddr?.state,
          });
        }
      });

      setCategories(updatedCategories);
    }
  }, [vendor_category_list, vendor_list]);

  const handleChange = (category) => (selectedOptions) => {
    const updatedCategories = { ...selectedCategories };
    const newVendors = [];
    selectedOptions?.map((item) => {
      if (!Array.isArray(updatedCategories[category])) {
        updatedCategories[category] = [];
      }
      newVendors.push(item.value)
    })
    updatedCategories[category] = newVendors
    setSelectedCategories(updatedCategories);
  }
  const getCategoryByName = (name) => {
    const fieldName = `${name}`;
    return categories[fieldName];
  };

  const handleSubmit = async () => {
    if (Object.keys(selectedCategories).length != orderData.category_list.list.length) return

    const promises = [];

    orderData.procurement_list.list.forEach((item) => {
      const curCategory = item.category;
      const makes = orderData?.category_list?.list?.find(i => i?.name === curCategory)?.makes?.map(j => ({ make: j, enabled: "false" })) || [];

      selectedCategories[curCategory].forEach((cat) => {
        const new_procurement_list = procurement_request_list?.find(value => value.name === orderId).procurement_list;
        const new_quantity = new_procurement_list?.list.find(value => value.name === item.name).quantity;

        const quotation_request = {
          procurement_task: orderId,
          category: item.category,
          item: item.name,
          vendor: cat,
          quantity: new_quantity,
          makes: { list: makes || [] }
        };

        promises.push(
          createDoc('Quotation Requests', quotation_request)
            .then(() => {
              console.log(quotation_request);
            })
            .catch(() => {
              console.log(submit_error);
            })
        );
      });
    });

    try {
      await Promise.all(promises);
      await updateDoc('Procurement Requests', orderId, {
        workflow_state: "RFQ Generated",
      })
      await mutate("Procurement Requests PRList")
      await mutate(`Procurement Requests ${orderId}`)

      setOrderData({
        project: '',
        work_package: '',
        procurement_list: {
          list: []
        },
        category_list: {
          list: []
        }
      })

      navigate(`/procurement-requests/${orderId}?tab=Update Quote`);

    } catch (error) {
      console.error("Error in creating documents:", error);
    }
  };

  const handleStartProcuring = async () => {
    try {

      await updateDoc("Procurement Requests", orderId, {
        workflow_state: "In Progress"
      })

      await prMutate()

      navigate(`/procurement-requests/${orderId}?tab=In Progress`);
      
    } catch (error) {
      console.error("Error while updating the status of PR:", error);
      toast({
        title: "Failed!",
        description: "Failed to update the status of the Procurement Request.",
        variant: "destructive"
      });
    }
  }

  if (vendor_category_list_loading || vendor_list_loading || procurement_request_list_loading || category_list_loading) return <div className="flex items-center h-[90vh] w-full justify-center"><TailSpin color={"red"} /> </div>

  if (orderData?.workflow_state !== "Approved") {
    return (
      <div className="flex items-center justify-center h-[90vh]">
        <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center space-y-4">
          <h2 className="text-2xl font-semibold text-gray-800">
            Heads Up!
          </h2>
          <p className="text-gray-600 text-lg">
            Hey there, the PR:{" "}
            <span className="font-medium text-gray-900">{orderData?.name}</span>{" "}
            is no longer available in the{" "}
            <span className="italic">Approved</span> state. The current state is{" "}
            <span className="font-semibold text-blue-600">
              {orderData?.workflow_state}
            </span>{" "}
            And the last modification was done by <span className="font-medium text-gray-900">
              {orderData?.modified_by === "Administrator" ? orderData?.modified_by : getFullName(orderData?.modified_by)}
            </span>
            !
          </p>
          <button
            className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors duration-300"
            onClick={() => navigate("/procurement-requests")}
          >
            Go Back to PR List
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
        <div className="flex-1 space-y-4">
          <div className="flex items-center">
            <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">Summary</h2>
          </div>
          <ProcurementHeaderCard orderData={orderData} />
          <div className="overflow-x-auto space-y-4 rounded-md border shadow-sm p-4">
              {orderData?.category_list.list.map((cat: any) => {
                return <div className="min-w-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-red-100">
                        <TableHead className="w-[50%]">
                          <span className="font-extrabold text-red-700">{cat.name}</span>
                          <div className="text-xs font-bold text-gray-500">
                            {cat?.makes?.length > 0 ? (
                              cat?.makes?.map((i, index, arr) => (
                                <i>{i}{index < arr.length - 1 && ", "}</i>
                              ))
                            ) : "--"}
                          </div>
                        </TableHead>
                        <TableHead className="w-[20%] text-red-700">UOM</TableHead>
                        <TableHead className="w-[10%] text-red-700">Qty</TableHead>
                        <TableHead className="w-[10%] text-red-700">Est. Amt</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderData?.procurement_list.list.map((item: any) => {
                        if (item.category === cat.name) {
                          const quotesForItem = quote_data
                            ?.filter(value => value.item_id === item.name && ![null, "0", 0, undefined].includes(value.quote))
                            ?.map(value => value.quote);
                          let minQuote;
                          if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
                          return (
                            <TableRow key={item.item}>
                              <TableCell>
                                <div className="inline items-baseline">
                                  <span>{item.item}</span>
                                  {item.comment && (
                                    <HoverCard>
                                      <HoverCardTrigger><MessageCircleMore className="text-blue-400 w-6 h-6 inline-block ml-1" /></HoverCardTrigger>
                                      <HoverCardContent className="max-w-[300px] bg-gray-800 text-white p-2 rounded-md shadow-lg">
                                        <div className="relative pb-4">
                                          <span className="block">{item.comment}</span>
                                          <span className="text-xs absolute right-0 italic text-gray-200">-Comment by PL</span>
                                        </div>

                                      </HoverCardContent>
                                    </HoverCard>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>{item.unit}</TableCell>
                              <TableCell>{item.quantity}</TableCell>
                              <TableCell>{minQuote ? formatToIndianRupee(minQuote * item.quantity) : "N/A"}</TableCell>
                            </TableRow>
                          )
                        }
                      })}
                    </TableBody>
                  </Table>
                </div>
              })}
          </div>

          <div className="flex items-center space-y-2">
            <h2 className="text-base pl-2 font-bold tracking-tight">PR Comments</h2>
          </div>
          <div className="border border-gray-200 rounded-lg p-4 flex flex-col gap-2">
            {comments?.length !== 0 ? (
              comments?.map((comment) => (
                <div key={comment?.name} className="flex items-start space-x-4 bg-gray-50 p-4 rounded-lg">
                  <Avatar>
                    <AvatarImage src={`https://api.dicebear.com/6.x/initials/svg?seed=${comment?.comment_by}`} />
                    <AvatarFallback>{comment?.comment_by[0]}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className="font-medium text-sm text-gray-900">{comment?.content}</p>
                    <div className="flex justify-between items-center mt-2">
                      <p className="text-sm text-gray-500">
                        {comment?.comment_by === "Administrator" ? "Administrator" : getFullName(comment?.comment_by)}
                      </p>
                      <p className="text-xs text-gray-400">
                        {formatDate(comment?.creation?.split(" ")[0])} {comment?.creation?.split(" ")[1].substring(0, 5)}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <span className="text-xs font-semibold">No Comments Found</span>
            )
            }
          </div>
          <div className="flex flex-col justify-end items-end">
            {update_loading ? <TailSpin color="red" height={30} width={30} /> : (
              <Button onClick={handleStartProcuring} className="flex items-center gap-1">
                Start Procuring
                <ArrowBigRightDash className="max-md:h-4 max-md:w-4" />
              </Button>
            )}
          </div>
        </div>
      {/* {page == 'vendors' &&
        <div className="flex-1 space-y-4">
          <div className="flex items-center">
            <ArrowLeft onClick={() => setPage("approve")} className="cursor-pointer" />
            <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">Select Vendors</h2>
          </div>
          <ProcurementHeaderCard orderData={orderData} />
          {orderData?.category_list?.list.map((cat) => {
            return <div>
              <div className="flex m-2 justify-between">
                <div>
                  <HoverCard>
                    <HoverCardTrigger>
                      <div className="text-xl font-bold py-2 text-red-700 underline">{cat.name}</div>
                    </HoverCardTrigger>
                    <HoverCardContent className="bg-white p-4 rounded-lg shadow-lg w-[400px]">
                      <h3 className="text-lg font-semibold mb-2">Items</h3>
                      <ul className="bg-gray-50 space-y-2 list-disc rounded-md">
                        {orderData?.procurement_list?.list
                          ?.filter(item => item.category === cat.name)
                          .map((item) => (
                            <li key={item.name} className="p-1 ml-6">
                              <span className="text-gray-800">{item.item}<span className="text-red-600 ml-2">({item.quantity} {item.unit})</span></span>
                            </li>
                          ))}
                      </ul>
                    </HoverCardContent>
                  </HoverCard>
                  <strong className="text-sm">Approved Makes:</strong>
                  <div className="text-xs font-bold text-gray-500 inline ml-2">
                    {cat?.makes?.length > 0 ? (
                      cat?.makes?.map((i, index, arr) => (
                        <i>{i}{index < arr.length - 1 && ", "}</i>
                      ))
                    ) : "--"}
                  </div>
                </div>
                <Sheet>
                  <SheetTrigger className="text-blue-500">
                    <div className="text-base text-blue-400">
                      <span className="max-sm:hidden">Add</span> Vendor<CirclePlus className="w-4 h-4 inline-block mb-1 ml-1" />
                    </div>
                  </SheetTrigger>
                  <SheetContent className='overflow-auto'>
                    <SheetHeader className="text-start">
                      <SheetTitle>
                        <div className="flex-1">
                          <span className="underline">Add Vendor for <span className="text-red-700">{cat.name}</span></span>
                          <p className=" text-xs font-light text-slate-500 p-1">Add a new vendor here with at least <span className="text-red-700 italic">{cat.name}</span> added as category</p>
                          <p className=" text-xs font-light text-slate-500 p-1"><span className="text-red-700 font-bold">NOTE: </span>Check if the vendor is already available! If yes, then click on cross at top right, scroll down to add <span className="text-red-700 italic">{cat.name}</span> to that vendor.</p>

                        </div>
                      </SheetTitle>
                      <NewVendor dynamicCategories={category_list || []} renderCategorySelection={true} navigation={false} />
                    </SheetHeader>
                  </SheetContent>
                </Sheet>
              </div>
              {(vendor_category_list && vendor_list) && (
                <Select options={getCategoryByName(cat.name)} onChange={handleChange(cat.name)}
                  isMulti
                  components={{
                    SingleValue: CustomSingleValue,
                    Option: CustomOption,
                  }}
                />
              )}
            </div>
          })}
          <div className="flex flex-col justify-end items-end max-md:py-6 pb-10">
            {(loading || update_loading) ? <ButtonLoading /> : (
              <Button disabled={selectedCategories === null || (selectedCategories && Object.values(selectedCategories).some((arr) => !arr.length)) || (selectedCategories && Object.keys(selectedCategories)?.length !== orderData?.category_list?.list?.length)} onClick={handleSubmit} className="flex items-center gap-1">
                <ListChecks className="h-4 w-4" />
                Send RFQ</Button>
            )}
          </div>
          <Accordion type="multiple" defaultValue={["Vendors"]}>
            <AccordionItem value="Vendors">
              <AccordionTrigger>
                <div className="md:mb-2 text-base md:text-lg px-2  w-full text-left">
                  <div className="flex-1">
                    <span className=" text-base mb-0.5 md:text-lg font-slim">Recently Added Vendors</span>
                    <div className="text-sm text-gray-400">Check if you have added a vendor previously and want to update their <span className="text-red-700 italic">category</span> </div>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <Card>
                  <CardHeader className="max-md:p-0">
                    <CardContent>
                      <DataTable columns={columns} data={vendor_list || []} category_options={categoryOptions} />
                    </CardContent>
                  </CardHeader>
                </Card>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>} */}
    </>
  )
}

const CustomSingleValue = ({ data }) => (
  <div>
    <strong>{data.vendor_name}</strong> <i>({data.city}, {data.state})</i>
  </div>
);

const CustomOption = (props) => {
  const { data, innerRef, innerProps } = props;
  return (
    <div ref={innerRef} {...innerProps} style={{ padding: "5px", cursor: "pointer" }}>
      <strong className="text-primary">{data.vendor_name}</strong> <i>({data.city}, {data.state})</i>
    </div>
  );
};