import React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { Badge } from "@/components/ui/badge";
import { Wallet, Plus, Info, CheckCircle2, Trash2, CreditCard, Undo2 } from "lucide-react";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import formatToIndianRupee from "@/utils/FormatPrice";
import { RefundAdjustment, AdjustmentMethodType, DifferenceData, ProcurementOrder } from "../../types";
import { useFrappeGetDocList } from "frappe-react-sdk";
import ReactSelect from "react-select";
import { ExpenseType } from "@/types/NirmaanStack/ExpenseType";
import { queryKeys, getProjectExpenseTypeListOptions } from "@/config/queryKeys";

interface Step2NegativeFlowProps {
  adjustmentMethod: AdjustmentMethodType;
  setAdjustmentMethod: (m: AdjustmentMethodType) => void;
  refundAdjustments: RefundAdjustment[];
  setRefundAdjustments: (adj: RefundAdjustment[]) => void;
  difference: DifferenceData;
  totalAdjustmentAllocated: number;
  adjCandidatePOs?: ProcurementOrder[];
  poName: string;
}

export const Step2NegativeFlow: React.FC<Step2NegativeFlowProps> = ({
  adjustmentMethod,
  setAdjustmentMethod,
  refundAdjustments,
  setRefundAdjustments,
  difference,
  totalAdjustmentAllocated,
  adjCandidatePOs,
  poName,
}) => {
  const [isMethodDialogOpen, setIsMethodDialogOpen] = React.useState(false);
  
  const expenseTypeFetchOptions = React.useMemo(() => getProjectExpenseTypeListOptions(), []);
  const { data: expenseTypesData, isLoading: expenseTypesLoading } = useFrappeGetDocList<ExpenseType>("Expense Type", expenseTypeFetchOptions as any, queryKeys.expenseTypes.list(expenseTypeFetchOptions));
  const expenseTypeOptions = React.useMemo(() => expenseTypesData?.map(et => ({ value: et.name, label: et.expense_name })) || [], [expenseTypesData]);

  const remainingToAdjust = Math.abs(difference.inclGst) - totalAdjustmentAllocated;

  const isPOSelected = refundAdjustments.some(a => a.type === "Another PO");

  const handleAddMethod = (type: AdjustmentMethodType) => {
    if (type === "Another PO") {
        setAdjustmentMethod("Another PO");
    } else {
        const id = Math.random().toString();
        setRefundAdjustments([...refundAdjustments, { 
            id, 
            type, 
            amount: Math.max(0, remainingToAdjust),
            adhoc_type: type === "Adhoc" ? "" : undefined,
            description: type === "Adhoc" ? `${poName} and ad-hoc : ` : undefined,
            date: type === "Refunded" ? new Date().toISOString().split('T')[0] : undefined
        }]);
    }
    setIsMethodDialogOpen(false);
  };

  const removeAdjustment = (id: string) => {
      setRefundAdjustments(refundAdjustments.filter(a => a.id !== id));
  };

  const updateAdjustment = (id: string, updates: Partial<RefundAdjustment>) => {
      setRefundAdjustments(refundAdjustments.map(a => a.id === id ? { ...a, ...updates } : a));
  };

  const hasAnotherPO = adjustmentMethod === "Another PO";
  const adhocAdjustments = refundAdjustments.filter(a => a.type === "Adhoc");
  const refundAdjustmentsItems = refundAdjustments.filter(a => a.type === "Refunded");

  return (
    <div className="space-y-4">
      <div className="bg-blue-50/50 p-6 rounded-xl border border-blue-100/50">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                    <div className="h-14 w-14 rounded-2xl bg-white shadow-sm border border-blue-100 flex items-center justify-center">
                        <Wallet className="h-7 w-7 text-blue-600" />
                    </div>
                    <div className="space-y-1">
                        <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest pl-1">Total Refund Amount</p>
                        <p className="text-3xl font-black text-slate-900 leading-none tracking-tight">{formatToIndianRupee(Math.abs(difference.inclGst))}</p>
                    </div>
                </div>
                <div className="flex flex-col items-end justify-center">
                     <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">PO ID:</span>
                        <span className="text-[10px] font-black text-slate-600 uppercase tracking-tight">{poName}</span>
                     </div>
                     <Badge variant="outline" className="bg-blue-100 text-blue-700 border-none font-black text-[9px] px-2 py-0.5 uppercase tracking-widest shadow-sm">Awaiting Adjustment</Badge>
                </div>
            </div>
      </div>

      <div className={`p-4 rounded-xl flex items-center justify-between border ${remainingToAdjust <= 0 ? "bg-green-50/50 border-green-100" : "bg-orange-50/50 border-orange-100"}`}>
          <div className="flex items-center gap-3">
             <div className={`h-8 w-8 rounded-full flex items-center justify-center ${remainingToAdjust <= 0 ? "bg-green-100" : "bg-orange-100"}`}>
                <Info className={`h-4 w-4 ${remainingToAdjust <= 0 ? "text-green-600" : "text-orange-600"}`} />
             </div>
             <p className={`text-sm font-bold tracking-tight ${remainingToAdjust <= 0 ? "text-green-800" : "text-orange-800"}`}>Remaining Balance to Adjust</p>
          </div>
          <p className={`text-xl font-black tracking-tight ${remainingToAdjust <= 0 ? "text-green-700" : "text-orange-700"}`}>{formatToIndianRupee(Math.max(0, remainingToAdjust))}</p>
      </div>

      <div className="flex flex-col items-start gap-2 w-full mb-6">
                <label className="text-[11px] font-black text-gray-700">Adjustment Method</label>
                <div className="grid grid-cols-3 gap-2 w-full">
                    <button 
                      onClick={() => {
                          setAdjustmentMethod("Another PO");
                          setRefundAdjustments([]); // Clear previous adjustments on tab switch
                      }}
                      className={`flex flex-row justify-center items-center py-[9px] px-[13px] gap-[9px] h-[36px] rounded-[4px] font-medium text-xs transition-colors flex-1 ${adjustmentMethod === "Another PO" ? "bg-[#336CE7] text-white" : "bg-[#F9F9F9] text-[#4B5563] hover:bg-gray-100"}`}>
                        Adjustment against another PO
                    </button>
                    <button 
                      disabled={isPOSelected}
                      onClick={() => {
                          setAdjustmentMethod("Adhoc");
                          // Clear and add fresh adhoc adjustment
                          setRefundAdjustments([{ id: Math.random().toString(), type: "Adhoc", amount: Math.abs(difference.inclGst), adhoc_type: "", description: `${poName} and ad-hoc : ` }]);
                      }}
                      className={`flex flex-row justify-center items-center py-[9px] px-[13px] gap-[9px] h-[36px] rounded-[4px] font-medium text-xs transition-colors flex-1 ${isPOSelected ? "opacity-50 cursor-not-allowed" : ""} ${adjustmentMethod === "Adhoc" ? "bg-[#336CE7] text-white" : "bg-[#F9F9F9] text-[#4B5563] hover:bg-gray-100"}`}>
                        Adjustment against adhoc purchase
                    </button>
                    <button 
                      disabled={isPOSelected}
                      onClick={() => {
                          setAdjustmentMethod("Refunded");
                          // Clear and add fresh refund adjustment
                          setRefundAdjustments([{ id: Math.random().toString(), type: "Refunded", amount: Math.abs(difference.inclGst), date: new Date().toISOString().split('T')[0] }]);
                      }}
                      className={`flex flex-row justify-center items-center py-[9px] px-[13px] gap-[9px] h-[36px] rounded-[4px] font-medium text-xs transition-colors flex-1 ${isPOSelected ? "opacity-50 cursor-not-allowed" : ""} ${adjustmentMethod === "Refunded" ? "bg-[#336CE7] text-white" : "bg-[#F9F9F9] text-[#4B5563] hover:bg-gray-100"}`}>
                        Vendor has refunded
                    </button>
                </div>
            </div>

            {hasAnotherPO && (
                <div className="space-y-4 pt-4">
                    <div className="flex items-center justify-between px-1">
                        <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest">Select POs to adjust</label>
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-none font-bold text-[10px] px-3 py-1">
                            Adjusted via POs : {formatToIndianRupee(refundAdjustments.filter(a => a.type === "Another PO").reduce((sum, a) => sum + (a.amount || 0), 0))}
                        </Badge>
                    </div>

                    <div className="space-y-2">
                        {adjCandidatePOs?.map((cand) => {
                             const isSelected = refundAdjustments.some(a => a.po_id === cand.name);
                             const adj = refundAdjustments.find(a => a.po_id === cand.name);
                             
                             const maxPayableForThisPO = (cand.total_amount || 0) - (cand.amount_paid || 0);
                             const remainingPayable = Math.max(0, maxPayableForThisPO - (adj?.amount || 0));
                             const canSelect = isSelected || remainingToAdjust > 0;
                             return (
                                <div key={cand.name} className={`p-4 rounded-[6px] border transition-all duration-200 ${isSelected ? "border-[#E5E7EB] bg-white" : "border-[#F3F4F6] bg-white hover:border-gray-200"} ${!canSelect ? "opacity-60 cursor-not-allowed" : ""}`}>
                                    <div className="flex items-center gap-4">
                                        <div 
                                            onClick={() => {
                                                if (!canSelect) return;
                                                if (isSelected) {
                                                    setRefundAdjustments(refundAdjustments.filter((a: RefundAdjustment) => a.po_id !== cand.name));
                                                } else {
                                                    setRefundAdjustments([...refundAdjustments, { id: Math.random().toString(), type: "Another PO", amount: Math.min(remainingToAdjust, maxPayableForThisPO), po_id: cand.name }]);
                                                }
                                            }}
                                            className={`h-[18px] w-[18px] rounded-[4px] border flex-shrink-0 flex items-center justify-center cursor-pointer transition-all ${isSelected ? "bg-[#2563EB] border-[#2563EB] text-white" : "border-[#D1D5DB] bg-white hover:border-[#BFDBFE]"} ${!canSelect ? "cursor-not-allowed" : ""}`}
                                        >
                                            {isSelected && <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={3} />}
                                        </div>
                                        <div className="grid grid-cols-3 flex-1 items-center">
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-1">
                                                    <span className="text-[13px] font-medium text-gray-600">PO ID:</span>
                                                    <span className="text-[13px] font-bold text-gray-900">{cand.name}</span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <span className="text-[11px] font-medium text-gray-400">Max adjustment allowed :</span>
                                                    <span className="text-[11px] font-bold text-gray-700">{formatToIndianRupee(maxPayableForThisPO)}</span>
                                                </div>
                                            </div>

                                            <div className="px-4 border-l border-gray-100 h-10 flex flex-col justify-center">
                                                <div className="text-[11px] font-medium text-gray-400 mb-0.5">Adjustment Applied:</div>
                                                <div className="text-xs font-bold text-green-600">-{formatToIndianRupee(adj?.amount || 0)}</div>
                                            </div>

                                            <div className="px-4 border-l border-gray-100 h-10 flex flex-col justify-center">
                                                <div className="text-[11px] font-medium text-gray-400 mb-0.5">Remaining Payable:</div>
                                                <div className="text-xs font-bold text-gray-900">{formatToIndianRupee(remainingPayable)}</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                             );
                        })}
                        {(!adjCandidatePOs || adjCandidatePOs.length === 0) && (
                            <div className="text-center py-20 bg-white rounded-xl border-2 border-dashed border-gray-100">
                                <p className="text-gray-400 font-bold text-sm">No other active POs found for this vendor.</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {!hasAnotherPO && (
                 <div className="space-y-4">
                     {adhocAdjustments.map((adj) => adjustmentMethod === "Adhoc" && (
                         <div key={adj.id} className="bg-[#F9F9F9] rounded-lg border border-gray-200 p-6 space-y-5">
                             {/* Header */}
                             <div className="flex items-center justify-between">
                                <h4 className="text-sm font-bold text-gray-900">Adjustment against adhoc purchase</h4>
                                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 font-semibold text-xs px-3 py-1">
                                    Adjusted via AdHoc  {formatToIndianRupee(adj.amount || 0)}
                                </Badge>
                             </div>
                             {/* Form Fields */}
                             <div className="space-y-4">
                                <div className="space-y-1.5">
                                    <label className="text-sm font-bold text-gray-900">Type<span className="text-red-500">*</span></label>
                                    <ReactSelect
                                        options={expenseTypeOptions}
                                        value={expenseTypeOptions.find(opt => opt.value === adj.adhoc_type) || null}
                                        onChange={(opt: any) => updateAdjustment(adj.id, { adhoc_type: opt?.value || "" })}
                                        isLoading={expenseTypesLoading}
                                        placeholder="Select an expense type"
                                        className="react-select-container text-sm"
                                        classNamePrefix="react-select"
                                        styles={{
                                            control: (base) => ({
                                                ...base,
                                                minHeight: '2.5rem',
                                                borderRadius: '6px',
                                                borderColor: '#e5e7eb',
                                                backgroundColor: '#fff',
                                                boxShadow: 'none',
                                                '&:hover': { borderColor: '#d1d5db' },
                                            })
                                        }}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-sm font-bold text-gray-900">Description<span className="text-red-500">*</span></label>
                                    <Textarea value={adj.description || ""} onChange={(e) => updateAdjustment(adj.id, { description: e.target.value })} className="min-h-[80px] bg-white border border-gray-200 rounded-md p-3 text-sm resize-none placeholder:text-gray-400" placeholder="Write Description...." />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-sm font-bold text-gray-900">Comment</label>
                                    <Textarea value={adj.comment || ""} placeholder="Write Comment...." className="min-h-[80px] bg-white border border-gray-200 rounded-md p-3 text-sm resize-none placeholder:text-gray-400" onChange={(e) => updateAdjustment(adj.id, { comment: e.target.value })} />
                                </div>
                             </div>
                             {/* Delete */}
                             <div className="flex justify-end pt-2">
                                 <Button variant="outline" size="sm" onClick={() => removeAdjustment(adj.id)} className="text-red-600 border-red-200 hover:bg-red-50 rounded-md gap-2 h-9 px-4 text-xs font-semibold">
                                     <Trash2 className="h-3.5 w-3.5" /> Delete
                                 </Button>
                             </div>
                         </div>
                     ))}
                     {refundAdjustmentsItems.map((adj) => adjustmentMethod === "Refunded" && (
                         <div key={adj.id} className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8 space-y-8">
                            <div className="flex items-center justify-between">
                                <h4 className="text-[11px] font-black text-gray-900 uppercase tracking-[0.2em]">Vendor has refunded</h4>
                                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-none font-bold text-[10px] px-3 py-1">
                                    Adjusted via Refund {formatToIndianRupee(adj.amount || 0)}
                                </Badge>
                            </div>
                            <div className="space-y-6">
                                <CustomAttachment selectedFile={adj.refund_attachment_file} onFileSelect={(file) => updateAdjustment(adj.id, { refund_attachment_file: file })} label="Upload Refund Proof (PDF/Image)" acceptedTypes={["application/pdf", "image/*"]} className="bg-white" />
                                <div className="space-y-3 px-1">
                                    <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest pl-1">Refund Date<span className="text-red-500">*</span></label>
                                    <Input type="date" value={adj.date} onChange={(e) => updateAdjustment(adj.id, { date: e.target.value })} className="h-12 bg-white border-2 rounded-2xl focus-visible:ring-blue-100 border-gray-100" />
                                </div>
                            </div>
                         </div>
                     ))}
                 </div>
            )}

            {adjustmentMethod === "Another PO" && isPOSelected && remainingToAdjust > 0 && (
                <div onClick={() => setIsMethodDialogOpen(true)} className="flex items-center gap-2 cursor-pointer text-blue-600 hover:text-blue-700 transition-colors py-2 px-1">
                    <Plus className="h-4 w-4" strokeWidth={3} />
                    <span className="text-sm font-black uppercase tracking-widest underline decoration-2 underline-offset-4">Add Another Adjustment Method</span>
                </div>
            )}

            {/* Render Additional Blocks (Secondary) */}
            <div className="space-y-6">
                {adhocAdjustments.map((adj) => adjustmentMethod !== "Adhoc" && (
                    <div key={adj.id} className="bg-[#F9F9F9] rounded-lg border border-gray-200 p-6 space-y-5 relative group">
                        <div className="flex items-center justify-between">
                            <h4 className="text-sm font-bold text-gray-900">Adjustment against adhoc purchase</h4>
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 font-semibold text-xs px-3 py-1">
                                 Adjusted via AdHoc  {formatToIndianRupee(adj.amount || 0)}
                            </Badge>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <label className="text-sm font-bold text-gray-900">Type<span className="text-red-500">*</span></label>
                                <ReactSelect
                                    options={expenseTypeOptions}
                                    value={expenseTypeOptions.find(opt => opt.value === adj.adhoc_type) || null}
                                    onChange={(opt: any) => updateAdjustment(adj.id, { adhoc_type: opt?.value || "" })}
                                    isLoading={expenseTypesLoading}
                                    placeholder="Select an expense type"
                                    className="react-select-container text-sm"
                                    classNamePrefix="react-select"
                                    styles={{
                                        control: (base) => ({
                                            ...base,
                                            minHeight: '2.5rem',
                                            borderRadius: '6px',
                                            borderColor: '#e5e7eb',
                                            backgroundColor: '#fff',
                                            boxShadow: 'none',
                                            '&:hover': { borderColor: '#d1d5db' },
                                        })
                                    }}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-sm font-bold text-gray-900">Description<span className="text-red-500">*</span></label>
                                <Textarea value={adj.description || ""} onChange={(e) => updateAdjustment(adj.id, { description: e.target.value })} className="min-h-[80px] bg-white border border-gray-200 rounded-md p-3 text-sm resize-none placeholder:text-gray-400" placeholder="Write Description...." />
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-sm font-bold text-gray-900">Comment</label>
                                <Textarea value={adj.comment || ""} placeholder="Write Comment...." className="min-h-[80px] bg-white border border-gray-200 rounded-md p-3 text-sm resize-none placeholder:text-gray-400" onChange={(e) => updateAdjustment(adj.id, { comment: e.target.value })} />
                            </div>
                        </div>

                        <div className="flex justify-end pt-2">
                            <Button variant="outline" size="sm" onClick={() => removeAdjustment(adj.id)} className="text-red-600 border-red-200 hover:bg-red-50 rounded-md gap-2 h-9 px-4 text-xs font-semibold">
                                <Trash2 className="h-3.5 w-3.5" /> Delete
                            </Button>
                        </div>
                    </div>
                ))}

                {refundAdjustmentsItems.map((adj) => adjustmentMethod !== "Refunded" && (
                    <div key={adj.id} className="bg-gray-50/50 rounded-3xl border border-gray-100 shadow-sm p-8 space-y-8 relative group">
                        <div className="flex items-center justify-between">
                            <h4 className="text-[11px] font-black text-gray-900 uppercase tracking-[0.2em]">Vendor has refunded</h4>
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-none font-bold text-[10px] px-3 py-1">
                                 Adjusted via Refund {formatToIndianRupee(adj.amount || 0)}
                            </Badge>
                        </div>

                        <div className="space-y-6">
                            <CustomAttachment selectedFile={adj.refund_attachment_file} onFileSelect={(file) => updateAdjustment(adj.id, { refund_attachment_file: file })} label="Upload Refund Proof (PDF/Image)" acceptedTypes={["application/pdf", "image/*"]} className="bg-white" />
                            <div className="space-y-3 px-1">
                                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest pl-1">Refund Date<span className="text-red-500">*</span></label>
                                <Input type="date" value={adj.date} onChange={(e) => updateAdjustment(adj.id, { date: e.target.value })} className="h-12 bg-white border-2 rounded-2xl focus-visible:ring-blue-100 border-gray-100" />
                            </div>
                        </div>

                        <div className="flex justify-end pt-4 border-t border-gray-50">
                            <Button variant="outline" size="sm" onClick={() => removeAdjustment(adj.id)} className="text-red-600 border-red-100 hover:bg-red-50 rounded-xl gap-2 h-10 px-4">
                                <Trash2 className="h-4 w-4" /> Delete
                            </Button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Selection Dialog */}
            <Dialog open={isMethodDialogOpen} onOpenChange={setIsMethodDialogOpen}>
                <DialogContent className="sm:max-w-md rounded-3xl border-none p-0 overflow-hidden">
                    <DialogHeader className="p-8 bg-blue-600 text-white">
                        <DialogTitle className="text-xl font-black tracking-tight">Add Another Adjustment Method</DialogTitle>
                        <DialogDescription className="text-blue-100 font-medium">
                            Select how you'd like to adjust the remaining amount of {formatToIndianRupee(remainingToAdjust)}.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="p-8 grid grid-cols-2 gap-4 bg-white">
                        <button 
                          onClick={() => handleAddMethod("Adhoc")}
                          className="flex flex-col items-center justify-center p-6 rounded-2xl border-2 border-gray-100 hover:border-blue-500 hover:bg-blue-50 transition-all group gap-4"
                        >
                            <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                                <CreditCard className="h-6 w-6 text-blue-600" />
                            </div>
                            <span className="font-black text-sm text-gray-900">Ad-hoc Credit</span>
                        </button>
                        <button 
                          onClick={() => handleAddMethod("Refunded")}
                          className="flex flex-col items-center justify-center p-6 rounded-2xl border-2 border-gray-100 hover:border-blue-500 hover:bg-blue-50 transition-all group gap-4"
                        >
                            <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center group-hover:bg-green-200 transition-colors">
                                <Undo2 className="h-6 w-6 text-green-600" />
                            </div>
                            <span className="font-black text-sm text-gray-900">Vendor Refund</span>
                        </button>
                    </div>
                    <DialogFooter className="p-6 bg-gray-50/50 justify-center">
                        <Button variant="ghost" onClick={() => setIsMethodDialogOpen(false)} className="rounded-xl font-bold text-gray-500">Cancel</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
    </div>
  );
};
