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
import { toast } from "@/components/ui/use-toast";
import { useFrappePostCall, useFrappeFileUpload } from "frappe-react-sdk";
import { Loader2, FilePenLine } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { CustomerPODetail } from "./AddCustomerPODialog";

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
  console.log("EditCustomerPODialog rendered with poDetail:", poDetail);
  const [linkOrAttachmentChoice, setLinkOrAttachmentChoice] =
    useState<LinkAttachmentChoice>(
      poDetail?.customer_po_attachment ? "attachment" : "link"
    );

  const [formData, setFormData] = useState<
    Omit<CustomerPODetail, "name" | "idx"> & { file: File | null }
  >({
    customer_po_number: poDetail.customer_po_number,
    customer_po_value_inctax: poDetail.customer_po_value_inctax,
    customer_po_value_exctax: poDetail.customer_po_value_exctax,
    customer_po_link: poDetail?.customer_po_link||"",
    customer_po_payment_terms: poDetail.customer_po_payment_terms,
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

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] || null;
      setFormData((prev) => ({
        ...prev,
        file: file,
        customer_po_attachment: file ? file.name : "",
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

    const updatedPODetail: Omit<CustomerPODetail, "idx"> = {
      name: poDetail.name,
      customer_po_number: formData.customer_po_number,
      customer_po_value_inctax: formData.customer_po_value_inctax,
      customer_po_value_exctax: formData.customer_po_value_exctax,
      customer_po_link:
        linkOrAttachmentChoice === "link" ? formData.customer_po_link : "",
      customer_po_attachment:
        linkOrAttachmentChoice === "attachment" ? finalAttachmentName : "",
      customer_po_payment_terms: formData.customer_po_payment_terms,
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
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold mb-4">
            Edit Customer Purchase Order
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-6 py-4">
          <div className="space-y-2">
            <Label htmlFor="customer_po_number">PO Number*</Label>
            <Input
              id="customer_po_number"
              value={formData.customer_po_number}
              onChange={handleInputChange}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="customer_po_creation_date">PO Date*</Label>
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
                PO Value (Incl. Tax)*
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
              <Label htmlFor="customer_po_link">PO Link*</Label>
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
            <div className="space-y-2">
              <Label htmlFor="customer_po_attachment">
                PO Attachment (PDF/Image)
              </Label>
              <Input
                id="customer_po_attachment"
                type="file"
                onChange={handleFileChange}
                accept=".pdf,image/*"
              />
              <p className="text-xs text-gray-500">
                {formData.file
                  ? `Selected: ${formData.file.name}`
                  : formData.customer_po_attachment
                  ? `Current: ${formData.customer_po_attachment}`
                  : "No file selected"}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="customer_po_payment_terms">Payment Terms</Label>
            <Textarea
              id="customer_po_payment_terms"
              value={formData.customer_po_payment_terms}
              onChange={handleInputChange}
              rows={4}
            />
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
