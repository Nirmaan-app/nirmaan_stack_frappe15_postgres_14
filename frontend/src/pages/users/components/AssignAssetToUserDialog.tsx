import { useState, useMemo, useEffect } from "react";
import { useFrappeCreateDoc, useFrappeUpdateDoc, useFrappeFileUpload } from "frappe-react-sdk";
import ReactSelect from "react-select";
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
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { Package, Calendar, FileText, Briefcase, Laptop } from "lucide-react";
import {
  ASSET_MASTER_DOCTYPE,
  ASSET_MANAGEMENT_DOCTYPE,
} from "@/pages/Assets/assets.constants";

interface AssetMasterRecord {
  name: string;
  asset_name: string;
  asset_category: string;
  asset_condition: string;
  asset_serial_number: string;
  asset_value: number;
  current_assignee: string;
}

interface AssetCategoryRecord {
  name: string;
  asset_category: string;
  category_type?: "Project" | "IT";
}

interface SelectOption {
  label: string;
  value: string;
}

type AssetTypeOption = "Project" | "IT";

const ASSET_TYPE_BUTTONS: { label: string; value: AssetTypeOption; icon: typeof Briefcase }[] = [
  { label: "Project", value: "Project", icon: Briefcase },
  { label: "IT", value: "IT", icon: Laptop },
];

interface AssignAssetToUserDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
  unassignedAssets: AssetMasterRecord[];
  categoryList: AssetCategoryRecord[] | undefined;
  /** Pre-selects the Type dropdown when the dialog opens (e.g. the active sub-tab). */
  initialAssetType?: AssetTypeOption;
  onAssigned?: () => void;
}

export function AssignAssetToUserDialog({
  isOpen,
  onOpenChange,
  userId,
  userName,
  unassignedAssets,
  categoryList,
  initialAssetType,
  onAssigned,
}: AssignAssetToUserDialogProps) {
  const { toast } = useToast();
  const { createDoc } = useFrappeCreateDoc();
  const { updateDoc } = useFrappeUpdateDoc();
  const { upload } = useFrappeFileUpload();

  const [assetType, setAssetType] = useState<AssetTypeOption | "">("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedAsset, setSelectedAsset] = useState<string>("");
  const [assignedDate, setAssignedDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [declarationFile, setDeclarationFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when dialog opens — pre-select the type if the caller passes one.
  useEffect(() => {
    if (isOpen) {
      setAssetType(initialAssetType ?? "");
      setSelectedCategory("");
      setSelectedAsset("");
      setAssignedDate(format(new Date(), "yyyy-MM-dd"));
      setDeclarationFile(null);
    }
  }, [isOpen, initialAssetType]);

  // Reset category + asset when the type switches
  useEffect(() => {
    setSelectedCategory("");
    setSelectedAsset("");
  }, [assetType]);

  // Reset asset when category changes (matches the original behavior)
  useEffect(() => {
    setSelectedAsset("");
  }, [selectedCategory]);

  // Category options filtered by selected Type. Falls back to all categories
  // if no type is chosen yet so we don't silently drop legacy entries that
  // lack a category_type value.
  const categoryOptions: SelectOption[] = useMemo(() => {
    const list = (categoryList ?? []).filter((cat) =>
      assetType ? cat.category_type === assetType : true
    );
    return list.map((cat) => ({ label: cat.asset_category, value: cat.name }));
  }, [categoryList, assetType]);

  // Category name -> category_type (for filtering assets by type even when no
  // specific category is picked yet).
  const categoryTypeMap = useMemo(() => {
    const map = new Map<string, AssetTypeOption>();
    (categoryList ?? []).forEach((c) => {
      if (c.category_type === "Project" || c.category_type === "IT") {
        map.set(c.name, c.category_type);
      }
    });
    return map;
  }, [categoryList]);

  // Filtered asset options based on Type, then narrowed further by Category.
  const assetOptions: SelectOption[] = useMemo(() => {
    let filteredAssets = unassignedAssets;

    if (assetType) {
      filteredAssets = filteredAssets.filter(
        (asset) => categoryTypeMap.get(asset.asset_category) === assetType
      );
    }

    if (selectedCategory) {
      filteredAssets = filteredAssets.filter(
        (asset) => asset.asset_category === selectedCategory
      );
    }

    return filteredAssets.map((asset) => ({
      label: `${asset.asset_name}${asset.asset_serial_number ? ` (${asset.asset_serial_number})` : ""}`,
      value: asset.name,
    }));
  }, [unassignedAssets, selectedCategory, assetType, categoryTypeMap]);

  const handleSubmit = async () => {
    if (!selectedAsset) {
      toast({
        title: "Asset Required",
        description: "Please select an asset to assign.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      let fileUrl: string | undefined;

      // Upload declaration file if provided
      if (declarationFile) {
        const fileArgs = {
          doctype: ASSET_MANAGEMENT_DOCTYPE,
          docname: `temp-assignment-${Date.now()}`,
          fieldname: "asset_declaration_attachment",
          isPrivate: true,
        };
        const uploadedFile = await upload(declarationFile, fileArgs);
        fileUrl = uploadedFile.file_url;
      }

      // Create Asset Management entry
      await createDoc(ASSET_MANAGEMENT_DOCTYPE, {
        asset: selectedAsset,
        asset_assigned_to: userId,
        asset_assigned_on: assignedDate,
        asset_declaration_attachment: fileUrl || undefined,
      });

      // Update Asset Master with current assignee
      await updateDoc(ASSET_MASTER_DOCTYPE, selectedAsset, {
        current_assignee: userId,
      });

      const assetName = assetOptions.find((a) => a.value === selectedAsset)?.label || selectedAsset;
      toast({
        title: "Asset Assigned",
        description: `${assetName} has been assigned to ${userName}.`,
        variant: "success",
      });

      onOpenChange(false);
      onAssigned?.();
    } catch (error: any) {
      console.error("Failed to assign asset:", error);
      toast({
        title: "Assignment Failed",
        description: error?.message || "An error occurred while assigning the asset.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const reactSelectStyles = {
    control: (base: any, state: any) => ({
      ...base,
      borderColor: state.isFocused ? "hsl(var(--ring))" : "hsl(var(--border))",
      boxShadow: state.isFocused ? "0 0 0 1px hsl(var(--ring))" : "none",
      "&:hover": { borderColor: "hsl(var(--border))" },
      minHeight: "40px",
    }),
    menuPortal: (base: any) => ({
      ...base,
      zIndex: 9999,
    }),
    menu: (base: any) => ({
      ...base,
      zIndex: 9999,
    }),
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
            <Package className="h-6 w-6 text-emerald-600" />
          </div>
          <DialogTitle className="text-center text-lg font-semibold">
            Assign Asset
          </DialogTitle>
          <DialogDescription className="text-center text-sm text-gray-500">
            Assign an asset to <span className="font-medium text-gray-700">{userName}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Asset Type — segmented button selector (default = active tab) */}
          <div>
            <Label className="text-sm font-medium text-gray-700">
              Asset Type <span className="text-red-500">*</span>
            </Label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {ASSET_TYPE_BUTTONS.map((opt) => {
                const Icon = opt.icon;
                const isSelected = assetType === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setAssetType(opt.value)}
                    className={`
                      inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium
                      transition-colors
                      ${isSelected
                        ? opt.value === "Project"
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-purple-500 bg-purple-50 text-purple-700"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                      }
                    `}
                  >
                    <Icon className="h-4 w-4" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Category Filter */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-gray-700">
              Category
              <span className="ml-1 text-xs text-gray-400">(filter)</span>
            </Label>
            <ReactSelect
              options={categoryOptions}
              value={categoryOptions.find((opt) => opt.value === selectedCategory) || null}
              onChange={(val) => setSelectedCategory(val?.value || "")}
              placeholder={
                assetType
                  ? `All ${assetType} categories...`
                  : "Select Asset Type first"
              }
              isClearable
              isDisabled={!assetType}
              styles={reactSelectStyles}
            />
          </div>

          {/* Asset Selection */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-gray-700">
              Asset <span className="text-red-500">*</span>
            </Label>
            <ReactSelect
              options={assetOptions}
              value={assetOptions.find((opt) => opt.value === selectedAsset) || null}
              onChange={(val) => setSelectedAsset(val?.value || "")}
              placeholder={
                assetType ? "Select an asset..." : "Select Asset Type first"
              }
              isClearable
              isDisabled={!assetType}
              styles={reactSelectStyles}
              noOptionsMessage={() =>
                unassignedAssets.length === 0
                  ? "No unassigned assets available"
                  : selectedCategory
                  ? `No ${assetType} assets in this category`
                  : `No unassigned ${assetType} assets available`
              }
            />
            {assetOptions.length === 0 && unassignedAssets.length > 0 && selectedCategory && (
              <p className="text-xs text-amber-600">
                No unassigned assets in this category. Try selecting a different category.
              </p>
            )}
          </div>

          {/* Assignment Date */}
          <div className="space-y-1.5">
            <Label htmlFor="assignedDate" className="text-sm font-medium text-gray-700">
              Assignment Date
            </Label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                id="assignedDate"
                type="date"
                value={assignedDate}
                onChange={(e) => setAssignedDate(e.target.value)}
                className="w-full rounded-md border border-gray-200 bg-white py-2 pl-10 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Declaration Attachment */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-gray-700">
              Declaration Document
              <span className="ml-1 text-xs text-gray-400">(optional)</span>
            </Label>
            <CustomAttachment
              selectedFile={declarationFile}
              onFileSelect={setDeclarationFile}
              acceptedTypes={["image/*", "application/pdf"]}
              label="Upload Declaration"
              maxFileSize={10 * 1024 * 1024}
              onError={(err) =>
                toast({
                  title: "File Error",
                  description: err.message,
                  variant: "destructive",
                })
              }
            />
            {!declarationFile && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <FileText className="h-3 w-3" />
                Declaration can be uploaded later
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !assetType || !selectedAsset}
            className="gap-2 bg-emerald-600 hover:bg-emerald-700"
          >
            {isSubmitting ? "Assigning..." : "Assign Asset"}
            <Package className="h-4 w-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
