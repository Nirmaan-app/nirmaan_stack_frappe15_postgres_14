import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import formatToIndianRupee from "@/utils/FormatPrice";
import {
  usePOAdjustmentDialog,
  type AdjustmentMethodType,
} from "./hooks/usePOAdjustment";
import type { RefundAdjustment } from "@/pages/PORevision/types";
import { useFrappeGetDocList } from "frappe-react-sdk";
import ReactSelect from "react-select";
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  IndianRupee,
  Plus,
  Trash2,
  Undo2,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import type { ExpenseType } from "@/types/NirmaanStack/ExpenseType";
import {
  queryKeys,
  getProjectExpenseTypeListOptions,
} from "@/config/queryKeys";

interface POAdjustmentDialogProps {
  poId: string;
  vendor: string;
  isOpen: boolean;
  onClose: () => void;
}

export function POAdjustmentDialog({
  poId,
  vendor,
  isOpen,
  onClose,
}: POAdjustmentDialogProps) {
  const {
    adjustmentMethod,
    setAdjustmentMethod,
    refundAdjustments,
    setRefundAdjustments,
    addAdjustment,
    removeAdjustment,
    updateAdjustment,
    resetForm,
    handleSubmit,
    adjustment,
    absImpact,
    isNegative,
    totalAllocated,
    remainingToAdjust,
    isPOSelected,
    candidatePOs,
    candidatesLoading,
    executing,
  } = usePOAdjustmentDialog(poId, vendor, isOpen);

  const [isMethodDialogOpen, setIsMethodDialogOpen] = React.useState(false);

  const expenseTypeFetchOptions = React.useMemo(
    () => getProjectExpenseTypeListOptions(),
    []
  );
  const { data: expenseTypesData, isLoading: expenseTypesLoading } =
    useFrappeGetDocList<ExpenseType>(
      "Expense Type",
      expenseTypeFetchOptions as any,
      queryKeys.expenseTypes.list(expenseTypeFetchOptions)
    );
  const expenseTypeOptions = React.useMemo(
    () =>
      expenseTypesData?.map((et) => ({
        value: et.name,
        label: et.expense_name,
      })) || [],
    [expenseTypesData]
  );

  if (!adjustment) return null;

  const hasAnotherPO = adjustmentMethod === "Another PO";
  const adhocAdjustments = refundAdjustments.filter((a) => a.type === "Adhoc");
  const refundItems = refundAdjustments.filter((a) => a.type === "Refunded");

  const handleMethodSwitch = (method: AdjustmentMethodType) => {
    setAdjustmentMethod(method);
    if (method === "Another PO") {
      setRefundAdjustments([]);
    } else if (method === "Adhoc") {
      setRefundAdjustments([
        {
          id: Math.random().toString(),
          type: "Adhoc",
          amount: absImpact,
          adhoc_type: "",
          description: `${poId} and ad-hoc : `,
        },
      ]);
    } else {
      setRefundAdjustments([
        {
          id: Math.random().toString(),
          type: "Refunded",
          amount: absImpact,
          date: new Date().toISOString().split("T")[0],
        },
      ]);
    }
  };

  const handleAddSecondaryMethod = (type: AdjustmentMethodType) => {
    addAdjustment(type);
    setIsMethodDialogOpen(false);
  };

  const handleTogglePO = (poName: string, maxPayable: number) => {
    const isSelected = refundAdjustments.some((a) => a.po_id === poName);
    if (isSelected) {
      setRefundAdjustments(
        refundAdjustments.filter((a) => a.po_id !== poName)
      );
    } else if (remainingToAdjust > 0) {
      setRefundAdjustments([
        ...refundAdjustments,
        {
          id: Math.random().toString(),
          type: "Another PO",
          amount: Math.min(remainingToAdjust, maxPayable),
          po_id: poName,
        },
      ]);
    }
  };

  const canSubmit =
    refundAdjustments.length > 0 && totalAllocated > 0 && !executing;

  const allocationPercent = absImpact > 0 ? Math.min(100, (totalAllocated / absImpact) * 100) : 0;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          resetForm();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto p-0 gap-0">
        {/* ── Header ── */}
        <div className="px-5 pt-5 pb-4 border-b border-gray-100">
          <DialogHeader className="p-0 space-y-0">
            <DialogTitle className="text-base font-semibold text-gray-900">
              Payment Adjustment
            </DialogTitle>
          </DialogHeader>

          {/* Impact summary row */}
          <div className="mt-3 flex items-center justify-between gap-4 bg-primary/[0.04] rounded-lg px-4 py-3 border border-primary/10">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <IndianRupee className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-[10px] font-semibold text-primary/60 uppercase tracking-wider leading-none mb-1">
                  Extra Amount Paid
                </p>
                <p className="text-xl font-bold text-gray-900 leading-none tabular-nums">
                  {formatToIndianRupee(absImpact)}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-0.5">
                {poId}
              </p>
              <Badge className="bg-primary/10 text-primary border-none font-semibold text-[10px] px-2 py-0.5 hover:bg-primary/10">
                Pending
              </Badge>
            </div>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="px-5 py-4">
          {!isNegative ? (
            <Alert className="border-green-200 bg-green-50/50">
              <AlertCircle className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800">
                Positive adjustment — a new payment term has been auto-created
                on the PO. No further action needed.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-4">
              {/* Remaining tracker with progress bar */}
              <div className={`rounded-lg border px-4 py-3 ${remainingToAdjust <= 0.01 ? "bg-green-50/60 border-green-200/60" : "bg-amber-50/40 border-amber-200/50"}`}>
                <div className="flex items-center justify-between mb-2">
                  <p className={`text-xs font-semibold ${remainingToAdjust <= 0.01 ? "text-green-700" : "text-amber-700"}`}>
                    Adjustment Remaining
                  </p>
                  <p className={`text-sm font-bold tabular-nums ${remainingToAdjust <= 0.01 ? "text-green-700" : "text-amber-700"}`}>
                    {formatToIndianRupee(remainingToAdjust)}
                  </p>
                </div>
                {/* Progress bar */}
                <div className="h-1.5 w-full rounded-full bg-black/5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${remainingToAdjust <= 0.01 ? "bg-green-500" : "bg-primary"}`}
                    style={{ width: `${allocationPercent}%` }}
                  />
                </div>
                <p className="text-[10px] text-gray-400 mt-1">
                  {formatToIndianRupee(totalAllocated)} of {formatToIndianRupee(absImpact)} allocated
                </p>
              </div>

              {/* Method selector pills */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                  Method
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {([
                    { key: "Another PO" as const, label: "Against PO" },
                    { key: "Adhoc" as const, label: "Ad-hoc" },
                    { key: "Refunded" as const, label: "Vendor Refund" },
                  ] as const).map(({ key, label }) => {
                    const isActive = adjustmentMethod === key;
                    const isDisabled = key !== "Another PO" && isPOSelected;
                    return (
                      <button
                        key={key}
                        disabled={isDisabled}
                        onClick={() => handleMethodSwitch(key)}
                        className={`h-8 rounded-md text-xs font-medium transition-colors ${isDisabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"} ${isActive ? "bg-primary text-white shadow-sm" : "bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200/60"}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Against PO card list ── */}
              {hasAnotherPO && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                      Select Target POs
                    </label>
                    <span className="text-[11px] font-semibold text-primary tabular-nums">
                      Via POs: {formatToIndianRupee(
                        refundAdjustments
                          .filter((a) => a.type === "Another PO")
                          .reduce((sum, a) => sum + (a.amount || 0), 0)
                      )}
                    </span>
                  </div>

                  <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                    {candidatesLoading ? (
                      <div className="text-center py-6 text-sm text-muted-foreground">
                        Loading...
                      </div>
                    ) : candidatePOs.length === 0 ? (
                      <div className="text-center py-8 border border-dashed border-gray-200 rounded-lg">
                        <p className="text-gray-400 text-sm">
                          No eligible POs for this vendor
                        </p>
                      </div>
                    ) : (
                      candidatePOs.map((cand) => {
                        const isSelected = refundAdjustments.some(
                          (a) => a.po_id === cand.name
                        );
                        const adj = refundAdjustments.find(
                          (a) => a.po_id === cand.name
                        );
                        const maxPayable = cand.created_terms_amount || 0;
                        const appliedAmount = adj?.amount || 0;
                        const remainingPayable = Math.max(
                          0,
                          maxPayable - appliedAmount
                        );
                        const canSelect = isSelected || remainingToAdjust > 0;

                        return (
                          <div
                            key={cand.name}
                            onClick={() => canSelect && handleTogglePO(cand.name, maxPayable)}
                            className={`px-3 py-2.5 rounded-md border transition-all duration-100 cursor-pointer ${isSelected ? "border-primary/30 bg-primary/[0.02]" : "border-gray-100 bg-white hover:border-gray-200"} ${!canSelect ? "opacity-40 !cursor-not-allowed" : ""}`}
                          >
                            <div className="flex items-center gap-3">
                              {/* Checkbox */}
                              <div
                                className={`h-4 w-4 rounded flex-shrink-0 flex items-center justify-center border transition-colors ${isSelected ? "bg-primary border-primary text-white" : "border-gray-300 bg-white"}`}
                              >
                                {isSelected && (
                                  <CheckCircle2 className="h-3 w-3" strokeWidth={3} />
                                )}
                              </div>

                              {/* PO info */}
                              <div className="grid grid-cols-3 flex-1 items-center min-w-0">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs font-semibold text-gray-900 truncate">
                                      {cand.name}
                                    </span>
                                    {cand.status && (
                                      <Badge
                                        variant="outline"
                                        className={`text-[9px] px-1.5 py-0 h-[14px] border-none leading-none font-medium ${
                                          cand.status === "PO Approved"
                                            ? "bg-green-50 text-green-600"
                                            : cand.status === "Dispatched"
                                              ? "bg-blue-50 text-blue-600"
                                              : cand.status === "Partially Dispatched"
                                                ? "bg-amber-50 text-amber-600"
                                                : cand.status === "Partially Delivered"
                                                  ? "bg-yellow-50 text-yellow-600"
                                                  : "bg-gray-50 text-gray-500"
                                        }`}
                                      >
                                        {cand.status}
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-gray-400 mt-0.5">
                                    Max: {formatToIndianRupee(maxPayable)}
                                  </p>
                                </div>

                                <div className="pl-3 border-l border-gray-100">
                                  <p className="text-[10px] text-gray-400">Applied</p>
                                  <p className="text-xs font-semibold text-green-600 tabular-nums">
                                    -{formatToIndianRupee(appliedAmount)}
                                  </p>
                                </div>

                                <div className="pl-3 border-l border-gray-100">
                                  <p className="text-[10px] text-gray-400">Remaining</p>
                                  <p className="text-xs font-semibold text-gray-800 tabular-nums">
                                    {formatToIndianRupee(remainingPayable)}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* ── Adhoc form (primary) ── */}
              {!hasAnotherPO &&
                adhocAdjustments.map(
                  (adj) =>
                    adjustmentMethod === "Adhoc" && (
                      <AdhocCard
                        key={adj.id}
                        adj={adj}
                        expenseTypeOptions={expenseTypeOptions}
                        expenseTypesLoading={expenseTypesLoading}
                        onUpdate={updateAdjustment}
                        onRemove={removeAdjustment}
                      />
                    )
                )}

              {/* ── Refund form (primary) ── */}
              {!hasAnotherPO &&
                refundItems.map(
                  (adj) =>
                    adjustmentMethod === "Refunded" && (
                      <RefundCard
                        key={adj.id}
                        adj={adj}
                        onUpdate={updateAdjustment}
                        onRemove={removeAdjustment}
                      />
                    )
                )}

              {/* "Add Another Method" link */}
              {adjustmentMethod === "Another PO" &&
                isPOSelected &&
                remainingToAdjust > 0 && (
                  <button
                    onClick={() => setIsMethodDialogOpen(true)}
                    className="flex items-center gap-1.5 text-primary hover:text-primary/80 transition-colors py-1"
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                    <span className="text-xs font-semibold">
                      Add another method
                    </span>
                  </button>
                )}

              {/* Secondary adjustment blocks */}
              {(adhocAdjustments.some(() => adjustmentMethod !== "Adhoc") ||
                refundItems.some(() => adjustmentMethod !== "Refunded")) && (
                <div className="space-y-3">
                  {adhocAdjustments.map(
                    (adj) =>
                      adjustmentMethod !== "Adhoc" && (
                        <AdhocCard
                          key={adj.id}
                          adj={adj}
                          expenseTypeOptions={expenseTypeOptions}
                          expenseTypesLoading={expenseTypesLoading}
                          onUpdate={updateAdjustment}
                          onRemove={removeAdjustment}
                        />
                      )
                  )}
                  {refundItems.map(
                    (adj) =>
                      adjustmentMethod !== "Refunded" && (
                        <RefundCard
                          key={adj.id}
                          adj={adj}
                          onUpdate={updateAdjustment}
                          onRemove={removeAdjustment}
                        />
                      )
                  )}
                </div>
              )}

              {/* Method selection sub-dialog */}
              <Dialog
                open={isMethodDialogOpen}
                onOpenChange={setIsMethodDialogOpen}
              >
                <DialogContent className="sm:max-w-sm p-0 overflow-hidden gap-0">
                  <DialogHeader className="px-5 pt-5 pb-3">
                    <DialogTitle className="text-sm font-semibold text-gray-900">
                      Add Another Method
                    </DialogTitle>
                    <DialogDescription className="text-xs text-gray-500">
                      Remaining: {formatToIndianRupee(remainingToAdjust)}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="px-5 pb-4 grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleAddSecondaryMethod("Adhoc")}
                      className="flex flex-col items-center justify-center p-4 rounded-lg border border-gray-200 hover:border-primary/40 hover:bg-primary/[0.02] transition-all group gap-2"
                    >
                      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
                        <CreditCard className="h-4 w-4 text-primary" />
                      </div>
                      <span className="font-semibold text-xs text-gray-800">
                        Ad-hoc Credit
                      </span>
                    </button>
                    <button
                      onClick={() => handleAddSecondaryMethod("Refunded")}
                      className="flex flex-col items-center justify-center p-4 rounded-lg border border-gray-200 hover:border-green-400/60 hover:bg-green-50/30 transition-all group gap-2"
                    >
                      <div className="h-9 w-9 rounded-full bg-green-100 flex items-center justify-center group-hover:bg-green-200/70 transition-colors">
                        <Undo2 className="h-4 w-4 text-green-600" />
                      </div>
                      <span className="font-semibold text-xs text-gray-800">
                        Vendor Refund
                      </span>
                    </button>
                  </div>
                  <DialogFooter className="px-5 pb-4 pt-0 justify-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsMethodDialogOpen(false)}
                      className="text-gray-400 font-medium text-xs"
                    >
                      Cancel
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              resetForm();
              onClose();
            }}
            disabled={executing}
            className="text-gray-500 font-medium"
          >
            Cancel
          </Button>
          {isNegative && (
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="px-5"
            >
              {executing ? "Processing..." : "Apply Adjustment"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sub-components ──────────────────────────────────────────────

interface AdhocCardProps {
  adj: RefundAdjustment;
  expenseTypeOptions: { value: string; label: string }[];
  expenseTypesLoading: boolean;
  onUpdate: (id: string, updates: Partial<RefundAdjustment>) => void;
  onRemove: (id: string) => void;
}

function AdhocCard({
  adj,
  expenseTypeOptions,
  expenseTypesLoading,
  onUpdate,
  onRemove,
}: AdhocCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 p-4 space-y-3 bg-gray-50/50">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-gray-700">Ad-hoc Expense</h4>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-primary tabular-nums">
            {formatToIndianRupee(adj.amount || 0)}
          </span>
          <button
            onClick={() => onRemove(adj.id)}
            className="text-gray-300 hover:text-red-500 transition-colors p-0.5"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="space-y-2.5">
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-gray-500">
            Type<span className="text-red-400 ml-0.5">*</span>
          </label>
          <ReactSelect
            options={expenseTypeOptions}
            value={
              expenseTypeOptions.find((opt) => opt.value === adj.adhoc_type) ||
              null
            }
            onChange={(opt: any) =>
              onUpdate(adj.id, { adhoc_type: opt?.value || "" })
            }
            isLoading={expenseTypesLoading}
            placeholder="Select expense type"
            menuPortalTarget={document.body}
            className="react-select-container text-xs"
            classNamePrefix="react-select"
            styles={{
              menuPortal: (base) => ({ ...base, zIndex: 9999 }),
              control: (base) => ({
                ...base,
                minHeight: "2rem",
                borderRadius: "6px",
                borderColor: "#e5e7eb",
                backgroundColor: "#fff",
                boxShadow: "none",
                fontSize: "0.8125rem",
                "&:hover": { borderColor: "#d1d5db" },
              }),
            }}
          />
        </div>
        <div className="space-y-1">
          <div className="flex justify-between items-center">
            <label className="text-[11px] font-medium text-gray-500">
              Description<span className="text-red-400 ml-0.5">*</span>
            </label>
            <span className="text-[9px] text-gray-300 tabular-nums">
              {adj.description?.length || 0}/140
            </span>
          </div>
          <Textarea
            maxLength={140}
            value={adj.description || ""}
            onChange={(e) => onUpdate(adj.id, { description: e.target.value })}
            className="min-h-[56px] bg-white border border-gray-200 rounded-md p-2 text-xs resize-none placeholder:text-gray-300"
            placeholder="Description..."
          />
        </div>
        <div className="space-y-1">
          <div className="flex justify-between items-center">
            <label className="text-[11px] font-medium text-gray-500">
              Comment
            </label>
            <span className="text-[9px] text-gray-300 tabular-nums">
              {adj.comment?.length || 0}/140
            </span>
          </div>
          <Textarea
            maxLength={140}
            value={adj.comment || ""}
            onChange={(e) => onUpdate(adj.id, { comment: e.target.value })}
            className="min-h-[56px] bg-white border border-gray-200 rounded-md p-2 text-xs resize-none placeholder:text-gray-300"
            placeholder="Optional comment..."
          />
        </div>
      </div>
    </div>
  );
}

interface RefundCardProps {
  adj: RefundAdjustment;
  onUpdate: (id: string, updates: Partial<RefundAdjustment>) => void;
  onRemove: (id: string) => void;
}

function RefundCard({ adj, onUpdate, onRemove }: RefundCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 p-4 space-y-3 bg-white">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-gray-700">Vendor Refund</h4>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-primary tabular-nums">
            {formatToIndianRupee(adj.amount || 0)}
          </span>
          <button
            onClick={() => onRemove(adj.id)}
            className="text-gray-300 hover:text-red-500 transition-colors p-0.5"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="space-y-2.5">
        <CustomAttachment
          selectedFile={adj.refund_attachment_file}
          onFileSelect={(file) =>
            onUpdate(adj.id, { refund_attachment_file: file })
          }
          label="Upload Refund Proof"
          acceptedTypes={["application/pdf", "image/*"]}
        />
        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-gray-500">
              Refund Date<span className="text-red-400 ml-0.5">*</span>
            </label>
            <Input
              type="date"
              value={adj.date}
              onChange={(e) => onUpdate(adj.id, { date: e.target.value })}
              className="h-8 bg-white text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-gray-500">
              UTR / Reference
            </label>
            <Input
              value={adj.transaction_ref || ""}
              onChange={(e) =>
                onUpdate(adj.id, { transaction_ref: e.target.value })
              }
              placeholder="Reference..."
              className="h-8 bg-white text-xs"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
