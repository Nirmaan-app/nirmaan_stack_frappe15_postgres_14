import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { VendorHoverCard } from "@/components/ui/vendor-hover-card";
import { ProcurementRequest, RFQData } from "@/types/NirmaanStack/ProcurementRequests";
import { SentBackCategory } from "@/types/NirmaanStack/SentBackCategory";
import formatToIndianRupee from "@/utils/FormatPrice";
import { CheckCheck, CircleMinus, MessageCircleMore } from "lucide-react";
import React from "react";
import { MakesSelection } from "./ItemVendorMakeSelection";

interface SelectVendorQuotesTableProps {
  sentBack?: boolean
  orderData : ProcurementRequest | SentBackCategory
  formData : RFQData
  setFormData : React.Dispatch<React.SetStateAction<RFQData>>
  selectedVendorQuotes : Map<any, any>
  setSelectedVendorQuotes : React.Dispatch<React.SetStateAction<Map<any, any>>>
  mode : string
  handleQuoteChange : (itemId: string, vendorId: string, quote: number | undefined) => void
  removeVendor : (vendorId: string) => void
}

export const SelectVendorQuotesTable : React.FC<SelectVendorQuotesTableProps> = ({sentBack = false, orderData, formData, setFormData, selectedVendorQuotes, setSelectedVendorQuotes, mode, handleQuoteChange, removeVendor}) => {
  return (
        <div className="overflow-x-auto space-y-4 rounded-md border shadow-sm p-4">
              {orderData?.category_list?.list.map((cat: any, index : number) => {
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
                      {(sentBack ? (orderData as SentBackCategory)?.item_list : (orderData as ProcurementRequest)?.procurement_list)?.list.map((item: any) => {
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
  )
}