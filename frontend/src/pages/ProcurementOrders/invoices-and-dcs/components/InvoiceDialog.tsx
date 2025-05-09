// import { CustomAttachment } from "@/components/helpers/CustomAttachment";
// import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
// import { Button } from "@/components/ui/button";
// import { Input } from "@/components/ui/input";
// import { Label } from "@/components/ui/label";
// import { toast } from "@/components/ui/use-toast";
// import { useUserData } from "@/hooks/useUserData";
// import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
// import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
// import { parseNumber } from "@/utils/parseNumber";
// import { useDialogStore } from "@/zustand/useDialogStore";
// import { useFrappeFileUpload, useFrappePostCall, useSWRConfig } from "frappe-react-sdk";
// import { useCallback, useState } from "react";
// import { TailSpin } from "react-loader-spinner";

// interface InvoiceDialogProps {
//   po?: ProcurementOrder | null
//   poMutate?: any
//   sr?: ServiceRequests | null
// }

// export const InvoiceDialog: React.FC<InvoiceDialogProps> = ({ po, poMutate, sr }) => {

//   const {toggleNewInvoiceDialog, newInvoiceDialog} = useDialogStore()
//   const {mutate} = useSWRConfig()
//   const userData = useUserData();
//   const [selectedAttachment, setSelectedAttachment] = useState<File | null>(null);

//   const { call: InvoiceUpdateCall, loading: InvoiceUpdateCallLoading } = useFrappePostCall(
//       "nirmaan_stack.api.delivery_notes.update_invoice_data.update_invoice_data"
//     );

//   const { upload, loading: uploadLoading } = useFrappeFileUpload();
//   const [invoiceData, setInvoiceData] = useState({
//     invoice_no: "",
//     amount: "",
//     date: "",
//   });

//   const uploadInvoice = useCallback(async () => {
//       if (!selectedAttachment) return null;
  
//       try {
//         const result = await upload(selectedAttachment, {
//           doctype: sr ? "Service Requests" : "Procurement Orders",
//           docname: po?.name || sr?.name,
//           fieldname: "attachment",
//           isPrivate: true
//         });
//         return result.file_url;
//       } catch (error) {
//         toast({
//           title: "Upload Failed",
//           description: "Failed to upload Invoice attachment",
//           variant: "destructive"
//         });
//         return null;
//       }
//     }, [selectedAttachment, po, sr, upload, toast]);

//   const handleUpdateInvoiceData = useCallback(async () => {
//         try {
//           const attachmentId = await uploadInvoice();
          
//           const modifiedInvoiceData = {...invoiceData, 
//             // invoice_attachment_id: attachmentId,
//             updated_by: userData?.user_id
//           };
    
//           const payload = {
//             po_id: po?.name || sr?.name,
//             invoice_data: modifiedInvoiceData,
//             invoice_attachment: attachmentId,
//             isSR: sr ? true : false
//           };
    
//           const response = await InvoiceUpdateCall(JSON.stringify(payload));
    
//           if (response.message.status === 200) {
//             await poMutate();
//             await mutate(`Nirmaan Attachments-${po?.name || sr?.name}`)
//             toggleNewInvoiceDialog();
//             setInvoiceData({
//               invoice_no: "",
//               amount: "",
//               date: "",
//             });
//             setSelectedAttachment(null);
    
//             toast({
//               title: "Success!",
//               description: response.message.message,
//               variant: "success"
//             });
    
//           } else if (response.message.status === 400) {
//             toast({
//               title: "Failed!",
//               description: response.message.error,
//               variant: "destructive"
//             });
//           }
//         } catch (error) {
//           console.error("Error updating Invoice data:", error);
//           toast({
//             title: "Update Failed",
//             description: "Failed to Update Invoice Data",
//             variant: "destructive"
//           });
//         }
//       }, [po, sr, userData, InvoiceUpdateCall, poMutate, toggleNewInvoiceDialog, toast, uploadInvoice]);
    

  
//   return (
//     <AlertDialog open={newInvoiceDialog} onOpenChange={toggleNewInvoiceDialog}>
//     <AlertDialogContent className="max-w-xs">
//       <AlertDialogHeader>
//         <AlertDialogTitle className="text-center">Add Invoice</AlertDialogTitle>
//       </AlertDialogHeader>
//                               <div className="flex flex-col gap-4 pt-4">
//                                   <div className="flex gap-4 w-full">
//                                       <Label className="w-[40%]">Invoice No.<sup className="text-sm text-red-600">*</sup></Label>
//                                       <Input
//                                           type="text"
//                                           placeholder="Enter Invoice no."
//                                           value={invoiceData.invoice_no}
//                                           onChange={(e) => setInvoiceData((prev) => ({...prev, invoice_no: e.target.value}))}
//                                       />
//                                   </div>
//                                   <div className="flex gap-4 w-full" >
//                                       <Label className="w-[40%]">Date<sup className=" text-sm text-red-600">*</sup></Label>
//                                       <Input
//                                               type="date"
//                                               placeholder="DD/MM/YYYY"
//                                               value={invoiceData.date}
//                                               onChange={(e) => setInvoiceData((prev) => ({...prev, date: e.target.value}))}
//                                               max={new Date().toISOString().split("T")[0]}
//                                               onKeyDown={(e) => e.preventDefault()}
//                                            />
//                                   </div>
//                                   <div className="flex gap-4 w-full">
//                                       <Label className="w-[40%]">Amount<sup className=" text-sm text-red-600">*</sup></Label>
//                                       <Input
//                                           type="number"
//                                           placeholder="Enter Invoice Amount"
//                                           value={invoiceData.amount}
//                                           onChange={(e) => setInvoiceData((prev) => ({...prev, amount: parseNumber(e.target.value)}))}
//                                       />
//                                   </div>
//                               </div>
      
//                                         <CustomAttachment
//                                               maxFileSize={20 * 1024 * 1024} // 20MB
//                                               selectedFile={selectedAttachment}
//                                               onFileSelect={setSelectedAttachment}
//                                               label="Attach Invoice"
//                                               className="w-full"
//                                             />
      
//                               <div className="flex gap-2 items-start pt-4 justify-center">
      
//                                   {uploadLoading || InvoiceUpdateCallLoading ? <TailSpin color="red" width={40} height={40} /> : (
//                                       <>
//                                           <AlertDialogCancel className="flex-1" asChild>
//                                               <Button variant={"outline"} className="border-primary text-primary">Cancel</Button>
//                                           </AlertDialogCancel>
//                                           <Button
//                                               onClick={handleUpdateInvoiceData}
//                                               disabled={!selectedAttachment || !invoiceData.date || !invoiceData.invoice_no || !invoiceData.amount}
//                                               className="flex-1">Confirm
//                                           </Button>
//                                       </>
//                                   )}
//                               </div>

//     </AlertDialogContent>
//   </AlertDialog>
//   )
// }


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
import { useCallback, useState, useEffect } from "react"; // Import useEffect
import { TailSpin } from "react-loader-spinner";
import { KeyedMutator } from 'swr';

type DocumentType = ProcurementOrder | ServiceRequests;
interface InvoiceDialogProps<T extends DocumentType> {
  // Consider passing doctype and docname instead for better reusability
  docType: "Procurement Orders" | "Service Requests";
  docName: string | undefined;
  // Pass mutate function tied to the specific document being updated
  docMutate: KeyedMutator<T[]>;
}

// Update component signature
export function InvoiceDialog<T extends DocumentType>({
  docType, docName, docMutate
}: InvoiceDialogProps<T>) {

  const { toggleNewInvoiceDialog, newInvoiceDialog } = useDialogStore();
  const { mutate: globalMutate } = useSWRConfig(); // Use for broader mutations like attachments if needed
  const userData = useUserData();
  const [selectedAttachment, setSelectedAttachment] = useState<File | null>(null);

  // Initial invoice state
  const initialInvoiceState = {
    invoice_no: "",
    amount: "",
    date: "",
  };
  const [invoiceData, setInvoiceData] = useState(initialInvoiceState);

  // API call hook
  const { call: updateInvoiceApiCall, loading: updateInvoiceApiCallLoading } = useFrappePostCall(
    "nirmaan_stack.api.delivery_notes.update_invoice_data.update_invoice_data"
  );

  // File upload hook
  const { upload, loading: uploadLoading } = useFrappeFileUpload();

  // Reset form when dialog closes
  useEffect(() => {
    if (!newInvoiceDialog) {
      setInvoiceData(initialInvoiceState);
      setSelectedAttachment(null);
    }
  }, [newInvoiceDialog]);


  const uploadInvoice = useCallback(async () => {
    if (!selectedAttachment || !docName || !docType) return null;

    try {
      // Always upload as private for financial documents
      const result = await upload(selectedAttachment, {
        doctype: docType,
        docname: docName,
        fieldname: "attachment", // This field might not exist directly on PO/SR, but Frappe handles it
        isPrivate: true
      });
      console.log("Upload successful:", result);
      return result.file_url; // Return the URL needed by the backend API
    } catch (error) {
      console.error("Upload Error:", error);
      toast({
        title: "Upload Failed",
        description: `Failed to upload Invoice attachment: ${error instanceof Error ? error.message : String(error)}`,
        variant: "destructive"
      });
      throw error; // Re-throw to stop the submission process
    }
  }, [selectedAttachment, docType, docName, upload, toast]);

  const handleUpdateInvoiceData = useCallback(async () => {
    if (!docName) {
        toast({ title: "Error", description: "Document name is missing.", variant: "destructive" });
        return;
    }
    if (!invoiceData.date || !invoiceData.invoice_no || !invoiceData.amount) {
        toast({ title: "Validation Error", description: "Please fill all required fields (Invoice No, Date, Amount).", variant: "destructive" });
        return;
    }

    try {
      // 1. Upload attachment if selected
      let attachmentUrl: string | null = null;
      if (selectedAttachment) {
        attachmentUrl = await uploadInvoice();
        // If upload fails, uploadInvoice will throw, stopping execution here
      }

      // 2. Prepare data for the API call
      const invoicePayloadForApi = {
        invoice_no: invoiceData.invoice_no,
        amount: parseNumber(invoiceData.amount), // Ensure amount is a number
        date: invoiceData.date,
        updated_by: userData?.user_id // Add user ID here
      };

      // 3. Prepare the main API payload
      const apiPayload = {
        docname: docName,
        // Pass invoice_data as a JSON string as expected by the backend
        invoice_data: JSON.stringify(invoicePayloadForApi),
        invoice_attachment: attachmentUrl, // Pass the URL or null
        isSR: docType === "Service Requests"
      };

      // 4. Call the backend API
      console.log("Calling updateInvoiceApiCall with payload:", apiPayload);
      const response = await updateInvoiceApiCall(apiPayload);
      console.log("API Response:", response);

      // 5. Handle response
      if (response.message?.status === 200) {
        toast({
          title: "Success!",
          description: response.message.message || `Invoice data updated for ${docName}.`,
          variant: "success"
        });
        await docMutate(); // Refresh the specific PO/SR data
        // Optionally refresh attachments list if displayed separately
        await globalMutate((key) => typeof key === 'string' && key.startsWith('Nirmaan Attachments-'));
        toggleNewInvoiceDialog(); // Close dialog on success

      } else {
        // Handle specific errors or show generic message from backend
        throw new Error(response.message?.message || `Failed to update invoice data.`);
      }
    } catch (error) {
      console.error("Error updating Invoice data:", error);
      toast({
        title: "Update Failed",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
        variant: "destructive"
      });
    }
  }, [
      docName,
      docType,
      userData?.user_id,
      invoiceData,
      selectedAttachment,
      uploadInvoice,
      updateInvoiceApiCall,
      docMutate,
      globalMutate,
      toggleNewInvoiceDialog,
      toast
    ]);

  // Combine loading states for the UI
  const isLoading = uploadLoading || updateInvoiceApiCallLoading;

  return (
    <AlertDialog open={newInvoiceDialog} onOpenChange={!isLoading ? toggleNewInvoiceDialog : undefined}> {/* Prevent closing while loading */}
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-center">Add Invoice</AlertDialogTitle>
        </AlertDialogHeader>
        <div className="flex flex-col gap-4 pt-4">
          {/* Invoice No */}
          <div className="grid grid-cols-3 items-center gap-4">
            <Label htmlFor="invoice_no" className="text-right col-span-1">Invoice No.<sup className="text-red-500">*</sup></Label>
            <Input
              id="invoice_no"
              type="text"
              placeholder="Enter Invoice no."
              value={invoiceData.invoice_no}
              onChange={(e) => setInvoiceData((prev) => ({ ...prev, invoice_no: e.target.value }))}
              className="col-span-2"
              disabled={isLoading}
            />
          </div>
          {/* Date */}
          <div className="grid grid-cols-3 items-center gap-4">
            <Label htmlFor="invoice_date" className="text-right col-span-1">Date<sup className="text-red-500">*</sup></Label>
            <Input
              id="invoice_date"
              type="date"
              value={invoiceData.date}
              onChange={(e) => setInvoiceData((prev) => ({ ...prev, date: e.target.value }))}
              max={new Date().toISOString().split("T")[0]} // Prevent future dates
              className="col-span-2"
              disabled={isLoading}
            />
          </div>
          {/* Amount */}
          <div className="grid grid-cols-3 items-center gap-4">
            <Label htmlFor="invoice_amount" className="text-right col-span-1">Amount<sup className="text-red-500">*</sup></Label>
            <Input
              id="invoice_amount"
              type="text" // Use text to allow better validation/parsing if needed
              inputMode="decimal" // Hint for mobile keyboards
              placeholder="Enter Amount"
              value={invoiceData.amount}
              onChange={(e) => {
                 // Allow only numbers and one decimal point
                 const value = e.target.value;
                 if (/^\d*\.?\d*$/.test(value)) {
                    setInvoiceData((prev) => ({ ...prev, amount: value }));
                 }
              }}
              className="col-span-2"
              disabled={isLoading}
            />
          </div>
        </div>

        <CustomAttachment
          maxFileSize={20 * 1024 * 1024} // 20MB
          selectedFile={selectedAttachment}
          onFileSelect={setSelectedAttachment}
          label="Attach Invoice"
          className="w-full mt-4"
          disabled={isLoading}
        />

        <div className="flex gap-2 items-center pt-6 justify-end">
          {isLoading ? (
            <div className='flex justify-center w-full'> <TailSpin color="red" width={30} height={30} /> </div>
             ) : (
            <>
              <AlertDialogCancel asChild>
                <Button variant={"outline"} disabled={isLoading}>Cancel</Button>
              </AlertDialogCancel>
              <Button
                onClick={handleUpdateInvoiceData}
                // Enable button only when required fields are filled
                disabled={!invoiceData.date || !invoiceData.invoice_no || !invoiceData.amount || isLoading || !selectedAttachment}
              >
                Confirm
              </Button>
            </>
          )}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}