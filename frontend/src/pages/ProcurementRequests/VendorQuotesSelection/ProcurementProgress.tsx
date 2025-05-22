import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Vendor } from "@/pages/ServiceRequests/service-request/select-service-vendor"
import { NewVendor } from "@/pages/vendors/new-vendor"
import { ProcurementItem, ProcurementItemBase, ProcurementItemWithVendor, ProcurementRequest, RFQData } from "@/types/NirmaanStack/ProcurementRequests"
import { parseNumber } from "@/utils/parseNumber"
import { FrappeConfig, FrappeContext, useFrappeDocumentEventListener, useFrappeGetDocList, useFrappeUpdateDoc, useSWRConfig } from "frappe-react-sdk"
import { AlertCircle, CirclePlus, Info, Undo2 } from "lucide-react"
import { useCallback, useContext, useEffect, useMemo, useState } from "react"
import { TailSpin } from "react-loader-spinner"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { ProcurementHeaderCard } from "../../../components/helpers/ProcurementHeaderCard"
import { VendorsReactMultiSelect } from "../../../components/helpers/VendorsReactSelect"
import { Button } from "../../../components/ui/button"
import { toast } from "../../../components/ui/use-toast"
import GenerateRFQDialog from "./components/GenerateRFQDialog"
import { SelectVendorQuotesTable } from "./SelectVendorQuotesTable"
import LoadingFallback from "@/components/layout/loaders/LoadingFallback"
import { useUserData } from "@/hooks/useUserData"
import { useVendorsList } from "./hooks/useVendorsList"
import { useUsersList } from "../ApproveNewPR/hooks/useUsersList"

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

  const updateProcurementData = async (formData: RFQData | null = null, updatedData : ProcurementItem[],  value : string) => {
    await updateDoc("Procurement Requests", prId, {
      rfq_data: formData,
      procurement_list: { list: updatedData },
      workflow_state: value === "revert" ? "Approved" : undefined
    });
    
    await prMutate();

    await mutate(`Procurement Requests:${prId}`)

    if(value === "review" || value === "revert") {
      toast({
        title: "Success!",
        description: value === "revert" ? `PR: ${prId} changes reverted successfully!` : `Quotes updated and saved successfully!`,
        variant: "success",
      })
      if(value === "revert") {
        navigate(`/procurement-requests?tab=New%20PR%20Request`)
      } else {
        navigate(`/procurement-requests/${prId}?tab=In+Progress&mode=review`)
      }
      localStorage.removeItem(`procurementDraft_${prId}`)
      // if(value === "review") {
      //   window.location.reload()
      // }
    }
  };

  return { updateProcurementData, update_loading };
};

export const ProcurementProgress : React.FC = () => {

  const [searchParams] = useSearchParams();
  const navigate = useNavigate()

  const {prId} = useParams<{ prId: string }>()
  const currentUser = useUserData().user_id

  // Ensure prId exists early
  if (!prId) {
    return <div className="flex items-center justify-center h-[90vh]">Error: PR ID is missing.</div>;
  }

  const [mode, setMode] = useState(searchParams.get("mode") || "edit")
  const [orderData, setOrderData] = useState<ProcurementRequest | null>(null)
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

  const [revertDialog, setRevertDialog] = useState(false);


  const toggleRevertDialog = useCallback(() => {
    setRevertDialog(!revertDialog);
  }, [revertDialog]);


  const {data: vendors, isLoading: vendors_loading} = useVendorsList({vendorTypes: ["Material", "Material & Service"]})

  const {data: usersList, isLoading: usersListLoading} = useUsersList()

  const userFullNameMap = useMemo(() => {
      const map = new Map<string, string>();
      usersList?.forEach(user => map.set(user.name, user.full_name || user.name));
      return map;
  }, [usersList]);

  const {viewers, emitDocClose, emitDocOpen} = useFrappeDocumentEventListener("Procurement Requests", prId, (event) => {
    console.log("Procurement Request document updated (real-time):", event);
    toast({
        title: "Document Updated",
        description: `Procurement Request ${event.name} has been modified.`,
    });
    procurement_request_mutate(); // Re-fetch this specific document
  },
  true // emitOpenCloseEventsOnMount (default)
  )

  const [otherEditors, setOtherEditors] = useState<string[]>([]);

  useEffect(() => {
    if (prId) {
      emitDocOpen();

      return () => {
        emitDocClose();
      }
    }
  }, [prId,]);

  // Logic to determine active editor and lock state
  useEffect(() => {
    if (!prId) return;

    // `viewers` contains all users currently subscribed to this document's room, including the current user.
    // `emitDocOpen` is called by the hook on mount, adding current user to the list.
    // `emitDocClose` is called on unmount.
    console.log("Viewers changed:", viewers, "Current user:", currentUser);

    if(viewers.length > 0) {
      setOtherEditors(viewers.filter(user => user !== currentUser));
    } else {
      setOtherEditors([]);
    }
    

}, [viewers]); // Re-run when viewers or activeEditor changes

  
  const getFullName = useMemo(() => (id: string | undefined | null): string => {
    if (!id) return "Unknown User";
    return userFullNameMap.get(id) || id;
}, [userFullNameMap]);


  const { updateProcurementData, update_loading } = useProcurementUpdates(prId, procurement_request_mutate)

  function isProcurementItemWithVendor(item: ProcurementItem): item is ProcurementItemWithVendor {
    // Check for properties specific to ProcurementItemWithVendor
    // You can check for 'vendor' or 'quote', or both if they always appear together.
    // Checking for 'vendor' is often sufficient if it's the distinguishing factor.
    return (item as ProcurementItemWithVendor).vendor !== undefined;
    // Alternatively, if 'quote' is also a good indicator:
    // return (item as ProcurementItemWithVendor).vendor !== undefined || (item as ProcurementItemWithVendor).quote !== undefined;
  }
  

  useEffect(() => {
    if (procurement_request && procurement_request.length > 0) {
      const request = procurement_request[0]
      const  itemToVendorMap = new Map()
      request.procurement_list.list.forEach((item: ProcurementItem) => {
        if(isProcurementItemWithVendor(item)) {
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
          initialMake: item?.make,
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

const updateURL = useCallback((key : string, value : string) => {
    const url = new URL(window.location.href);
    url.searchParams.set(key, value);
    window.history.pushState({}, "", url);
}, []);


const onClick = async (value : string) => {
    if (mode === value) return;
    if(value === "view" && JSON.stringify(formData) !== JSON.stringify(orderData?.rfq_data || {})) {
        setIsRedirecting("view")
        const updatedOrderList: ProcurementItem[] = orderData?.procurement_list?.list?.map((item: ProcurementItem): ProcurementItem => {
          if (selectedVendorQuotes.has(item.name)) {
            const vendorId : string = selectedVendorQuotes.get(item.name);
            const vendorData = formData.details?.[item.name]?.vendorQuotes?.[vendorId];
            if (vendorData) {
              return {
                ...item,
                vendor: vendorId,
                quote: parseNumber(vendorData.quote),
                make: (isProcurementItemWithVendor(item) ? item.make : undefined), // Preserve original make if it had one
              };
            }
          }

          if (isProcurementItemWithVendor(item)) {
            const { vendor, quote, make, ...restOfItemBase } = item;
            return restOfItemBase; // Now it's ProcurementItemBase
        }
        return item; // It was already ProcurementItemBase
        }) || [];

        if (orderData) {
          setOrderData(prevOrderData => {
              if (!prevOrderData) return null;
              return {
                  ...prevOrderData,
                  procurement_list: { list: updatedOrderList }
              };
          });
          await updateProcurementData(formData, updatedOrderList, value);
      }
    }
    setMode(value);
    updateURL("mode", value);
};

  const handleVendorSelection = useCallback(() => {
    setFormData((prev) => ({ ...prev, selectedVendors: [...prev.selectedVendors, ...selectedVendors] }));
    setSelectedVendors([]);
    setAddVendorsDialog(false);
  }, [formData, selectedVendors, setFormData, setSelectedVendors, setAddVendorsDialog]);


const handleReviewChanges = async () => {
  const updatedOrderList: ProcurementItem[] = orderData?.procurement_list?.list?.map((item: ProcurementItem): ProcurementItem => {
    if (selectedVendorQuotes.has(item.name)) {
      const vendorId : string = selectedVendorQuotes.get(item.name);
      const vendorData = formData.details?.[item.name]?.vendorQuotes?.[vendorId];
      if (vendorData) {
        return {
          ...item,
          vendor: vendorId,
          quote: parseNumber(vendorData.quote),
          make: vendorData.make || (isProcurementItemWithVendor(item) ? item.make : undefined),
        };
      }
    }

    if(isProcurementItemWithVendor(item)) {
      const { vendor, quote, make, ...restOfItemBase } = item;
      return restOfItemBase;
    }
    return item;
  }) || [];

  if (orderData) {
    setOrderData(prevOrderData => {
        if (!prevOrderData) return null;
        return {
            ...prevOrderData,
            procurement_list: { list: updatedOrderList }
        };
    });
    setIsRedirecting("review");
    await updateProcurementData(formData, updatedOrderList, "review");
} else {
    toast({ title: "Error", description: "Order data is not available to review changes.", variant: "destructive" });
}
};

const handleRevertPR = async () => {
  const updatedOrderList: ProcurementItem[] = orderData?.procurement_list?.list?.map((item: ProcurementItem): ProcurementItemBase => { // Return type is ProcurementItemBase
      // When reverting, we always want to strip vendor/quote/make details
      if (isProcurementItemWithVendor(item)) {
          const { vendor, quote, make, ...restOfItemBase } = item;
          return restOfItemBase;
      }
      // If it's already ProcurementItemBase, just return it
      return item;
  }) || [];

  if (orderData) {
      setOrderData(prevOrderData => {
          if (!prevOrderData) return null;
          // Ensure the list being set matches the expected type for procurement_list.list
          const correctlyTypedList: ProcurementItem[] = updatedOrderList.map(baseItem => baseItem as ProcurementItem);

          return {
              ...prevOrderData,
              procurement_list: { list: correctlyTypedList },
              rfq_data: { selectedVendors: [], details: {} }
          };
      });
      setIsRedirecting("revert");
      // Pass updatedOrderList, which is now ProcurementItemBase[]
      // updateProcurementData might need to accept ProcurementItemBase[] or handle the union.
      // For simplicity, if updateProcurementData expects ProcurementItem[], we cast.
      await updateProcurementData(undefined, updatedOrderList as ProcurementItem[], "revert");
  } else {
      toast({ title: "Error", description: "Order data is not available to revert.", variant: "destructive" });
  }
};


if (procurement_request_loading || vendors_loading || usersListLoading) return <LoadingFallback />

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
    {/* Lock Information Banner */}
    {otherEditors?.length > 0 && (
                <div className="sticky top-0 z-40 p-3 bg-yellow-100 border-b border-yellow-300 text-yellow-800 text-sm flex items-center justify-center shadow-md">
                    <AlertCircle className="h-5 w-5 mr-2" />
                    This Procurement Request is currently being edited by{" "}
                    <strong className="mx-1">{otherEditors.map(getFullName).join(", ")}</strong>.
                </div>
            )}
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
      
      
        <div className="flex justify-between items-end">
                  <AlertDialog open={revertDialog} onOpenChange={toggleRevertDialog}>
                        <AlertDialogTrigger asChild>
                          <Button className="flex items-center gap-1">
                            <Undo2 className="w-4 h-4" />
                            Revert PR
                          </Button>
                        </AlertDialogTrigger>
                          <AlertDialogContent className="py-8 max-sm:px-12 px-16 text-start overflow-auto">
                              <AlertDialogHeader className="text-start">
                                  <AlertDialogTitle className="text-center">
                                      Revert Procurement Request
                                  </AlertDialogTitle>
                                      <AlertDialogDescription>Are you sure you want to revert the PR changes?, this will permanently empty the rfq data filled if any.</AlertDialogDescription>
                                  <div className="flex gap-2 items-center pt-4 justify-center">
                                      {update_loading ? <TailSpin color="red" width={40} height={40} /> : (
                                          <>
                                              <AlertDialogCancel className="flex-1" asChild>
                                                  <Button variant={"outline"} className="border-primary text-primary">Cancel</Button>
                                              </AlertDialogCancel>
                                               <Button
                                                  onClick={handleRevertPR}
                                                  className="flex-1">
                                                      Confirm
                                              </Button>
                                          </>
                                      )}
                                  </div>
          
                              </AlertDialogHeader>
                          </AlertDialogContent>
                      </AlertDialog>
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
          <p className="text-lg font-semibold">{isRedirecting === "view" ? "Saving Changes... Please wait" : isRedirecting === "revert" ? "Reverting Changes... Please wait" : "Redirecting... Please wait"}</p>
        </div>
      </div>
    )}
    </>
  )
}

export default ProcurementProgress;
