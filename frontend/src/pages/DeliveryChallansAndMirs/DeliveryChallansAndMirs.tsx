import { useContext, useMemo, useState, useCallback } from "react";
import { useFrappeGetDocList, useFrappeGetCall } from "frappe-react-sdk";
import { UserContext } from "@/utils/auth/UserProvider";

// UI Components
import ProjectSelect from "@/components/custom-select/project-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText } from "lucide-react";

// Extracted components
import { CategoryFilter } from "./components/CategoryFilter";
import { POListTable } from "./components/POListTable";
import { POListCards } from "./components/POListCards";
import { UploadDCMIRDialog } from "./components/UploadDCMIRDialog";
import { ViewAttachmentsDialog } from "./components/ViewAttachmentsDialog";
import { usePODeliveryDocuments } from "./hooks/usePODeliveryDocuments";

// Types
import type { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import type { PODeliveryDocuments } from "@/types/NirmaanStack/PODeliveryDocuments";

interface POItem {
  item_id: string;
  item_name: string;
  category: string;
  quantity: number;
  received_quantity: number;
  unit: string;
  quote: number;
  make: string;
  tax: number;
  tax_amount: number;
  total_amount: number;
  amount: number;
  procurement_package: string;
  comment: string;
}

interface EnrichedProcurementOrder extends Omit<ProcurementOrder, 'items'> {
  categories: string[];
  category_count: number;
  items: POItem[];
  item_count: number;
  error?: string;
}

interface DeliveryChallanAPIResponse {
  pos: EnrichedProcurementOrder[];
  unique_categories: string[];
  category_counts: Record<string, number>;
  total_pos: number;
}

interface NirmaanAttachmentCount {
  name: string;
  associated_docname: string;
  attachment_type: string;
}

interface UploadDialogState {
  open: boolean;
  mode: "create" | "edit";
  dcType: "Delivery Challan" | "Material Inspection Report";
  poName: string;
  poDisplayName: string;
  poProject: string;
  poVendor: string;
  poItems: { item_id: string; item_name: string; unit: string; category?: string; make?: string }[];
  existingDoc?: PODeliveryDocuments;
}

const UPLOAD_DIALOG_CLOSED: UploadDialogState = {
  open: false,
  mode: "create",
  dcType: "Delivery Challan",
  poName: "",
  poDisplayName: "",
  poProject: "",
  poVendor: "",
  poItems: [],
};

export const DeliveryChallansAndMirs = () => {
  const { setSelectedProject, selectedProject } = useContext(UserContext);

  // Category filter state
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  // Upload dialog state
  const [uploadDialog, setUploadDialog] = useState<UploadDialogState>(UPLOAD_DIALOG_CLOSED);

  // View dialog state — viewPoId drives the usePODeliveryDocuments hook
  const [viewPoId, setViewPoId] = useState<string | null>(null);
  const [viewPoDisplayName, setViewPoDisplayName] = useState("");

  // Fetch PO Delivery Documents for the view dialog
  const { data: pddDocs, isLoading: pddLoading, mutate: mutatePDD } = usePODeliveryDocuments(viewPoId);

  // Fetch enriched PO list from custom API
  const { data: deliveryChallanData, isLoading, mutate: mutatePOs } = useFrappeGetCall<{ message: DeliveryChallanAPIResponse }>(
    "nirmaan_stack.api.delivery_challans_data.get_delivery_challan_pos_with_categories",
    selectedProject ? { project_id: selectedProject } : undefined,
    selectedProject ? undefined : null,
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
    }
  );

  // Fetch attachment counts per PO for badge display
  const { data: projectAttachmentsList, mutate: mutateProjectAttachments } = useFrappeGetDocList<NirmaanAttachmentCount>(
    "Nirmaan Attachments",
    {
      fields: ["name", "associated_docname", "attachment_type"],
      filters: [
        ["project", "=", selectedProject || ""],
        ["associated_doctype", "=", "Procurement Orders"],
        ["attachment_type", "in", ["po delivery challan", "material inspection report"]],
      ],
      limit: 10000,
    },
    selectedProject ? undefined : null
  );

  // Extract data from API response
  const procurementOrdersList = deliveryChallanData?.message?.pos || [];
  const uniqueCategories = deliveryChallanData?.message?.unique_categories || [];
  const categoryCounts = deliveryChallanData?.message?.category_counts || {};

  // Filter POs by selected categories
  const selectedProjectPOs = useMemo(() => {
    if (!selectedProject || !procurementOrdersList.length) return [];

    if (selectedCategories.length === 0) return [...procurementOrdersList];

    return procurementOrdersList.filter(
      (po) => po.categories?.some((cat) => selectedCategories.includes(cat))
    );
  }, [procurementOrdersList, selectedProject, selectedCategories]);

  // Attachment count helper for PO row badges
  const getAttachmentCount = useCallback(
    (poName: string) => {
      if (!projectAttachmentsList) return { dc: 0, mir: 0, total: 0 };
      const poAtts = projectAttachmentsList.filter((att) => att.associated_docname === poName);
      const dc = poAtts.filter((att) => att.attachment_type === "po delivery challan").length;
      const mir = poAtts.filter((att) => att.attachment_type === "material inspection report").length;
      return { dc, mir, total: dc + mir };
    },
    [projectAttachmentsList]
  );

  // --- Handlers ---

  const handleProjectChange = (selectedItem: any) => {
    const projectValue = selectedItem ? selectedItem.value : null;
    setSelectedProject(projectValue);
    setSelectedCategories([]);
    if (projectValue) {
      sessionStorage.setItem("selectedProject", JSON.stringify(projectValue));
    } else {
      sessionStorage.removeItem("selectedProject");
    }
  };

  const handleToggleCategory = (category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]
    );
  };

  const handleClearCategoryFilters = () => {
    setSelectedCategories([]);
  };

  const handleOpenUploadDialog = (poName: string, type: "DC" | "MIR") => {
    const po = selectedProjectPOs.find((p) => p.name === poName);
    if (!po) return;

    setUploadDialog({
      open: true,
      mode: "create",
      dcType: type === "DC" ? "Delivery Challan" : "Material Inspection Report",
      poName,
      poDisplayName: `PO-${poName.split("/")[1]}`,
      poProject: po.project,
      poVendor: po.vendor,
      poItems: po.items.map((item) => ({
        item_id: item.item_id,
        item_name: item.item_name,
        unit: item.unit,
        category: item.category,
        make: item.make,
      })),
    });
  };

  const handleViewAttachments = (poName: string) => {
    setViewPoId(poName);
    setViewPoDisplayName(`PO-${poName.split("/")[1]}`);
  };

  const handleEdit = (doc: PODeliveryDocuments) => {
    const po = selectedProjectPOs.find((p) => p.name === doc.procurement_order);
    if (!po) return;

    // Close view dialog and open upload in edit mode
    setViewPoId(null);
    setUploadDialog({
      open: true,
      mode: "edit",
      dcType: doc.type,
      poName: doc.procurement_order,
      poDisplayName: `PO-${doc.procurement_order.split("/")[1]}`,
      poProject: doc.project,
      poVendor: doc.vendor || po.vendor,
      poItems: po.items.map((item) => ({
        item_id: item.item_id,
        item_name: item.item_name,
        unit: item.unit,
        category: item.category,
        make: item.make,
      })),
      existingDoc: doc,
    });
  };

  const handleUploadSuccess = () => {
    mutatePOs();
    mutateProjectAttachments();
    mutatePDD();
  };

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">
          Delivery Challans & MIRs
        </h2>
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
              <CategoryFilter
                categories={uniqueCategories}
                categoryCounts={categoryCounts}
                selectedCategories={selectedCategories}
                filteredPOCount={selectedProjectPOs.length}
                onToggleCategory={handleToggleCategory}
                onClearFilters={handleClearCategoryFilters}
              />

              <POListTable
                pos={selectedProjectPOs}
                isLoading={isLoading}
                selectedCategories={selectedCategories}
                getAttachmentCount={getAttachmentCount}
                onUpload={handleOpenUploadDialog}
                onViewAttachments={handleViewAttachments}
              />

              <POListCards
                pos={selectedProjectPOs}
                isLoading={isLoading}
                selectedCategories={selectedCategories}
                getAttachmentCount={getAttachmentCount}
                onUpload={handleOpenUploadDialog}
                onViewAttachments={handleViewAttachments}
              />
            </>
          )}

          {!selectedProject && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-16 w-16 text-muted-foreground mb-4" aria-hidden="true" />
              <h3 className="text-lg font-semibold mb-2">Select a Project</h3>
              <p className="text-sm text-muted-foreground">
                Choose a project from the dropdown above to view its purchase orders
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload DC/MIR Dialog */}
      <UploadDCMIRDialog
        open={uploadDialog.open}
        onOpenChange={(open) => {
          if (!open) setUploadDialog(UPLOAD_DIALOG_CLOSED);
        }}
        mode={uploadDialog.mode}
        dcType={uploadDialog.dcType}
        poName={uploadDialog.poName}
        poDisplayName={uploadDialog.poDisplayName}
        poProject={uploadDialog.poProject}
        poVendor={uploadDialog.poVendor}
        poItems={uploadDialog.poItems}
        existingDoc={uploadDialog.existingDoc}
        onSuccess={handleUploadSuccess}
      />

      {/* View Attachments Dialog */}
      <ViewAttachmentsDialog
        open={viewPoId !== null}
        onOpenChange={(open) => {
          if (!open) setViewPoId(null);
        }}
        poName={viewPoId || ""}
        poDisplayName={viewPoDisplayName}
        documents={pddDocs}
        isLoading={pddLoading}
        onEdit={handleEdit}
      />
    </div>
  );
};
