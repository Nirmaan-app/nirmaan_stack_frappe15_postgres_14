import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Vendor } from "@/pages/ServiceRequests/service-request/select-service-vendor"
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers"
import { ProcurementItem, ProcurementRequest, RFQData } from "@/types/NirmaanStack/ProcurementRequests"
import { SentBackCategory } from "@/types/NirmaanStack/SentBackCategory"
import { Vendors } from "@/types/NirmaanStack/Vendors"
import formatToIndianRupee from "@/utils/FormatPrice"
import { useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk"
import _ from "lodash"
import { CheckCheck, CircleMinus, CirclePlus, FolderPlus, Info, ListChecks, MessageCircleMore } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { TailSpin } from "react-loader-spinner"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import ReactSelect, { components } from "react-select"
import { VendorsReactMultiSelect } from "../../../components/helpers/VendorsReactSelect"
import { ProcurementHeaderCard } from "../../../components/ui/ProcurementHeaderCard"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../../../components/ui/alert-dialog"
import { Badge } from "../../../components/ui/badge"
import { Button } from "../../../components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../../components/ui/dialog"
import { Input } from "../../../components/ui/input"
import { Label } from "../../../components/ui/label"
import { toast } from "../../../components/ui/use-toast"
import { VendorHoverCard } from "../../../components/ui/vendor-hover-card"

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

const useProcurementUpdates = (prId: string, mutate : any) => {
  const { updateDoc, loading: update_loading } = useFrappeUpdateDoc();

  const navigate = useNavigate()

  const updateProcurementData = async (formData: RFQData, updatedData : ProcurementItem[],  value : string) => {
    await updateDoc("Procurement Requests", prId, {
      rfq_data: formData,
      procurement_list: { list: updatedData }
    });
    
    await mutate();

    if(value === "review") {
      toast({
        title: "Success!",
        description: `Quotes updated and saved successfully!`,
        variant: "success",
      })
      navigate(`/procurement-requests/${prId}?tab=In+Progress&mode=review`)
      localStorage.removeItem(`procurementDraft_${prId}`)
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

  const {data: vendors, isLoading: vendors_loading} = useFrappeGetDocList<Vendors>("Vendors", {
    fields: ["vendor_name", "vendor_type", "name", "vendor_city", "vendor_state"],
    filters: [["vendor_type", "in", ["Material", "Material & Service"]]],
    limit: 10000,
    orderBy: { field: "vendor_name", order: "asc" },
  })

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
          makes: defaultMakes,
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
                quote: vendorData.quote,
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

const removeVendor = useCallback((vendorId: string) => {
    setFormData((prev) => {
      const updatedSelectedVendors = prev.selectedVendors.filter(
        (v) => v?.value !== vendorId
      );
  
      const updatedDetails = Object.keys(prev.details).reduce(
        (acc, itemId) => {
          const itemDetails = prev.details[itemId];
          const updatedVendorQuotes = { ...itemDetails.vendorQuotes };
          delete updatedVendorQuotes[vendorId];
  
          acc[itemId] = {
            ...itemDetails,
            vendorQuotes: updatedVendorQuotes,
          };
          return acc;
        },
        {} as typeof prev.details
      );
  
      return {
        ...prev,
        selectedVendors: updatedSelectedVendors,
        details: updatedDetails,
      };
    });

    setSelectedVendorQuotes(prev => {
      const updatedQuotes = new Map(prev)

      for(const [itemId, vendor] of updatedQuotes) {
        if (vendor === vendorId) updatedQuotes.delete(itemId)
      }
      return updatedQuotes
    })

    setOrderData((prev) => ({
      ...prev,
      procurement_list: {
        list: prev.procurement_list.list.map((item) => 
        item?.vendor === vendorId ? _.omit(item, ["vendor", "quote", "make"]) : item
        )
      }
    }))
  }, []);

  const handleVendorSelection = () => {
    setFormData((prev) => ({ ...prev, selectedVendors: [...prev.selectedVendors, ...selectedVendors] }));
    setSelectedVendors([]);
    setAddVendorsDialog(false);
  };

 const handleQuoteChange = useCallback((
  itemId: string,
  vendorId: string,
  quote: number | undefined,
) => {
  setFormData((prev) => ({
    ...prev,
    details: {
      ...prev.details,
      [itemId]: {
        ...prev.details[itemId],
        vendorQuotes: {
          ...prev.details[itemId].vendorQuotes,
          [vendorId]: { ...(prev.details[itemId].vendorQuotes[vendorId] || {}), quote: quote },
        },
      },
    },
  }))

  const isValidQuote = quote && quote > 0;
  if (!isValidQuote) {
    setSelectedVendorQuotes(prev => {
      const updated = new Map(prev);
      if (updated.get(itemId) === vendorId) {
        updated.delete(itemId);
      }
      return updated;
    });
  }
}, []);


const handleReviewChanges = async () => {
  const updatedOrderList = orderData?.procurement_list?.list?.map((item) => {
    if (selectedVendorQuotes.has(item.name)) {
      const vendorId : string = selectedVendorQuotes.get(item.name);
      const vendorData = formData.details?.[item.name]?.vendorQuotes?.[vendorId];
      if (vendorData) {
        return {
          ...item,
          vendor: vendorId,
          quote: vendorData.quote,
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
      <div className="flex items-center max-sm:items-end justify-between">
      <div className="flex gap-4 max-sm:flex-col">
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

      <div className="flex gap-2 items-center">
        {mode === "edit" && (
          <Button onClick={() => setAddVendorsDialog(true)} variant={"outline"} className="text-primary border-primary flex gap-1">
          <CirclePlus className="w-4 h-4" />
          Add {formData?.selectedVendors?.length > 0 && "More"} Vendors
        </Button>
        )}

        <Button disabled variant={"outline"} className="text-primary border-primary flex gap-1">
          <FolderPlus className="w-4 h-4" />
          Generate RFQ
        </Button>
      </div>

      </div>
      <div className="overflow-x-auto space-y-4 rounded-md border shadow-sm p-4">
              {orderData?.category_list?.list.map((cat: any, index) => {
                return <div key={cat.name} className="min-w-[400px]">
                  <Table>
                    <TableHeader>
                      {index === 0 && (
                      <TableRow className="bg-red-100">
                        <TableHead className="min-w-[200px] w-[30%] text-red-700 font-bold">
                          Item Details
                        </TableHead>
                        <TableHead className="min-w-[80px] w-[10%] text-red-700 font-bold">QTY</TableHead>
                        <TableHead className="min-w-[80px] w-[10%] text-red-700 font-bold">UOM</TableHead>
                        {formData?.selectedVendors?.length === 0 ? (
                          <TableHead className="min-w-[300px] w-[50%] text-red-700">
                          <p className="border text-center border-gray-400 rounded-md py-1 font-medium">No Vendors Selected</p>
                        </TableHead>
                        ) : (
                          formData?.selectedVendors?.map((v, _) => <TableHead key={v?.value} className={`text-center w-[15%] text-red-700 text-xs font-medium`}>
                            <p className="min-w-[150px] max-w-[150px] border border-gray-400 rounded-md py-1 flex gap-1 items-center justify-center">
                                <div className="truncate text-left">
                                  <VendorHoverCard vendor_id={v?.value} />
                                </div>
                            {mode === "edit" &&  (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <CircleMinus className="w-4 h-4 cursor-pointer" />
                                </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                  <AlertDialogDescription>Click on confirm to remove this vendor?</AlertDialogDescription>
                                  <div className="flex items-end justify-end gap-2">
                                    <AlertDialogCancel asChild>
                                      <Button variant="outline" className="border-primary text-primary">Cancel</Button>
                                    </AlertDialogCancel>
                                    <Button onClick={() => removeVendor(v?.value || "")} className="flex items-center gap-1">
                                      <CheckCheck className="h-4 w-4" />
                                      Confirm
                                    </Button>
                                  </div>
                                </AlertDialogHeader>

                              </AlertDialogContent>
                            </AlertDialog>
                            )}
                            </p>
                            </TableHead>)
                        )}
                      </TableRow>
                      )}
                      <TableRow className="bg-red-50">
                        <TableHead className="min-w-[200px] w-[30%] text-red-700">
                          {cat.name}
                        </TableHead>
                        <TableHead className="min-w-[80px] w-[10%]" />
                        <TableHead className="min-w-[80px] w-[10%]" />
                        {formData?.selectedVendors?.length === 0 ? (
                          <TableHead className="min-w-[300px] w-[50%]" />
                        ) : (
                          formData?.selectedVendors?.map((v, _, arr) => <TableHead className={`min-w-[150px] w-[15%] max-w-[150px]`} />)
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderData?.procurement_list?.list.map((item: any) => {
                        if (item.category === cat.name) {
                          return (
                            <TableRow key={`${cat.name}-${item.name}`}>
                              <TableCell className="py-8">
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
                              {formData?.selectedVendors?.map(v => {
                                const data = formData?.details?.[item.name]?.vendorQuotes?.[v?.value]
                                const quote = data?.quote
                                const make = data?.make
                                const isSelected = mode === "view" && selectedVendorQuotes?.get(item?.name) === v?.value;
                                return (
                                  <TableCell key={`${item.name}-${v?.value}`}>
                                    <div aria-disabled={mode === "edit" || !quote} aria-checked={isSelected} 
                                    onClick={() => {
                                      if(mode === "edit") {
                                        return
                                      }
                                      if(isSelected) {
                                        const updatedQuotes = new Map(selectedVendorQuotes);
                                        updatedQuotes.delete(item.name);
                                        setSelectedVendorQuotes(updatedQuotes);
                                      } else {
                                        setSelectedVendorQuotes(new Map(selectedVendorQuotes.set(item.name, v?.value)));
                                      }
                                    }} 
                                    role="radio" 
                                    tabIndex={0} 
                                    className={`min-w-[150px] max-w-[150px] space-y-3 p-3 border border-gray-300 rounded-md shadow-md transition-all 
                                    ring-offset-2 ring-gray-300 focus:ring-2 focus:ring-primary hover:shadow-lg ${mode === "view" && !quote ? "pointer-events-none opacity-50" : ""} ${isSelected ? "bg-red-100 ring-2 ring-primary" : "bg-white"}`}>
                                      <div className="flex flex-col gap-1">
                                        <Label className="text-xs font-semibold text-primary">Make</Label>
                                        {mode === "edit" ? (
                                           <MakesSelection vendor={v} item={item} formData={formData} orderData={orderData} setFormData={setFormData} />
                                        ) : (
                                          <p className="text-sm font-medium text-gray-700">{make || "--"}</p>
                                        )}
                                      </div>
                                      <div className="flex flex-col gap-1">
                                        <Label className="text-xs font-semibold text-primary">Rate</Label>
                                        {mode === "edit" ? (
                                          <Input className="h-8" type="number" value={quote || ""} onChange={(e) => {
                                            const value = e.target.value === "" ? 0 : parseInt(e.target.value)
                                            handleQuoteChange(item.name, v?.value || "", value)
                                          }} />
                                        ) : (
                                          <p>{quote ?  formatToIndianRupee(quote) : "--"}</p>
                                        )}
                                      </div>
                                    </div>
                                  </TableCell>
                                )
                              })}
                            </TableRow>
                          )
                        }
                      })}
                    </TableBody>
                  </Table>
                </div>
              })}
      </div>  
      
      <div className="flex justify-end">
        <Button disabled={mode === "edit" || !selectedVendorQuotes?.size} onClick={handleReviewChanges}>Continue</Button>
      </div>

      <AlertDialog open={addVendorsDialog} onOpenChange={() => setAddVendorsDialog(!addVendorsDialog)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-center">Add Vendors</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            <VendorsReactMultiSelect vendorOptions={vendorOptions || []} setSelectedVendors={setSelectedVendors} />
          </AlertDialogDescription>
          <div className="flex items-end gap-4">
            <AlertDialogCancel className="flex-1">Cancel</AlertDialogCancel>
            <Button onClick={handleVendorSelection} className="flex-1">Confirm</Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
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


interface MakesSelectionProps {
  vendor: Vendor
  item: ProcurementItem
  formData: RFQData
  orderData: ProcurementRequest | SentBackCategory
  setFormData: any
}


export const MakesSelection : React.FC<MakesSelectionProps> = ({ vendor, item, formData, orderData, setFormData }) => {

  const [showAlert, setShowAlert] = useState(false);
  const toggleShowAlert = () => {
    setShowAlert((prevState) => !prevState);
  };

  const [makeOptions, setMakeOptions] = useState([]);

  const [newSelectedMakes, setNewSelectedMakes] = useState([]);

  const { data: categoryMakeList, isLoading: categoryMakeListLoading, mutate: categoryMakeListMutate } = useFrappeGetDocList("Category Makelist", {
    fields: ["*"],
    limit: 100000,
  })

  useEffect(() => {
    if (categoryMakeList?.length > 0) {
      const categoryMakes = categoryMakeList?.filter((i) => i?.category === item?.category);
      const makeOptionsList = categoryMakes?.map((i) => ({ label: i?.make, value: i?.make })) || [];
      const filteredOptions = makeOptionsList?.filter(i => !formData?.details?.[item?.name]?.makes?.some(j => j === i?.value))
      setMakeOptions(filteredOptions)
    }

  }, [categoryMakeList, item, formData, orderData])

  const editMakeOptions = formData?.details?.[item?.name]?.makes?.map((i) => ({
    value: i,
    label: i,
  }));

  // const selectedMake = quotationData?.list
  //   ?.find((j) => j?.qr_id === q?.name)
  //   ?.makes?.find((m) => m?.enabled === "true");

  const selectedMakeName = formData?.details?.[item?.name]?.vendorQuotes?.[vendor?.value]?.make


  const selectedVendorMake = { value: selectedMakeName, label: selectedMakeName }
  // const selectedMakeValue = selectedMake
  //   ? { value: selectedMake?.make, label: selectedMake?.make }
  //   : selectedMakefromq
  //   ? { value: selectedMakefromq?.make, label: selectedMakefromq?.make }
  //   : null;

  const handleMakeChange = (make) => {
    setFormData((prev) => ({
      ...prev,
      details: {
        ...prev.details,
        [item?.name]: {
          ...prev.details[item?.name],
          vendorQuotes: {
            ...prev.details[item?.name].vendorQuotes,
            [vendor?.value]: { ...(prev.details[item?.name].vendorQuotes[vendor?.value] || {}), make: make.value },
          },
        },
      },
    }));
  }

  const handleAddNewMakes = () => {
    const newMakes = newSelectedMakes?.map(i => i?.value)
    setFormData((prev) => ({
      ...prev,
      details: {
        ...prev.details,
        [item?.name]: {
          ...prev.details[item?.name],
         makes : [...prev.details[item?.name].makes, ...newMakes]
        },
      },
    }));

    setNewSelectedMakes([])
    toggleShowAlert()
  }

  const CustomMenu = (props) => {
    const { MenuList } = components;

    return (
      <MenuList {...props}>
        {props.children}
        <div
          className="p-2 bg-gray-100 hover:bg-gray-200 text-center cursor-pointer"
          onClick={() => toggleShowAlert()}
        >
          <strong>Add New Make</strong>
        </div>
      </MenuList>
    );
  };

  return (
    <>
    <div className="w-full">
      <ReactSelect
        className="w-full"
        placeholder="Select Make..."
        value={selectedVendorMake}
        options={editMakeOptions}
        onChange={handleMakeChange}
        components={{ MenuList: CustomMenu }}
      />
    </div>

    <Dialog open={showAlert} onOpenChange={toggleShowAlert}>
      <DialogContent className="text-start">
        <DialogHeader>
          <DialogTitle>Add New Makes</DialogTitle>
        </DialogHeader>
        <DialogDescription>
        <div className="flex gap-1 flex-wrap mb-4">
          {editMakeOptions?.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="font-semibold">Existing Makes for this item:</h2>
              <div className="flex gap-1 flex-wrap">
              {editMakeOptions?.map((i) => (
                <Badge key={i?.value}>{i?.value}</Badge>
              ))}
              </div>
            </div>
          )}
        </div>
        <div className="mb-4">
          <Label>
            Select New Make
          </Label>
          {categoryMakeList && (
            <ReactSelect options={makeOptions} value={newSelectedMakes} isMulti onChange={(selectedOptions) => setNewSelectedMakes(selectedOptions)} />
          )}
        </div>
        <div className="flex justify-end gap-2 items-center">
            <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button onClick={handleAddNewMakes} disabled={!newSelectedMakes?.length} className="flex items-center gap-1">
            <ListChecks className="h-4 w-4" />
            Confirm
          </Button>
        </div>
        </DialogDescription>
      </DialogContent>
    </Dialog>
    </>
  );
};
