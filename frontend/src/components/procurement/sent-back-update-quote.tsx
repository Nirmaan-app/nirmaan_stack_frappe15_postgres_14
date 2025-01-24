import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  ArrowBigRightDash,
  ArrowLeft,
  CirclePlus,
  Download,
  Handshake,
  ListChecks,
  PencilLine,
  Trash,
} from "lucide-react";
import SentBackQuotationForm from "./sent-back-quotation-form";
import { useFrappeCreateDoc, useFrappeDeleteDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { useLocation, useParams } from "react-router-dom";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui/button";
import { NewVendor } from "@/pages/vendors/new-vendor";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ColumnDef } from "@tanstack/react-table";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { formatDate } from "@/utils/FormatDate";
import { Badge } from "../ui/badge";
import { AddVendorCategories } from "../forms/addvendorcategories";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { DataTable } from "../data-table/data-table";
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@/components/ui/hover-card";
import { useToast } from "../ui/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { PrintRFQ } from "./rfq-pdf";
import { ProcurementHeaderCard } from "../ui/ProcurementHeaderCard";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { TailSpin } from "react-loader-spinner";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";

export const SentBackUpdateQuote = () => {
  const { sbId: id } = useParams<{ sbId: string }>();
  const navigate = useNavigate();

  const {
    data: category_data,
    isLoading: category_loading,
    error: category_error,
  } = useFrappeGetDocList("Category", {
    fields: ["*"],
    limit: 1000,
  });

  const {
    data: vendor_list,
    isLoading: vendor_list_loading,
    error: vendor_list_error,
    mutate: vendor_list_mutate,
  } = useFrappeGetDocList(
    "Vendors",
    {
      fields: ["*"],
      filters: [["vendor_type", "=", "Material"]],
      limit: 1000,
    },
    "Material Vendors"
  );

  const {
    data: quotation_request_list,
    isLoading: quotation_request_list_loading,
    error: quotation_request_list_error,
    mutate: quotation_request_list_mutate,
  } = useFrappeGetDocList(
    "Quotation Requests",
    {
      fields: ["*"],
      limit: 10000,
    },
    "Quotation Requests"
  );

  const {
    data: sent_back_list,
    isLoading: sent_back_list_loading,
    error: sent_back_list_error,
  } = useFrappeGetDocList("Sent Back Category", {
    fields: ["*"],
    limit: 1000,
  });

  const [categoryOptions, setCategoryOptions] = useState<
    { label: string; value: string }[]
  >([]); // State for dynamic category options

  const getVendorName = (vendorName: string) => {
    return vendor_list?.find((vendor) => vendor.name === vendorName)
      ?.vendor_name;
  };

  const [uniqueVendors, setUniqueVendors] = useState({
    list: [],
  });
  const [orderData, setOrderData] = useState({
    project: "",
  });

  const [deleteVendor, setDeleteVendor] = useState(null);

  const [deleteDialog, setDeleteDialog] = useState(false);

  const toggleDeleteDialog = () => {
    setDeleteDialog((prevState) => !prevState);
  };

  const { createDoc } = useFrappeCreateDoc();

  const { deleteDoc, loading: delete_loading } = useFrappeDeleteDoc()

  useEffect(() => {
    sent_back_list?.map((item) => {
      if (item.name === id) {
        setOrderData(item);
      }
    });
  }, [sent_back_list]);

  useEffect(() => {
    if (category_data) {
      const currOptions = category_data.map((item) => ({
        value: item.name,
        label:
          item.name + "(" + item.work_package.slice(0, 4).toUpperCase() + ")",
      }));
      setCategoryOptions(currOptions);
    }
  }, [category_data]);

  // console.log("uniqueVendors", uniqueVendors)

  // console.log("orderData", orderData)

  useEffect(() => {
    if (orderData.project) {
      const vendors = uniqueVendors.list;
      // vendor_list?.map((item) => (item.vendor_category.categories)[0] === (orderData.category_list.list)[0].name && vendors.push(item.name))
      quotation_request_list?.map((item) => {
        const isPresent = orderData.category_list.list.find(
          (cat) => cat.name === item.category
        );
        const isSameItem = orderData.item_list.list.find(
          (i) => i.name === item.item
        );
        if (
          orderData.procurement_request === item.procurement_task &&
          isPresent &&
          isSameItem
        ) {
          const value = item.vendor;
          vendors.push(value);
        }
      });
      const removeDuplicates = (array) => {
        return Array.from(new Set(array));
      };
      const uniqueList = removeDuplicates(vendors);
      setUniqueVendors({
        list: uniqueList,
      });
    }
  }, [quotation_request_list, orderData, vendor_list]);

  const handleUpdateQuote = () => {
    // if (location.pathname.includes("cancelled-sb")) {
    //   navigate(`/cancelled-sb/${id}/update-quote/choose-vendor`);
    // } else if (location.pathname.includes("rejected-sb")) {
    //   navigate(`/rejected-sb/${id}/update-quote/choose-vendor`);
    // } else {
    //   navigate(`/delayed-sb/${id}/update-quote/choose-vendor`);
    // }
    navigate("choose-vendor")
  };

  const isButtonDisabled = useCallback(
    (vencat) => {
      const orderCategories = orderData?.category_list?.list || [];
      return !orderCategories.every((category) =>
        vencat.includes(category.name)
      );
    },
    [orderData, vendor_list]
  );

  const { toast } = useToast();

  const handleAddVendor = async (vendor_name) => {
    const vendorId = vendor_list?.find(
      (ven) => ven.vendor_name === vendor_name
    ).name;
    try {
      const promises = [];
      orderData?.item_list?.list.forEach((item) => {
        const newItem = {
          procurement_task: orderData.procurement_request,
          category: item.category,
          item: item.name,
          vendor: vendorId,
          quantity: item.quantity,
        };
        promises.push(createDoc("Quotation Requests", newItem));
      });

      await Promise.all(promises);

      // Mutate the vendor-related data
      // await mutate("Vendors");
      // await mutate("Quotation Requests");
      // await mutate("Vendor Category");
      vendor_list_mutate();
      quotation_request_list_mutate();

      toast({
        title: "Success!",
        description: `Vendor: ${vendor_name} Added Successfully!`,
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Failed!",
        description: `${error?.message}`,
        variant: "destructive",
      });
      console.error(
        "There was an error while adding the vendor in sent-back-update-quote",
        error
      );
    }
  };

  const getVendorAddr = (name) => {
    if (vendor_list) {
      const vendor = vendor_list?.find((ven) => ven?.vendor_name === name);
      return { city: vendor?.vendor_city, state: vendor?.vendor_state };
    }
  };
  // console.log("orderData", orderData)
  const columns: ColumnDef<ProjectsType>[] = useMemo(
    () => [
      {
        accessorKey: "vendor_name",
        header: ({ column }) => {
          return <DataTableColumnHeader column={column} title="Vendor Name" />;
        },
        cell: ({ row }) => {
          const vendor_name = row.getValue("vendor_name");
          const vendorCategories =
            row.getValue("vendor_category")?.categories || [];
          return (
            <>
              {!isButtonDisabled(vendorCategories) && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant={"outline"}
                      className="font-light max-md:text-xs border-green-500 py-6 flex flex-col items-start"
                    >
                      <div className="w-[300px] text-wrap flex flex-col">
                        <span className="text-red-500 font-semibold">
                          {vendor_name}
                        </span>
                        <span>Add to Sent Back</span>
                      </div>
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Add Vendor to the current Sent Back
                      </AlertDialogTitle>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleAddVendor(vendor_name)}
                        >
                          Add
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogHeader>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              {isButtonDisabled(vendorCategories) && (
                <HoverCard>
                  <HoverCardTrigger>
                    <Button
                      disabled={isButtonDisabled(vendorCategories)}
                      variant={"outline"}
                      className="font-light max-md:text-xs border-green-500 py-6 flex flex-col items-start"
                    >
                      <div className="w-[300px] text-wrap flex flex-col">
                        <span className="text-red-500 font-semibold">
                          {row.getValue("vendor_name")}
                        </span>{" "}
                        <span>Add to Sent Back</span>
                      </div>
                    </Button>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-80 bg-gray-800 text-white p-2 rounded-md shadow-lg">
                    <div>
                      Please add{" "}
                      <span className="font-semibold underline">
                        All Associated Categories of Current Sent Back
                      </span>{" "}
                      to this vendor to enable
                    </div>
                  </HoverCardContent>
                </HoverCard>
              )}
            </>
          );
        },
      },

      {
        accessorKey: "creation",
        header: ({ column }) => {
          return <DataTableColumnHeader column={column} title="Date Created" />;
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium">
              {formatDate(row.getValue("creation")?.split(" ")[0])}
            </div>
          );
        },
      },
      {
        accessorKey: "vendor_category",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader column={column} title="Vendor Categories" />
          );
        },
        cell: ({ row }) => {
          const categories = row.getValue("vendor_category");
          const vendor_name = row.getValue("vendor_name");
          return (
            <div className="space-x-1 space-y-1">
              {categories?.categories.map((cat) => (
                <Badge key={cat}>{cat}</Badge>
              ))}
              <Sheet>
                <SheetTrigger>
                  <button className="px-2 border flex gap-1 items-center rounded-md hover:bg-gray-200">
                    <CirclePlus className="w-3 h-3" />
                    <span>Add categories</span>
                  </button>
                </SheetTrigger>
                <SheetContent className="overflow-auto">
                  <AddVendorCategories
                    vendor_name={vendor_name}
                    isSheet={true}
                  />
                </SheetContent>
              </Sheet>
            </div>
          );
        },
        // Implement filtering for the categories
        filterFn: (row, _columnId, filterValue: string[]) => {
          const categories =
            row.getValue<string[]>("vendor_category")["categories"] || [];
          return filterValue.every((filter) => categories.includes(filter));
        },
      },
      {
        id: "vendor_address",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Address" />
        ),
        cell: ({ row }) => {
          const id = row.getValue("vendor_name");
          const address = getVendorAddr(id);
          return (
            <div>
              <span>{address?.city}, </span>
              <span>{address?.state}</span>
            </div>
          );
        },
      },
    ],
    [orderData, isButtonDisabled, vendor_list, uniqueVendors]
  );

  const handleDeleteVendor = async () => {
    try {

      const filteredVendorQuotes = quotation_request_list?.filter(i => i?.vendor === deleteVendor && i?.procurement_task === orderData?.procurement_request)

      filteredVendorQuotes?.forEach(async (item) => {
        await deleteDoc("Quotation Requests", item.name);
      })

      const filteredVendors = uniqueVendors?.list?.filter(i => i !== deleteVendor)

      setUniqueVendors({
        list: filteredVendors
      })

      await quotation_request_list_mutate()

      toast({
        title: "Success!",
        description: `Vendor: ${deleteVendor} deleted successfully!`,
        variant: "success",
      });

      toggleDeleteDialog()
      
    } catch (error) {
      console.log("error while deleting vendor", error);
      toast({
        title: "Failed!",
        description: `${error?.message}`,
        variant: "destructive",
      });
    }
  }

  // console.log("universalComments", universalComments)

  // console.log("orderData", orderData)

  const filteredVendorList = vendor_list?.filter(
    (ven) => !uniqueVendors?.list?.includes(ven.name)
  );

  if (
    quotation_request_list_loading ||
    sent_back_list_loading ||
    category_loading ||
    vendor_list_loading
  )
    return (
      <div className="flex items-center h-[90vh] w-full justify-center">
        <TailSpin color={"red"} />{" "}
      </div>
    );

  return (
    <>
      <div className="flex-1 space-y-4">
        {/* <div className="flex items-center">
                        <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} />
                        <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">Add Vendors/Update Quote</h2>
                    </div> */}
        <ProcurementHeaderCard orderData={orderData} sentBack />
        <div className="flex justify-between">
          <div className="p-2 sm:pl-7 font-light underline text-red-700">
            Selected Vendor List
          </div>
          <div className="p-2 sm:pl-7 font-light underline text-red-700 pr-10 sm:pr-32">
            Options
          </div>
        </div>
        {uniqueVendors.list.map((item) => {
          return (
            <div key={item} className="sm:px-4 max-sm:py-2 flex justify-between items-center max-sm:border-b">
              <div className="sm:pl-4 pl-2 py-4">
                <strong>{getVendorName(item)}</strong>
                {uniqueVendors?.list?.length > 1 && (
                  <Dialog open={deleteDialog} onOpenChange={toggleDeleteDialog}>
                    <DialogTrigger onClick={() => setDeleteVendor(item)}>
                      <Trash className="h-4 w-4 ml-2 fill-primary text-primary inline cursor-pointer" />
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Are you sure?</DialogTitle>
                      </DialogHeader>
                        <DialogDescription>Click on Confirm to delete vendor: <strong>{getVendorName(deleteVendor)}</strong> from this SB!</DialogDescription>
                        <div className="flex items-center justify-end gap-2">
                          {delete_loading ? <TailSpin color="red" height={40} width={40} /> : (
                            <>
                            <DialogClose asChild>
                              <Button variant={"outline"}>Cancel</Button>
                            </DialogClose>
                            <Button onClick={handleDeleteVendor}>
                              Confirm
                            </Button>
                            </>
                          )}
                          </div>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
              <div className="flex space-x-2 max-sm:flex-col items-center justify-center max-sm:gap-2">
                <Sheet>
                  <SheetTrigger className="border-2 border-opacity-50 border-red-500 text-red-500 bg-white font-normal px-4 my-2 rounded-lg">
                    <div className="flex">
                      <Download className="h-5 w-5 mt-0.5 mr-1" />
                      RFQ PDF
                    </div>
                  </SheetTrigger>
                  <SheetContent className="overflow-auto">
                    {/* <ScrollArea className="h-[90%] w-[600px] rounded-md border p-4"> */}
                    <SheetHeader>
                      <SheetTitle className="text-center">Print PDF</SheetTitle>
                      <SheetDescription>
                        <PrintRFQ
                          vendor_id={item}
                          pr_id={orderData?.procurement_request}
                          itemList={orderData?.item_list || []}
                        />
                      </SheetDescription>
                    </SheetHeader>
                    {/* </ScrollArea> */}
                  </SheetContent>
                </Sheet>
                <Sheet>
                  <SheetTrigger className="border-2 border-opacity-50 border-red-500 text-red-500 bg-white font-normal px-4 my-2 rounded-lg">
                    Enter Price(s)
                  </SheetTrigger>
                  <SheetContent className="overflow-auto">
                    {/* <ScrollArea className="h-[90%] w-[600px] rounded-md border p-4"> */}
                    <SheetHeader className="text-start">
                      <div className="flex items-center gap-1">
                        <SheetTitle className="text-xl">
                          Enter Price(s)
                        </SheetTitle>
                        <PencilLine className="w-5 h-5 text-primary" />
                      </div>
                      <SheetDescription className="py-2">
                        {/* <Card className="p-5"> */}
                        <SentBackQuotationForm
                          vendor_id={item}
                          pr_id={orderData.procurement_request}
                          sb_id={id}
                        />
                        {/* </Card> */}
                      </SheetDescription>
                    </SheetHeader>
                    {/* </ScrollArea> */}
                  </SheetContent>
                </Sheet>
              </div>
            </div>
          );
        })}
        <div className="flex items-center justify-between mt-6">
          <Sheet>
            <SheetTrigger className="text-blue-500">
              <div className="flex items-center gap-1 ml-4">
                <CirclePlus className="w-4 h-4" />
                Add New Vendor
              </div>
            </SheetTrigger>
            <SheetContent className="overflow-auto">
              <SheetHeader className="text-start">
                <SheetTitle>Add New Vendor for "{orderData.name}"</SheetTitle>
                <SheetDescription>
                  <div className="flex-1">
                    <span className=" text-slim text-sm text-red-700">
                      Note:
                    </span>
                    <p className="text-xs">
                      {" "}
                      - This will add a new vendor entry within the system. Only
                      add new vendors here.
                    </p>
                    <p className="text-xs">
                      {" "}
                      - This form will automatically add vendors categories from
                      this PR/SB to the vendor.
                    </p>
                  </div>
                  {/* <SentBackVendorForm quotation_request_list_mutate={quotation_request_list_mutate} sent_back_data={orderData} vendor_list_mutate={vendor_list_mutate} /> */}
                  <NewVendor
                    dynamicCategories={
                      orderData?.category_list?.list?.map(
                        (item) => item.name
                      ) || []
                    }
                    sentBackData={orderData}
                    renderCategorySelection={false}
                    navigation={false}
                  />
                </SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>
          <Button
            className="flex items-center gap-1"
            onClick={handleUpdateQuote}
          >
            <ListChecks className="h-4 w-4" />
            Update Quote
          </Button>
        </div>
        <Accordion type="multiple">
          <AccordionItem value="Vendors">
            <AccordionTrigger>
              <Button
                variant="ghost"
                size="lg"
                className="md:mb-2 text-base md:text-lg px-2  w-full justify-start"
              >
                <span className=" text-base mb-0.5 md:text-lg font-slim">
                  Add Existing Vendors
                </span>
              </Button>
            </AccordionTrigger>
            <AccordionContent>
              <Card className="max-md:p-0">
                <CardHeader className="max-md:p-0">
                  <div className="pl-6 flex gap-1 items-center pt-10 max-md:pt-6 flex-wrap">
                    <span className="font-light max-md:text-sm">
                      Sent Back Categories:{" "}
                    </span>
                    {orderData?.category_list?.list.map((cat) => (
                      <Badge>{cat.name}</Badge>
                    ))}
                  </div>
                  <CardContent>
                    <DataTable
                      columns={columns}
                      data={filteredVendorList || []}
                      category_options={categoryOptions}
                    />
                  </CardContent>
                </CardHeader>
              </Card>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </>
  );
};
