import { useContext, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFrappeGetDocList, useFrappeFileUpload, useFrappePostCall } from "frappe-react-sdk";
import { UserContext } from "@/utils/auth/UserProvider";
import { formatDate } from "@/utils/FormatDate";
import { useUserData } from "@/hooks/useUserData";
import { encodeFrappeId } from "@/pages/DeliveryNotes/constants";

// UI Components
import ProjectSelect from "@/components/custom-select/project-select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileText, Upload, Eye, Download, CirclePlus } from "lucide-react";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { useToast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";

// Types
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";

interface UploadDialogState {
  open: boolean;
  poId: string;
  poName: string;
  type: "DC" | "MIR" | null;
}

interface NirmaanAttachment {
  name: string;
  creation: string;
  attachment: string;
  attachment_type: string;
  modified_by: string;
}

export const DeliveryChallansAndMirs = () => {
  const { setSelectedProject, selectedProject } = useContext(UserContext);
  const { toast } = useToast();
  const userData = useUserData();
  const navigate = useNavigate();

  // State
  const [uploadDialog, setUploadDialog] = useState<UploadDialogState>({
    open: false,
    poId: "",
    poName: "",
    type: null,
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [viewAttachmentsDialog, setViewAttachmentsDialog] = useState<{
    open: boolean;
    poId: string;
    poName: string;
  }>({
    open: false,
    poId: "",
    poName: "",
  });

  // Fetch all POs with Partially Delivered or Delivered status
  const { data: procurementOrdersList, isLoading, mutate: mutatePOs } = useFrappeGetDocList<ProcurementOrder>(
    "Procurement Orders",
    {
      fields: ["name", "project", "vendor", "vendor_name", "dispatch_date", "latest_delivery_date", "status", "procurement_request"],
      filters: [["status", "in", ["Partially Delivered", "Delivered"]]],
      orderBy: { field: "latest_delivery_date", order: "desc" },
      limit: 1000,
    }
  );

  // Fetch all attachments for the selected project to show counts
  const { data: projectAttachmentsList, mutate: mutateProjectAttachments } = useFrappeGetDocList<NirmaanAttachment>(
    "Nirmaan Attachments",
    {
      fields: ["name", "associated_docname", "attachment_type"],
      filters: [
        ["project", "=", selectedProject],
        ["associated_doctype", "=", "Procurement Orders"],
        ["attachment_type", "in", ["delivery challan", "material inspection report"]],
      ],
      limit: 10000,
    },
    selectedProject ? undefined : null // Only fetch when project is selected
  );

  // Fetch attachments for the selected PO
  const { data: attachmentsList, isLoading: attachmentsLoading, mutate: mutateAttachments } = useFrappeGetDocList<NirmaanAttachment>(
    "Nirmaan Attachments",
    {
      fields: ["name", "creation", "attachment", "attachment_type", "modified_by"],
      filters: [
        ["associated_doctype", "=", "Procurement Orders"],
        ["associated_docname", "=", viewAttachmentsDialog.poId],
        ["attachment_type", "in", ["delivery challan", "material inspection report"]],
      ],
      orderBy: { field: "creation", order: "desc" },
      limit: 1000,
    },
    viewAttachmentsDialog.poId ? undefined : null // Only fetch when dialog is open
  );

  // API hooks
  const { upload, loading: uploadLoading } = useFrappeFileUpload();
  const { call: createAttachmentDoc, loading: createAttachmentLoading } = useFrappePostCall(
    "frappe.client.insert"
  );

  const handleProjectChange = (selectedItem: any) => {
    const projectValue = selectedItem ? selectedItem.value : null;
    setSelectedProject(projectValue);
    if (projectValue) {
      sessionStorage.setItem("selectedProject", JSON.stringify(projectValue));
    } else {
      sessionStorage.removeItem("selectedProject");
    }
  };

  // Navigate to PO view
  const handleNavigateToPO = (po: ProcurementOrder) => {
    if (!po.procurement_request) {
      console.error("PO missing procurement_request field:", po);
      toast({
        title: "Navigation Error",
        description: "This Purchase Order is missing required information.",
        variant: "destructive",
      });
      return;
    }

    if (po.procurement_request && po.name) {
      const encodedPoId = encodeFrappeId(po.name);
      const path = `/prs&milestones/procurement-requests/${po.procurement_request}/${encodedPoId}`;
      console.log("Navigating to PO:", { po: po.name, pr: po.procurement_request, path });
      navigate(path);
    }
  };

  // Filter POs by selected project
  const selectedProjectPOs = useMemo(() => {
    if (!selectedProject || !procurementOrdersList) return [];
    return procurementOrdersList.filter((po) => po.project === selectedProject);
  }, [procurementOrdersList, selectedProject]);

  // Get the latest delivery date (dispatch_date or latest_delivery_date)
  const getLatestDeliveryDate = (po: ProcurementOrder): string => {
    const date = po.latest_delivery_date || po.dispatch_date;
    return date ? formatDate(date) : "N/A";
  };

  // Open upload dialog
  const handleOpenUploadDialog = (poName: string, type: "DC" | "MIR") => {
    const po = selectedProjectPOs.find((p) => p.name === poName);
    if (!po) return;

    setUploadDialog({
      open: true,
      poId: poName,
      poName: `PO-${poName.split("/")[1]}`,
      type,
    });
    setSelectedFile(null);
  };

  // Close upload dialog
  const handleCloseUploadDialog = () => {
    setUploadDialog({ open: false, poId: "", poName: "", type: null });
    setSelectedFile(null);
  };

  // Handle file upload
  const handleUploadFile = async () => {
    if (!selectedFile || !uploadDialog.type) {
      toast({
        title: "No File Selected",
        description: "Please select a file to upload",
        variant: "destructive",
      });
      return;
    }

    try {
      // Step 1: Upload file to Frappe
      const uploadResult = await upload(selectedFile, {
        doctype: "Procurement Orders",
        docname: uploadDialog.poId,
        fieldname: "attachment",
        isPrivate: true,
      });

      if (!uploadResult?.file_url) {
        throw new Error("File upload failed");
      }

      // Step 2: Get PO details for project and vendor
      const po = selectedProjectPOs.find((p) => p.name === uploadDialog.poId);
      if (!po) {
        throw new Error("Purchase Order not found");
      }

      // Step 3: Create Nirmaan Attachments record
      const attachmentType = uploadDialog.type === "DC" ? "delivery challan" : "material inspection report";

      const attachmentDoc = {
        doctype: "Nirmaan Attachments",
        project: po.project,
        attachment: uploadResult.file_url,
        attachment_type: attachmentType,
        associated_doctype: "Procurement Orders",
        associated_docname: uploadDialog.poId,
        attachment_link_doctype: "Vendors",
        attachment_link_docname: po.vendor,
      };

      await createAttachmentDoc({ doc: attachmentDoc });

      // Success
      toast({
        title: "Upload Successful",
        description: `${uploadDialog.type} uploaded successfully for ${uploadDialog.poName}`,
        variant: "success",
      });

      // Refresh data and close dialog
      mutatePOs();
      mutateProjectAttachments();
      handleCloseUploadDialog();
    } catch (error: any) {
      console.error("Upload error:", error);
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload file",
        variant: "destructive",
      });
    }
  };

  // Open view attachments dialog
  const handleViewAttachments = (poName: string) => {
    setViewAttachmentsDialog({
      open: true,
      poId: poName,
      poName: `PO-${poName.split("/")[1]}`,
    });
  };

  // Close view attachments dialog
  const handleCloseViewAttachments = () => {
    setViewAttachmentsDialog({ open: false, poId: "", poName: "" });
  };

  // Group attachments by type
  const groupedAttachments = useMemo(() => {
    if (!attachmentsList) return { dc: [], mir: [] };

    const dc = attachmentsList.filter((att) => att.attachment_type === "delivery challan");
    const mir = attachmentsList.filter((att) => att.attachment_type === "material inspection report");

    return { dc, mir };
  }, [attachmentsList]);

  // Get attachment count for a specific PO
  const getAttachmentCount = (poName: string): { dc: number; mir: number; total: number } => {
    if (!projectAttachmentsList) return { dc: 0, mir: 0, total: 0 };

    const poAttachments = projectAttachmentsList.filter((att) => att.associated_docname === poName);
    const dc = poAttachments.filter((att) => att.attachment_type === "delivery challan").length;
    const mir = poAttachments.filter((att) => att.attachment_type === "material inspection report").length;

    return { dc, mir, total: dc + mir };
  };

  // Download attachment
  const handleDownloadAttachment = (fileUrl: string, fileName: string) => {
    const link = document.createElement("a");
    link.href = fileUrl;
    link.download = fileName;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Slice file name to maintain consistent dialog size
  const sliceFileName = (fileName: string, maxLength: number = 25): string => {
    if (fileName.length <= maxLength) return fileName;
    const extension = fileName.split(".").pop();
    const nameWithoutExt = fileName.substring(0, fileName.lastIndexOf("."));
    const slicedName = nameWithoutExt.substring(0, maxLength - (extension ? extension.length + 4 : 3));
    return `${slicedName}...${extension ? `.${extension}` : ""}`;
  };

  const isUploading = uploadLoading || createAttachmentLoading;

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Delivery Challans & MIRs</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select Project</CardTitle>
          <p className="text-sm text-muted-foreground pt-1">
            Select a project to view its purchase orders and upload documents.
          </p>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <ProjectSelect onChange={handleProjectChange} />
          </div>

          {selectedProject && (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[120px]">PO No.</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Latest Delivery Date</TableHead>
                      <TableHead className="text-center w-[140px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8">
                          Loading...
                        </TableCell>
                      </TableRow>
                    )}
                    {!isLoading && selectedProjectPOs.length > 0 ? (
                      selectedProjectPOs.map((po) => {
                        const attachmentCount = getAttachmentCount(po.name);
                        return (
                          <TableRow key={po.name}>
                            <TableCell className="font-medium">
                              <span
                                className="text-blue-600 underline cursor-pointer hover:text-blue-800"
                                onClick={() => handleNavigateToPO(po)}
                              >
                                {`PO-${po.name.split("/")[1]}`}
                              </span>
                            </TableCell>
                            <TableCell>{po.vendor_name || "N/A"}</TableCell>
                            <TableCell>{getLatestDeliveryDate(po)}</TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1.5 items-center">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleOpenUploadDialog(po.name, "DC")}
                                  className="flex items-center gap-1 w-full justify-center"
                                >
                                  <CirclePlus className="h-4 w-4" />
                                  <span className="hidden lg:inline">Upload</span>
                                  <span> DC</span>
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleOpenUploadDialog(po.name, "MIR")}
                                  className="flex items-center gap-1 w-full justify-center"
                                >
                                  <CirclePlus className="h-4 w-4" />
                                  <span className="hidden lg:inline">Upload</span>
                                  <span> MIR</span>
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => handleViewAttachments(po.name)}
                                  className="flex items-center gap-1 relative w-full justify-center"
                                  title={
                                    attachmentCount.total > 0
                                      ? `${attachmentCount.dc} DC${attachmentCount.dc !== 1 ? 's' : ''}, ${attachmentCount.mir} MIR${attachmentCount.mir !== 1 ? 's' : ''}`
                                      : "No attachments"
                                  }
                                >
                                  <Eye className="h-4 w-4" />
                                  <span className="hidden lg:inline">View</span>
                                  {attachmentCount.total > 0 && (
                                    <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                                      {attachmentCount.total}
                                    </span>
                                  )}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    ) : !isLoading ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-red-500 py-8">
                          No Purchase Orders found for this project.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile/Tablet Card View */}
              <div className="md:hidden space-y-4">
                {isLoading && <p className="text-center py-8">Loading...</p>}
                {!isLoading && selectedProjectPOs.length > 0 ? (
                  selectedProjectPOs.map((po) => {
                    const attachmentCount = getAttachmentCount(po.name);
                    return (
                      <Card key={po.name} className="border-l-4 border-l-blue-500">
                        <CardContent className="p-4">
                          {/* PO Header */}
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <span
                                className="font-bold text-blue-600 text-lg underline cursor-pointer hover:text-blue-800"
                                onClick={() => handleNavigateToPO(po)}
                              >
                                {`PO-${po.name.split("/")[1]}`}
                              </span>
                            </div>
                            <Badge variant="outline">{po.status}</Badge>
                          </div>

                          {/* PO Details */}
                          <div className="space-y-2 text-sm mb-4">
                            <div className="flex items-start">
                              <span className="text-gray-500 min-w-[120px] font-medium">Vendor:</span>
                              <span className="text-gray-900 flex-1">{po.vendor_name || "N/A"}</span>
                            </div>
                            <div className="flex items-start">
                              <span className="text-gray-500 min-w-[120px] font-medium">Delivery Date:</span>
                              <span className="text-gray-900">{getLatestDeliveryDate(po)}</span>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex flex-col gap-2 pt-2 border-t">
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleOpenUploadDialog(po.name, "DC")}
                                className="flex-1 flex items-center justify-center gap-2"
                              >
                                <FileText className="h-4 w-4" />
                                Upload DC
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleOpenUploadDialog(po.name, "MIR")}
                                className="flex-1 flex items-center justify-center gap-2"
                              >
                                <Upload className="h-4 w-4" />
                                Upload MIR
                              </Button>
                            </div>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleViewAttachments(po.name)}
                              className="w-full flex items-center justify-center gap-2 relative"
                              title={
                                attachmentCount.total > 0
                                  ? `${attachmentCount.dc} DC${attachmentCount.dc !== 1 ? 's' : ''}, ${attachmentCount.mir} MIR${attachmentCount.mir !== 1 ? 's' : ''}`
                                  : "No attachments"
                              }
                            >
                              <Eye className="h-4 w-4" />
                              View Attachments
                              {attachmentCount.total > 0 && (
                                <span className="ml-1 bg-blue-600 text-white text-xs rounded-full px-2 py-0.5">
                                  {attachmentCount.total}
                                </span>
                              )}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                ) : !isLoading ? (
                  <div className="text-center text-red-500 py-8">
                    No Purchase Orders found for this project.
                  </div>
                ) : null}
              </div>
            </>
          )}

          {!selectedProject && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Select a Project</h3>
              <p className="text-sm text-muted-foreground">
                Choose a project from the dropdown above to view its purchase orders
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload Dialog */}
      <Dialog open={uploadDialog.open} onOpenChange={handleCloseUploadDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              Upload {uploadDialog.type === "DC" ? "Delivery Challan" : "Material Inspection Report"}
            </DialogTitle>
            <DialogDescription>
              Upload {uploadDialog.type} for {uploadDialog.poName}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <CustomAttachment
              selectedFile={selectedFile}
              onFileSelect={setSelectedFile}
              label={`Select ${uploadDialog.type} File`}
              maxFileSize={20 * 1024 * 1024}
              acceptedTypes={["application/pdf", "image/*"]}
            />
          </div>

          <DialogFooter>
            {isUploading ? (
              <div className="flex justify-center w-full">
                <TailSpin color="#3b82f6" width={40} height={40} />
              </div>
            ) : (
              <>
                <Button variant="outline" onClick={handleCloseUploadDialog}>
                  Cancel
                </Button>
                <Button onClick={handleUploadFile} disabled={!selectedFile}>
                  Upload
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Attachments Dialog */}
      <Dialog open={viewAttachmentsDialog.open} onOpenChange={handleCloseViewAttachments}>
        <DialogContent className="sm:max-w-[700px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Attachments for {viewAttachmentsDialog.poName}</DialogTitle>
            <DialogDescription>View all uploaded Delivery Challans and MIRs</DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-6">
            {attachmentsLoading ? (
              <div className="flex justify-center py-8">
                <TailSpin color="#3b82f6" width={40} height={40} />
              </div>
            ) : (
              <>
                {/* Delivery Challans Section */}
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <FileText className="h-5 w-5 text-blue-600" />
                    Delivery Challans ({groupedAttachments.dc.length})
                  </h3>
                  {groupedAttachments.dc.length > 0 ? (
                    <div className="space-y-2">
                      {groupedAttachments.dc.map((attachment) => {
                        const fileName = attachment.attachment.split("/").pop() || "file";
                        return (
                          <Card key={attachment.name} className="border-l-4 border-l-blue-500">
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium" title={fileName}>
                                    {sliceFileName(fileName)}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    Uploaded: {formatDate(attachment.creation)}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    By: {attachment.modified_by}
                                  </p>
                                </div>
                                <div className="flex gap-2 flex-shrink-0">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      window.open(attachment.attachment, "_blank")
                                    }
                                    className="flex items-center gap-1"
                                  >
                                    <Eye className="h-4 w-4" />
                                    View
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      handleDownloadAttachment(
                                        attachment.attachment,
                                        fileName
                                      )
                                    }
                                    className="flex items-center gap-1"
                                  >
                                    <Download className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground italic py-4 text-center border rounded-lg">
                      No Delivery Challans uploaded yet
                    </p>
                  )}
                </div>

                {/* MIRs Section */}
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <Upload className="h-5 w-5 text-green-600" />
                    Material Inspection Reports ({groupedAttachments.mir.length})
                  </h3>
                  {groupedAttachments.mir.length > 0 ? (
                    <div className="space-y-2">
                      {groupedAttachments.mir.map((attachment) => {
                        const fileName = attachment.attachment.split("/").pop() || "file";
                        return (
                          <Card key={attachment.name} className="border-l-4 border-l-green-500">
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium" title={fileName}>
                                    {sliceFileName(fileName)}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    Uploaded: {formatDate(attachment.creation)}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    By: {attachment.modified_by}
                                  </p>
                                </div>
                                <div className="flex gap-2 flex-shrink-0">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      window.open(attachment.attachment, "_blank")
                                    }
                                    className="flex items-center gap-1"
                                  >
                                    <Eye className="h-4 w-4" />
                                    View
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      handleDownloadAttachment(
                                        attachment.attachment,
                                        fileName
                                      )
                                    }
                                    className="flex items-center gap-1"
                                  >
                                    <Download className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground italic py-4 text-center border rounded-lg">
                      No Material Inspection Reports uploaded yet
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseViewAttachments}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
