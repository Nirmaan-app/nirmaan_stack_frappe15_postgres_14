import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFrappeFileUpload, useFrappePostCall } from "frappe-react-sdk";
import { format } from "date-fns";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { useToast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import { FileText } from "lucide-react";
import SITEURL from "@/constants/siteURL";

import { DCMIRItemSelector } from "./DCMIRItemSelector";
import { uploadDCMIRSchema, type UploadDCMIRFormValues } from "../schema";
import type { PODeliveryDocuments } from "@/types/NirmaanStack/PODeliveryDocuments";

interface POItemForSelector {
  item_id: string;
  item_name: string;
  unit: string;
  category?: string;
  make?: string;
}

interface UploadDCMIRDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  dcType: "Delivery Challan" | "Material Inspection Report";
  poName: string;
  poDisplayName: string;
  poProject: string;
  poVendor: string;
  poItems: POItemForSelector[];
  /** For edit mode - the existing PO Delivery Document to update */
  existingDoc?: PODeliveryDocuments;
  /** Callback after successful create/edit */
  onSuccess: () => void;
}

export const UploadDCMIRDialog = ({
  open,
  onOpenChange,
  mode,
  dcType,
  poName,
  poDisplayName,
  poProject,
  poVendor,
  poItems,
  existingDoc,
  onSuccess,
}: UploadDCMIRDialogProps) => {
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const { upload, loading: uploadLoading } = useFrappeFileUpload();
  const { call: createAttachmentDoc, loading: createAttLoading } = useFrappePostCall("frappe.client.insert");
  const { call: createPDD } = useFrappePostCall(
    "nirmaan_stack.api.po_delivery_documentss.create_po_delivery_documents"
  );
  const { call: updatePDD } = useFrappePostCall(
    "nirmaan_stack.api.po_delivery_documentss.update_po_delivery_documents"
  );
  const { call: updateAttachmentUrl } = useFrappePostCall(
    "nirmaan_stack.api.po_delivery_documentss.update_nirmaan_attachment"
  );

  const [attachmentAction, setAttachmentAction] = useState<"keep" | "replace">("keep");
  const typeLabel = dcType === "Delivery Challan" ? "DC" : "MIR";

  const form = useForm<UploadDCMIRFormValues>({
    resolver: zodResolver(uploadDCMIRSchema),
    defaultValues: {
      referenceNumber: "",
      dcReference: "",
      dcDate: format(new Date(), "yyyy-MM-dd"),
      items: poItems.map((item) => ({
        item_id: item.item_id,
        item_name: item.item_name,
        unit: item.unit,
        category: item.category || "",
        quantity: 0,
        make: item.make || "",
        selected: false,
      })),
      isSignedByClient: true,
      clientRepresentativeName: "",
    },
  });

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      if (mode === "edit" && existingDoc) {
        setAttachmentAction("keep");
        setSelectedFile(null);
        form.reset({
          referenceNumber: existingDoc.reference_number || "",
          dcReference: existingDoc.dc_reference || "",
          dcDate: existingDoc.dc_date || format(new Date(), "yyyy-MM-dd"),
          items: poItems.map((poItem) => {
            const existingItem = existingDoc.items?.find(
              (ei) => ei.item_id === poItem.item_id
            );
            return {
              item_id: poItem.item_id,
              item_name: poItem.item_name,
              unit: poItem.unit,
              category: poItem.category || "",
              quantity: existingItem?.quantity || 0,
              make: poItem.make || "",
              selected: !!existingItem,
            };
          }),
          isSignedByClient: !!existingDoc.is_signed_by_client,
          clientRepresentativeName: existingDoc.client_representative_name || "",
        });
      } else {
        form.reset({
          referenceNumber: "",
          dcReference: "",
          dcDate: format(new Date(), "yyyy-MM-dd"),
          items: poItems.map((item) => ({
            item_id: item.item_id,
            item_name: item.item_name,
            unit: item.unit,
            category: item.category || "",
            quantity: 0,
            make: item.make || "",
            selected: false,
          })),
          isSignedByClient: true,
          clientRepresentativeName: "",
        });
        setSelectedFile(null);
      }
    }
  }, [open, mode, existingDoc, poItems]);

  const isSubmitting = uploadLoading || createAttLoading;
  const isSignedByClient = form.watch("isSignedByClient");

  const onSubmit = async (data: UploadDCMIRFormValues) => {
    try {
      const selectedItems = data.items
        .filter((item) => item.selected && item.quantity > 0)
        .map(({ selected, ...rest }) => rest);

      if (mode === "edit" && existingDoc) {
        // Handle attachment replacement if user chose to replace
        if (attachmentAction === "replace" && selectedFile) {
          const uploadResult = await upload(selectedFile, {
            doctype: "Procurement Orders",
            docname: poName,
            fieldname: "attachment",
            isPrivate: true,
          });
          if (!uploadResult?.file_url) {
            throw new Error("File upload failed");
          }
          // Update the existing Nirmaan Attachment record with new URL
          if (existingDoc.nirmaan_attachment) {
            await updateAttachmentUrl({
              attachment_name: existingDoc.nirmaan_attachment,
              new_url: uploadResult.file_url,
            });
          }
        }

        // Edit mode: update existing doc
        await updatePDD({
          document_name: existingDoc.name,
          items: JSON.stringify(selectedItems),
          reference_number: data.referenceNumber,
          dc_reference: data.dcReference || null,
          dc_date: data.dcDate || null,
          is_signed_by_client: data.isSignedByClient ? 1 : 0,
          client_representative_name: data.isSignedByClient
            ? data.clientRepresentativeName
            : null,
        });

        toast({
          title: "Updated Successfully",
          description: `${typeLabel} record updated for ${poDisplayName}`,
          variant: "success",
        });
      } else {
        // Create mode: upload file + create attachment + create PDD
        if (!selectedFile) {
          toast({
            title: "No File Selected",
            description: "Please select a file to upload",
            variant: "destructive",
          });
          return;
        }

        // Step 1: Upload file
        const uploadResult = await upload(selectedFile, {
          doctype: "Procurement Orders",
          docname: poName,
          fieldname: "attachment",
          isPrivate: true,
        });

        if (!uploadResult?.file_url) {
          throw new Error("File upload failed");
        }

        // Step 2: Create Nirmaan Attachment (backward compat)
        const attachmentType =
          dcType === "Delivery Challan"
            ? "po delivery challan"
            : "material inspection report";

        const attResult = await createAttachmentDoc({
          doc: {
            doctype: "Nirmaan Attachments",
            project: poProject,
            attachment: uploadResult.file_url,
            attachment_type: attachmentType,
            associated_doctype: "Procurement Orders",
            associated_docname: poName,
            attachment_link_doctype: "Vendors",
            attachment_link_docname: poVendor,
            attachment_ref: data.referenceNumber || undefined,
          },
        });

        const attachmentId = attResult?.message?.name;

        // Step 3: Create PO Delivery Documents record
        await createPDD({
          procurement_order: poName,
          dc_type: dcType,
          reference_number: data.referenceNumber,
          dc_reference: data.dcReference || null,
          attachment_id: attachmentId,
          items: JSON.stringify(selectedItems),
          dc_date: data.dcDate || null,
          is_signed_by_client: data.isSignedByClient ? 1 : 0,
          client_representative_name: data.isSignedByClient
            ? data.clientRepresentativeName
            : null,
        });

        toast({
          title: "Upload Successful",
          description: `${typeLabel} uploaded successfully for ${poDisplayName}`,
          variant: "success",
        });
      }

      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: mode === "edit" ? "Update Failed" : "Upload Failed",
        description: error?.message || "An error occurred",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto overscroll-y-contain">
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "Update" : "Upload"}{" "}
            {dcType === "Delivery Challan"
              ? "Delivery Challan"
              : "Material Inspection Report"}
          </DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? `Update ${typeLabel} details for ${poDisplayName}`
              : `Upload ${typeLabel} for ${poDisplayName}`}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Section 1: Document */}
            {mode === "create" && (
              <CustomAttachment
                selectedFile={selectedFile}
                onFileSelect={setSelectedFile}
                label={`Select ${typeLabel} File`}
                maxFileSize={20 * 1024 * 1024}
                acceptedTypes={["application/pdf", "image/*"]}
              />
            )}

            {mode === "edit" && existingDoc?.attachment_url && (
              <div className="space-y-2">
                <Label>Attachment</Label>
                {attachmentAction === "keep" ? (
                  <div className="flex items-center justify-between gap-2 p-3 border rounded-md bg-muted/30">
                    <a
                      href={`${SITEURL}${existingDoc.attachment_url}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                      title={existingDoc.attachment_url.split("/").pop() || "Attached file"}
                    >
                      <FileText className="h-4 w-4 flex-shrink-0" />
                      {(() => {
                        const name = existingDoc.attachment_url.split("/").pop() || "Attached file";
                        if (name.length <= 25) return name;
                        const dotIdx = name.lastIndexOf(".");
                        const ext = dotIdx !== -1 ? name.slice(dotIdx) : "";
                        const availLen = 25 - ext.length - 3;
                        return availLen > 0
                          ? `${name.slice(0, availLen)}...${ext}`
                          : `${name.slice(0, 22)}...`;
                      })()}
                    </a>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setAttachmentAction("replace")}
                    >
                      Replace
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <CustomAttachment
                      selectedFile={selectedFile}
                      onFileSelect={setSelectedFile}
                      label={`Select new ${typeLabel} File`}
                      maxFileSize={20 * 1024 * 1024}
                      acceptedTypes={["application/pdf", "image/*"]}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setAttachmentAction("keep");
                        setSelectedFile(null);
                      }}
                    >
                      Cancel Replace
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="referenceNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {typeLabel} Number <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={`Enter ${typeLabel} number`}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dcDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {dcType === "Material Inspection Report" && (
              <FormField
                control={form.control}
                name="dcReference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Associated DC Number</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Enter associated DC number (optional)"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <Separator />

            {/* Section 2: Items */}
            <div>
              <p className="text-sm text-muted-foreground mb-2">
                Select items and enter delivered/inspected quantities
              </p>
              <DCMIRItemSelector form={form} />
              {form.formState.errors.items && (
                <p className="text-sm text-destructive mt-1">
                  {typeof form.formState.errors.items === "object" && "message" in form.formState.errors.items
                    ? (form.formState.errors.items as { message?: string }).message
                    : "Please select at least one item"}
                </p>
              )}
            </div>

            <Separator />

            {/* Section 3: Client Signature */}
            <div className="space-y-3">
              <FormField
                control={form.control}
                name="isSignedByClient"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-3">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        aria-label="Toggle client signature"
                      />
                    </FormControl>
                    <FormLabel className="!mt-0">Signed by client?</FormLabel>
                  </FormItem>
                )}
              />

              {isSignedByClient && (
                <FormField
                  control={form.control}
                  name="clientRepresentativeName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Client Representative Name{" "}
                        <span className="text-red-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Enter client representative name"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            <DialogFooter>
              {isSubmitting ? (
                <div className="flex justify-center w-full" role="status">
                  <TailSpin color="#3b82f6" width={40} height={40} />
                  <span className="sr-only">Uploading...</span>
                </div>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={mode === "create" && !selectedFile}
                  >
                    {mode === "edit" ? "Update" : "Upload"}
                  </Button>
                </>
              )}
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
