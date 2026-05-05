import { useContext, useMemo, useState, useCallback, useEffect } from "react";
import { useFrappeGetDocList, useFrappeGetCall } from "frappe-react-sdk";
import { UserContext } from "@/utils/auth/UserProvider";

// UI Components
import ProjectSelect from "@/components/custom-select/project-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { urlStateManager } from "@/utils/urlStateManager";

// Extracted components
import { CategoryFilter } from "./components/CategoryFilter";
import { POListTable } from "./components/POListTable";
import { POListCards } from "./components/POListCards";
import { ITMListTable, type EnrichedITM } from "./components/ITMListTable";
import { ITMListCards } from "./components/ITMListCards";
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
  is_dispatched?: number;
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

interface DeliveryChallanITMAPIResponse {
  itms: EnrichedITM[];
  unique_categories: string[];
  category_counts: Record<string, number>;
  total_itms: number;
}

interface NirmaanAttachmentCount {
  name: string;
  associated_docname: string;
  associated_doctype: string;
  attachment_type: string;
}

type ParentMode = "PO" | "ITM";

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
  parentDoctype?: "Procurement Orders" | "Internal Transfer Memo";
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

  // Parent toggle: PO or ITM (URL-persisted via `parent` param)
  const initialParentMode: ParentMode = getUrlStringParam("parent", "PO") === "ITM" ? "ITM" : "PO";
  const [parentMode, setParentMode] = useState<ParentMode>(initialParentMode);
  useEffect(() => {
    urlStateManager.updateParam("parent", parentMode);
  }, [parentMode]);

  // Category filter state
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  // Upload dialog state
  const [uploadDialog, setUploadDialog] = useState<UploadDialogState>(UPLOAD_DIALOG_CLOSED);

  // View dialog state — viewParent drives the usePODeliveryDocuments hook
  const [viewParent, setViewParent] = useState<{ name: string; doctype: "Procurement Orders" | "Internal Transfer Memo" } | null>(null);
  const [viewDisplayName, setViewDisplayName] = useState("");

  // Fetch Delivery Documents for the view dialog (works for both PO and ITM)
  const { data: pddDocs, isLoading: pddLoading, mutate: mutatePDD } = usePODeliveryDocuments(
    viewParent ? viewParent.name : null,
    viewParent ? viewParent.doctype : undefined,
  );

  // Fetch enriched PO list
  const { data: deliveryChallanData, isLoading: poLoading, mutate: mutatePOs } = useFrappeGetCall<{ message: DeliveryChallanAPIResponse }>(
    "nirmaan_stack.api.delivery_challans_data.get_delivery_challan_pos_with_categories",
    selectedProject && parentMode === "PO" ? { project_id: selectedProject } : undefined,
    selectedProject && parentMode === "PO" ? undefined : null,
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
    }
  );

  // Fetch enriched ITM list
  const { data: deliveryChallanITMData, isLoading: itmLoading, mutate: mutateITMs } = useFrappeGetCall<{ message: DeliveryChallanITMAPIResponse }>(
    "nirmaan_stack.api.delivery_challans_data.get_delivery_challan_itms_with_categories",
    selectedProject && parentMode === "ITM" ? { project_id: selectedProject } : undefined,
    selectedProject && parentMode === "ITM" ? undefined : null,
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
    }
  );

  // Fetch attachment counts (covers both PO and ITM associations)
  const { data: projectAttachmentsList, mutate: mutateProjectAttachments } = useFrappeGetDocList<NirmaanAttachmentCount>(
    "Nirmaan Attachments",
    {
      fields: ["name", "associated_docname", "associated_doctype", "attachment_type"],
      filters: [
        ["project", "=", selectedProject || ""],
        ["associated_doctype", "in", ["Procurement Orders", "Internal Transfer Memo"]],
        ["attachment_type", "in", ["po delivery challan", "itm delivery challan", "material inspection report"]],
      ],
      limit: 10000,
    },
    selectedProject ? undefined : null
  );

  // Extract data from API responses
  const procurementOrdersList = deliveryChallanData?.message?.pos || [];
  const itmList = deliveryChallanITMData?.message?.itms || [];

  const uniqueCategories = parentMode === "PO"
    ? deliveryChallanData?.message?.unique_categories || []
    : deliveryChallanITMData?.message?.unique_categories || [];
  const categoryCounts = parentMode === "PO"
    ? deliveryChallanData?.message?.category_counts || {}
    : deliveryChallanITMData?.message?.category_counts || {};

  const isLoading = parentMode === "PO" ? poLoading : itmLoading;

  // Filter POs by selected categories
  const selectedProjectPOs = useMemo(() => {
    if (!selectedProject || !procurementOrdersList.length) return [];
    if (selectedCategories.length === 0) return [...procurementOrdersList];
    return procurementOrdersList.filter(
      (po) => po.categories?.some((cat) => selectedCategories.includes(cat))
    );
  }, [procurementOrdersList, selectedProject, selectedCategories]);

  // Filter ITMs by selected categories
  const selectedProjectITMs = useMemo(() => {
    if (!selectedProject || !itmList.length) return [];
    if (selectedCategories.length === 0) return [...itmList];
    return itmList.filter(
      (itm) => itm.categories?.some((cat) => selectedCategories.includes(cat))
    );
  }, [itmList, selectedProject, selectedCategories]);

  // Attachment count helper
  const getAttachmentCount = useCallback(
    (parentName: string) => {
      if (!projectAttachmentsList) return { dc: 0, mir: 0, total: 0 };
      const atts = projectAttachmentsList.filter((att) => att.associated_docname === parentName);
      const dc = atts.filter((att) => att.attachment_type === "po delivery challan" || att.attachment_type === "itm delivery challan").length;
      const mir = atts.filter((att) => att.attachment_type === "material inspection report").length;
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

  const handleParentModeChange = (mode: ParentMode) => {
    setParentMode(mode);
    setSelectedCategories([]);
  };

  const handleToggleCategory = (category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]
    );
  };

  const handleClearCategoryFilters = () => {
    setSelectedCategories([]);
  };

  const handleOpenUploadDialog = (parentName: string, type: "DC" | "MIR") => {
    if (parentMode === "PO") {
      const po = selectedProjectPOs.find((p) => p.name === parentName);
      if (!po) return;
      const poItems = po.status === "Partially Dispatched"
        ? po.items.filter(item => item.is_dispatched === 1)
        : po.items;
      setUploadDialog({
        open: true,
        mode: "create",
        dcType: type === "DC" ? "Delivery Challan" : "Material Inspection Report",
        poName: parentName,
        poDisplayName: `PO-${parentName.split("/")[1]}`,
        poProject: po.project,
        poVendor: po.vendor,
        poItems: poItems.map((item) => ({
          item_id: item.item_id,
          item_name: item.item_name,
          unit: item.unit,
          category: item.category,
          make: item.make,
        })),
        parentDoctype: "Procurement Orders",
      });
    } else {
      const itm = selectedProjectITMs.find((i) => i.name === parentName);
      if (!itm) return;
      setUploadDialog({
        open: true,
        mode: "create",
        dcType: type === "DC" ? "Delivery Challan" : "Material Inspection Report",
        poName: parentName,
        poDisplayName: itm.name,
        poProject: itm.target_project,
        poVendor: "",
        poItems: itm.items.map((item) => ({
          item_id: item.item_id,
          item_name: item.item_name,
          unit: item.unit,
          category: item.category,
          make: item.make,
        })),
        parentDoctype: "Internal Transfer Memo",
      });
    }
  };

  const handleViewAttachments = (parentName: string) => {
    if (parentMode === "PO") {
      setViewParent({ name: parentName, doctype: "Procurement Orders" });
      setViewDisplayName(`PO-${parentName.split("/")[1]}`);
    } else {
      setViewParent({ name: parentName, doctype: "Internal Transfer Memo" });
      setViewDisplayName(parentName);
    }
  };

  const handleEdit = (doc: PODeliveryDocuments) => {
    const docParentDoctype = (doc.parent_doctype || "Procurement Orders") as "Procurement Orders" | "Internal Transfer Memo";
    const parentName = doc.parent_docname || doc.procurement_order || "";

    if (docParentDoctype === "Procurement Orders") {
      const po = selectedProjectPOs.find((p) => p.name === parentName);
      if (!po) return;
      const poItems = po.status === "Partially Dispatched"
        ? po.items.filter(item => item.is_dispatched === 1)
        : po.items;
      setViewParent(null);
      setUploadDialog({
        open: true,
        mode: "edit",
        dcType: doc.type,
        poName: parentName,
        poDisplayName: `PO-${parentName.split("/")[1]}`,
        poProject: doc.project,
        poVendor: doc.vendor || po.vendor,
        poItems: poItems.map((item) => ({
          item_id: item.item_id,
          item_name: item.item_name,
          unit: item.unit,
          category: item.category,
          make: item.make,
        })),
        existingDoc: doc,
        parentDoctype: "Procurement Orders",
      });
    } else {
      const itm = selectedProjectITMs.find((i) => i.name === parentName);
      if (!itm) return;
      setViewParent(null);
      setUploadDialog({
        open: true,
        mode: "edit",
        dcType: doc.type,
        poName: parentName,
        poDisplayName: parentName,
        poProject: doc.project,
        poVendor: "",
        poItems: itm.items.map((item) => ({
          item_id: item.item_id,
          item_name: item.item_name,
          unit: item.unit,
          category: item.category,
          make: item.make,
        })),
        existingDoc: doc,
        parentDoctype: "Internal Transfer Memo",
      });
    }
  };

  const handleUploadSuccess = () => {
    mutatePOs();
    mutateITMs();
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
            Select a project to view its purchase orders or transfer memos and upload documents.
          </p>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <ProjectSelect onChange={handleProjectChange} />
          </div>

          {selectedProject && (
            <>
              {/* PO / ITM toggle */}
              <div className="flex gap-1.5 mb-4">
                <button
                  onClick={() => handleParentModeChange("PO")}
                  className={cn(
                    "px-3 py-1.5 text-sm rounded",
                    parentMode === "PO"
                      ? "bg-sky-500 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  )}
                >
                  Purchase Orders
                </button>
                <button
                  onClick={() => handleParentModeChange("ITM")}
                  className={cn(
                    "px-3 py-1.5 text-sm rounded",
                    parentMode === "ITM"
                      ? "bg-sky-500 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  )}
                >
                  Transfer Memos
                </button>
              </div>

              <CategoryFilter
                categories={uniqueCategories}
                categoryCounts={categoryCounts}
                selectedCategories={selectedCategories}
                filteredPOCount={parentMode === "PO" ? selectedProjectPOs.length : selectedProjectITMs.length}
                onToggleCategory={handleToggleCategory}
                onClearFilters={handleClearCategoryFilters}
              />

              {parentMode === "PO" ? (
                <>
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
              ) : (
                <>
                  <ITMListTable
                    itms={selectedProjectITMs}
                    isLoading={isLoading}
                    selectedCategories={selectedCategories}
                    getAttachmentCount={getAttachmentCount}
                    onUpload={handleOpenUploadDialog}
                    onViewAttachments={handleViewAttachments}
                  />
                  <ITMListCards
                    itms={selectedProjectITMs}
                    isLoading={isLoading}
                    selectedCategories={selectedCategories}
                    getAttachmentCount={getAttachmentCount}
                    onUpload={handleOpenUploadDialog}
                    onViewAttachments={handleViewAttachments}
                  />
                </>
              )}
            </>
          )}

          {!selectedProject && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-16 w-16 text-muted-foreground mb-4" aria-hidden="true" />
              <h3 className="text-lg font-semibold mb-2">Select a Project</h3>
              <p className="text-sm text-muted-foreground">
                Choose a project from the dropdown above to view its purchase orders or transfer memos
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
        parentDoctype={uploadDialog.parentDoctype}
        onSuccess={handleUploadSuccess}
      />

      {/* View Attachments Dialog */}
      <ViewAttachmentsDialog
        open={viewParent !== null}
        onOpenChange={(open) => {
          if (!open) setViewParent(null);
        }}
        poName={viewParent?.name || ""}
        poDisplayName={viewDisplayName}
        documents={pddDocs}
        isLoading={pddLoading}
        onEdit={handleEdit}
      />
    </div>
  );
};
