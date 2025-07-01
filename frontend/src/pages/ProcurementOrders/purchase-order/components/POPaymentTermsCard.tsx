import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useFrappeGetDoc, useFrappeUpdateDoc } from "frappe-react-sdk";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  PencilIcon,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { TailSpin } from "react-loader-spinner";
import { v4 as uuidv4 } from "uuid";

// =================================================================================
// PROPS & TYPE DEFINITIONS
// =================================================================================
interface POPaymentTermsCardProps {
  accountsPage: boolean;
  estimatesViewing: boolean;
  summaryPage: boolean;
  PO: ProcurementOrder | null;
  poMutate: any;
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
      // Ensure each note has a unique client-side ID for React keys and editing.
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

const EditTermsDialog = ({ isOpen, onClose, po, onSave, isLoading }) => {
  const { control, handleSubmit, watch, setValue, formState: { errors } } = useForm({
    defaultValues: {
      payment_terms: po.payment_terms?.map(term => ({
        ...term,
        percentage: Number(term.percentage) || 0,
        // Ensure due_date is in YYYY-MM-DD format for the input[type="date"]
        due_date: term.due_date ? term.due_date.split(' ')[0] : '', 
      })) || [],
    },
  });

  const { fields } = useFieldArray({ control, name: "payment_terms" });
  const watchedTerms = watch("payment_terms");

  // --- Total calculation logic remains the same ---
  const calculateTotals = (terms) => {
    if (!terms || !Array.isArray(terms)) return { percentage: 0, amount: 0 };
    const activeTerms = terms.filter((term) => Number(term.docstatus) !== 1);
    const percentage = activeTerms.reduce((sum, term) => sum + (Number(term.percentage) || 0), 0);
    const amount = activeTerms.reduce((sum, term) => sum + (Number(term.amount) || 0), 0);
    return { percentage, amount };
  };

  const [totalPercentage, setTotalPercentage] = useState(() => calculateTotals(po.payment_terms).percentage);
  const [totalAmount, setTotalAmount] = useState(() => calculateTotals(po.payment_terms).amount);

  useEffect(() => {
    const subscription = watch((value) => {
      const currentTerms = value.payment_terms || [];
      const { percentage, amount } = calculateTotals(currentTerms);
      setTotalPercentage(percentage);
      setTotalAmount(amount);
    });
    return () => subscription.unsubscribe();
  }, [watch]);
  
  // Get today's date in YYYY-MM-DD format for the input min attribute
  const today = new Date().toISOString().split('T')[0];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogPortal>
 <DialogContent className="sm:max-w-2xl bg-white p-6 rounded-lg shadow-xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-gray-800 text-center">
            Edit {po.payment_terms?.[0]?.payment_type || "Payment"} Terms
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSave)}>
          <div className="my-6 space-y-2">
            {/* --- Header Row with Due Date --- */}
            <div className="flex px-2 pb-2 border-b">
              <div className="w-2/5 text-sm font-medium text-muted-foreground">Term</div>
              <div className="w-1/5 text-right text-sm font-medium text-muted-foreground">Percentage (%)</div>
              <div className="w-1/5 text-right text-sm font-medium text-muted-foreground">Amount</div>
              {po.payment_terms?.[0]?.payment_type === "Credit" && (
                <div className="w-1/5 text-center text-sm font-medium text-muted-foreground">Due Date</div>
              )}
            </div>
            {/* --- Data Rows --- */}
            <div className="space-y-1">
              {fields.map((field, index) => (
                <div key={field.id} className="flex items-center p-2 rounded-md hover:bg-gray-50">
                  <div className="w-2/5 flex items-center">
                    <Controller
                      name={`payment_terms.${index}.docstatus`}
                      control={control}
                      render={({ field: checkField }) => (
                        <Checkbox
                          id={`term-${index}`}
                          checked={checkField.value !== 1}
                          onCheckedChange={(checked) => {
                            checkField.onChange(checked ? 0 : 1);
                            if (!checked) {
                              setValue(`payment_terms.${index}.percentage`, 0, { shouldDirty: true });
                              setValue(`payment_terms.${index}.amount`, "0.00", { shouldDirty: true });
                            }
                          }}
                        />
                      )}
                    />
                    <Label htmlFor={`term-${index}`} className="ml-3 text-sm font-medium text-gray-700 cursor-pointer">
                      {field.label}
                    </Label>
                  </div>
                  <div className="w-1/5 px-1">
                    <Controller
                      name={`payment_terms.${index}.percentage`}
                      control={control}
                      render={({ field: percentageField }) => (
                        <Input
                          className="text-right h-9"
                          disabled={watchedTerms[index]?.docstatus === 1}
                          {...percentageField}
                          onChange={(e) => {
                            const newPercentage = e.target.value === "" ? "" : Number(e.target.value);
                            percentageField.onChange(newPercentage);
                            const newAmount = (Number(po.total_amount) * (Number(newPercentage) || 0)) / 100;
                            setValue(`payment_terms.${index}.amount`, newAmount.toFixed(2));
                          }}
                        />
                      )}
                    />
                  </div>
                  <div className="w-1/5 px-1">
                    <Input
                      className="text-right h-9 bg-gray-100 cursor-not-allowed"
                      readOnly
                      value={formatToIndianRupee(Number(watchedTerms[index]?.amount) || 0)}
                    />
                  </div>
                  {/* --- NEW: Conditional Due Date Input --- */}
                  {po.payment_terms?.[0]?.payment_type === "Credit" && (
                    <div className="w-1/5 px-1">
                      <Controller
                        name={`payment_terms.${index}.due_date`}
                        control={control}
                        // Add validation rules
                        rules={{
                          required: "Due date is required for credit terms.",
                          validate: value => new Date(value) > new Date(today) || "Due date must be in the future."
                        }}
                        render={({ field: dateField }) => (
                          <Input
                            type="date"
                           
                            className={`h-9 ${errors.payment_terms?.[index]?.due_date ? 'border-red-500' : ''}`}
                            min={today} // Prevents selecting past dates
                            disabled={true}
                            {...dateField}
                          />
                        )}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* --- Totals and Validation --- */}
            <div className="flex px-2 pt-3 border-t">
              <div className="w-2/5 text-base font-bold text-gray-800">Total</div>
              <div className="w-1/5 text-right text-base font-bold text-gray-800">{Math.round(totalPercentage)}%</div>
              <div className="w-1/5 text-right text-base font-bold text-gray-800">{formatToIndianRupee(totalAmount)}</div>
              {po.payment_terms?.[0]?.payment_type === "Credit" && <div className="w-1/5"></div>}
            </div>
          </div>
          
          {/* Display Validation Errors */}
          {Object.values(errors.payment_terms || {}).map((error: any, index) => 
            error.due_date && (
              <div key={index} className="text-xs text-red-600 p-2 bg-red-50 rounded-md">
                Error on row {index + 1}: {error.due_date.message}
              </div>
            )
          )}
          {Math.round(totalPercentage) !== 100 && (
            <div className="flex items-center p-3 text-sm text-red-700 bg-red-50 rounded-lg mt-2">
              <AlertCircle className="h-5 w-5 mr-2" /> The total percentage must be exactly 100%.
            </div>
          )}

          <div className="flex justify-end gap-3 mt-8">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              className="bg-red-600 hover:bg-red-700"
              disabled={isLoading || Math.round(totalPercentage) !== 100 || Object.keys(errors).length > 0}
            >
              {isLoading ? <TailSpin color="white" height={20} width={20} /> : "Confirm"}
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
      gst_applicable: 1, // Assuming GST is always applicable if editing
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
            Project GST & Notes
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-6 pt-4">
          <div>
            <Label className="font-semibold text-gray-700">
              Project GST Selection <span className="text-red-500">*</span>
            </Label>
            {poProject && poProject.project_gst_number ? (
              <Select onValueChange={setSelectedGst} value={selectedGst}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select Project GST" />
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
              {Number(term.percentage)}%
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

const PaymentTermRow = ({
  term,
  displayStatus,
  onReques_tPayment,
  isUpdating,
}) => {
  return (
    <li className="flex justify-between items-center py-2.5 border-b border-gray-100 last:border-b-0">
      <span className="text-gray-800">
        • {term.label} - {Number(term.percentage).toFixed(0)}% -{" "}
        <span className="font-semibold text-black">
          {formatToIndianRupee(Number(term.amount))}
        </span>
      </span>
      <div className="w-40 text-right">
        {displayStatus === "Created" && (
          <Badge
            variant="outline"
            className="border-grey-500 text-grey-600"
          >
            Created
          </Badge>
        )}
        {displayStatus === "Paid" && (
          <div className="flex items-center justify-end text-green-600">
            <CheckCircle2 className="h-5 w-5 mr-2" />
            <span className="font-medium text-sm">Paid</span>
          </div>
        )}
        {displayStatus === "Requested" && (
          <Badge
            variant="outline"
            className="border-orange-500 text-orange-600"
          >
            Requested
          </Badge>
        )}
          {displayStatus === "Scheduled" && (
          <Badge
            variant="outline"
            className="border-grey-500 text-grey-600"
          >
            Scheduled
          </Badge>
        )}
        {/* {displayStatus === "Approved" &&
          (isUpdating ? (
            <div className="flex justify-center items-center h-full">
              <TailSpin color="red" width={20} height={20} />
            </div>
          ) : (
            <Button
              size="sm"
              className="bg-red-600 hover:bg-red-700 text-white text-xs h-7 px-3"
              onClick={() => onReques_tPayment(term)}
            >
              Request Payment
            </Button>
          ))} */}
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
  const [updatingTermName, setUpdatingTermName] = useState<string | null>(null);
  const [isEditTermsOpen, setEditTermsOpen] = useState(false);
  const [isEditGstNotesOpen, setEditGstNotesOpen] = useState(false);
  const [termToRequest, setTermToRequest] = useState<PaymentTerm | null>(null);

  const isReadOnly = accountsPage || estimatesViewing || summaryPage;

  const processedPaymentTerms = useMemo(() => {
    let nextActionableFound = false;
    const terms = Array.isArray(PO.payment_terms) ? PO.payment_terms : [];
    return terms.map((term) => {
      let displayStatus: "Created" |"Paid" | "Requested" | "Approved" |"Scheduled"| "Created" =
        "Created";
        
      const termStatus = term.status;
      if(termStatus === "Created") displayStatus = "Created";
      else if (termStatus === "Paid") displayStatus = "Paid";
      else if (termStatus === "Requested") displayStatus = "Requested";
      else if (!nextActionableFound && !isReadOnly) {
        displayStatus = "Approved";
        nextActionableFound = true;
      }
      return { ...term, displayStatus };
    });
  }, [PO.payment_terms, isReadOnly]);

  const displayNotes = useMemo(
    () => parseNotePoints(PO.note_points),
    [PO.note_points]
  );

  const handleOpenRequestDialog = (term: PaymentTerm) => setTermToRequest(term);

  const handleConfirmRequestPayment = async () => {
    if (!termToRequest) return;
    setUpdatingTermName(termToRequest.name);
    try {
      const updatedPaymentTerms = PO.payment_terms.map((term) =>
        term.name === termToRequest.name
          ? { ...term, status: "requested" }
          : term
      );
      await handleSave({ payment_terms: updatedPaymentTerms });
      toast({
        title: "Success!",
        description: `Payment for "${termToRequest.label}" has been requested.`,
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Could not request payment.",
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
      poMutate();
      setEditTermsOpen(false);
      setEditGstNotesOpen(false);
    } catch (error) {
      throw error;
    }
  };

  const handleSaveTerms = async (data: { payment_terms: PaymentTerm[] }) => {
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
        description: "Failed to update terms.",
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

  return (
    <>
      <Card className="rounded-sm shadow-md col-span-3 overflow-x-auto">
        <CardContent className="p-4 sm:p-6">
          <div className="pb-6">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-lg font-bold text-red-600">
                Project Payment
              </h3>
              {!isReadOnly && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={() => setEditTermsOpen(true)}
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
              {processedPaymentTerms.length > 0 ? (
                processedPaymentTerms.map((term) => (
                  <PaymentTermRow
                    key={term.name}
                    term={term}
                    displayStatus={term.displayStatus}
                    onReques_tPayment={handleOpenRequestDialog}
                    isUpdating={updatingTermName === term.name}
                  />
                ))
              ) : (
                <p className="text-sm text-gray-400 text-center py-4">
                  No payment terms defined.
                </p>
              )}
            </ul>
          </div>
          <div className="pt-6 border-t">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-lg font-bold text-red-600">
                Project GST And Notes
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

      <EditTermsDialog
        isOpen={isEditTermsOpen}
        onClose={() => setEditTermsOpen(false)}
        po={PO}
        onSave={handleSaveTerms}
        isLoading={isUpdatingDoc}
      />
      <EditGstNotesDialog
        isOpen={isEditGstNotesOpen}
        onClose={() => setEditGstNotesOpen(false)}
        po={PO}
        poProject={poProject}
        onSave={handleSaveGstNotes}
        isLoading={isUpdatingDoc}
      />
      <RequestPaymentDialog
        isOpen={!!termToRequest}
        onClose={() => setTermToRequest(null)}
        term={termToRequest}
        onConfirm={handleConfirmRequestPayment}
        isLoading={!!updatingTermName}
      />
    </>
  );
};

export default POPaymentTermsCard;
