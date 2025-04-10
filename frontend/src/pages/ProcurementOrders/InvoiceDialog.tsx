import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { parseNumber } from "@/utils/parseNumber";
import { useDialogStore } from "@/zustand/useDialogStore";
import { useFrappeFileUpload, useFrappePostCall, useSWRConfig } from "frappe-react-sdk";
import { useCallback, useState } from "react";
import { TailSpin } from "react-loader-spinner";

interface InvoiceDialogProps {
  po?: ProcurementOrder | null
  poMutate?: any
  sr?: ServiceRequests | null
}

export const InvoiceDialog: React.FC<InvoiceDialogProps> = ({ po, poMutate, sr }) => {

  const {toggleNewInvoiceDialog, newInvoiceDialog} = useDialogStore()
  const {mutate} = useSWRConfig()
  const userData = useUserData();
  const [selectedAttachment, setSelectedAttachment] = useState<File | null>(null);

  const { call: InvoiceUpdateCall, loading: InvoiceUpdateCallLoading } = useFrappePostCall(
      "nirmaan_stack.api.delivery_notes.update_invoice_data.update_invoice_data"
    );

  const { upload, loading: uploadLoading } = useFrappeFileUpload();
  const [invoiceData, setInvoiceData] = useState({
    invoice_no: "",
    amount: "",
    date: "",
  });

  const uploadInvoice = useCallback(async () => {
      if (!selectedAttachment) return null;
  
      try {
        const result = await upload(selectedAttachment, {
          doctype: sr ? "Service Requests" : "Procurement Orders",
          docname: po?.name || sr?.name,
          fieldname: "attachment",
          isPrivate: true
        });
        return result.file_url;
      } catch (error) {
        toast({
          title: "Upload Failed",
          description: "Failed to upload Invoice attachment",
          variant: "destructive"
        });
        return null;
      }
    }, [selectedAttachment, po, sr, upload, toast]);

  const handleUpdateInvoiceData = useCallback(async () => {
        try {
          const attachmentId = await uploadInvoice();
          
          const modifiedInvoiceData = {...invoiceData, 
            // invoice_attachment_id: attachmentId,
            updated_by: userData?.user_id
          };
    
          const payload = {
            po_id: po?.name || sr?.name,
            invoice_data: modifiedInvoiceData,
            invoice_attachment: attachmentId,
            isSR: sr ? true : false
          };
    
          const response = await InvoiceUpdateCall(payload);
    
          if (response.message.status === 200) {
            await poMutate();
            await mutate(`Nirmaan Attachments-${po?.name || sr?.name}`)
            toggleNewInvoiceDialog();
            setInvoiceData({
              invoice_no: "",
              amount: "",
              date: "",
            });
            setSelectedAttachment(null);
    
            toast({
              title: "Success!",
              description: response.message.message,
              variant: "success"
            });
    
          } else if (response.message.status === 400) {
            toast({
              title: "Failed!",
              description: response.message.error,
              variant: "destructive"
            });
          }
        } catch (error) {
          console.error("Error updating Invoice data:", error);
          toast({
            title: "Update Failed",
            description: "Failed to Update Invoice Data",
            variant: "destructive"
          });
        }
      }, [po, sr, userData, InvoiceUpdateCall, poMutate, toggleNewInvoiceDialog, toast, uploadInvoice]);
    

  
  return (
    <AlertDialog open={newInvoiceDialog} onOpenChange={toggleNewInvoiceDialog}>
    <AlertDialogContent className="max-w-xs">
      <AlertDialogHeader>
        <AlertDialogTitle className="text-center">Add Invoice</AlertDialogTitle>
      </AlertDialogHeader>
                              <div className="flex flex-col gap-4 pt-4">
                                  <div className="flex gap-4 w-full">
                                      <Label className="w-[40%]">Invoice No.<sup className="text-sm text-red-600">*</sup></Label>
                                      <Input
                                          type="text"
                                          placeholder="Enter Invoice no."
                                          value={invoiceData.invoice_no}
                                          onChange={(e) => setInvoiceData((prev) => ({...prev, invoice_no: e.target.value}))}
                                      />
                                  </div>
                                  <div className="flex gap-4 w-full" >
                                      <Label className="w-[40%]">Date<sup className=" text-sm text-red-600">*</sup></Label>
                                      <Input
                                              type="date"
                                              placeholder="DD/MM/YYYY"
                                              value={invoiceData.date}
                                              onChange={(e) => setInvoiceData((prev) => ({...prev, date: e.target.value}))}
                                              max={new Date().toISOString().split("T")[0]}
                                              onKeyDown={(e) => e.preventDefault()}
                                           />
                                  </div>
                                  <div className="flex gap-4 w-full">
                                      <Label className="w-[40%]">Amount<sup className=" text-sm text-red-600">*</sup></Label>
                                      <Input
                                          type="number"
                                          placeholder="Enter Invoice Amount"
                                          value={invoiceData.amount}
                                          onChange={(e) => setInvoiceData((prev) => ({...prev, amount: parseNumber(e.target.value)}))}
                                      />
                                  </div>
                              </div>
      
                                        <CustomAttachment
                                              maxFileSize={20 * 1024 * 1024} // 20MB
                                              selectedFile={selectedAttachment}
                                              onFileSelect={setSelectedAttachment}
                                              label="Attach Invoice"
                                              className="w-full"
                                            />
      
                              <div className="flex gap-2 items-start pt-4 justify-center">
      
                                  {uploadLoading || InvoiceUpdateCallLoading ? <TailSpin color="red" width={40} height={40} /> : (
                                      <>
                                          <AlertDialogCancel className="flex-1" asChild>
                                              <Button variant={"outline"} className="border-primary text-primary">Cancel</Button>
                                          </AlertDialogCancel>
                                          <Button
                                              onClick={handleUpdateInvoiceData}
                                              disabled={!selectedAttachment || !invoiceData.date || !invoiceData.invoice_no || !invoiceData.amount}
                                              className="flex-1">Confirm
                                          </Button>
                                      </>
                                  )}
                              </div>

    </AlertDialogContent>
  </AlertDialog>
  )
}