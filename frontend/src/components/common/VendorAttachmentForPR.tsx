import { useMemo, useState, useCallback } from "react";
import {
  useFrappeGetDocList,
  useFrappePostCall,
  useFrappeFileUpload,
} from "frappe-react-sdk";
import { NirmaanAttachment } from "@/types/NirmaanStack/NirmaanAttachment";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Paperclip, Trash2, Eye } from "lucide-react";
import { TailSpin } from "react-loader-spinner";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import SITEURL from "@/constants/siteURL";
import { cn } from "@/lib/utils";

interface VendorAttachmentForPRProps {
  prId: string;
  vendorId: string; // This should be the Vendor DocName
  vendorName: string; // Display name
  projectId?: string;
  onUploadSuccess?: () => void;
  onDeleteSuccess?: () => void;
}

export const VendorAttachmentForPR = ({
  prId,
  vendorId,
  vendorName,
  projectId,
  onUploadSuccess,
  onDeleteSuccess,
}: VendorAttachmentForPRProps) => {
  const [open, setOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // --- Data Fetching ---
  const {
    data: attachments,
    isLoading: attachmentsLoading,
    mutate: mutateAttachments,
  } = useFrappeGetDocList<NirmaanAttachment>(
    "Nirmaan Attachments",
    {
      fields: ["name", "attachment_type", "attachment", "creation"],
      filters: [
        ["associated_doctype", "=", "Procurement Requests"],
        ["associated_docname", "=", prId],
        ["attachment_link_docname", "=", vendorId],
        ["attachment_type", "=", "Vendor Quote"],
      ],
      orderBy: { field: "creation", order: "desc" },
    },
    open ? `VendorAttachments-${prId}-${vendorId}` : `VendorAttachments-${prId}-${vendorId}` // Fetch always for label accuracy
  );

  // --- Mutations ---
  const { upload, loading: uploadLoading } = useFrappeFileUpload();
  const { call: createAttachment, loading: createLoading } = useFrappePostCall(
    "frappe.client.insert"
  );
  const { call: deleteAttachment, loading: deleteLoading } = useFrappePostCall(
    "frappe.client.delete"
  );

  const isSubmitting = uploadLoading || createLoading;

  // --- Handlers ---

  const handleUpload = async () => {
    if (!selectedFile) {
      toast({
        title: "No File Selected",
        description: "Please select a file to upload.",
        variant: "destructive",
      });
      return;
    }

    try {
      // 0. If replacing, delete existing attachment first
      if (attachments && attachments.length > 0) {
        // We assume only one attachment should exist per vendor
        for (const existingAtt of attachments) {
             await deleteAttachment({
                doctype: "Nirmaan Attachments",
                name: existingAtt.name,
              });
        }
      }

      // 1. Upload File
      const uploadResult = await upload(selectedFile, {
        doctype: "Procurement Requests",
        docname: prId,
        fieldname: "attachment", // Generic field, file is private
        isPrivate: true,
      });

      if (!uploadResult.file_url) {
        throw new Error("File upload failed - no URL returned.");
      }

      // 2. Create Nirmaan Attachment Record
      await createAttachment({
        doc: {
          doctype: "Nirmaan Attachments",
          attachment_type: "Vendor Quote",
          attachment: uploadResult.file_url,
          associated_doctype: "Procurement Requests",
          associated_docname: prId,
          attachment_link_doctype: "Vendors",
          attachment_link_docname: vendorId,
          project: projectId || "",
        },
      });

      toast({
        title: "Success",
        description: "Vendor quote uploaded successfully.",
        variant: "success",
      });

      setSelectedFile(null);
      mutateAttachments();
      onUploadSuccess?.();
      setOpen(false); // Close dialog on success
    } catch (error: any) {
      console.error("Upload Error:", error);
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload vendor quote.",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await deleteAttachment({
        doctype: "Nirmaan Attachments",
        name: name,
      });
      toast({
        title: "Deleted",
        description: "Attachment removed successfully.",
        variant: "success",
      });
      mutateAttachments();
      onDeleteSuccess?.();
    } catch (error: any) {
      console.error("Delete Error:", error);
      toast({
        title: "Delete Failed",
        description: "Could not delete attachment.",
        variant: "destructive",
      });
    }
  };

  const handleView = (url: string) => {
    window.open(`${SITEURL}${url}`, "_blank");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 text-xs bg-white w-full sm:w-auto transition-colors",
            attachments && attachments.length > 0
              ? "text-green-600 border-green-200 hover:bg-green-50 hover:text-green-700"
              : "text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700"
          )}
        >
          <Paperclip className="mr-2 h-3 w-3" />
          {attachments && attachments.length > 0 ? "View Vendor Quote" : "Add Vendor Quote"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Vendor Quotes: {vendorName} ({prId})</DialogTitle>
          <DialogDescription>
            Manage quote attachments for this vendor.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-4">
          {/* Current Attachment Section */}
          {attachmentsLoading ? (
            <div className="flex justify-center p-4">
              <TailSpin width={30} height={30} color="gray" />
            </div>
          ) : attachments && attachments.length > 0 ? (
            <div className="space-y-4">
              <div className="border p-4 rounded-md bg-green-50 border-green-200">
                <h4 className="text-sm font-medium text-green-800 mb-2">Current Quote</h4>
                <div className="flex items-center justify-between bg-white p-3 rounded border border-green-100 shadow-sm">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <Paperclip className="h-4 w-4 text-green-600 flex-shrink-0" />
                    <span className="text-sm font-medium truncate max-w-[250px]" title={attachments[0].attachment?.split("/").pop()}>
                      {attachments[0].attachment?.split("/").pop() || "Attached File"}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => handleView(attachments[0].attachment)}
                  >
                    <Eye className="mr-1 h-3 w-3" /> View
                  </Button>
                </div>
                <p className="text-xs text-green-700 mt-2">
                  uploaded on {attachments[0].creation?.split(" ")[0]}
                </p>
              </div>

              {/* Replace Section */}
              <div className="pt-2 border-t">
                <h4 className="text-sm font-medium mb-3">Replace Quote</h4>
                <div className="flex flex-col gap-3 p-4 border rounded-md bg-slate-50">
                  <CustomAttachment
                    selectedFile={selectedFile}
                    onFileSelect={setSelectedFile}
                    label="Select New File to Replace"
                    acceptedTypes={[
                      "application/pdf",
                      "image/*",
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                      "text/csv",
                    ]}
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={handleUpload}
                      disabled={!selectedFile || isSubmitting}
                    >
                      {isSubmitting ? (
                        <TailSpin width={20} height={20} color="white" />
                      ) : (
                        "Confirm Replacement"
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Upload Section (Empty State) */
            <div className="space-y-4 border p-4 rounded-md bg-slate-50">
              <h4 className="text-sm font-medium">Upload Quote</h4>
              <div className="flex flex-col gap-3">
                <CustomAttachment
                  selectedFile={selectedFile}
                  onFileSelect={setSelectedFile}
                  label="Select Quote File (PDF, Image, Excel)"
                  acceptedTypes={[
                    "application/pdf",
                    "image/*",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "text/csv",
                  ]}
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={handleUpload}
                    disabled={!selectedFile || isSubmitting}
                  >
                    {isSubmitting ? (
                      <TailSpin width={20} height={20} color="white" />
                    ) : (
                      "Upload"
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
