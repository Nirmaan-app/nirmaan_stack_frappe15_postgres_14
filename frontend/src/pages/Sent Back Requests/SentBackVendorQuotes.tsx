import { VendorsReactMultiSelect } from "@/components/helpers/VendorsReactSelect";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ProcurementHeaderCard } from "@/components/ui/ProcurementHeaderCard";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { toast } from "@/components/ui/use-toast";
import { ProcurementItem, RFQData } from "@/types/NirmaanStack/ProcurementRequests";
import { SentBackCategory } from "@/types/NirmaanStack/SentBackCategory";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { useFrappeGetDocList, useFrappeUpdateDoc, useSWRConfig } from "frappe-react-sdk";
import { CirclePlus, Info } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import GenerateRFQDialog from "../ProcurementRequests/VendorQuotesSelection/GenerateRFQDialog";
import { SelectVendorQuotesTable } from "../ProcurementRequests/VendorQuotesSelection/SelectVendorQuotesTable";
import { Vendor } from "../ServiceRequests/service-request/select-service-vendor";
import { NewVendor } from "../vendors/new-vendor";

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

const useProcurementUpdates = (sbId: string, sbMutate : any) => {
  const { updateDoc, loading: update_loading } = useFrappeUpdateDoc();
  const {mutate} = useSWRConfig()

  const navigate = useNavigate()

  const updateProcurementData = async (formData: RFQData, updatedData : ProcurementItem[],  value : string) => {
    await updateDoc("Sent Back Category", sbId, {
      rfq_data: formData,
      item_list: { list: updatedData }
    });
    
    await sbMutate();
    await mutate(`Sent Back Category:${sbId}`)

    if(value === "review") {
      toast({
        title: "Success!",
        description: `Quotes updated and saved successfully!`,
        variant: "success",
      })
      navigate(`/sent-back-requests/${sbId}?mode=review`)
      localStorage.removeItem(`sentBackDraft_${sbId}`)
      window.location.reload()
    }
  };

  return { updateProcurementData, update_loading };
};

export const SentBackVendorQuotes : React.FC = () => {

  const { sbId } = useParams<{ sbId: string }>()
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState(searchParams.get("mode") || "edit")
  const [selectedVendors, setSelectedVendors] = useState<Vendor[]>([])
  const [selectedVendorQuotes, setSelectedVendorQuotes] = useState(new Map())
  const [isRedirecting, setIsRedirecting] = useState<string>("")
  const [addVendorsDialog, setAddVendorsDialog] = useState(false)

  const [formData, setFormData] = usePersistentState<RFQData>(`sentBackDraft_${sbId}`, {
      selectedVendors: [],
      details: {},
    });

  const { data: sent_back_list, isLoading: sent_back_list_loading, mutate: sent_back_list_mutate } = useFrappeGetDocList<SentBackCategory>("Sent Back Category", {
      fields: ["*"],
      filters: [["name", "=", sbId]]
    },
    sbId ? `Sent Back Category ${sbId}` : null
  );

  const {data: vendors, isLoading: vendors_loading} = useFrappeGetDocList<Vendors>("Vendors", {
      fields: ["vendor_name", "vendor_type", "name", "vendor_city", "vendor_state"],
      filters: [["vendor_type", "in", ["Material", "Material & Service"]]],
      limit: 10000,
      orderBy: { field: "vendor_name", order: "asc" },
    }, "Material Vendors")

  const { updateProcurementData, update_loading } = useProcurementUpdates(sbId, sent_back_list_mutate)

  const [orderData, setOrderData] = useState<SentBackCategory | undefined>();

  useEffect(() => {
      if (sent_back_list) {
        const request = sent_back_list[0]
        const  itemToVendorMap = new Map()
        request.item_list.list.forEach((item) => {
          if(item?.vendor) {
            itemToVendorMap.set(item?.name, item?.vendor)
          }
        })
        if(!Object.keys(formData.details || {}).length && request.rfq_data && Object.keys(request.rfq_data).length) {
            setFormData(request.rfq_data)
        }
        setOrderData(request)
        setSelectedVendorQuotes(itemToVendorMap)
      }
    }, [sent_back_list])
  
    useEffect(() => {
      if (
        orderData && orderData.item_list.list.length > 0 &&
        Object.keys(formData.details).length === 0
      ) {
        const newDetails: RFQData['details'] = {};
        
        orderData.item_list.list.forEach((item) => {
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
        const updatedOrderList = orderData?.item_list?.list?.map((item) => {
          if (selectedVendorQuotes.has(item.name)) {
            const vendorId : string = selectedVendorQuotes.get(item.name);
            const vendorData = formData.details?.[item.name]?.vendorQuotes?.[vendorId];
            if (vendorData) {
              return {
                ...item,
                vendor: vendorId,
                quote: parseFloat(vendorData.quote  || "0"),
                make: vendorData.make,
              };
            }
            return { ...item };
          } else {
            const { vendor, quote, make, ...rest } = item;
            return rest;
          }
        }) || [];
      
        setOrderData({ ...orderData, item_list: { list: updatedOrderList } });
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
    const updatedOrderList = orderData?.item_list?.list?.map((item) => {
      if (selectedVendorQuotes.has(item.name)) {
        const vendorId : string = selectedVendorQuotes.get(item.name);
        const vendorData = formData.details?.[item.name]?.vendorQuotes?.[vendorId];
        if (vendorData) {
          return {
            ...item,
            vendor: vendorId,
            quote: parseFloat(vendorData.quote || "0"),
            make: vendorData.make,
          };
        }
        return { ...item };
      } else {
        const { vendor, quote, make, ...rest } = item;
        return rest;
      }
    }) || [];
  
    setOrderData({ ...orderData, item_list: { list: updatedOrderList } });
  
    setIsRedirecting("review");
  
    await updateProcurementData(formData, updatedOrderList, "review");
  };

  if (sent_back_list_loading || vendors_loading) return <div className="flex items-center h-[90vh] w-full justify-center"><TailSpin color={"red"} /> </div>

  return (
    <>
    {update_loading && (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
    <div className="bg-white p-6 rounded-lg shadow-lg text-center">
      <p className="text-lg font-semibold">{isRedirecting === "view" ? "Saving Changes... Please wait" : "Redirecting... Please wait"}</p>
    </div>
  </div>
  )}
    <div className="flex-1 space-y-4">
        <ProcurementHeaderCard orderData={orderData} sentBack />
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
                    <li>
                        As this is a Sent Back PR, you <b>must</b> select a vendor quote for <b>every</b> item listed.
                    </li>
                    <li>
                        The <b>Continue</b> button will remain disabled until all items have a selected vendor quote.
                    </li>
                    <li>Once all items have a vendor quote selected, click <b>Continue</b> to proceed.</li>
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

      <GenerateRFQDialog orderData={{...orderData, procurement_list: { list : orderData?.item_list.list}}} />
      </div>
      </div>

        <SelectVendorQuotesTable sentBack orderData={orderData} formData={formData} setFormData={setFormData} selectedVendorQuotes={selectedVendorQuotes} setSelectedVendorQuotes={setSelectedVendorQuotes} mode={mode} setOrderData={setOrderData} />
    
    <div className="flex justify-end">
      <Button disabled={mode === "edit" || selectedVendorQuotes?.size !== orderData?.item_list?.list?.length} onClick={handleReviewChanges}>Continue</Button>
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
  </>
  )
}