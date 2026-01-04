/**
 * @deprecated RETIRED COMPONENT - January 2026
 *
 * This component has been retired and is no longer in use.
 * Reason: No active route or import - dead code
 *
 * Depended on:
 * - PrintRFQ from rfq-pdf.tsx (also retired)
 *
 * If you need vendor quote update functionality, use:
 * - src/pages/ProcurementRequests/VendorQuotesSelection/
 */

/*
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet";
import { NewVendor } from "@/pages/vendors/new-vendor";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { formatDate } from "@/utils/FormatDate";
import { ColumnDef } from "@tanstack/react-table";
import {
    useFrappeCreateDoc,
    useFrappeDeleteDoc,
    useFrappeGetDocList,
    useFrappeUpdateDoc,
    useSWRConfig,
} from "frappe-react-sdk";
import {
    CirclePlus,
    Download,
    ListChecks,
    PencilLine,
    Trash,
    Undo2
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate, useParams } from "react-router-dom";
import { DataTable } from "../data-table/data-table";
import { AddVendorCategories } from "../forms/addvendorcategories";
import { ProcurementHeaderCard } from "../helpers/ProcurementHeaderCard";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "../ui/accordion";
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
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader } from "../ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";
import { useToast } from "../ui/use-toast";
import QuotationForm from "./quotation-form";
import { PrintRFQ } from "./rfq-pdf";

export const UpdateQuote = () => {
  const { prId: orderId } = useParams<{ prId: string }>();
  const navigate = useNavigate();

  const {
    data: vendor_list,
    isLoading: vendor_list_loading,
    mutate: vendor_list_mutate,
  } = useFrappeGetDocList(
    "Vendors",
    {
      fields: ["*"],
      filters: [["vendor_type", "in", ["Material", "Material & Service"]]],
      limit: 10000,
    },
    "Material Vendors"
  );

  const {
    data: procurement_request_list,
    isLoading: procurement_request_list_loading,
  } = useFrappeGetDocList("Procurement Requests", {
    fields: ["*"],
    limit: 100000,
  });
  const {
    data: quotation_request_list,
    isLoading: quotation_request_list_loading,
    mutate: quotation_request_list_mutate,
  } = useFrappeGetDocList(
    "Quotation Requests",
    {
      fields: ["*"],
      filters: [["procurement_task", "=", orderId]],
      limit: 1000,
    },
    `Quotations Requests,Procurement_task=${orderId}`
  );

  // console.log("quotations requests", quotation_request_list)

  const {
    data: category_data,
    isLoading: category_loading,
  } = useFrappeGetDocList("Category", {
    fields: ["*"],
    filters: [["work_package", "!=", "Services"]],
    limit: 10000,
  });

  const { updateDoc: updateDoc, error: update_error } = useFrappeUpdateDoc();
  const { createDoc } = useFrappeCreateDoc();

  const { deleteDoc, loading: delete_loading } = useFrappeDeleteDoc()

  const getVendorName = (vendorName: string) => {
    return vendor_list?.find((vendor) => vendor.name === vendorName)
      ?.vendor_name;
  };
  const [categoryOptions, setCategoryOptions] = useState<
    { label: string; value: string }[]
  >([]);

  const [uniqueVendors, setUniqueVendors] = useState({
    list: [],
  });

  const [deleteVendor, setDeleteVendor] = useState(null);

  const [deleteDialog, setDeleteDialog] = useState(false);

  const toggleDeleteDialog = () => {
    setDeleteDialog((prevState) => !prevState);
  };

  const checkItemQuoteStatus = (vendor_id) => {
    if (!quotation_request_list || quotation_request_list.length === 0) {
      return "Not filled";
    }

    const filteredQuotes = quotation_request_list.filter(
      (quote) => quote.vendor === vendor_id
    );

    if (filteredQuotes.length === 0) {
      return "Not filled";
    }

    const allFilled = filteredQuotes.every(
      (quote) => ![null, "", "0"].includes(quote.quote)
    );
    const noneFilled = filteredQuotes.every((quote) =>
      [null, "", "0"].includes(quote.quote)
    );

    if (noneFilled) {
      return "Not filled";
    } else if (allFilled) {
      return "All Filled";
    } else {
      return "Partially Filled";
    }
  };

  const [orderData, setOrderData] = useState({
    project: "",
    work_package: "",
    procurement_list: {
      list: [],
    },
    category_list: {
      list: [],
    },
  });
  if (!orderData.project) {
    procurement_request_list?.map((item) => {
      if (item.name === orderId) {
        setOrderData(item);
      }
    });
  }

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
  const { mutate } = useSWRConfig();

  const handleAddVendor = async (vendor_name) => {
    const vendorId = vendor_list?.find(
      (ven) => ven.vendor_name === vendor_name
    ).name;
    try {
      const promises = [];
      orderData?.procurement_list?.list.forEach((item) => {
        const makes = orderData?.category_list?.list?.find(i => i?.name === item?.category)?.makes?.map(j => ({ make: j, enabled: "false" })) || [];
        const newItem = {
          procurement_task: orderData.name,
          category: item.category,
          item: item.name,
          vendor: vendorId,
          quantity: item.quantity,
          makes: { list: makes || [] }
        };
        promises.push(createDoc("Quotation Requests", newItem));
      });

      await Promise.all(promises);

      // Mutate the vendor-related data
      await mutate("Vendors");
      await mutate("Quotation Requests");
      await mutate("Vendor Category");
      await vendor_list_mutate();
      await quotation_request_list_mutate();

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
        "There was an error while adding the vendor in update-quote",
        error
      );
    }
  };

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

  useEffect(() => {
    const vendors = [];
    quotation_request_list?.map((item) => {
      const value = item.vendor;
      vendors.push(value);
    });
    const removeDuplicates = (array) => {
      return Array.from(new Set(array));
    };
    const uniqueList = removeDuplicates(vendors);

    setUniqueVendors({
      list: uniqueList,
    });

  }, [quotation_request_list]);

  // console.log("orderData", orderData)

  const getVendorAddr = (name) => {
    if (vendor_list) {
      const vendor = vendor_list?.find((ven) => ven?.vendor_name === name);
      return { city: vendor?.vendor_city, state: vendor?.vendor_state };
    }
  };

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
                      <div className="w-[250px] text-wrap flex flex-col">
                        <span className="text-red-500 font-semibold">
                          {vendor_name}
                        </span>
                        <span>Add to PR</span>
                      </div>
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Add Vendor to the current PR
                      </AlertDialogTitle>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="flex items-center gap-1">
                          <Undo2 className="h-4 w-4" />
                          Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleAddVendor(vendor_name)}
                          className="flex items-center gap-1"
                        >
                          <CirclePlus className="h-4 w-4" />
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
                      <div className="w-[250px] text-wrap flex flex-col">
                        <span className="text-red-500 font-semibold">
                          {row.getValue("vendor_name")}
                        </span>{" "}
                        <span>Add to PR</span>
                      </div>
                    </Button>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-80 bg-gray-800 text-white p-2 rounded-md shadow-lg">
                    <div>
                      Please add{" "}
                      <span className="font-semibold underline">
                        All Associated Categories of Current PR
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
                    vendor_id={row.original.name}
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

  const handleUpdateQuote = () => {
    updateDoc("Procurement Requests", orderId, {
      workflow_state: "Quote Updated",
    })
      .then(() => {
        console.log("orderId", orderId);
        navigate(`/procurement-requests/${orderId}?tab=Choose Vendor`);
      })
      .catch(() => {
        console.log("submit_error", update_error);
      });
  };

  const handleDeleteVendor = async () => {
    try {

      const filteredVendorQuotes = quotation_request_list?.filter(i => i?.vendor === deleteVendor)

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

  const filteredVendorList = vendor_list?.filter(
    (ven) => !uniqueVendors?.list?.includes(ven.name)
  );

  if (
    procurement_request_list_loading ||
    category_loading ||
    quotation_request_list_loading ||
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
        <div className="flex items-center">
          {/* <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} /> */
/*<h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">
  Input Quotes
</h2>
</div>
<ProcurementHeaderCard orderData={orderData} />
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
              <DialogDescription>Click on Confirm to delete vendor: <strong>{getVendorName(deleteVendor)}</strong> from this PR!</DialogDescription>
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
        <SheetTrigger className="border-2 border-opacity-50 border-red-500 text-red-500 bg-white font-normal px-4 py-2 rounded-lg">
          <div className="flex">
            <Download className="h-5 w-5 mt-0.5 mr-1" />
            RFQ PDF
          </div>
        </SheetTrigger>
        <SheetContent className="overflow-auto">
          {/* <ScrollArea className="h-[90%] w-[600px] rounded-md border p-4"> */
/*<SheetHeader>
  <SheetTitle className="text-center">
    Print PDF
  </SheetTitle>
  <SheetDescription>
    <PrintRFQ
      vendor_id={item}
      pr_id={orderData.name}
      itemList={orderData?.procurement_list || []}
    />
  </SheetDescription>
</SheetHeader>
{/* </ScrollArea> */
/*</SheetContent>
</Sheet>
{/* <button><ReleasePO vendorId = {vendorId}/></button> */
/*<Sheet>
  <SheetTrigger className="border-2 border-opacity-50 border-red-500 text-red-500 bg-white font-normal px-2 py-2 rounded-lg flex items-center gap-1">
    <span className="hover:underline">Enter Price(s) </span>
    <HoverCard>
      <HoverCardTrigger>
        <div
          className={`w-2 h-2 ${checkItemQuoteStatus(item) === "All Filled"
              ? "bg-green-500"
              : checkItemQuoteStatus(item) === "Not filled"
                ? "bg-red-500"
                : "bg-yellow-500"
            }  rounded-full`}
        />
      </HoverCardTrigger>
      <HoverCardContent className="mr-14 bg-gray-800 text-white p-2 rounded-md shadow-lg">
        {checkItemQuoteStatus(item) === "All Filled"
          ? "All items(s) quotes are filled"
          : checkItemQuoteStatus(item) === "Not filled"
            ? "No item quote is filled"
            : "Partially Filled"}
      </HoverCardContent>
    </HoverCard>
  </SheetTrigger>
  <SheetContent className="overflow-auto">
    {/* <ScrollArea className="h-[90%] w-[600px] p-2"> */
/*<SheetHeader className="text-start">
  <div className="flex items-center gap-1">
    <SheetTitle className="text-xl">
      Enter Price(s)
    </SheetTitle>
    <PencilLine className="w-5 h-5 text-primary" />
  </div>
  <SheetDescription className="py-2">
    {/* <Card className="p-5"> */
/*<QuotationForm
  vendor_id={item}
  pr_id={orderData.name}
/>
{/* </Card> */
/*</SheetDescription>
</SheetHeader>
{/* </ScrollArea> */
/*</SheetContent>
</Sheet>
</div>
</div>
);
})}
<div className="font-light text-sm text-slate-500 max-sm:px-2 px-8 py-6">
<span className="text-red-700">Notes:</span> You can download RFQ
PDFs for individual vendors for getting quotes
</div>
<div className="flex items-center justify-between">
<Sheet>
<SheetTrigger className="text-blue-500">
<div className="sm:pl-8 pl-2">
<CirclePlus className="w-4 h-4 inline mr-1 mb-1" />
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
    - This will add a new vendor entry within the system.
    Only add new vendors here.
  </p>
  <p className="text-xs">
    {" "}
    - This form will automatically add vendors categories
    from this PR/SB to the vendor.
  </p>
</div>
<NewVendor
  dynamicCategories={
    orderData?.category_list?.list?.map(
      (item) => item.name
    ) || []
  }
  prData={orderData}
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
<Accordion type="multiple" defaultValue={["Vendors"]}>
<AccordionItem value="Vendors">
<AccordionTrigger>
<div className="md:mb-2 text-base md:text-lg px-2  w-full text-left">
<div className="flex-1">
<span className=" text-base mb-0.5 md:text-lg font-slim">
  Recently Added Vendors List
</span>
<div className="text-sm text-gray-400">
  Here you can add previosuly added vendors to this PR. You
  can also update a previously added vendor`s{" "}
  <span className="text-red-700 italic">category</span>{" "}
</div>
</div>
</div>
</AccordionTrigger>
<AccordionContent>
<Card className="max-md:p-0">
<CardHeader className="max-md:p-0">
<div className="pl-6 flex gap-1 items-center pt-10 max-md:pt-6 flex-wrap">
  <span className="font-light max-md:text-sm">
    PR Categories:{" "}
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
*/

// Export nothing - file is retired
export { }