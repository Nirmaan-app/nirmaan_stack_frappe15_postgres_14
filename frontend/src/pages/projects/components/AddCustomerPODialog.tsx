
// import { Button } from "@/components/ui/button";
// import {
//     Dialog,
//     DialogContent,
//     DialogHeader,
//     DialogTitle,
//     DialogTrigger
// } from "@/components/ui/dialog";
// import { Input } from "@/components/ui/input";
// import { Label } from "@/components/ui/label";
// import { Textarea } from "@/components/ui/textarea";
// import { toast } from "@/components/ui/use-toast";
// // CORRECTED: Import useFrappePostCall and useFrappeFileUpload
// import { useFrappePostCall, useFrappeFileUpload } from "frappe-react-sdk"; 
// import { CirclePlus, Loader2 } from "lucide-react";
// import React, { useCallback, useState, ChangeEvent, useMemo } from "react";

// // Define the interface for a single row in the 'customer_po_details' child table
// export interface CustomerPODetail {
//     name: string; // Frappe docname of the child record
//     idx: number; // Frappe index
//     customer_po_number: string;
//     customer_po_value_inctax: number;
//     customer_po_value_exctax: number;
//     customer_po_link: string;
//     customer_po_attachment: string; // File URL/Name
//     customer_po_payment_terms: string;
// }

// interface AddCustomerPODialogProps {
//     projectName: string; // Name of the parent Projects doc (e.g., "PROJ/0001")
//     currentCustomerPODetails: CustomerPODetail[];
//     refetchProjectData: () => Promise<any>;
// }

// type LinkAttachmentChoice = 'link' | 'attachment' | 'none';

// // Define the custom Frappe method name
// // IMPORTANT: Update this with the actual path to your Python function.
// const CUSTOM_API_METHOD = 'nirmaan_stack.api.projects.add_customer_po.add_customer_po_with_validation'; 

// export const AddCustomerPODialog: React.FC<AddCustomerPODialogProps> = ({ projectName, currentCustomerPODetails, refetchProjectData }) => {
//     const [open, setOpen] = useState(false);
    
//     // State for Link/Attachment choice
//     const [linkOrAttachmentChoice, setLinkOrAttachmentChoice] = useState<LinkAttachmentChoice>('none');
    
//     const [formData, setFormData] = useState<Omit<CustomerPODetail, 'name' | 'idx' | 'customer_po_attachment'> & { file: File | null, customer_po_attachment: string }>({
//         customer_po_number: '',
//         customer_po_value_inctax: 0,
//         customer_po_value_exctax: 0,
//         customer_po_link: '',
//         customer_po_payment_terms: '',
//         file: null,
//         customer_po_attachment: '', // Stores display name of the selected file
//     });

//     // CORRECTION: Initialize useFrappePostCall and pass the method name
//     const {  call: CustomerPoCreate, loading: callLoading } = useFrappePostCall<{ message: string }>(CUSTOM_API_METHOD); 
//     // CHANGE: Initialize useFrappeFileUpload for handling the attachment
//     const { upload, loading: uploadLoading } = useFrappeFileUpload();
    
//     // Combined loading state for button disabling
//     const updateLoading = callLoading || uploadLoading;

//     const handleInputChange = useCallback((e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
//         const { id, value } = e.target;
//         setFormData(prev => ({
//             ...prev,
//             [id]: (id === 'customer_po_value_inctax' || id === 'customer_po_value_exctax')
//                 ? parseFloat(value || '0')
//                 : value,
//         }));
//     }, []);

//     const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
//         const file = e.target.files?.[0] || null;
//         setFormData(prev => ({
//             ...prev,
//             file: file,
//             // Store the local file name for display and form state
//             customer_po_attachment: file ? file.name : '', 
//         }));
//     }, []);
    
//     // Handler for radio button change
//     const handleChoiceChange = useCallback((choice: LinkAttachmentChoice) => {
//         setLinkOrAttachmentChoice(choice);
//         // Reset the input values when the choice changes to ensure only one field is sent
//         setFormData(prev => ({
//             ...prev,
//             customer_po_link: choice === 'link' ? prev.customer_po_link : '',
//             customer_po_attachment: choice === 'attachment' ? prev.customer_po_attachment : '', // Keep file name if it exists
//             file: choice === 'attachment' ? prev.file : null, // Keep file object if it exists
//         }));
//     }, []);

//     const resetForm = useCallback(() => {
//         setFormData({
//             customer_po_number: '',
//             customer_po_value_inctax: 0,
//             customer_po_value_exctax: 0,
//             customer_po_link: '',
//             customer_po_payment_terms: '',
//             file: null,
//             customer_po_attachment: '',
//         });
//         setLinkOrAttachmentChoice('none');
//     }, []);

//     const handleSubmit = async (e: React.FormEvent) => {
//         e.preventDefault();
//         if (!projectName) {
//             toast({ title: "Error", description: "Project Name is missing.", variant: "destructive" });
//             return;
//         }
        
//         // Ensure form is valid before proceeding
//         if (!isFormValid) {
//             toast({ title: "Error", description: "Please fill all required fields.", variant: "destructive" });
//             return;
//         }

//         let finalAttachmentName = '';

//         // 1. Handle File Upload if an attachment is selected
//         if (linkOrAttachmentChoice === 'attachment' && formData.file) {
//             try {
//                 // Use useFrappeFileUpload hook
//                 const fileResponse = await upload(formData.file, {
//                     isPrivate: 0, // Set to 1 if you want it private
//                     // Link the file to the parent document right away
//                     attachedToName: projectName,
//                     attachedToDoctype: 'Projects',
//                     attachedToFieldName: 'customer_po_attachment', // Optional: link to the field if desired
//                 });
                
//                 // The Frappe response contains the file URL or file name
//                 console.log("File uploaded successfully:", fileResponse);
//                 finalAttachmentName =fileResponse.file_url; 
//             } catch (error: any) {
//                 console.error("Failed to upload file:", error);
//                 const errorMessage = error?.messages?.[0]?.message || error?.message || "An unknown error occurred during file upload.";
//                 toast({ title: "Error", description: `File upload failed: ${errorMessage}`, variant: "destructive" });
//                 return;
//             }
//         }
        
//         // 2. Prepare data for the Custom API call
//         const newPODetail: Omit<CustomerPODetail, 'name' | 'idx'> = {
//             customer_po_number: formData.customer_po_number,
//             customer_po_value_inctax: formData.customer_po_value_inctax,
//             customer_po_value_exctax: formData.customer_po_value_exctax,
//             customer_po_payment_terms: formData.customer_po_payment_terms,
            
//             // Conditionally set link or attachment
//             customer_po_link: linkOrAttachmentChoice === 'link' ? formData.customer_po_link : '',
//             // Use the uploaded file name if attachment was chosen
//             customer_po_attachment: linkOrAttachmentChoice === 'attachment' ? finalAttachmentName : '',
//         };

//         // 3. Call Custom Frappe API for validation and saving using .then().catch() pattern
//         CustomerPoCreate({
//             project_name: projectName,
//             new_po_detail: newPODetail
//         })
//         .then((data) => {
//             // Success handler
//             if(data?.message?.status=="Duplicate"){
//               toast({title:"Duplicate Po Number",description:"Failed to create Customer Po, Because We already have PO Number in our records Create New Po number for Creation.",variant:"destructive"});
//             }else{
// toast({ title: "Success", description: "Customer PO created and validated successfully.", variant: "success" });
//             refetchProjectData(); 
//             setOpen(false);
//             resetForm();
//             }
            
//         })
//         .catch((error: any) => {
//             // Error handler
//            // Alternative robust message extraction (if SDK doesn't process error well)
// const rawException = error?.exception;
// const specificMessage = rawException 
//     ? rawException.split(': ').slice(1).join(': ').trim() 
//     : "An unknown error occurred.";

// const errorMessage = specificMessage|| error?.messages?.[0]?.message || error?.message;
//             toast({ 
//                 title: "Error", 
//                 // Display the custom error from the Python function (e.g., Duplicate PO Error)
//                 description: `Failed to create Customer PO: ${errorMessage.replace(/<[^>]*>?/gm, '')}`, // Strip HTML tags for toast
//                 variant: "destructive" 
//             });
//         });
        
//     };

//     const isLinkAttachmentValid = useMemo(() => {
//         if (linkOrAttachmentChoice === 'link') {
//             return formData.customer_po_link.trim() !== '';
//         }
//         if (linkOrAttachmentChoice === 'attachment') {
//             return formData.file !== null; // Check for the actual file object
//         }
//         return true; 
//     }, [linkOrAttachmentChoice, formData]);
    
//     const isFormValid = useMemo(() => {
//         // Require PO number, Incl. Tax value, and EITHER a link or an attachment (or allow none if business logic permits)
//         return (
//             formData.customer_po_number.trim() !== '' &&
//             formData.customer_po_value_inctax > 0 &&
//             (linkOrAttachmentChoice === 'none' || isLinkAttachmentValid)
//         );
//     }, [formData, linkOrAttachmentChoice, isLinkAttachmentValid]);

//     return (
//         <Dialog open={open} onOpenChange={setOpen}>
//             <DialogTrigger asChild>
//                 <Button variant="default" className="ml-4">
//                     <CirclePlus className="h-4 w-4 mr-2" /> Add Customer PO
//                 </Button>
//             </DialogTrigger>
//             <DialogContent className="sm:max-w-[600px]">
//                 <DialogHeader>
//                     <DialogTitle className="text-xl font-semibold mb-4">
//                         Add Customer Purchase Order
//                     </DialogTitle>
//                 </DialogHeader>
//                 <form onSubmit={handleSubmit} className="grid gap-6 py-4">
//                     {/* Basic Fields */}
//                     <div className="grid grid-cols-1 gap-4">
//                         <div className="space-y-2">
//                             <Label htmlFor="customer_po_number">PO Number*</Label>
//                             <Input
//                                 id="customer_po_number"
//                                 value={formData.customer_po_number}
//                                 onChange={handleInputChange}
//                                 required
//                             />
//                         </div>
//                     </div>
//                     <div className="grid grid-cols-2 gap-4">
//                         <div className="space-y-2">
//                             <Label htmlFor="customer_po_value_inctax">PO Value (Incl. Tax)*</Label>
//                             <Input
//                                 id="customer_po_value_inctax"
//                                 type="number"
//                                 step="any"
//                                 value={formData.customer_po_value_inctax || ''}
//                                 onChange={handleInputChange}
//                                 required
//                             />
//                         </div>
//                         <div className="space-y-2">
//                             <Label htmlFor="customer_po_value_exctax">PO Value (Excl. Tax)</Label>
//                             <Input
//                                 id="customer_po_value_exctax"
//                                 type="number"
//                                 step="any"
//                                 value={formData.customer_po_value_exctax || ''}
//                                 onChange={handleInputChange}
//                             />
//                         </div>
//                     </div>

//                     {/* Radio Button Choice for Link or Attachment */}
//                     <div className="space-y-2 border p-4 rounded-md">
//                         <Label>PO Source (Link or Attachment)</Label>
//                         <div className="flex gap-6">
//                             <div className="flex items-center space-x-2">
//                                 <input
//                                     type="radio"
//                                     id="choiceLink"
//                                     name="poSource"
//                                     checked={linkOrAttachmentChoice === 'link'}
//                                     onChange={() => handleChoiceChange('link')}
//                                     className="h-4 w-4 text-primary border-gray-300 focus:ring-primary"
//                                 />
//                                 <Label htmlFor="choiceLink" className="font-normal">Link</Label>
//                             </div>
//                             <div className="flex items-center space-x-2">
//                                 <input
//                                     type="radio"
//                                     id="choiceAttachment"
//                                     name="poSource"
//                                     checked={linkOrAttachmentChoice === 'attachment'}
//                                     onChange={() => handleChoiceChange('attachment')}
//                                     className="h-4 w-4 text-primary border-gray-300 focus:ring-primary"
//                                 />
//                                 <Label htmlFor="choiceAttachment" className="font-normal">Attachment</Label>
//                             </div>
                            
//                         </div>
//                     </div>

//                     {/* Conditionally Rendered Fields */}
//                     {linkOrAttachmentChoice === 'link' && (
//                         <div className="grid grid-cols-1 gap-4">
//                             <div className="space-y-2">
//                                 <Label htmlFor="customer_po_link">PO Link*</Label>
//                                 <Input
//                                     id="customer_po_link"
//                                     type="url"
//                                     value={formData.customer_po_link}
//                                     onChange={handleInputChange}
//                                     required
//                                 />
//                             </div>
//                         </div>
//                     )}
                    
//                     {linkOrAttachmentChoice === 'attachment' && (
//                         <div className="grid grid-cols-1 gap-4">
//                             <div className="space-y-2">
//                                 <Label htmlFor="customer_po_attachment">PO Attachment (PDF/Image)*</Label>
//                                 <Input
//                                     id="customer_po_attachment"
//                                     type="file"
//                                     onChange={handleFileChange}
//                                     accept=".pdf,image/*"
//                                     required={linkOrAttachmentChoice === 'attachment' && !formData.file}
//                                 />
//                                 <p className="text-xs text-gray-500 mt-1">
//                                     {formData.file ? `Selected: ${formData.file.name}` : 'Select a file.'}
//                                 </p>
//                             </div>
//                         </div>
//                     )}

//                     {/* Payment Terms Field */}
//                     <div className="grid grid-cols-1 gap-4">
//                         <div className="space-y-2">
//                             <Label htmlFor="customer_po_payment_terms">Payment Terms</Label>
//                             <Textarea
//                                 id="customer_po_payment_terms"
//                                 value={formData.customer_po_payment_terms}
//                                 onChange={handleInputChange}
//                                 rows={4}
//                             />
//                         </div>
//                     </div>

//                     <Button type="submit" disabled={!isFormValid || updateLoading}>
//                         {updateLoading ? (
//                             <Loader2 className="mr-2 h-4 w-4 animate-spin" />
//                         ) : (
//                             <CirclePlus className="mr-2 h-4 w-4" />
//                         )}
//                         {updateLoading 
//                             ? (uploadLoading ? "Uploading File..." : "Validating & Saving...") 
//                             : "Create Customer PO"
//                         }
//                     </Button>
//                 </form>
//             </DialogContent>
//         </Dialog>
//     );
// };

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { toast } from "@/components/ui/use-toast";
import { CirclePlus, Loader2, Trash2, Plus, Pencil, Sparkles, AlertTriangle } from "lucide-react";
import React, { useCallback, useState, ChangeEvent, useMemo, useEffect } from "react";
import { formatDate } from "@/utils/FormatDate";
import { useCustomerPOActions } from "@/pages/projects/data/tab/financials/useCustomerPOApi";
import { useFrappePostCall } from "frappe-react-sdk";
import { getFrappeError } from "@/utils/frappeErrors";

// Structured payment term type
export interface PaymentTerm {
    label: string;
    percentage: number;
    description: string;
    expected_date?: string;
}

// Define the interface for a single row in the 'customer_po_details' child table
export interface CustomerPODetail {
    name: string; // Frappe docname of the child record
    idx: number; // Frappe index
    customer_po_number: string;
    customer_po_value_inctax: number;
    customer_po_value_exctax: number;
    customer_po_link: string;
    customer_po_attachment: string; // File URL/Name
    customer_po_payment_terms: string;
    customer_po_creation_date: string; // Date string (YYYY-MM-DD)
}

interface AddCustomerPODialogProps {
    projectName: string; // Name of the parent Projects doc (e.g., "PROJ/0001")
    refetchProjectData: () => Promise<any>;
}

// REMOVED 'none' to enforce selection
type LinkAttachmentChoice = 'link' | 'attachment'; 

export const AddCustomerPODialog: React.FC<AddCustomerPODialogProps> = ({ projectName, refetchProjectData }) => {
    const [open, setOpen] = useState(false);
    
    // State for Link/Attachment choice - Default to 'link' for initial form state
    const [linkOrAttachmentChoice, setLinkOrAttachmentChoice] = useState<LinkAttachmentChoice>('attachment');

    // Payment terms dynamic rows state
    const [paymentTerms, setPaymentTerms] = useState<PaymentTerm[]>([]);
    
    const [formData, setFormData] = useState<Omit<CustomerPODetail, 'name' | 'idx' | 'customer_po_attachment' | 'customer_po_payment_terms'> & { file: File | null, customer_po_attachment: string }>({
        customer_po_number: '',
        customer_po_value_inctax: 0,
        customer_po_value_exctax: 0,
        customer_po_link: '',
        customer_po_creation_date: new Date().toISOString().split('T')[0],

        file: null,
        customer_po_attachment: '', 
    });

    const {
        createCustomerPO,
        uploadCustomerPOAttachment,
        createLoading: callLoading,
        uploadLoading,
    } = useCustomerPOActions();
    
    const updateLoading = callLoading || uploadLoading;
    
    // --- AI autofill from the PO attachment (mirrors the Fulfil Payment dialog) ---
    const { call: extractCustomerPOFields } = useFrappePostCall(
        "nirmaan_stack.api.customer_po_autofill.extract_customer_po_fields"
    );
    // file_url uploaded during autofill — reused on submit so we don't upload twice.
    const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);
    const [isAutofilling, setIsAutofilling] = useState(false);
    const [autofilledFields, setAutofilledFields] = useState<Set<string>>(new Set());
    // Confirmed mismatch banner: the PO appears to be for a different project OR from
    // a different customer. `kind` tailors the wording; both block auto-fill.
    const [projectMismatch, setProjectMismatch] = useState<{ kind: "project" | "customer"; expected: string; extracted: string } | null>(null);
    // Full invoice-style AI provenance, persisted on the PO row for audit (set on autofill).
    const [autofillMeta, setAutofillMeta] = useState<Record<string, any> | null>(null);
    // Attachment-first reveal gate: the PO fields stay hidden until a file has been
    // read (success OR fail) — on the Link path they always show.
    const [attachmentProcessed, setAttachmentProcessed] = useState(false);

    const clearAutofillFlag = (field: string) => {
        setAutofilledFields(prev => {
            if (!prev.has(field)) return prev;
            const next = new Set(prev);
            next.delete(field);
            return next;
        });
    };

    const handleAttachmentSelect = async (file: File | null) => {
        setFormData(prev => ({ ...prev, file }));
        setUploadedFileUrl(null);
        setAutofilledFields(new Set());
        setProjectMismatch(null);
        setAutofillMeta(null);
        setAttachmentProcessed(false); // hide the fields again until this file is read
        if (!file || !projectName) return;

        setIsAutofilling(true);
        try {
            // Upload first (autofill needs a File record to read), then extract.
            const uploaded = await uploadCustomerPOAttachment(projectName, file);
            setUploadedFileUrl(uploaded.file_url);

            const res: any = await extractCustomerPOFields({
                file_url: uploaded.file_url,
                project_name: projectName, // backend resolves Projects.project_name to match against
            });
            const data = res?.message ?? res;

            // Confirmed mismatch ("totally mismatched") → do NOT auto-fill; leave the
            // form blank for manual entry and warn in red. The PO is wrong for this
            // project if EITHER it names a different project OR its issuer (buyer
            // GSTIN/name) ≠ this project's customer.
            const pm = data?.validation?.project_match;
            const cm = data?.validation?.customer_match;
            const projectMismatched = !!(pm && pm.match === false);
            const customerMismatched = !!(cm && cm.match === false);
            const mismatched = projectMismatched || customerMismatched;

            const filled = new Set<string>();
            // Mismatch no longer blocks auto-fill — we fill, then warn (banner + toast).
            setFormData(prev => {
                const next = { ...prev };
                if (data?.customer_po_number) {
                    next.customer_po_number = data.customer_po_number;
                    filled.add("customer_po_number");
                }
                // PO Date read off the PDF (already normalized to YYYY-MM-DD by the backend).
                if (data?.customer_po_date) {
                    next.customer_po_creation_date = data.customer_po_date;
                    filled.add("customer_po_creation_date");
                }
                const inc = parseFloat(data?.customer_po_value_inctax);
                if (!isNaN(inc) && inc > 0) {
                    next.customer_po_value_inctax = inc;
                    filled.add("customer_po_value_inctax");
                }
                const exc = parseFloat(data?.customer_po_value_exctax);
                if (!isNaN(exc) && exc > 0) {
                    next.customer_po_value_exctax = exc;
                    filled.add("customer_po_value_exctax");
                }
                return next;
            });

            // AI-extracted payment schedule → fill the Payment Terms rows.
            // The existing submit serializes `paymentTerms` into customer_po_payment_terms (JSON).
            if (Array.isArray(data?.payment_terms) && data.payment_terms.length > 0) {
                setPaymentTerms(
                    data.payment_terms.map((t: any) => ({
                        label: String(t?.label ?? "").trim(),
                        percentage: Number(t?.percentage) || 0,
                        description: String(t?.description ?? "").trim(),
                        expected_date: "",
                    }))
                );
                filled.add("payment_terms");
            }

            setAutofilledFields(filled);

            // Surface the confirmed mismatch in red (computed above). Prefer the
            // customer detail (the stronger signal) when it's the one that disagreed.
            setProjectMismatch(
                customerMismatched
                    ? {
                          kind: "customer",
                          expected: cm.expected_name || cm.expected_gstin || "",
                          extracted: cm.extracted_name || cm.extracted_gstin || "",
                      }
                    : projectMismatched
                    ? { kind: "project", expected: pm.expected || "", extracted: pm.extracted || "" }
                    : null
            );

            // Capture full invoice-style provenance to persist on the PO row at save time.
            const matchVal = pm?.match;
            setAutofillMeta({
                autofill_used: 1,
                autofill_processor_id: data?.processor_id || "",
                autofill_extracted_po_number: data?.customer_po_number || "",
                autofill_extracted_value_inctax: parseFloat(data?.customer_po_value_inctax) || 0,
                autofill_extracted_value_exctax: parseFloat(data?.customer_po_value_exctax) || 0,
                autofill_extracted_project_reference: pm?.extracted || "",
                autofill_project_match:
                    matchVal === true ? "matched" : matchVal === false ? "mismatch" : "unverified",
                autofill_confidence_json: JSON.stringify(data?.confidence || {}),
                autofill_all_entities_json: JSON.stringify(data?.entities || []),
            });

            if (mismatched && filled.size > 0) {
                toast({
                    title: customerMismatched ? "Auto-filled — check the customer" : "Auto-filled — check the project",
                    description: "The fields were filled, but this PO may belong to a different project/customer. Please review before saving.",
                    variant: "default",
                });
            } else if (filled.size > 0) {
                toast({
                    title: "Auto-filled from PO",
                    description: `Filled ${filled.size} field${filled.size > 1 ? "s" : ""}. Please verify before saving.`,
                    variant: "success",
                });
            } else {
                toast({
                    title: "Couldn't auto-fill",
                    description: "Please enter the PO details manually.",
                    variant: "default",
                });
            }
        } catch (e: any) {
            // The reader (Gemini) can fail intermittently on large/complex POs —
            // timeout, model overload, or a blocked/empty response. Degrade gracefully
            // to manual entry instead of a hard error: the fields are revealed (blank)
            // in `finally`, and re-uploading the file retries the read.
            toast({
                title: "Couldn't read the PO automatically",
                description:
                    getFrappeError(e) ||
                    "The PO reader had a temporary problem (more likely on large files). Re-upload to try again, or enter the details manually below.",
                variant: "default",
            });
        } finally {
            setIsAutofilling(false);
            // Reveal the fields now — filled on success, blank for manual entry on failure.
            setAttachmentProcessed(true);
        }
    };

    // EFFECT: Reset form when dialog is opened
    useEffect(() => {
        if (open) {
            resetForm();
        }
    }, [open]);

    const handleInputChange = useCallback((e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { id, value } = e.target;
        clearAutofillFlag(id); // user edited an autofilled field — drop the amber tint
        setFormData(prev => ({
            ...prev,
            [id]: (id === 'customer_po_value_inctax' || id === 'customer_po_value_exctax')
                ? parseFloat(value || '0')
                : value,
        }));
    }, []);

    // Handler for radio button change
    const handleChoiceChange = useCallback((choice: LinkAttachmentChoice) => {
        setLinkOrAttachmentChoice(choice);
        setAttachmentProcessed(false); // re-hide the fields on the attachment path until a file is read
        // Reset the input values when the choice changes to ensure only one field is sent
        setFormData(prev => ({
            ...prev,
            // Clear the field that is NOT selected
            customer_po_link: choice === 'link' ? prev.customer_po_link : '',
            customer_po_attachment: choice === 'attachment' ? prev.customer_po_attachment : '',
            file: choice === 'attachment' ? prev.file : null,
        }));
        // Leaving the attachment path drops any autofill state/sparkle.
        if (choice !== 'attachment') {
            setUploadedFileUrl(null);
            setAutofilledFields(new Set());
            setProjectMismatch(null);
            setAutofillMeta(null);
        }
    }, []);

    // Payment term: new term input state (always visible at bottom)
    const [newTerm, setNewTerm] = useState<PaymentTerm>({ label: '', percentage: 0, description: '', expected_date: '' });
    const [isEditingTerm, setIsEditingTerm] = useState(false);

    const handleAddTerm = useCallback(() => {
        if (!newTerm.label.trim()) return; // at least label required
        setPaymentTerms(prev => [...prev, { ...newTerm }]);
        setNewTerm({ label: '', percentage: 0, description: '', expected_date: '' }); // reset input for next
        setIsEditingTerm(false);
    }, [newTerm]);

    const removePaymentTerm = useCallback((index: number) => {
        setPaymentTerms(prev => prev.filter((_, i) => i !== index));
    }, []);

    const resetForm = useCallback(() => {
        setFormData({
            customer_po_number: '',
            customer_po_value_inctax: 0,
            customer_po_value_exctax: 0,
            customer_po_link: '',
            customer_po_creation_date: new Date().toISOString().split('T')[0],
            file: null,
            customer_po_attachment: '',
        });
        setPaymentTerms([]);
        setNewTerm({ label: '', percentage: 0, description: '', expected_date: '' });
        setIsEditingTerm(false);
        setLinkOrAttachmentChoice('attachment'); // attachment-first: default source
        setUploadedFileUrl(null);
        setIsAutofilling(false);
        setAutofilledFields(new Set());
        setProjectMismatch(null);
        setAutofillMeta(null);
        setAttachmentProcessed(false); // fields hidden until the PO is read
    }, []);

    const isLinkAttachmentValid = useMemo(() => {
        return true; 
    }, []);
    
    const isFormValid = useMemo(() => {
        // PO Number is OPTIONAL. Enforce: Incl. Tax value, PO Date, AND valid Link/Attachment
        return (
            formData.customer_po_value_inctax > 0 &&
            formData.customer_po_creation_date.trim() !== '' &&
            isLinkAttachmentValid
        );
    }, [formData, isLinkAttachmentValid]);

    // Attachment-first reveal: on the Link path the PO fields always show; on the
    // Attachment path they appear only after the uploaded PO has been read.
    const showDataFields =
        linkOrAttachmentChoice === 'link' ||
        (linkOrAttachmentChoice === 'attachment' && attachmentProcessed);

    // Soft validation warnings — surfaced for review, NEVER block saving.
    const validationWarnings = useMemo(() => {
        const warnings: string[] = [];

        if (paymentTerms.length > 0) {
            // Percentages should add up to exactly 100% — flag over/short with the amount.
            const totalPct = paymentTerms.reduce((sum, t) => sum + (Number(t.percentage) || 0), 0);
            const roundedPct = Math.round(totalPct * 100) / 100;
            if (roundedPct > 100) {
                const over = Math.round((roundedPct - 100) * 100) / 100;
                warnings.push(`Payment terms add up to ${roundedPct}% — that's ${over}% over 100%.`);
            } else if (roundedPct < 100) {
                const short = Math.round((100 - roundedPct) * 100) / 100;
                warnings.push(`Payment terms add up to ${roundedPct}% — ${short}% short of 100%.`);
            }
            // Expected dates are never auto-read — flag the ones still blank.
            const missingDates = paymentTerms.filter(t => !t.expected_date).length;
            if (missingDates > 0) {
                warnings.push(
                    `${missingDates} of ${paymentTerms.length} payment term${paymentTerms.length > 1 ? 's' : ''} ${missingDates > 1 ? 'have' : 'has'} no expected date.`
                );
            }
        }

        // Amounts — only after an extraction attempt, so manual/Link entry isn't nagged.
        if (attachmentProcessed) {
            const inc = Number(formData.customer_po_value_inctax) || 0;
            const exc = Number(formData.customer_po_value_exctax) || 0;
            if (inc > 0 && exc <= 0) {
                warnings.push("Amounts partially read — only the Incl. Tax value was found. Please enter the Excl. Tax value.");
            } else if (exc > 0 && inc <= 0) {
                warnings.push("Amounts partially read — only the Excl. Tax value was found. Please enter the Incl. Tax value.");
            } else if (inc > 0 && exc > 0 && exc > inc) {
                warnings.push("Excl. Tax value is greater than Incl. Tax — please verify the amounts.");
            }
        }

        return warnings;
    }, [paymentTerms, attachmentProcessed, formData.customer_po_value_inctax, formData.customer_po_value_exctax]);


    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!isFormValid) {
            let message = "Please fill all required fields: PO Date, Value (Incl. Tax).";
            toast({ title: "Validation Failed", description: message, variant: "destructive" });
            return;
        }

        if (!projectName) {
            toast({ title: "Error", description: "Project Name is missing.", variant: "destructive" });
            return;
        }
        
        let finalAttachmentName = '';

        // 1. Handle File Upload if an attachment is selected
        if (linkOrAttachmentChoice === 'attachment' && formData.file) {
            if (uploadedFileUrl) {
                // Already uploaded during autofill — reuse the same File record.
                finalAttachmentName = uploadedFileUrl;
            } else {
                try {
                    const fileResponse = await uploadCustomerPOAttachment(projectName, formData.file);

                    // Frappe file upload returns the file URL or file name in 'file_url'
                    finalAttachmentName = fileResponse.file_url;
                } catch (error: any) {
                    console.error("Failed to upload file:", error);
                    const errorMessage = error?.messages?.[0]?.message || error?.message || "An unknown error occurred during file upload.";
                    toast({ title: "Error", description: `File upload failed: ${errorMessage}`, variant: "destructive" });
                    return;
                }
            }
        }
        
        // 2. Prepare data for the Custom API call
        // Stringify payment terms array to JSON for storage in Long Text field
        const paymentTermsJson = paymentTerms.length > 0 ? JSON.stringify(paymentTerms) : '';

        const newPODetail: Omit<CustomerPODetail, 'name' | 'idx'> & Record<string, any> = {
            customer_po_number: formData.customer_po_number,
            customer_po_value_inctax: formData.customer_po_value_inctax,
            customer_po_value_exctax: formData.customer_po_value_exctax,
            customer_po_payment_terms: paymentTermsJson,
            customer_po_creation_date: formData.customer_po_creation_date,

            // Conditionally set link or attachment
            customer_po_link: linkOrAttachmentChoice === 'link' ? formData.customer_po_link : '',
            customer_po_attachment: linkOrAttachmentChoice === 'attachment' ? finalAttachmentName : '',

            // AI autofill provenance (audit-only) — persisted when the PO was AI-filled from the attachment.
            // The backend appends this dict straight to the child row, so these keys land on the new fields.
            ...(linkOrAttachmentChoice === 'attachment' && autofillMeta ? autofillMeta : {}),
        };

        // 3. Call Custom Frappe API for saving
        createCustomerPO(projectName, newPODetail)
        .then((data) => {
            if(data?.message?.status=="Duplicate"){
              toast({title:"Duplicate Po Number",description:"Failed to create Customer Po, Because We already have PO Number in our records. Create a New Po number for Creation.",variant:"destructive"});
            }else{
                toast({ title: "Success", description: "Customer PO created and validated successfully.", variant: "success" });
                refetchProjectData(); 
                setOpen(false);
                resetForm();
            }
            
        })
        .catch((error: any) => {
            const rawException = error?.exception;
            const specificMessage = rawException 
                ? rawException.split(': ').slice(1).join(': ').trim() 
                : null;

            const errorMessage = specificMessage || error?.messages?.[0]?.message || error?.message || "An unknown error occurred.";
            toast({ 
                title: "Error", 
                description: `Failed to create Customer PO: ${errorMessage.replace(/<[^>]*>?/gm, '')}`, 
                variant: "destructive" 
            });
        });
        
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="default" className="ml-4">
                    <CirclePlus className="h-4 w-4 mr-2" /> Add Customer PO
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto overflow-x-hidden">
                <DialogHeader>
                    <DialogTitle className="text-xl font-semibold mb-4">
                        Add Customer Purchase Order
                    </DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-6 py-4">
                    {/* PO Source FIRST (attachment-first): uploading the PO auto-fills the fields below */}
                    {/* Radio Button Choice for Link or Attachment */}
                    <div className="space-y-2 border p-4 rounded-md">
                        <Label className="font-medium">PO Source (Link or Attachment)</Label>
                        <div className="flex gap-6">
                            <div className="flex items-center space-x-2">
                                <input
                                    type="radio"
                                    id="choiceLink"
                                    name="poSource"
                                    checked={linkOrAttachmentChoice === 'link'}
                                    onChange={() => handleChoiceChange('link')}
                                    className="h-4 w-4 text-primary border-gray-300 focus:ring-primary"
                                />
                                <Label htmlFor="choiceLink" className="font-normal">Link</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <input
                                    type="radio"
                                    id="choiceAttachment"
                                    name="poSource"
                                    checked={linkOrAttachmentChoice === 'attachment'}
                                    onChange={() => handleChoiceChange('attachment')}
                                    className="h-4 w-4 text-primary border-gray-300 focus:ring-primary"
                                />
                                <Label htmlFor="choiceAttachment" className="font-normal">Attachment</Label>
                            </div>
                        </div>
                    </div>

                    {/* Conditionally Rendered Fields */}
                    {linkOrAttachmentChoice === 'link' && (
                        <div className="grid grid-cols-1 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="customer_po_link">PO Link</Label>
                                <Input
                                    id="customer_po_link"
                                    type="url"
                                    value={formData.customer_po_link}
                                    onChange={handleInputChange}
                                />
                            </div>
                        </div>
                    )}
                    
                    {linkOrAttachmentChoice === 'attachment' && (
                        <div className="space-y-2">
                            <Label>PO Attachment (PDF/Image)</Label>
                            <p className="text-xs text-muted-foreground">
                                We'll read the PO and fill in the PO Number and values for you.
                            </p>
                            <CustomAttachment
                                selectedFile={formData.file}
                                onFileSelect={handleAttachmentSelect}
                                acceptedTypes={["application/pdf", "image/*"]}
                                label="Upload PO Attachment"
                            />
                            {isAutofilling && (
                                <div className="flex items-center gap-2 text-xs text-amber-700">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Reading your PO… extracting details.
                                </div>
                            )}
                            {!isAutofilling && autofilledFields.size > 0 && (
                                <div className="flex items-center gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded px-2 py-1.5">
                                    <Sparkles className="h-3.5 w-3.5 text-amber-700 flex-shrink-0" />
                                    <span>Auto-filled from the PO — please review and edit if anything is wrong.</span>
                                </div>
                            )}
                            {projectMismatch && (
                                <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-300 px-2 py-1.5">
                                    <AlertTriangle className="h-3.5 w-3.5 text-red-600 flex-shrink-0 mt-0.5" />
                                    <div className="text-xs text-red-800 leading-snug">
                                        <p className="font-medium">
                                            {projectMismatch.kind === "customer"
                                                ? "This PO may be from a different customer — please double-check."
                                                : "This PO may be for a different project — please double-check."}
                                        </p>
                                        <p className="mt-0.5">
                                            {projectMismatch.kind === "customer"
                                                ? `The PO is from "${projectMismatch.extracted}" but this project's customer is "${projectMismatch.expected}".`
                                                : `The PO mentions "${projectMismatch.extracted}" but this project is "${projectMismatch.expected}".`}{" "}
                                            The fields were still auto-filled — double-check you uploaded the right file before saving.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Soft validation warnings — shown up top, right after the auto-fill note */}
                    {validationWarnings.length > 0 && (
                        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 space-y-1">
                            <div className="flex items-center gap-2 text-xs font-medium text-red-800">
                                <AlertTriangle className="h-3.5 w-3.5 text-red-600 flex-shrink-0" />
                                Please check before saving
                            </div>
                            <ul className="list-disc pl-5 text-xs text-red-800 space-y-0.5">
                                {validationWarnings.map((w, i) => (
                                    <li key={i}>{w}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {showDataFields && (
                    <>
                    {/* Basic Fields */}
                    <div className="grid grid-cols-1 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="customer_po_number">PO Number <span className="text-muted-foreground text-xs">(optional)</span></Label>
                            <Input
                                id="customer_po_number"
                                value={formData.customer_po_number}
                                onChange={handleInputChange}
                                className={autofilledFields.has("customer_po_number") ? "bg-amber-50 border-amber-300 focus-visible:ring-amber-400" : ""}
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                            <Label htmlFor="customer_po_creation_date">PO Date <span className="text-red-500">*</span></Label>
                            <Input
                                id="customer_po_creation_date"
                                type="date"
                                value={formData.customer_po_creation_date}
                                onChange={handleInputChange}
                                required
                                className={autofilledFields.has("customer_po_creation_date") ? "bg-amber-50 border-amber-300 focus-visible:ring-amber-400" : ""}
                            />
                        </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="customer_po_value_inctax">PO Value (Incl. Tax) <span className="text-red-500">*</span></Label>
                            <Input
                                id="customer_po_value_inctax"
                                type="number"
                                step="any"
                                value={formData.customer_po_value_inctax || ''}
                                onChange={handleInputChange}
                                required
                                className={autofilledFields.has("customer_po_value_inctax") ? "bg-amber-50 border-amber-300 focus-visible:ring-amber-400" : ""}
                            />
                        </div>
                         
                        <div className="space-y-2">
                            <Label htmlFor="customer_po_value_exctax">PO Value (Excl. Tax)</Label>
                            <Input
                                id="customer_po_value_exctax"
                                type="number"
                                step="any"
                                value={formData.customer_po_value_exctax || ''}
                                onChange={handleInputChange}
                                className={autofilledFields.has("customer_po_value_exctax") ? "bg-amber-50 border-amber-300 focus-visible:ring-amber-400" : ""}
                            />
                        </div>
                    </div>


                    {/* Payment Terms — Display + Add Flow */}
                    <div className="space-y-3 border p-4 rounded-md">
                        <Label className="font-medium">Payment Terms</Label>

                        {/* Existing terms — compact read-only rows */}
                        {paymentTerms.map((term, index) => (
                            <div key={index} className={`px-3 py-2 border rounded ${!term.expected_date ? "bg-yellow-50 border-yellow-200" : "bg-gray-50"}`}>
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-3 text-sm">
                                        <span className="font-medium">{term.label}</span>
                                        <span className="text-blue-600 font-mono whitespace-nowrap">{term.percentage}%</span>
                                        {term.expected_date ? (
                                            <span className="text-gray-500 text-xs whitespace-nowrap">Date: {formatDate(term.expected_date)}</span>
                                        ) : (
                                            <span className="text-yellow-700 text-xs whitespace-nowrap">No expected date</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                                setNewTerm({ ...term });
                                            setIsEditingTerm(true);
                                                removePaymentTerm(index);
                                            }}
                                            className="h-7 w-7 p-0 text-blue-500 hover:text-blue-700"
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => removePaymentTerm(index)}
                                            className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>
                                {term.description && (
                                    <p className="text-xs text-muted-foreground mt-1 break-words">{term.description}</p>
                                )}
                            </div>
                        ))}

                        {/* Input row — Label + % on first line, Description on second */}
                        <div className="space-y-2">
                            <div className="grid grid-cols-[5fr_2fr_3fr] gap-2 items-end">
                                <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">Label</Label>
                                    <Input
                                        placeholder="e.g. Advance"
                                        value={newTerm.label}
                                        onChange={(e) => setNewTerm(prev => ({ ...prev, label: e.target.value }))}
                                        className="h-8 text-sm"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">%</Label>
                                    <Input
                                        type="number"
                                        min={0}
                                        max={100}
                                        placeholder="%"
                                        value={newTerm.percentage || ''}
                                        onChange={(e) => setNewTerm(prev => ({ ...prev, percentage: parseFloat(e.target.value || '0') }))}
                                        className="h-8 text-sm"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">Expected Date</Label>
                                    <Input
                                        type="date"
                                        value={newTerm.expected_date || ''}
                                        onChange={(e) => setNewTerm(prev => ({ ...prev, expected_date: e.target.value }))}
                                        className="h-8 text-sm"
                                    />
                                </div>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Description</Label>
                                <Textarea
                                    placeholder="e.g. Upon PO signing"
                                    value={newTerm.description}
                                    onChange={(e) => setNewTerm(prev => ({ ...prev, description: e.target.value }))}
                                    rows={2}
                                    className="text-sm resize-none"
                                />
                            </div>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleAddTerm}
                            disabled={!newTerm.label.trim()}
                            className="w-full h-8 text-xs border-red-500 text-red-600 bg-transparent hover:bg-red-50"
                        >
                            <Plus className="h-3 w-3 mr-1" /> {isEditingTerm ? 'Update Term' : 'Add Term'}
                        </Button>
                    </div>
                    </>
                    )}

                    <div className="flex gap-4">
                        <Button 
                            type="button" 
                            variant="outline" 
                            onClick={() => setOpen(false)} 
                            className="flex-1"
                            disabled={updateLoading}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!isFormValid || updateLoading} className="flex-1">
                            {updateLoading ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <CirclePlus className="mr-2 h-4 w-4" />
                            )}
                            {updateLoading 
                                ? (uploadLoading ? "Uploading File..." : "Validating & Saving...") 
                                : "Create Customer PO"
                            }
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
};
