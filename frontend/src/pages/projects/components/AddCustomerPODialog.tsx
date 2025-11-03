
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
import { toast } from "@/components/ui/use-toast";
import { useFrappePostCall, useFrappeFileUpload } from "frappe-react-sdk"; 
import { CirclePlus, Loader2 } from "lucide-react";
import React, { useCallback, useState, ChangeEvent, useMemo } from "react";

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
}

interface AddCustomerPODialogProps {
    projectName: string; // Name of the parent Projects doc (e.g., "PROJ/0001")
    currentCustomerPODetails: CustomerPODetail[];
    refetchProjectData: () => Promise<any>;
}

// REMOVED 'none' to enforce selection
type LinkAttachmentChoice = 'link' | 'attachment'; 

// Define the custom Frappe method name
const CUSTOM_API_METHOD = 'nirmaan_stack.api.projects.add_customer_po.add_customer_po_with_validation'; 

export const AddCustomerPODialog: React.FC<AddCustomerPODialogProps> = ({ projectName, currentCustomerPODetails, refetchProjectData }) => {
    const [open, setOpen] = useState(false);
    
    // State for Link/Attachment choice - Default to 'link' for initial form state
    const [linkOrAttachmentChoice, setLinkOrAttachmentChoice] = useState<LinkAttachmentChoice>('link');
    
    const [formData, setFormData] = useState<Omit<CustomerPODetail, 'name' | 'idx' | 'customer_po_attachment'> & { file: File | null, customer_po_attachment: string }>({
        customer_po_number: '',
        customer_po_value_inctax: 0,
        customer_po_value_exctax: 0,
        customer_po_link: '',
        customer_po_payment_terms: '',
        file: null,
        customer_po_attachment: '', 
    });

    const {  call: CustomerPoCreate, loading: callLoading } = useFrappePostCall<{ message: any }>(CUSTOM_API_METHOD); 
    const { upload, loading: uploadLoading } = useFrappeFileUpload();
    
    const updateLoading = callLoading || uploadLoading;

    const handleInputChange = useCallback((e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { id, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [id]: (id === 'customer_po_value_inctax' || id === 'customer_po_value_exctax')
                ? parseFloat(value || '0')
                : value,
        }));
    }, []);

    const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0] || null;
        setFormData(prev => ({
            ...prev,
            file: file,
            customer_po_attachment: file ? file.name : '', 
        }));
    }, []);
    
    // Handler for radio button change
    const handleChoiceChange = useCallback((choice: LinkAttachmentChoice) => {
        setLinkOrAttachmentChoice(choice);
        // Reset the input values when the choice changes to ensure only one field is sent
        setFormData(prev => ({
            ...prev,
            // Clear the field that is NOT selected
            customer_po_link: choice === 'link' ? prev.customer_po_link : '',
            customer_po_attachment: choice === 'attachment' ? prev.customer_po_attachment : '', 
            file: choice === 'attachment' ? prev.file : null, 
        }));
    }, []);

    const resetForm = useCallback(() => {
        setFormData({
            customer_po_number: '',
            customer_po_value_inctax: 0,
            customer_po_value_exctax: 0,
            customer_po_link: '',
            customer_po_payment_terms: '',
            file: null,
            customer_po_attachment: '',
        });
        setLinkOrAttachmentChoice('link'); // Reset to default
    }, []);

    const isLinkAttachmentValid = useMemo(() => {
        if (linkOrAttachmentChoice === 'link') {
            return formData.customer_po_link.trim() !== '';
        }
        if (linkOrAttachmentChoice === 'attachment') {
            return formData.file !== null; // File object must exist
        }
        // This case should not be reachable now that 'none' is removed
        return false; 
    }, [linkOrAttachmentChoice, formData]);
    
    const isFormValid = useMemo(() => {
        // Enforce: PO Number, Incl. Tax value, AND valid Link/Attachment
        return (
            formData.customer_po_number.trim() !== '' &&
            formData.customer_po_value_inctax > 0 &&
            isLinkAttachmentValid
        );
    }, [formData, isLinkAttachmentValid]);


    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!isFormValid) {
            let message = "Please fill all required fields: PO Number, Value (Incl. Tax).";
            if (linkOrAttachmentChoice === 'link' && formData.customer_po_link.trim() === '') {
                message += " Also, the PO Link is required.";
            } else if (linkOrAttachmentChoice === 'attachment' && formData.file === null) {
                 message += " Also, an Attachment file is required.";
            }
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
            try {
                const fileResponse = await upload(formData.file, {
                    isPrivate: 0, 
                    attachedToName: projectName,
                    attachedToDoctype: 'Projects',
                    // attachedToFieldName: 'customer_po_attachment', // Not needed for file DocType
                });
                
                // Frappe file upload returns the file URL or file name in 'file_url'
                finalAttachmentName = fileResponse.file_url; 
            } catch (error: any) {
                console.error("Failed to upload file:", error);
                const errorMessage = error?.messages?.[0]?.message || error?.message || "An unknown error occurred during file upload.";
                toast({ title: "Error", description: `File upload failed: ${errorMessage}`, variant: "destructive" });
                return;
            }
        }
        
        // 2. Prepare data for the Custom API call
        const newPODetail: Omit<CustomerPODetail, 'name' | 'idx'> = {
            customer_po_number: formData.customer_po_number,
            customer_po_value_inctax: formData.customer_po_value_inctax,
            customer_po_value_exctax: formData.customer_po_value_exctax,
            customer_po_payment_terms: formData.customer_po_payment_terms,
            
            // Conditionally set link or attachment
            customer_po_link: linkOrAttachmentChoice === 'link' ? formData.customer_po_link : '',
            customer_po_attachment: linkOrAttachmentChoice === 'attachment' ? finalAttachmentName : '',
        };

        // 3. Call Custom Frappe API for saving
        CustomerPoCreate({
            project_name: projectName,
            new_po_detail: newPODetail
        })
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
                : "An unknown error occurred.";

            const errorMessage = specificMessage || error?.messages?.[0]?.message || error?.message;
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
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle className="text-xl font-semibold mb-4">
                        Add Customer Purchase Order
                    </DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-6 py-4">
                    {/* Basic Fields */}
                    <div className="grid grid-cols-1 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="customer_po_number">PO Number*</Label>
                            <Input
                                id="customer_po_number"
                                value={formData.customer_po_number}
                                onChange={handleInputChange}
                                required
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="customer_po_value_inctax">PO Value (Incl. Tax)*</Label>
                            <Input
                                id="customer_po_value_inctax"
                                type="number"
                                step="any"
                                value={formData.customer_po_value_inctax || ''}
                                onChange={handleInputChange}
                                required
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
                            />
                        </div>
                    </div>

                    {/* Radio Button Choice for Link or Attachment */}
                    <div className="space-y-2 border p-4 rounded-md">
                        <Label className="font-medium">PO Source* (Link or Attachment)</Label>
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
                                <Label htmlFor="customer_po_link">PO Link*</Label>
                                <Input
                                    id="customer_po_link"
                                    type="url"
                                    value={formData.customer_po_link}
                                    onChange={handleInputChange}
                                    required
                                />
                            </div>
                        </div>
                    )}
                    
                    {linkOrAttachmentChoice === 'attachment' && (
                        <div className="grid grid-cols-1 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="customer_po_attachment">PO Attachment (PDF/Image)*</Label>
                                <Input
                                    id="customer_po_attachment"
                                    type="file"
                                    onChange={handleFileChange}
                                    accept=".pdf,image/*"
                                    // Required attribute is now handled by isFormValid check
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    {formData.file ? `Selected: ${formData.file.name}` : 'Select a file.'}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Payment Terms Field */}
                    <div className="grid grid-cols-1 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="customer_po_payment_terms">Payment Terms</Label>
                            <Textarea
                                id="customer_po_payment_terms"
                                value={formData.customer_po_payment_terms}
                                onChange={handleInputChange}
                                rows={4}
                            />
                        </div>
                    </div>

                    <Button type="submit" disabled={!isFormValid || updateLoading}>
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
                </form>
            </DialogContent>
        </Dialog>
    );
};