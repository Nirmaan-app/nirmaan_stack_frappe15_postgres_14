import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Vendor } from "@/pages/ServiceRequests/service-request/select-service-vendor"
import { NewVendor } from "@/pages/vendors/new-vendor"
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers"
import { ProcurementItem, ProcurementRequest, RFQData } from "@/types/NirmaanStack/ProcurementRequests"
import { Vendors } from "@/types/NirmaanStack/Vendors"
import { useFrappeGetDocList, useFrappeUpdateDoc, useSWRConfig } from "frappe-react-sdk"
import { CirclePlus, Info } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { TailSpin } from "react-loader-spinner"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { VendorsReactMultiSelect } from "../../../components/helpers/VendorsReactSelect"
import { ProcurementHeaderCard } from "../../../components/ui/ProcurementHeaderCard"
import { Button } from "../../../components/ui/button"
import { toast } from "../../../components/ui/use-toast"
import GenerateRFQDialog from "./GenerateRFQDialog"
import { SelectVendorQuotesTable } from "./SelectVendorQuotesTable"

// Custom hook to persist state to localStorage
function usePersistentState<T>(key: string, defaultValue: T) {
  const [state, setState] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : defaultValue;
    } catch (e) {
      return defaultValue;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(state));
  }, [key, state]);

  return [state, setState] as [T, typeof setState];
}

const useProcurementUpdates = (prId: string, prMutate : any) => {
  const { updateDoc, loading: update_loading } = useFrappeUpdateDoc();

  const {mutate} = useSWRConfig()

  const navigate = useNavigate()

  const updateProcurementData = async (formData: RFQData, updatedData : ProcurementItem[],  value : string) => {
    await updateDoc("Procurement Requests", prId, {
      rfq_data: formData,
      procurement_list: { list: updatedData }
    });
    
    await prMutate();

    await mutate(`Procurement Requests:${prId}`)

    if(value === "review") {
      toast({
        title: "Success!",
        description: `Quotes updated and saved successfully!`,
        variant: "success",
      })
      navigate(`/procurement-requests/${prId}?tab=In+Progress&mode=review`)
      localStorage.removeItem(`procurementDraft_${prId}`)
      window.location.reload()
    }
  };

  return { updateProcurementData, update_loading };
};

export const ProcurementProgress : React.FC = () => {

  const [searchParams] = useSearchParams();
  const navigate = useNavigate()

  const {prId} = useParams<{ prId: string }>()
  const [mode, setMode] = useState(searchParams.get("mode") || "edit")
  const [orderData, setOrderData] = useState<ProcurementRequest | undefined>()
  const [addVendorsDialog, setAddVendorsDialog] = useState(false)
  const [selectedVendors, setSelectedVendors] = useState<Vendor[]>([])

  const [selectedVendorQuotes, setSelectedVendorQuotes] = useState(new Map())
  const [isRedirecting, setIsRedirecting] = useState<string>("")

  const [formData, setFormData] = usePersistentState<RFQData>(`procurementDraft_${prId}`, {
    selectedVendors: [],
    details: {},
  });

  const { data: procurement_request, isLoading: procurement_request_loading, mutate: procurement_request_mutate } = useFrappeGetDocList<ProcurementRequest>("Procurement Requests", {
    fields: ["*"],
    filters: [["name", "=", prId]]
  }, prId ? `Procurement Requests ${prId}` : null)

  // const {deleteDialog, toggleDeleteDialog} = useContext(UserContext);
    
  // const {handleDeletePR, deleteLoading} = usePRorSBDelete(procurement_request_mutate);

  const {data: vendors, isLoading: vendors_loading} = useFrappeGetDocList<Vendors>("Vendors", {
    fields: ["vendor_name", "vendor_type", "name", "vendor_city", "vendor_state"],
    filters: [["vendor_type", "in", ["Material", "Material & Service"]]],
    limit: 10000,
    orderBy: { field: "vendor_name", order: "asc" },
  }, "Material Vendors")

  const { data: usersList, isLoading: usersListLoading } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", {
      fields: ["*"],
      limit: 1000,
    })
  
  const getFullName = (id : string | undefined) => {
    return usersList?.find((user) => user?.name == id)?.full_name || ""
  }

  const { updateProcurementData, update_loading } = useProcurementUpdates(prId, procurement_request_mutate)

  useEffect(() => {
    if (procurement_request) {
      const request = procurement_request[0]
      const  itemToVendorMap = new Map()
      request.procurement_list.list.forEach((item) => {
        if(item?.vendor) {
          itemToVendorMap.set(item?.name, item?.vendor)
        }
      })
      if(!Object.keys(formData.details || {}).length && request.rfq_data && Object.keys(request.rfq_data).length) {
          setFormData(request.rfq_data)
      }
      setOrderData(procurement_request[0])
      setSelectedVendorQuotes(itemToVendorMap)
    }
  }, [procurement_request])

  useEffect(() => {
    if (
      orderData && orderData?.procurement_list?.list?.length > 0 &&
      Object.keys(formData.details).length === 0
    ) {
      const newDetails: RFQData['details'] = {};
      
      orderData.procurement_list.list.forEach((item) => {
        const matchingCategory = orderData.category_list.list.find(
          (cat) => cat.name === item.category
        );
        const defaultMakes = matchingCategory ? matchingCategory.makes : [];
        newDetails[item.name] = {
          vendorQuotes: {},
          makes: defaultMakes || [],
        };
      });
      setFormData((prev) => ({ ...prev, details: newDetails }));
    }
  }, [orderData, formData.details]);

  const useVendorOptions = (vendors : any, selectedVendors: Vendor[]) => 
    useMemo(() => vendors
      ?.filter(v => !selectedVendors.some(sv => sv.value === v.name))
      .map(v => ({
        label: v.vendor_name,
        value: v.name,
        city: v.vendor_city,
        state: v.vendor_state,
      })),
    [vendors, selectedVendors]
  );

const vendorOptions = useVendorOptions(vendors, formData.selectedVendors);

const updateURL = (key : string, value : string) => {
    const url = new URL(window.location);
    url.searchParams.set(key, value);
    window.history.pushState({}, "", url);
};


const onClick = async (value : string) => {
    if (mode === value) return;
    if(value === "view" && JSON.stringify(formData) !== JSON.stringify(orderData?.rfq_data || {})) {
        setIsRedirecting("view")
        const updatedOrderList = orderData?.procurement_list?.list?.map((item) => {
          if (selectedVendorQuotes.has(item.name)) {
            const vendorId : string = selectedVendorQuotes.get(item.name);
            const vendorData = formData.details?.[item.name]?.vendorQuotes?.[vendorId];
            if (vendorData) {
              return {
                ...item,
                vendor: vendorId,
                quote: parseFloat(vendorData.quote),
                make: vendorData.make,
              };
            }
            return { ...item };
          } else {
            const { vendor, quote, make, ...rest } = item;
            return rest;
          }
        });
      
        setOrderData({ ...orderData, procurement_list: { list: updatedOrderList } });
        await updateProcurementData(formData, updatedOrderList, value)
    }
    setMode(value);
    updateURL("mode", value);
};

  const handleVendorSelection = () => {
    setFormData((prev) => ({ ...prev, selectedVendors: [...prev.selectedVendors, ...selectedVendors] }));
    setSelectedVendors([]);
    setAddVendorsDialog(false);
  };


const handleReviewChanges = async () => {
  const updatedOrderList = orderData?.procurement_list?.list?.map((item) => {
    if (selectedVendorQuotes.has(item.name)) {
      const vendorId : string = selectedVendorQuotes.get(item.name);
      const vendorData = formData.details?.[item.name]?.vendorQuotes?.[vendorId];
      if (vendorData) {
        return {
          ...item,
          vendor: vendorId,
          quote: parseFloat(vendorData.quote),
          make: vendorData.make,
        };
      }
      return { ...item };
    } else {
      const { vendor, quote, make, ...rest } = item;
      return rest;
    }
  }) || [];

  setOrderData({ ...orderData, procurement_list: { list: updatedOrderList } });

  setIsRedirecting("review");

  await updateProcurementData(formData, updatedOrderList, "review");
};

if (procurement_request_loading || vendors_loading || usersListLoading) return <div className="flex items-center h-[90vh] w-full justify-center"><TailSpin color={"red"} /> </div>

  if (orderData?.workflow_state !== "In Progress") {
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
            <span className="italic">In Progress</span> state. The current state is{" "}
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
      <ProcurementHeaderCard orderData={orderData} />
      <div className="flex max-sm:flex-col max-sm:items-start items-center justify-between max-sm:gap-4">
        <div className="flex gap-4 max-sm:justify-between w-full">
          <h2 className="text-lg font-semibold tracking-tight max-sm:text-base ml-2">RFQ List</h2>
          <div className="flex items-center gap-1">
            <div className="flex items-center border border-primary text-primary rounded-md text-xs cursor-pointer">
            <span  role="radio" tabIndex={0} aria-checked={mode === "edit"} onClick={() => onClick("edit")} className={`${mode === "edit" ? "bg-red-100" : ""} py-1 px-4 rounded-md`}>Edit</span>
            <span role="radio" tabIndex={0} aria-checked={mode === "view"}  onClick={() => onClick("view")}  className={`${mode === "view" ? "bg-red-100" : ""} py-1 px-4 rounded-md`}>View</span>
          </div>
        <HoverCard>
          <HoverCardTrigger>
            <Info className="text-blue-500" />
          </HoverCardTrigger>
          <HoverCardContent>
            {mode === "edit" ? (
                <div>
                    <p className="font-semibold mb-2 tracking-tight">Edit Mode Instructions:</p>
                    <ul className="list-disc list-inside space-y-1 text-xs">
                        <li>Select required vendors using the <b>Add More Vendors</b> button.</li>
                        <li>Fill in the quotes for each relevant Item-Vendor combination.</li>
                        <li>Select Makes (if applicable).</li>
                        <li>Click <b>View</b> to review your item-vendor quote selections.</li>
                    </ul>
                </div>
            ) : (
                <div>
                    <p className="font-semibold mb-2 tracking-tight">View Mode Instructions:</p>
                    <ul className="list-disc list-inside space-y-1 text-xs">
                        <li>To enable the <b>Continue</b> button below the items table, select at least one Item-Vendor quote.</li>
                        <li>Click <b>Continue</b> to navigate to the review selections page.</li>
                    </ul>
                </div>
          )}
        </HoverCardContent>
        </HoverCard>
        </div>
      </div>

      <div className="flex gap-2 items-center max-sm:justify-end max-sm:w-full">
        {mode === "edit" && (
          <Button onClick={() => setAddVendorsDialog(true)} variant={"outline"} className="text-primary border-primary flex gap-1">
          <CirclePlus className="w-4 h-4" />
          Select {formData?.selectedVendors?.length > 0 && "More"} Vendors
        </Button>
        )}
        <GenerateRFQDialog orderData={orderData} />
      </div>
      </div>

      <SelectVendorQuotesTable orderData={orderData} formData={formData} setFormData={setFormData} selectedVendorQuotes={selectedVendorQuotes} setSelectedVendorQuotes={setSelectedVendorQuotes} mode={mode} setOrderData={setOrderData} />
      
      
      <div className="flex justify-end items-end">
        {/* <AlertDialog open={deleteDialog} onOpenChange={toggleDeleteDialog}>
                        <AlertDialogTrigger asChild>
                          <Button className="flex items-center gap-1">
                            <Trash2 className="w-4 h-4" />
                            Delete PR
                          </Button>
                        </AlertDialogTrigger>
                          <AlertDialogContent className="py-8 max-sm:px-12 px-16 text-start overflow-auto">
                              <AlertDialogHeader className="text-start">
                                  <AlertDialogTitle className="text-center">
                                      Delete Procurement Request
                                  </AlertDialogTitle>
                                      <AlertDialogDescription>Are you sure you want to delete this PR?</AlertDialogDescription>
                                  <div className="flex gap-2 items-center pt-4 justify-center">
                                      {deleteLoading ? <TailSpin color="red" width={40} height={40} /> : (
                                          <>
                                              <AlertDialogCancel className="flex-1" asChild>
                                                  <Button variant={"outline"} className="border-primary text-primary">Cancel</Button>
                                              </AlertDialogCancel>
                                               <Button
                                                  onClick={() => handleDeletePR(orderData?.name, true)}
                                                  className="flex-1">
                                                      Confirm
                                              </Button>
                                          </>
                                      )}
                                  </div>
          
                              </AlertDialogHeader>
                          </AlertDialogContent>
                      </AlertDialog> */}
        <Button disabled={mode === "edit" || !selectedVendorQuotes?.size} onClick={handleReviewChanges}>Continue</Button>
      </div>

      <Dialog open={addVendorsDialog} onOpenChange={() => setAddVendorsDialog(!addVendorsDialog)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-center">Add Vendors</DialogTitle>
          </DialogHeader>
          <DialogDescription className="flex gap-2 items-center">
            <div className="w-[90%]">
              <VendorsReactMultiSelect vendorOptions={vendorOptions || []} setSelectedVendors={setSelectedVendors} />
            </div>
              <Sheet>
                <SheetTrigger asChild>
                  <CirclePlus 
                  // onClick={() => setAddVendorsDialog(false)} 
                  className="text-primary cursor-pointer" />
                </SheetTrigger>
                <SheetContent className="overflow-auto">
                  <SheetHeader className="text-start">
                    <SheetTitle>
                      <div className="flex-1">
                        <span className="underline">Add New Material Vendor</span>
                      </div>
                    </SheetTitle>
                    <NewVendor
                      navigation={false}
                    />
                  </SheetHeader>
                </SheetContent>
              </Sheet>
          </DialogDescription>
          <div className="flex items-end gap-4">
            <DialogClose className="flex-1" asChild>
              <Button variant={"outline"}>Cancel</Button>
            </DialogClose>
            <Button onClick={handleVendorSelection} className="flex-1">Confirm</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
    {update_loading && (
      <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
        <div className="bg-white p-6 rounded-lg shadow-lg text-center">
          <p className="text-lg font-semibold">{isRedirecting === "view" ? "Saving Changes... Please wait" : "Redirecting... Please wait"}</p>
        </div>
      </div>
    )}
    </>
  )
}
