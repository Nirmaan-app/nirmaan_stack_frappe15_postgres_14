import { useState, useMemo, useEffect } from "react";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { toast } from "@/components/ui/use-toast";
import {
  RevisionItem,
  DifferenceData,
  SummaryData
} from "../types";
import {
  useProcurementRequestForRevision,
  useProjectForRevision,
  useRevisionCategories,
  useRevisionItems,
  useRevisionCategoryMakelist,
  useRevisionVendorInvoices,
} from "../data/usePORevisionQueries";
import { useCreateRevision } from "../data/usePORevisionMutations";

interface UsePORevisionProps {
  po: ProcurementOrder;
  open: boolean;
  onClose: () => void;
  onSuccess?: (revisionName: string) => void;
}

export const usePORevision = ({ po, open, onClose, onSuccess }: UsePORevisionProps) => {
  const [revisionItems, setRevisionItems] = useState<RevisionItem[]>([]);
  const [justification, setJustification] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);

  // Calculations
  const beforeSummary = useMemo<SummaryData>(() => {
    const totalExclGst = po?.items?.reduce((sum, item) => sum + (item.amount || 0), 0) || 0;
    const totalInclGst = po?.items?.reduce((sum, item) => sum + (item.total_amount || 0), 0) || 0;
    return { totalExclGst, totalInclGst };
  }, [po]);

  const afterSummary = useMemo<SummaryData>(() => {
    const totalExclGst = revisionItems.reduce((sum, item) => {
      if (item.item_type === "Deleted") return sum;
      const qty = item.quantity || 0;
      const rate = item.quote || 0;
      return sum + (qty * rate);
    }, 0);

    const totalInclGst = revisionItems.reduce((sum, item) => {
      if (item.item_type === "Deleted") return sum;
      const qty = item.quantity || 0;
      const rate = item.quote || 0;
      const tax = item.tax || 0;
      const amount = qty * rate;
      const total = amount + (amount * tax / 100);
      return sum + total;
    }, 0);

    return { totalExclGst, totalInclGst };
  }, [revisionItems]);

  const difference = useMemo<DifferenceData>(() => {
    return {
      exclGst: afterSummary.totalExclGst - beforeSummary.totalExclGst,
      inclGst: afterSummary.totalInclGst - beforeSummary.totalInclGst,
    };
  }, [beforeSummary, afterSummary]);

  const netImpact = useMemo(() => {
    return Math.abs(difference.inclGst);
  }, [difference]);

  // Sync state on open
  useEffect(() => {
    if (open && po) {
      setRevisionItems(po.items.map(i => ({ ...i, item_type: "Original", original_row_id: i.name })));
      setStep(1);
      setJustification("");
    }
  }, [open, po]);

  // ─── Centralized Data Fetching ────────────────────────────
  const { data: prData } = useProcurementRequestForRevision(po?.procurement_request);
  const { data: projectDoc } = useProjectForRevision(po?.project);

  const allRelevantPackages = useMemo(() => {
    const packages = new Set<string>();

    if (projectDoc?.project_work_packages) {
      const projectWPs = (typeof projectDoc.project_work_packages === 'string'
        ? JSON.parse(projectDoc.project_work_packages)
        : projectDoc.project_work_packages)?.work_packages ?? [];
      projectWPs.forEach((wp: any) => {
        if (wp.work_package_name) packages.add(wp.work_package_name);
      });
    }

    if (prData?.work_package) packages.add(prData.work_package);

    (prData?.pr_tag_list || []).forEach((tag: any) => {
      if (tag.tag_package) packages.add(tag.tag_package);
    });

    (projectDoc?.project_wp_category_makes || []).forEach((item: any) => {
      if (item.procurement_package) packages.add(item.procurement_package);
    });

    return Array.from(packages);
  }, [prData?.work_package, prData?.pr_tag_list, projectDoc?.project_work_packages, projectDoc?.project_wp_category_makes]);

  const { data: categories } = useRevisionCategories(allRelevantPackages);
  const categoryNames = useMemo(() => categories?.map(c => c.name) || [], [categories]);

  const { data: itemsList } = useRevisionItems(allRelevantPackages, categoryNames);
  const { data: categoryMakelist } = useRevisionCategoryMakelist(allRelevantPackages, categoryNames);

  const itemOptions = useMemo(() => {
    if (!itemsList) return [];

    const projectMakes = projectDoc?.project_wp_category_makes || [];
    const allowedCategoriesFromProject = projectMakes.map((item: any) => item.category).filter(Boolean);
    const allowedPackagesFromProject = projectMakes.map((item: any) => item.procurement_package).filter(Boolean);

    const filteredItems = itemsList.filter(item => {
      const category = categories?.find(cat => cat.name === item.category);
      if (!category) return false;

      const catName = category.category_name || category.name;
      if (catName === "Tool & Equipments" || catName === "Additional Charges" || category.work_package === "Additional Charges" || category.work_package === "Tool & Equipments") return true;

      if (allowedCategoriesFromProject.length > 0 || allowedPackagesFromProject.length > 0) {
        const matchesCategory = allowedCategoriesFromProject.includes(item.category);
        const matchesPackage = allowedPackagesFromProject.includes(category.work_package);
        return matchesCategory || matchesPackage;
      }

      const prTags = prData?.pr_tag_list || [];
      const allowedPackagesFromTags = prTags.length > 0
        ? Array.from(new Set(prTags.map((t: any) => t.tag_package)))
        : [];

      if (allowedPackagesFromTags.length > 0) {
        return allowedPackagesFromTags.includes(category.work_package) || category.work_package === "Tool & Equipments" || category.work_package === "Additional Charges";
      }

      return true;
    });

    const categoryMap = new Map(categories?.map(c => [c.name, c]) || []);
    const categoryMakesMap = new Map<string, string[]>();
    categoryMakelist?.forEach(m => {
      if (!categoryMakesMap.has(m.category)) categoryMakesMap.set(m.category, []);
      categoryMakesMap.get(m.category)!.push(m.make);
    });

    return filteredItems.map(item => ({
      label: item.item_name,
      value: item.name,
      item_id: item.name,
      item_name: item.item_name,
      make: item.make_name || "",
      available_makes: categoryMakesMap.get(item.category) || (item.make_name ? [item.make_name] : []),
      unit: item.unit_name || "",
      category: item.category,
      procurement_package: categoryMap.get(item.category)?.work_package || "",
      tax: parseFloat(categoryMap.get(item.category)?.tax || "0")
    }));
  }, [itemsList, categories, categoryMakelist, projectDoc?.project_wp_category_makes, prData?.pr_tag_list]);

  const { data: invoices } = useRevisionVendorInvoices(po?.name, open);

  // ─── Centralized Mutations ───────────────────────────────
  const { createRevision } = useCreateRevision();

  // Item Handlers
  const handleAddItem = (newItem?: RevisionItem) => {
    const itemToAdd: RevisionItem = newItem || {
      item_name: "",
      make: "",
      unit: "Nos",
      quantity: 0,
      quote: 0,
      tax: 0,
      item_type: "New"
    };
    setRevisionItems([...revisionItems, itemToAdd]);
  };

  const handleUpdateItem = (index: number, updates: Partial<RevisionItem>) => {
    const newItems = [...revisionItems];
    const item = newItems[index];

    if (item.item_type === "Original") {
      newItems[index] = { ...item, ...updates, item_type: updates.item_type || "Revised" };
    } else {
      newItems[index] = { ...item, ...updates };
    }
    setRevisionItems(newItems);
  };

  const handleRemoveItem = (index: number) => {
    const newItems = [...revisionItems];
    const item = newItems[index];

    if (item.item_type === "Original" || item.item_type === "Revised") {
      newItems[index] = { ...item, item_type: "Deleted" };
    } else if (item.item_type === "Deleted") {
      // Check if original existed
      if (item.original_row_id) {
        const original = po.items.find(i => i.name === item.original_row_id);
        if (original) {
          // Check if it was revised before being deleted
          const isRevised = Object.keys(item).some(k => (item as any)[k] !== (original as any)[k] && k !== 'item_type');
          newItems[index] = { ...original, item_type: isRevised ? "Revised" : "Original", original_row_id: original.name };
        }
      }
    } else {
      newItems.splice(index, 1);
    }
    setRevisionItems(newItems);
  };

  const handleSave = async () => {
    try {
      setLoading(true);

      const itemsToSubmit = revisionItems.map(item => {
        // Find original item if it exists
        const original = item.original_row_id ? po.items.find(i => i.name === item.original_row_id) : null;

        return {
          item_type: item.item_type,
          original_row_id: item.original_row_id,

          // Revision Details
          item_id: item.item_id,
          item_name: item.item_name,
          make: item.make,
          quantity: item.quantity,
          unit: item.unit,
          quote: item.quote,
          amount: (item.quantity || 0) * (item.quote || 0),
          tax: item.tax,
          category: item.category,
          procurement_package: item.procurement_package,

          // Original Details
          original_item_id: original?.item_id,
          original_item_name: original?.item_name,
          original_make: original?.make,
          original_qty: original?.quantity,
          original_received_qty: original?.received_quantity,
          original_unit: original?.unit,
          original_rate: original?.quote,
          original_amount: original?.amount,
          original_tax: original?.tax,
          original_category: original?.category,
          original_procurement_package: original?.procurement_package,
        };
      });

      const res = await createRevision({
        po_id: po.name,
        justification,
        revision_items: JSON.stringify(itemsToSubmit),
        total_amount_difference: difference.inclGst,
      });

      const result = res.message;
      const revName = typeof result === "string" ? result : result?.name;
      const autoApproved = typeof result === "object" && result?.auto_approved;

      toast({
        title: autoApproved ? "Revision Auto-Approved" : "Revision Created",
        description: autoApproved
          ? `PO Revision ${revName} was automatically approved.`
          : `PO Revision ${revName} has been created successfully.`,
        variant: "success",
      });

      if (onSuccess) {
        onSuccess(revName);
      }
      onClose();
    } catch (error: any) {
      console.error("Revision error:", error);
      toast({ title: "Error", description: error.message || "Something went wrong while creating the revision.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return {
    revisionItems,
    setRevisionItems,
    justification,
    setJustification,
    loading,
    step,
    setStep,
    beforeSummary,
    afterSummary,
    difference,
    netImpact,
    invoices,
    handleAddItem,
    handleUpdateItem,
    handleRemoveItem,
    handleSave,
    itemOptions,
  };
};
