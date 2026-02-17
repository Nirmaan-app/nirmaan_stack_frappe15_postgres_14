import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { toast } from "@/components/ui/use-toast";
import { useFrappePostCall, useFrappeFileUpload } from "frappe-react-sdk";
import { Loader2, FilePenLine, Trash2, Plus, Pencil, X } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import type { CustomerPODetail } from "./AddCustomerPODialog";
import type { PaymentTerm } from "./AddCustomerPODialog";

// Helper to safely parse payment terms from JSON string
const parsePaymentTerms = (value: string | undefined | null): PaymentTerm[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Legacy plain text — ignore
  }
  return [];
};

interface EditCustomerPODialogProps {
  projectName: string;
  poDetail: CustomerPODetail; // current row data
  open: boolean;
  onClose: () => void;
  refetchProjectData: () => Promise<any>;
}

type LinkAttachmentChoice = "link" | "attachment";

const UPDATE_API_METHOD =
  "nirmaan_stack.api.projects.add_customer_po.update_customer_po_with_validation";

export const EditCustomerPODialog: React.FC<EditCustomerPODialogProps> = ({
  projectName,
  poDetail,
  open,
  onClose,
  refetchProjectData,
}) => {
  const [linkOrAttachmentChoice, setLinkOrAttachmentChoice] =
    useState<LinkAttachmentChoice>(
      poDetail?.customer_po_attachment ? "attachment" : "link"
    );

  // Payment terms dynamic rows state — parse existing JSON on mount
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerm[]>(
    parsePaymentTerms(poDetail.customer_po_payment_terms)
  );

  // New term input state (always visible at bottom)
  const [newTerm, setNewTerm] = useState<PaymentTerm>({ label: '', percentage: 0, description: '' });
  const [isEditingTerm, setIsEditingTerm] = useState(false);

  const [formData, setFormData] = useState<
    Omit<CustomerPODetail, "name" | "idx" | "customer_po_payment_terms"> & { file: File | null }
  >({
    customer_po_number: poDetail.customer_po_number,
    customer_po_value_inctax: poDetail.customer_po_value_inctax,
    customer_po_value_exctax: poDetail.customer_po_value_exctax,
    customer_po_link: poDetail?.customer_po_link||"",
    customer_po_creation_date: poDetail.customer_po_creation_date,
    customer_po_attachment: poDetail?.customer_po_attachment||"",
    file: null,
  });

  const { call: updatePO, loading: updateLoading } =
    useFrappePostCall<{ message: any }>(UPDATE_API_METHOD);
  const { upload, loading: uploadLoading } = useFrappeFileUpload();

  const totalLoading = updateLoading || uploadLoading;

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const { id, value } = e.target;
      setFormData((prev) => ({
        ...prev,
        [id]:
          id === "customer_po_value_inctax" ||
          id === "customer_po_value_exctax"
            ? parseFloat(value || "0")
            : value,
      }));
    },
    []
  );



  const handleChoiceChange = useCallback((choice: LinkAttachmentChoice) => {
    setLinkOrAttachmentChoice(choice);
    setFormData((prev) => ({
      ...prev,
      customer_po_link: choice === "link" ? prev.customer_po_link : "",
      customer_po_attachment:
        choice === "attachment" ? prev.customer_po_attachment : "",
      file: choice === "attachment" ? prev.file : null,
    }));
  }, []);

  const isLinkAttachmentValid = useMemo(() => {
    if (linkOrAttachmentChoice === "link") {
      return formData.customer_po_link.trim() !== "";
    }
    if (linkOrAttachmentChoice === "attachment") {
      return formData.file !== null || !!formData.customer_po_attachment;
    }
    return false;
  }, [linkOrAttachmentChoice, formData]);

  const isFormValid = useMemo(() => {
    return (
      formData.customer_po_number.trim() !== "" &&
      formData.customer_po_value_inctax > 0 &&
      formData.customer_po_creation_date.trim() !== "" &&
      isLinkAttachmentValid
    );
  }, [formData, isLinkAttachmentValid]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) {
      toast({
        title: "Validation Failed",
        description: "Please fill all required fields before saving.",
        variant: "destructive",
      });
      return;
    }

    let finalAttachmentName = formData.customer_po_attachment;

    if (linkOrAttachmentChoice === "attachment" && formData.file) {
      try {
        const fileResponse = await upload(formData.file, {
          isPrivate: true,  // Must be private to avoid S3 ACL issues
          doctype: "Projects",
          docname: projectName,
          fieldname: "customer_po_attachment",
        });
        finalAttachmentName = fileResponse.file_url;
      } catch (error: any) {
        toast({
          title: "Error",
          description: "Failed to upload attachment file.",
          variant: "destructive",
        });
        return;
      }
    }

    // Stringify payment terms array to JSON for storage in Long Text field
    const paymentTermsJson = paymentTerms.length > 0 ? JSON.stringify(paymentTerms) : '';

    const updatedPODetail: Omit<CustomerPODetail, "idx"> = {
      name: poDetail.name,
      customer_po_number: formData.customer_po_number,
      customer_po_value_inctax: formData.customer_po_value_inctax,
      customer_po_value_exctax: formData.customer_po_value_exctax,
      customer_po_link:
        linkOrAttachmentChoice === "link" ? formData.customer_po_link : "",
      customer_po_attachment:
        linkOrAttachmentChoice === "attachment" ? finalAttachmentName : "",
      customer_po_payment_terms: paymentTermsJson,
      customer_po_creation_date: formData.customer_po_creation_date,
    };

    updatePO({
      project_name: projectName,
      updated_po_detail: updatedPODetail,
    })
      .then(() => {
        toast({
          title: "Success",
          description: "Customer PO updated successfully.",
          variant: "success",
        });
        refetchProjectData();
        onClose();
      })
      .catch((err) => {
        console.error(err);
        toast({
          title: "Error",
          description: "Failed to update Customer PO.",
          variant: "destructive",
        });
      });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold mb-4">
            Edit Customer Purchase Order
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-6 py-4">
          <div className="space-y-2">
            <Label htmlFor="customer_po_number">PO Number <span className="text-red-500">*</span></Label>
            <Input
              id="customer_po_number"
              value={formData.customer_po_number}
              onChange={handleInputChange}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="customer_po_creation_date">PO Date <span className="text-red-500">*</span></Label>
            <Input
              id="customer_po_creation_date"
              type="date"
              value={formData.customer_po_creation_date}
              onChange={handleInputChange}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="customer_po_value_inctax">
                PO Value (Incl. Tax) <span className="text-red-500">*</span>
              </Label>
              <Input
                id="customer_po_value_inctax"
                type="number"
                step="any"
                value={formData.customer_po_value_inctax || ""}
                onChange={handleInputChange}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="customer_po_value_exctax">
                PO Value (Excl. Tax)
              </Label>
              <Input
                id="customer_po_value_exctax"
                type="number"
                step="any"
                value={formData.customer_po_value_exctax || ""}
                onChange={handleInputChange}
              />
            </div>
          </div>

          {/* Radio */}
          <div className="space-y-2 border p-4 rounded-md">
            <Label className="font-medium">PO Source (Link or Attachment)</Label>
            <div className="flex gap-6">
              <div className="flex items-center space-x-2">
                <input
                  type="radio"
                  id="choiceLink"
                  name="poSource"
                  checked={linkOrAttachmentChoice === "link"}
                  onChange={() => handleChoiceChange("link")}
                />
                <Label htmlFor="choiceLink">Link</Label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="radio"
                  id="choiceAttachment"
                  name="poSource"
                  checked={linkOrAttachmentChoice === "attachment"}
                  onChange={() => handleChoiceChange("attachment")}
                />
                <Label htmlFor="choiceAttachment">Attachment</Label>
              </div>
            </div>
          </div>

          {linkOrAttachmentChoice === "link" && (
            <div className="space-y-2">
              <Label htmlFor="customer_po_link">PO Link <span className="text-red-500">*</span></Label>
              <Input
                id="customer_po_link"
                type="url"
                value={formData.customer_po_link}
                onChange={handleInputChange}
                required
              />
            </div>
          )}

          {linkOrAttachmentChoice === "attachment" && (
            <div className="space-y-2 overflow-hidden">
              <Label>PO Attachment (PDF/Image)</Label>
              <CustomAttachment
                selectedFile={formData.file}
                onFileSelect={(file) => setFormData(prev => ({ ...prev, file }))}
                acceptedTypes={["application/pdf", "image/*"]}
                label={formData.customer_po_attachment ? "Replace PO Attachment" : "Upload PO Attachment"}
              />
              {!formData.file && formData.customer_po_attachment && (
                <div className="flex items-center gap-2 p-2 bg-accent/10 rounded-md">
                  <a
                    href={formData.customer_po_attachment}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline truncate block flex-1 min-w-0"
                  >
                    {decodeURIComponent(formData.customer_po_attachment.split('/').pop()?.split('?')[0] || 'Attachment')}
                  </a>
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, customer_po_attachment: '' }))}
                    className="p-1 rounded-full hover:bg-accent/20 transition-colors shrink-0"
                    aria-label="Remove attachment"
                  >
                    <X className="h-4 w-4 text-destructive" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Payment Terms — Display + Add Flow */}
          <div className="space-y-3 border p-4 rounded-md">
            <Label className="font-medium">Payment Terms</Label>

            {/* Existing terms — compact read-only rows */}
            {paymentTerms.map((term, index) => (
              <div key={index} className="px-3 py-2 border rounded bg-gray-50">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 text-sm">
                    <span className="font-medium">{term.label}</span>
                    <span className="text-blue-600 font-mono whitespace-nowrap">{term.percentage}%</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setNewTerm({ ...term });
                        setIsEditingTerm(true);
                        setPaymentTerms(prev => prev.filter((_, i) => i !== index));
                      }}
                      className="h-7 w-7 p-0 text-blue-500 hover:text-blue-700"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setPaymentTerms(prev => prev.filter((_, i) => i !== index))}
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
              <div className="grid grid-cols-[7fr_3fr] gap-2 items-end">
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
              onClick={() => {
                if (!newTerm.label.trim()) return;
                setPaymentTerms(prev => [...prev, { ...newTerm }]);
                setNewTerm({ label: '', percentage: 0, description: '' });
                setIsEditingTerm(false);
              }}
              disabled={!newTerm.label.trim()}
              className="w-full h-8 text-xs border-red-500 text-red-600 bg-transparent hover:bg-red-50"
            >
              <Plus className="h-3 w-3 mr-1" /> {isEditingTerm ? 'Update Term' : 'Add Term'}
            </Button>
          </div>

          <Button type="submit" disabled={!isFormValid || totalLoading}>
            {totalLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FilePenLine className="mr-2 h-4 w-4" />
            )}
            {totalLoading
              ? uploadLoading
                ? "Uploading File..."
                : "Updating PO..."
              : "Update Customer PO"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};
