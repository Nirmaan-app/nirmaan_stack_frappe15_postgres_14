import { useState, useMemo, useEffect } from "react";
import { useFrappeGetDocList, useFrappePostCall, useFrappeFileUpload, useFrappeGetDoc } from "frappe-react-sdk";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { Category } from "@/types/NirmaanStack/Category";
import { Items } from "@/types/NirmaanStack/Items";
import { CategoryMakelist } from "@/types/NirmaanStack/CategoryMakelist";
import { toast } from "@/components/ui/use-toast";
import { 
  RevisionItem, 
  PaymentTerm, 
  RefundAdjustment, 
  AdjustmentMethodType, 
  DifferenceData, 
  SummaryData 
} from "../types";

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

  // Step 2 State
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerm[]>([]); 
  const [refundAdjustments, setRefundAdjustments] = useState<RefundAdjustment[]>([]);
  const [adjustmentMethod, setAdjustmentMethod] = useState<AdjustmentMethodType>("Another PO");

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

  const totalAdjustmentAllocated = useMemo(() => {
    return refundAdjustments.reduce((sum, adj) => sum + (adj.amount || 0), 0);
  }, [refundAdjustments]);

  // Sync state on open
  useEffect(() => {
    if (open && po) {
      setRevisionItems(po.items.map(i => ({ ...i, item_type: "Original", original_row_id: i.name })));
      setStep(1);
      setJustification("");
      setPaymentTerms([]);
      setRefundAdjustments([]);
    }
  }, [open, po]);

  // Fetch Data
  const { data: prData } = useFrappeGetDoc<ProcurementRequest>(
    "Procurement Requests",
    po?.procurement_request || "",
    po?.procurement_request ? `PR-${po.procurement_request}` : null
  );

  const workPackage = prData?.work_package;

  const { data: categories } = useFrappeGetDocList<Category>(
    "Category",
    {
      fields: ["name", "tax"],
      filters: [["work_package", "in",[workPackage,"Tool & Equipments","Additional Charges"]]], 
      limit: 0,
    },
    workPackage ? `Categories-WP-${workPackage}` : null
  );

  const categoryNames = useMemo(() => categories?.map(c => c.name) || [], [categories]);

  const { data: itemsList } = useFrappeGetDocList<Items>(
    "Items",
    {
      fields: ["name", "item_name", "category", "unit_name", "make_name"],
      filters: categoryNames.length > 0 ? [["category", "in", categoryNames]] : [["name", "=", "INVALID"]],
      limit: 0,
    },
    categoryNames.length > 0 ? `Items-Cat-${workPackage}` : null
  );

  const { data: categoryMakelist } = useFrappeGetDocList<CategoryMakelist>(
    "Category Makelist",
    {
      fields: ["category", "make"],
      filters: categoryNames.length > 0 ? [["category", "in", categoryNames]] : [["category", "=", "INVALID"]],
      limit: 0,
    },
    categoryNames.length > 0 ? `CatMakelist-${workPackage}` : null
  );

  const itemOptions = useMemo(() => {
    if (!itemsList) return [];
    
    // Create a map of categories to get tax easily
    const categoryMap = new Map(categories?.map(c => [c.name, c]) || []);

    const categoryMakesMap = new Map<string, string[]>();
    categoryMakelist?.forEach(m => {
        if (!categoryMakesMap.has(m.category)) categoryMakesMap.set(m.category, []);
        categoryMakesMap.get(m.category)!.push(m.make);
    });

    return itemsList.map(item => ({
      label: item.item_name,
      value: item.name,
      item_id: item.name,
      item_name: item.item_name,
      make: item.make_name || "",
      available_makes: categoryMakesMap.get(item.category) || (item.make_name ? [item.make_name] : []),
      unit: item.unit_name || "",
      category: item.category,
      tax: parseFloat(categoryMap.get(item.category)?.tax || "0")
    }));
  }, [itemsList, categories, categoryMakelist]);

  const { data: invoices } = useFrappeGetDocList<VendorInvoice>(
    "Vendor Invoices",
    {
      fields: ["name", "invoice_no", "invoice_date", "invoice_amount", "status", "owner"],
      filters: [
        ["document_type", "=", "Procurement Orders"],
        ["document_name", "=", po?.name || ""],
      ],
      limit: 100,
    },
    open && po?.name ? `VendorInvoices-${po.name}` : null
  );

  const { data: adjCandidatePOs } = useFrappeGetDocList<ProcurementOrder>(
    "Procurement Orders",
    {
      fields: ["name", "vendor", "total_amount","amount_paid"],
      filters: [
        ["vendor", "=", po?.vendor || ""],
        ["status", "in", ["PO Approved"]],
      ],
      limit: 100,
    },
    open && po?.vendor ? `AdjCandidatePOs-${po.vendor}` : null
  );

  const { call: makeRevision } = useFrappePostCall("nirmaan_stack.api.po_revisions.revision_logic.make_po_revisions");
  const { upload } = useFrappeFileUpload();

  // Item Handlers
  const handleAddItem = () => {
    const newItem: RevisionItem = {
      item_name: "",
      make: "",
      unit: "Nos",
      quantity: 0,
      quote: 0,
      tax: 0,
      item_type: "New"
    };
    setRevisionItems([...revisionItems, newItem]);
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
          
          // Original Details
          original_item_id: original?.item_id,
          original_item_name: original?.item_name,
          original_make: original?.make,
          original_qty: original?.quantity,
          original_unit: original?.unit,
          original_rate: original?.quote,
          original_amount: original?.amount,
          original_tax: original?.tax,
        };
      });

      let returnDetails = null;
      if (difference.inclGst > 0) {
        returnDetails = { 
          list: {
            type: "Payment Terms", 
            Details: [
              {
                return_type: "Payment-terms",
                status: "Pending",
                amount: difference.inclGst,
                terms: paymentTerms.map(pt => ({
                  label: pt.term,
                  amount: pt.amount
                }))
              }
            ]
          }
        };
      } else {
        // Upload refund files if any
        const detailsWithFiles = await Promise.all(refundAdjustments.map(async (adj) => {
            const detail: any = {
                status: "Pending",
                amount: adj.amount,
            };

            if (adj.type === "Another PO") {
                detail.return_type = "Against-po";
                detail.target_pos = [{
                    po_number: adj.po_id,
                    amount: adj.amount
                }];
            } else if (adj.type === "Adhoc") {
                detail.return_type = "Ad-hoc";
                detail.status = "Pending";
                detail["ad-hoc_tyep"] = adj.adhoc_type || "expense";
                detail["ad-hoc_dexription"] = adj.description || "";
                detail.comment = adj.comment || "";
            } else if (adj.type === "Refunded") {
                detail.return_type = "Vendor-has-refund";
                detail.refund_date = adj.date || "";
                
                // Handle file upload
                if (adj.refund_attachment_file) {
                    try {
                        const uploadResult = await upload(adj.refund_attachment_file, {
                            doctype: "Procurement Orders",
                            docname: po.name,
                            fieldname: "attachment",
                            isPrivate: true
                        });
                        detail.refund_attachment = uploadResult?.file_url || "";
                    } catch (err) {
                        console.error("Refund file upload failed:", err);
                        // Continue anyway or throw? Let's proceed with empty if failed but log it
                        detail.refund_attachment = "";
                    }
                } else {
                    detail.refund_attachment = adj.refund_attachment || "";
                }
            }
            return detail;
        }));

        returnDetails = {
          list: {
            type: "Refund Adjustment",
            Details: detailsWithFiles
          }
        };
      }

      const res = await makeRevision({
        po_id: po.name,
        justification,
        revision_items: JSON.stringify(itemsToSubmit),
        total_amount_difference: difference.inclGst,
        payment_return_details: JSON.stringify(returnDetails)
      });

      const revName = res.message;

      toast({ title: "Revision Created", description: `PO Revision ${revName} has been created successfully.`, variant: "success" });
      
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
    paymentTerms,
    setPaymentTerms,
    refundAdjustments,
    setRefundAdjustments,
    adjustmentMethod,
    setAdjustmentMethod,
    beforeSummary,
    afterSummary,
    difference,
    netImpact,
    totalAdjustmentAllocated,
    invoices,
    adjCandidatePOs,
    handleAddItem,
    handleUpdateItem,
    handleRemoveItem,
    handleSave,
    itemOptions,
  };
};
