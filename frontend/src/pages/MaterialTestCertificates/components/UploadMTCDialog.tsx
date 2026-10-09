import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { CalendarIcon, FileText, Info, X } from "lucide-react";
import { TailSpin } from "react-loader-spinner";

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
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import SITEURL from "@/constants/siteURL";
import { getFrappeError } from "@/utils/frappeErrors";
import { formatDate } from "@/utils/FormatDate";
import {
  billableLines,
  certificateDateProblem,
  coverableLines,
  editableLines,
  mtcFileName,
  mtcItemTag,
  mtcLineKey,
  takenLineKeys,
  type MTCItemTag,
  type POLineInput,
} from "@/utils/mtc";
import type { MaterialTestCertificate } from "@/types/NirmaanStack/MaterialTestCertificate";

import { MTCItemChecklist } from "./MTCItemChecklist";
import { useMTCMutations } from "../hooks/useMTCMutations";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ACCEPTED_TYPES = ["application/pdf", "image/*"] as const;

interface UploadMTCDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  poName: string;
  poDisplayName: string;
  vendorName?: string;
  poItems: POLineInput[];
  /** Every MTC of this PO -- decides which lines are still free. */
  mtcs: MaterialTestCertificate[];
  /** Edit only. */
  existing?: MaterialTestCertificate;
  /** Refetch the MTC list -- after a save, and after a refusal (another user may have just claimed an item). */
  onRefresh: () => void;
}

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** A neutral file chip: icon, full name (wraps), optional size, optional link, and an action. */
const FileChip = ({
  name,
  size,
  href,
  action,
}: {
  name: string;
  size?: string;
  href?: string;
  action: React.ReactNode;
}) => (
  <div className="flex min-h-[40px] items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
    <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
    {href ? (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="min-w-0 flex-1 break-all text-sm text-blue-600 hover:underline"
      >
        {name}
      </a>
    ) : (
      <span className="min-w-0 flex-1 break-all text-sm">{name}</span>
    )}
    {size && <span className="flex-shrink-0 text-xs text-muted-foreground">{size}</span>}
    {action}
  </div>
);

export const UploadMTCDialog = ({
  open,
  onOpenChange,
  mode,
  poName,
  poDisplayName,
  vendorName,
  poItems,
  mtcs,
  existing,
  onRefresh,
}: UploadMTCDialogProps) => {
  const isEdit = mode === "edit" && !!existing;
  const { toast } = useToast();
  const { create, update, busy } = useMTCMutations(poName);

  const [file, setFile] = useState<File | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [certificateDate, setCertificateDate] = useState("");
  const [dateOpen, setDateOpen] = useState(false);
  const today = format(new Date(), "yyyy-MM-dd");

  const lines = useMemo(
    () => (isEdit ? editableLines(existing!, poItems, mtcs) : coverableLines(poItems, mtcs)),
    [isEdit, existing, poItems, mtcs]
  );

  const tags = useMemo(() => {
    const map = new Map<string, MTCItemTag>();
    if (!isEdit) return map;
    for (const item of existing!.items ?? []) {
      const tag = mtcItemTag(item, poItems);
      if (tag) map.set(mtcLineKey(item.item_id, item.make), tag);
    }
    return map;
  }, [isEdit, existing, poItems]);

  // Billable lines held by OTHER certificates of this PO: not offered, but counted for the note.
  const coveredElsewhere = useMemo(() => {
    const taken = takenLineKeys(mtcs, existing?.name);
    return billableLines(poItems).filter((l) => taken.has(l.key)).length;
  }, [mtcs, existing?.name, poItems]);

  // Reset on every open. Edit starts from this MTC's items and date; create has no default date (owner).
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setReplacing(false);
    setCertificateDate(isEdit ? existing!.certificate_date ?? "" : "");
    setSelected(
      isEdit
        ? new Set((existing!.items ?? []).map((i) => mtcLineKey(i.item_id, i.make)))
        : new Set()
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.name]);

  const selectedLines = lines.filter((l) => selected.has(l.key));
  const needsFile = !isEdit || replacing;

  // The first thing still missing, shown in the footer instead of a silently disabled button.
  const blocker =
    needsFile && !file
      ? "Choose the certificate file."
      : certificateDateProblem(certificateDate, today)
        ? "Pick the Certificate Date."
        : selectedLines.length === 0
          ? "Tick at least one item."
          : null;

  const handleSubmit = async () => {
    try {
      if (isEdit) {
        await update(existing!.name, selectedLines, replacing ? file : null, certificateDate);
        toast({ title: "Certificate updated", description: `Saved for ${poDisplayName}.`, variant: "success" });
      } else {
        await create(file!, selectedLines, certificateDate);
        toast({
          title: "Certificate uploaded",
          description: `Material Test Certificate added to ${poDisplayName}.`,
          variant: "success",
        });
      }
      onRefresh();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: isEdit ? "Could not save the certificate" : "Could not upload the certificate",
        description: getFrappeError(error),
        variant: "destructive",
      });
      onRefresh();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-[760px] max-h-[90vh] overflow-y-auto overscroll-y-contain">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Material Test Certificate" : "Upload Material Test Certificate"}</DialogTitle>
          <DialogDescription>{[poDisplayName, vendorName].filter(Boolean).join(" · ")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
            {/* Certificate file */}
            <div className="min-w-0 space-y-1.5">
              <Label>
                Certificate file {needsFile && <span className="text-red-500">*</span>}
              </Label>
              {file ? (
                <FileChip
                  name={file.name}
                  size={formatSize(file.size)}
                  action={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 flex-shrink-0"
                      onClick={() => setFile(null)}
                      aria-label="Remove the selected file"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  }
                />
              ) : isEdit && !replacing ? (
                <FileChip
                  name={mtcFileName(existing!.attachment)}
                  href={`${SITEURL}${existing!.attachment}`}
                  action={
                    <Button type="button" variant="outline" size="sm" onClick={() => setReplacing(true)}>
                      Replace file
                    </Button>
                  }
                />
              ) : (
                <CustomAttachment
                  selectedFile={null}
                  onFileSelect={setFile}
                  label="Select certificate file"
                  maxFileSize={MAX_FILE_BYTES}
                  acceptedTypes={[...ACCEPTED_TYPES]}
                />
              )}
              <p className="text-xs text-muted-foreground">
                PDF or image · up to 20 MB
                {isEdit && replacing && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      className="text-blue-600 hover:underline"
                      onClick={() => {
                        setReplacing(false);
                        setFile(null);
                      }}
                    >
                      Keep the current file
                    </button>
                  </>
                )}
              </p>
            </div>

            {/* Certificate Date: the app's calendar picker; future days can't be picked. */}
            <div className="space-y-1.5">
              <Label htmlFor="mtc-certificate-date">
                Certificate Date <span className="text-red-500">*</span>
              </Label>
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="mtc-certificate-date"
                    type="button"
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !certificateDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" aria-hidden="true" />
                    {certificateDate ? formatDate(certificateDate) : "Select date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={certificateDate ? parseISO(certificateDate) : undefined}
                    onSelect={(date) => {
                      setCertificateDate(date ? format(date, "yyyy-MM-dd") : "");
                      setDateOpen(false);
                    }}
                    disabled={(date) => format(date, "yyyy-MM-dd") > today}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Items */}
          <div className="space-y-1.5">
            <Label>
              Items covered <span className="text-red-500">*</span>
            </Label>
            <MTCItemChecklist lines={lines} selected={selected} onChange={setSelected} tags={tags} />
            {coveredElsewhere > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                {coveredElsewhere} item{coveredElsewhere === 1 ? "" : "s"} already{" "}
                {coveredElsewhere === 1 ? "has" : "have"} a certificate on this PO and{" "}
                {coveredElsewhere === 1 ? "isn't" : "aren't"} listed.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
          <span className={cn("text-sm", blocker ? "text-amber-700" : "text-muted-foreground")}>
            {blocker ?? `${selectedLines.length} item${selectedLines.length === 1 ? "" : "s"} selected`}
          </span>
          {busy ? (
            <div role="status" className="flex items-center gap-2">
              <TailSpin color="red" width={28} height={28} />
              <span className="sr-only">Saving</span>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={handleSubmit} disabled={!!blocker}>
                {isEdit ? "Save changes" : "Upload"}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
