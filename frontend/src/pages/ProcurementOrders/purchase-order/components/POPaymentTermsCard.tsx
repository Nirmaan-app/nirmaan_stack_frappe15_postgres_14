import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { usePOValidation } from "@/hooks/usePOValidation";
import { useUserData } from "@/hooks/useUserData";
import { useCEOHoldGuard } from "@/hooks/useCEOHoldGuard";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogPortal,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import {
  PaymentTerm,
  ProcurementOrder,
  NotePoint,
} from "@/types/NirmaanStack/ProcurementOrders";
import { Projects } from "@/types/NirmaanStack/Projects";
import formatToIndianRupee from "@/utils/FormatPrice";
import {
  useFrappeGetDoc,
  useFrappeUpdateDoc,
  useFrappePostCall,
} from "frappe-react-sdk";
import { ValidationMessages } from "@/components/validations/ValidationMessages";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  PencilIcon,
  PlusCircle,
  Save,
  Send,
  Trash2,
  AlertTriangle,
  TriangleAlert,
} from "lucide-react";
import React, { useEffect, useMemo, useState,useCallback } from "react";
import {useSearchParams,useNavigate} from "react-router-dom";
import { format, isToday, isPast } from "date-fns"; // A great library for date handling

import { Controller, useFieldArray, useForm } from "react-hook-form";
import { TailSpin } from "react-loader-spinner";
import { v4 as uuidv4 } from "uuid";
import { ApiResponse } from "@/types/NirmaanStack/ApiResponse";

// =================================================================================
// PROPS & TYPE DEFINITIONS
// =================================================================================
interface POPaymentTermsCardProps {
  accountsPage: boolean;
  estimatesViewing: boolean;
  summaryPage: boolean;
  PO: ProcurementOrder | null;
  poMutate: any;
  projectPaymentsMutate: any;
  isEditTermsOpenmanual: boolean;
  setEditTermsOpenmanual: (isOpen: boolean) => void;
}

// =================================================================================
// HELPER FUNCTION for parsing the `note_points` JSON field
// =================================================================================
const parseNotePoints = (
  notesData: string | { list: NotePoint[] } | null | undefined
): (NotePoint & { id: string })[] => {
  if (!notesData) return [];
  try {
    const data =
      typeof notesData === "string" ? JSON.parse(notesData) : notesData;
    if (data && Array.isArray(data.list)) {
      return data.list.map((note) => ({
        ...note,
        id: note.id || uuidv4(),
      }));
    }
  } catch (e) {
    console.error("Failed to parse note_points JSON:", e);
    return [];
  }
  return [];
};

// =================================================================================
// DIALOG SUB-COMPONENTS
// =================================================================================

// src/utils/formatters.ts

export const getAllocationStatusMessage = (
  remainingAmount: number,
  isMismatched: boolean
): React.ReactNode => {
  if (!isMismatched) {
    return <span className="text-green-600">✔ Fully Allocated</span>;
  }

  if (remainingAmount > 0) {
    return (
      <span className="text-blue-600">
        Remaining to Allocate: {formatToIndianRupee(remainingAmount)}
      </span>
    );
  }

  if (remainingAmount < 0) {
    return (
      <span className="text-red-600">
        Over-allocated, Reduce by:{" "}
        {formatToIndianRupee(Math.abs(remainingAmount))}
      </span>
    );
  }

  return null;
};

// this compoent reuse to Credits resheduled dialog
export const EditTermsDialog = ({ isOpen, onClose, po, onSave, isLoading }) => {
  const {
    control,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useForm({
    defaultValues: {
      payment_terms:
        po?.payment_terms?.map((term) => ({
          ...term,
          percentage: Number(term.percentage) || 0,
          amount: (Number(term.amount) || 0).toFixed(2),
          due_date: term.due_date ? term.due_date.split(" ")[0] : "",
        })) || [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "payment_terms",
  });
  const watchedTerms = watch("payment_terms");

  const calculateTotals = (terms) => {
    if (!terms || !Array.isArray(terms)) return { percentage: 0, amount: 0 };
    const activeTerms = terms.filter((term) => Number(term.docstatus) !== 1);
    const percentage = activeTerms.reduce(
      (sum, term) => sum + (Number(term.percentage) || 0),
      0
    );
    const amount = activeTerms.reduce(
      (sum, term) => sum + (Number(term.amount) || 0),
      0
    );
    return { percentage, amount };
  };

  const [totalAmount, setTotalAmount] = useState(
    () => calculateTotals(po?.payment_terms).amount
  );

  useEffect(() => {
    const subscription = watch((value) => {
      const { amount } = calculateTotals(value.payment_terms || []);
      setTotalAmount(amount);
    });
    return () => subscription.unsubscribe();
  }, [watch]);

  const today = new Date().toISOString().split("T")[0];

  // MODIFIED: Added smarter logic to auto-fill new terms
  const handleAddTerm = () => {
    const currentTotal = calculateTotals(getValues().payment_terms).amount;
    const remaining = Number(po?.total_amount) - currentTotal;

    // if (remaining <= 0) {
    //   toast({
    //     title: "Amount Fully Allocated",
    //     description:
    //       "Please reduce the amount from existing terms before adding a new one.",
    //     variant: "destructive",
    //   });
    //   return;
    // }

    const totalPoAmount = Number(po.total_amount) || 1;
    const newPercentage = (remaining / totalPoAmount) * 100;

    append({
      label: "",
      amount: 0,
      percentage: 0,
      payment_type: po.payment_terms?.[0]?.payment_type,
      due_date: "",
      docstatus: 0,
      term_status: "Created",
    });
  };

  // --- CHANGE 2: Modify the mismatch check ---
  // Allow submission if the absolute difference is less than 1.
  const isTotalAmountMismatched =
    Math.abs(totalAmount - Number(po?.total_amount)) >= 1;
  const remainingAmount = Number(po?.total_amount) - totalAmount;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogPortal>
        <DialogContent className="sm:max-w-4xl bg-white p-6 rounded-lg shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold text-gray-800 text-center">
              Edit {po?.payment_terms?.[0]?.payment_type || "Payment"} Terms
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSave)}>
            <div className="my-6 space-y-2">
              <div className="flex px-2 pb-2 border-b items-center space-x-2">
                <div className="w-[35%] text-sm font-medium text-muted-foreground">
                  Term
                </div>
                <div className="w-[20%] text-right text-sm font-medium text-muted-foreground">
                  Amount
                </div>
                <div className="w-[15%] text-right text-sm font-medium text-muted-foreground">
                  Percentage (%)
                </div>
                {po?.payment_terms?.[0]?.payment_type === "Credit" && (
                  <div className="w-[20%] text-center text-sm font-medium text-muted-foreground">
                    Due Date
                  </div>
                )}
                <div className="w-12"></div>
              </div>
              <div className="space-y-1">
                {fields.map((field, index) => {
                  // Only "Created" status terms are editable
                  const currentStatus = watchedTerms[index]?.term_status;
                  const isRowDisabled = currentStatus !== "Created";
                  const isTermInactive = watchedTerms[index]?.docstatus === 1;
                  const isDisabled = isRowDisabled || isTermInactive;

                  return (
                    <div
                      key={field.id}
                      className="flex items-center p-2 rounded-md hover:bg-gray-50 space-x-2"
                    >
                      <div className="w-[35%] flex items-center space-x-2">
                        <Controller
                          name={`payment_terms.${index}.docstatus`}
                          control={control}
                          render={({ field: checkField }) => (
                            <Checkbox
                              id={`term-active-${index}`}
                              checked={!isTermInactive}
                              disabled={isRowDisabled}
                              onCheckedChange={(checked) => {
                                checkField.onChange(checked ? 0 : 1);
                                if (!checked) {
                                  setValue(`payment_terms.${index}.amount`, 0, {
                                    shouldDirty: true,
                                  });
                                  setValue(
                                    `payment_terms.${index}.percentage`,
                                    0,
                                    { shouldDirty: true }
                                  );
                                }
                              }}
                            />
                          )}
                        />
                        <Controller
                          name={`payment_terms.${index}.label`}
                          control={control}
                          rules={{ required: "Term label is required." }}
                          render={({ field: labelField }) => (
                            <Input
                              placeholder="e.g., On Delivery"
                              className={`h-9 w-full ${
                                errors?.payment_terms?.[index]?.label
                                  ? "border-red-500"
                                  : ""
                              }`}
                              disabled={isDisabled}
                              {...labelField}
                            />
                          )}
                        />
                      </div>
                      <div className="w-[20%] px-1">
                        <Controller
                          name={`payment_terms.${index}.amount`}
                          control={control}
                          render={({ field: amountField }) => (
                            <Input
                              type="number"
                              className="text-right h-9"
                              disabled={isDisabled}
                              step="0.01"
                              {...amountField} // This passes value, name, ref
                              // 1. SIMPLIFIED onChange: Only update state and recalculate percentage
                              onChange={(e) => {
                                const rawValue = e.target.value;
                                // Let react-hook-form handle the state update with the raw value
                                amountField.onChange(rawValue);

                                // Recalculate percentage on every keystroke for live feedback
                                const newAmount = Number(rawValue) || 0;
                                const totalPoAmount =
                                  Number(po.total_amount) || 1;
                                const newPercentage =
                                  (newAmount / totalPoAmount) * 100;
                                setValue(
                                  `payment_terms.${index}.percentage`,
                                  newPercentage
                                );
                              }}
                              // 2. NEW onBlur: Format the number to two decimal places
                              onBlur={(e) => {
                                // First, call the original onBlur from react-hook-form
                                amountField.onBlur(e);

                                // Now, format the value
                                const value =
                                  parseFloat(amountField.value) || 0;
                                // Use setValue to update the form state with the formatted string
                                setValue(
                                  `payment_terms.${index}.amount`,
                                  value.toFixed(2),
                                  {
                                    shouldValidate: true, // Optional: re-run validation
                                    shouldDirty: true, // Ensure the form knows it has changed
                                  }
                                );
                              }}
                            />
                          )}
                        />
                      </div>
                      <div className="w-[15%] px-1">
                        <Input
                          className="text-right h-9 bg-gray-100 cursor-not-allowed"
                          readOnly
                          disabled={isDisabled}
                          value={`${(
                            Number(watchedTerms[index]?.percentage) || 0
                          ).toFixed(2)}`}
                        />
                      </div>
                      {po?.payment_terms?.[0]?.payment_type === "Credit" && (
                        <div className="w-[20%] px-1">
                          <Controller
                            name={`payment_terms.${index}.due_date`}
                            control={control}
                            rules={{
                              validate: (value) => {
                                // Get the status of the current row
                                const status =
                                  getValues().payment_terms[index].term_status;

                                // Due date is required for credit terms
                                if (!value) {
                                  return "Due date is required for credit terms.";
                                }

                                // If the row is not editable (not Created), skip further validation
                                if (status !== "Created") {
                                  return true;
                                }

                                // For Created terms, due date must be today or in the future
                                if (new Date(value) < new Date(today)) {
                                  return "Due date must be today or in the future.";
                                }

                                return true;
                              },
                            }}
                            render={({ field: dateField }) => (
                              <Input
                                type="date"
                                className={`h-9 ${
                                  errors?.payment_terms?.[index]?.due_date
                                    ? "border-red-500"
                                    : ""
                                }`}
                                // min={today}
                                disabled={isDisabled}
                                {...dateField}
                              />
                            )}
                          />
                        </div>
                      )}
                      <div className="w-12 flex-shrink-0 flex justify-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => remove(index)}
                          disabled={isRowDisabled}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-start pt-3 px-2">
                <Button
                  type="button"
                  variant="outline"
                  className="text-sm h-9"
                  onClick={handleAddTerm}
                >
                  <PlusCircle className="h-4 w-4 mr-2" /> Add Payment Term
                </Button>
              </div>
              <div className="px-2 pt-4 mt-4 border-t space-y-2">
                <div className="flex">
                  <div className="w-[35%] text-base font-bold text-gray-800">
                    Total
                  </div>
                  <div className="w-[20%] text-right text-base font-bold text-gray-800">
                    {formatToIndianRupee(totalAmount)}
                  </div>
                  <div className="w-[15%] text-right text-base font-bold text-gray-800">
                    {calculateTotals(watchedTerms)?.percentage.toFixed(2)}%
                  </div>
                </div>
                {/* NEW: Remaining amount display */}
                <div className="flex justify-end text-right">
                  <span className="text-sm font-semibold">
                    {getAllocationStatusMessage(
                      remainingAmount,
                      isTotalAmountMismatched
                    )}
                  </span>
                </div>
              </div>
            </div>
            {Object.values(errors?.payment_terms || {}).map(
              (error: any, index) =>
                (error.due_date || error.label) && (
                  <div
                    key={index}
                    className="text-xs text-red-600 p-2 bg-red-50 rounded-md"
                  >
                    Error on row {index + 1}:{" "}
                    {error.due_date?.message || error.label?.message}
                  </div>
                )
            )}
            {/* --- CHANGE 4: Update the warning message --- */}
            {isTotalAmountMismatched && (
              <div className="flex items-center p-3 text-sm text-red-700 bg-red-50 rounded-lg mt-2">
                <AlertCircle className="h-5 w-5 mr-2" />
                The total allocated amount must match the PO total of{" "}
                {formatToIndianRupee(po.total_amount)}. Current difference is{" "}
                {formatToIndianRupee(remainingAmount)}.
              </div>
            )}

            <div className="flex justify-end gap-3 mt-8">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-red-600 hover:bg-red-700"
                disabled={
                  isLoading ||
                  isTotalAmountMismatched ||
                  Object.keys(errors).length > 0
                }
              >
                {isLoading ? (
                  <TailSpin color="white" height={20} width={20} />
                ) : (
                  "Confirm"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
};


 const EditGstNotesDialog = ({
  isOpen,
  onClose,
  po,
  poProject,
  onSave,
  isLoading,
}) => {
  const [notes, setNotes] = useState<{ id: string; note: string }[]>([]);
  const [curNote, setCurNote] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedGst, setSelectedGst] = useState(po.project_gst || "");

  useEffect(() => {
    if (po && isOpen) {
      setNotes(parseNotePoints(po.note_points));
      setSelectedGst(po.project_gst || "");
    }
  }, [po, isOpen]);

  const handleAddOrUpdateNote = () => {
    if (!curNote.trim()) return;
    if (editingId) {
      setNotes(
        notes.map((n) => (n.id === editingId ? { ...n, note: curNote } : n))
      );
    } else {
      setNotes([...notes, { id: uuidv4(), note: curNote }]);
    }
    setCurNote("");
    setEditingId(null);
  };

  const handleEditNote = (noteId: string) => {
    const noteToEdit = notes.find((n) => n.id === noteId);
    if (noteToEdit) {
      setCurNote(noteToEdit.note);
      setEditingId(noteId);
    }
  };

  const handleDeleteNote = (noteId: string) => {
    setNotes(notes.filter((n) => n.id !== noteId));
    if (editingId === noteId) {
      setCurNote("");
      setEditingId(null);
    }
  };

  const finalSave = () => {
    const dataToSave = {
      project_gst: selectedGst,
      gst_applicable: 1,
      note_points: JSON.stringify({
        list: notes.map(({ id, ...rest }) => rest),
      }),
    };
    onSave(dataToSave);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg bg-white p-6 rounded-lg shadow-xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-gray-800">
            Nirmaan GST for Billing & Notes
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-6 pt-4">
          <div>
            <Label className="font-semibold text-gray-700">
              Nirmaan GST for Billing <span className="text-red-500">*</span>
            </Label>
            {poProject && poProject.project_gst_number ? (
              <Select onValueChange={setSelectedGst} value={selectedGst}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select Nirmaan GST for Billing" />
                </SelectTrigger>
                <SelectContent>
                  {JSON.parse(poProject.project_gst_number).list.map(
                    (option) => (
                      <SelectItem key={option.gst} value={option.gst}>
                        {option.location} ({option.gst})
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-gray-500 mt-1">
                No GST options available.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label className="font-semibold text-gray-700">
              Create Note Points
            </Label>
            <div className="flex items-center gap-2">
              <Input
                value={curNote}
                onChange={(e) => setCurNote(e.target.value)}
                placeholder="Type a new note..."
              />
              <Button
                type="button"
                className="bg-red-600 hover:bg-red-700 h-9 px-4"
                onClick={handleAddOrUpdateNote}
              >
                <PencilIcon className="h-4 w-4 mr-2" />{" "}
                {editingId ? "Update" : "Add"}
              </Button>
            </div>
          </div>
          <div className="space-y-3">
            <Label className="font-semibold text-gray-700">Notes Preview</Label>
            {notes.length > 0 ? (
              <ol className="list-decimal list-inside space-y-2 rounded-md border p-3">
                {notes.map((note) => (
                  <li
                    key={note.id}
                    className="flex justify-between items-center group"
                  >
                    <span className="text-sm text-gray-800">{note.note}</span>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {editingId === note.id ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleEditNote(note.id)}
                        >
                          <PencilIcon className="h-4 w-4 text-gray-500" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleDeleteNote(note.id)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-center text-sm text-gray-400 p-4 border rounded-md">
                No notes added.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-3 pt-6 border-t">
            <Button
              type="button"
              onClick={finalSave}
              className="bg-red-600 hover:bg-red-700 w-full"
              disabled={isLoading}
            >
              {isLoading ? (
                <TailSpin color="white" height={20} width={20} />
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" /> Save
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const RequestPaymentDialog = ({
  isOpen,
  onClose,
  term,
  onConfirm,
  isLoading,
}) => {
  if (!isOpen || !term) return null;
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg bg-white p-6 rounded-lg shadow-xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-gray-800 text-center">
            Request Payment
          </DialogTitle>
        </DialogHeader>
        <div className="my-6">
          <div className="grid grid-cols-12 gap-x-4 px-3 py-2 bg-gray-50/50 text-xs font-semibold text-gray-500 uppercase">
            <div className="col-span-7">Term</div>
            <div className="col-span-2 text-right">Percentage</div>
            <div className="col-span-3 text-right">Amount</div>
          </div>
          <div className="grid grid-cols-12 gap-x-4 items-center px-3 py-4 border-b">
            <div className="col-span-7 flex items-center text-sm font-medium text-gray-800">
              {" "}
              • {term.label}
            </div>
            <div className="col-span-2 text-right text-sm text-gray-600">
              {Number(term.percentage).toFixed(2)}%
            </div>
            <div className="col-span-3 text-right text-sm font-semibold text-gray-800">
              {formatToIndianRupee(Number(term.amount))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="bg-red-600 hover:bg-red-700 w-32"
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? (
              <TailSpin color="white" height={20} width={20} />
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" /> Request
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Helper function to determine if a payment term is eligible for payment request.
 * For Credit terms: must be in Created status AND due_date <= today
 * For non-Credit terms (DAP, Cash, etc.): must be in Created status
 */
const canRequestPaymentForTerm = (term: PaymentTerm): boolean => {
  if (term.term_status !== "Created") return false;

  // Non-credit: always eligible if Created
  if (term.payment_type !== "Credit") return true;

  // Credit: eligible only if due_date <= today
  if (!term.due_date) return false;
  const dueDate = new Date(term.due_date);
  return isToday(dueDate) || isPast(dueDate);
};

const PaymentTermRow = ({ term, onReques_tPayment, role }) => {
  const hasPermission = ["Nirmaan Procurement Executive Profile", "Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile"].includes(role);

  // Calculate eligibility using the helper function
  const isEligibleForRequest = canRequestPaymentForTerm(term);
  const canRequest = hasPermission && isEligibleForRequest;

  return (
    <li className="flex justify-between items-center py-2.5 border-b border-gray-100 last:border-b-0">
      <div className="flex items-center gap-x-4 flex-1">
        <span className="text-gray-800 w-2/5 truncate">{term.label}</span>
        <span className="font-semibold text-black w-1/5 text-right">
          {Number(term.percentage).toFixed(0)}%
        </span>
        <span className="font-semibold text-black w-2/5 text-right">
          {formatToIndianRupee(Number(term.amount))}
        </span>
      </div>
      <div className="w-40 text-right ml-4">
        {term?.term_status === "Return" && (
          <Badge variant="outline" className="border-grey-500 text-blue-600">
            Return
          </Badge>
        )}
        {term?.term_status === "Approved" && (
          <Badge variant="outline" className="border-grey-500 text-grey-600">
            Approved
          </Badge>
        )}
        {term?.term_status === "Paid" && (
          <div className="flex items-center justify-end text-green-600">
            <CheckCircle2 className="h-5 w-5 mr-2" />
            <span className="font-medium text-sm">Paid</span>
          </div>
        )}
        {term?.term_status === "Requested" && (
          <Badge
            variant="outline"
            className="border-orange-500 text-orange-600"
          >
            Requested
          </Badge>
        )}
        {term?.term_status === "Rejected" && (
          <Badge variant="outline" className="border-red-500 text-red-600">
            Rejected
          </Badge>
        )}
        {term?.term_status === "canceled" && (
          <Badge variant="outline" className="border-grey-500 text-grey-600">
            canceled
          </Badge>
        )}
        {/* For Created status: show Request button if eligible, or due date badge if Credit term not yet due */}
        {term?.term_status === "Created" && canRequest && (
          <Button
            size="sm"
            className="bg-yellow-400 hover:bg-yellow-500 text-red text-xs h-7 px-3"
            onClick={() => onReques_tPayment(term)}
          >
            Request Payment
          </Button>
        )}
        {term?.term_status === "Created" && term.payment_type === "Credit" && !isEligibleForRequest && (
          <Badge
            variant="outline"
            className="border-orange-500 text-orange-600"
          >
            Due: {term.due_date ? format(new Date(term.due_date), "dd-MMM-yyyy") : "N/A"}
          </Badge>
        )}
      </div>
    </li>
  );
};

// =================================================================================
// MAIN CARD COMPONENT
// =================================================================================

export const POPaymentTermsCard: React.FC<POPaymentTermsCardProps> = ({
  PO,
  accountsPage,
  estimatesViewing,
  summaryPage,
  poMutate,
  projectPaymentsMutate
}) => {
  if (!PO)
    return (
      <Card className="rounded-sm shadow-md col-span-3">
        <CardContent className="p-4 text-center text-gray-500">
          Loading Payment Details...
        </CardContent>
      </Card>
    );

  const { data: poProject } = useFrappeGetDoc<Projects>(
    "Projects",
    PO?.project,
    PO ? `Projects-${PO.name}` : null
  );
  const { updateDoc, loading: isUpdatingDoc } = useFrappeUpdateDoc();
  const { errors, isValid, hasVendorIssues } = usePOValidation(PO);
  const { role } = useUserData();
  const { isCEOHold, showBlockedToast } = useCEOHoldGuard(PO?.project);
  const {
    call: CreatePPApi,
    loading: CreatePPApiLoading,
    error: CreatePPapiError,
  } = useFrappePostCall<ApiResponse>(
    "nirmaan_stack.api.payments.project_payments.create_project_payment"
  );

 const [searchParams, setSearchParams] = useSearchParams(); // Use setSearchParams as well
 const navigate = useNavigate(); // Use navigate as well

  const [updatingTermName, setUpdatingTermName] = useState<string | null>(null);
  const [isEditTermsOpen, setEditTermsOpen] = useState(false);
  const [isEditGstNotesOpen, setEditGstNotesOpen] = useState(false);
  const [termToRequest, setTermToRequest] = useState<PaymentTerm | null>(null);

    // --- ADD: useEffect to check the URL when the component mounts ---
  useEffect(() => {
    // Check if the 'isEditing' parameter from the URL is 'true'
    if (searchParams.get('isEditing') === 'true') {
      // If it is, programmatically open the dialog by setting the state.
      setEditTermsOpen(true);
     
    }else{
       setEditTermsOpen(false);
    }
  }, []); // This effect runs once on load and if the URL params change.


   const cleanupEditUrlParam = useCallback(() => {
    // Only run if the parameter actually exists
    if (searchParams.get('isEditing') === 'true') {
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.delete('isEditing');
      
      // Update the URL without reloading or adding to history
      navigate(`?${newSearchParams.toString()}`, { replace: true });
    }
  }, [navigate, searchParams]); // Dependencies for useCallback
  
  
  

  const isReadOnly = accountsPage || estimatesViewing || PO.status === "Inactive" || !["Nirmaan Procurement Executive Profile", "Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile"].includes(role);

  // const isPaymentTermsEditable = useMemo(() => {
  //   if (
  //     !PO.payment_terms ||
  //     !Array.isArray(PO.payment_terms) ||
  //     PO.payment_terms.length === 0
  //   ) {
  //     return true;
  //   }
  //   return PO.payment_terms.every((term) => term.status === "Created");
  // }, [PO.payment_terms]);

  const processedPaymentTerms = useMemo(() => {
    const terms = Array.isArray(PO.payment_terms) ? PO.payment_terms : [];
    return terms.map((term) => {
      // let displayStatus:
      //   | "Created"
      //   | "Paid"
      //   | "Requested"
      //   | "Approved"
      //   | "Scheduled"
      //   | "Return" = "Created";

      // const termStatus = term.status;
      // if (termStatus === "Paid") displayStatus = "Paid";
      // else if (termStatus === "Requested") displayStatus = "Requested";
      // else if (termStatus === "Return") displayStatus = "Return";
      // else if (termStatus === "Scheduled") displayStatus = "Scheduled";
      // else if (termStatus === "Approved") displayStatus = "Approved";
      // else displayStatus = "Created";

      return { ...term };
    });
  }, [PO.payment_terms]);

  const displayNotes = useMemo(
    () => parseNotePoints(PO.note_points),
    [PO.note_points]
  );

  const handleOpenRequestDialog = (term: PaymentTerm) => setTermToRequest(term);

  const handleConfirmRequestPayment = async () => {
    if (isCEOHold) {
      showBlockedToast();
      return;
    }
    if (!termToRequest) return;
    setUpdatingTermName(termToRequest.name);
    try {
      const result = await CreatePPApi({
        doctype: "Procurement Orders",
        docname: PO.name,
        project: PO.project,
        vendor: PO.vendor,
        amount: termToRequest.amount,
        ptname: termToRequest.name,
      });
      // console.log("message", result);
      if (result && result.message && result.message.status === 200) {
        toast({
          title: "Success!",
          description: `${result.message.message}`,
          variant: "success",
        });
      }
      poMutate();
      projectPaymentsMutate();
    } catch (error) {
      console.log("getting error toast why ", error.message);
      toast({
        title: "Error",
        description: `Could not request payment ${error?.message}`,
        variant: "destructive",
      });
    } finally {
      setUpdatingTermName(null);
      setTermToRequest(null);
    }
  };



  const handleSave = async (dataToSave: Partial<ProcurementOrder>) => {
    try {
      await updateDoc("Procurement Orders", PO.name, dataToSave);
     cleanupEditUrlParam()
      poMutate();
      setEditTermsOpen(false);
      setEditGstNotesOpen(false);
    } catch (error) {
      throw error;
    }
  };

  const handleSaveTerms = async (data: { payment_terms: PaymentTerm[] }) => {
    // Payment terms are saved as-is. Status transitions (Created → Requested → etc.)
    // are handled by the backend when payment requests are made.
    // Frontend determines eligibility for payment requests based on due_date.
    try {
      await handleSave({ payment_terms: data.payment_terms });
      toast({
        title: "Success",
        description: "Payment terms updated.",
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to update terms `,
        variant: "destructive",
      });
    }
  };

  const handleSaveGstNotes = async (data: {
    project_gst: string;
    note_points: string;
    gst_applicable: 0 | 1;
  }) => {
    try {
      await handleSave(data);
      toast({
        title: "Success",
        description: "GST and Notes updated.",
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update details.",
        variant: "destructive",
      });
    }
  };

  console.log("processedPaymentTerms",processedPaymentTerms)
  return (
    <>
      <Card className="rounded-sm shadow-md col-span-3 overflow-x-auto">
        <CardContent className="p-4 sm:p-6">
          <div className="pb-6">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-lg font-bold text-red-600">
                PO Payment Terms
              </h3>
              {!isReadOnly && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={() => setEditTermsOpen(true)}
                  //  disabled={!isPaymentTermsEditable}
                >
                  <PencilIcon className="w-3 h-3 mr-1" />
                  Edit
                </Button>
              )}
            </div>
            <p className="text-sm text-gray-500 mb-3">
              Payment type:{" "}
              <span className="text-red-600 font-medium">
                {PO.payment_terms?.[0]?.payment_type || "Not Set"}
              </span>
            </p>
            <ul className="space-y-1">
              {processedPaymentTerms.length > 0 && PO.status!=="Inactive" ? (
                processedPaymentTerms.map((term) => (
                  <PaymentTermRow
                    key={term.name}
                    term={term}
                    // displayStatus={term?.term_status}
                    onReques_tPayment={handleOpenRequestDialog}
                    role={role}
                  />
                ))
              ) : (
                <p className="text-sm text-gray-400 text-center py-4">
                   {PO.status==="Inactive"?"This Payment Terms Are in InActive Mode":"No payment terms defined" }.
                </p>
              )}
            </ul>
          </div>
          <div className="pt-6 border-t">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-lg font-bold text-red-600">
                Nirmaan GST for Billing & Notes
                {!isValid && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <AlertTriangle
                        color="red"
                        size={16}
                        className="inline-block ml-2  max-sm:w-2 max-sm:h-2"
                      />
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      className="bg-background border border-border text-foreground w-80"
                    >
                      <ValidationMessages
                        title="Required Before Proceeding"
                        errors={errors}
                      />
                    </TooltipContent>
                  </Tooltip>
                )}
              </h3>

              {!isReadOnly && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={() => setEditGstNotesOpen(true)}
                >
                  <PencilIcon className="w-3 h-3 mr-1" />
                  Edit
                </Button>
              )}
            </div>
            <div className="text-sm space-y-3">
              <p>
                <span className="font-semibold text-gray-800">GST: </span>
                <span className="text-gray-600">
                  {poProject && poProject.project_gst_number && PO.project_gst
                    ? JSON.parse(poProject.project_gst_number).list.find(
                        (g) => g.gst === PO.project_gst
                      )?.location
                    : "Not Set"}
                </span>
              </p>
              <div>
                <p className="font-semibold text-gray-800 mb-1">Notes</p>
                {displayNotes.length > 0 ? (
                  <ol className="list-decimal list-inside space-y-1 text-gray-600">
                    {displayNotes.map((note) => (
                      <li key={note.id}>{note.note}</li>
                    ))}
                  </ol>
                ) : (
                  <div className="text-gray-400 italic bg-gray-50 p-3 rounded-md border">
                    No notes added.
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {isEditTermsOpen && (
        <EditTermsDialog
          isOpen={isEditTermsOpen}
          onClose={() => {
            cleanupEditUrlParam()
            setEditTermsOpen(false)}}
          po={PO}
          onSave={handleSaveTerms}
          isLoading={isUpdatingDoc}
        />
      )}

      {isEditGstNotesOpen && (
        <EditGstNotesDialog
          isOpen={isEditGstNotesOpen}
          onClose={() => setEditGstNotesOpen(false)}
          po={PO}
          poProject={poProject}
          onSave={handleSaveGstNotes}
          isLoading={isUpdatingDoc}
        />
      )}
      <RequestPaymentDialog
        isOpen={!!termToRequest}
        onClose={() => setTermToRequest(null)}
        term={termToRequest}
        onConfirm={handleConfirmRequestPayment}
        isLoading={CreatePPApiLoading}
      />
    </>
  );
};

export default POPaymentTermsCard;
