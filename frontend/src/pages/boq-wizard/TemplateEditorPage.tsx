import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FrappeConfig,
  FrappeContext,
  useFrappeGetCall,
  useFrappePostCall,
} from "frappe-react-sdk";
import {
  ArrowDown,
  ArrowUp,
  FileSpreadsheet,
  Loader2,
  Plus,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/utils/FormatDate";
import { useUserData } from "@/hooks/useUserData";
import { getFrappeError } from "@/utils/frappeErrors";
import { TemplateRowsEditor } from "./TemplateRowsEditor";

// ── Admin endpoint response types ───────────────────────────────────────────
// get_master_template_admin is Admin+Estimates-only and NOT part of the shared
// boqTypes.ts create-time contract (that is get_master_template, a different shape).
// It returns {} when no master exists, else the full authoring/provenance blob.

interface MasterTemplateAdminSheet {
  sheet_name: string;
  sheet_order: number;
  sheet_label?: string | null;
  disposition: "data" | "general_specs";
  sheet_config?: unknown;
  work_packages?: unknown;
  preamble_text?: string | null;
  row_count?: number;
}

interface MasterTemplateAdminResponse {
  name?: string;
  template_name?: string;
  is_active?: boolean | 0 | 1;
  seeded_from_boq?: string | null;
  seeded_at?: string | null;
  last_updated_by?: string | null;
  last_updated_on?: string | null;
  sheets?: MasterTemplateAdminSheet[];
}

/** boq:wizard_parse_done payload (same event the upload screen consumes). */
interface ParseDonePayload {
  status: string;
  boq_name?: string;
  error_code?: string;
}

/** get_upload_status response (polling fallback; mirrors the realtime payload). */
interface UploadStatusResponse {
  state: "pending" | "done";
  status?: string;
  boq_name?: string;
  error_code?: string;
}

type SeedStatus = "idle" | "uploading" | "parsing" | "error";

const ACCEPTED_EXTS = new Set([".xlsx", ".xlsm"]);

const SEED_ERROR_MSGS: Record<string, string> = {
  corrupted: "The file appears to be corrupted or is not a valid Excel workbook.",
  zero_sheets: "The workbook contains no visible sheets. Please check the file and try again.",
  internal: "An unexpected error occurred while processing the file. Please try again.",
};

/**
 * A-T8 SHELL -- the Templates-admin screen.
 *
 * Route: /upload-boq/templates (lazy). Admin + Estimates only (server also gates).
 * Reads get_master_template_admin: {} (no master) -> empty seed state; else the
 * provenance card + is_active toggle + sheets list + a re-seed button.
 *
 * SEEDING reuses the upload -> parse socket/poll "first-to-resolve-wins" trio from
 * BoqUploadScreen: an is_template_source=1 upload authors a PROJECT-LESS seed BoQ,
 * then boq:wizard_parse_done (fast) OR get_upload_status polling (fallback) resolves
 * it and we navigate to that seed BoQ's hub.
 *
 * The per-row ReviewTree editor is a LATER slice -- this shell only stubs it.
 */
export function TemplateEditorPage() {
  const navigate = useNavigate();
  const { socket } = useContext(FrappeContext) as FrappeConfig;
  const { user_id, role } = useUserData();

  const isAuthorized =
    user_id === "Administrator" ||
    ["Nirmaan Admin Profile", "Nirmaan Estimates Executive Profile"].includes(
      role as string
    );

  // ── Master template read (Admin+Estimates) ────────────────────────────────
  const {
    data: adminData,
    isLoading,
    mutate: mutateAdmin,
  } = useFrappeGetCall<{ message: MasterTemplateAdminResponse }>(
    "nirmaan_stack.api.boq.wizard.template_materialize.get_master_template_admin",
    undefined,
    isAuthorized ? "boq-master-template-admin" : null
  );

  const master = adminData?.message;
  const hasMaster = !!master?.name;
  const isActive =
    master?.is_active === true || master?.is_active === 1;

  // ── Active toggle ─────────────────────────────────────────────────────────
  const { call: setActiveCall, loading: togglingActive } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.template_admin.set_template_active"
  );

  const handleToggleActive = useCallback(
    async (checked: boolean) => {
      try {
        await setActiveCall({ active: checked ? 1 : 0 });
        await mutateAdmin();
      } catch {
        // read is authoritative -- re-fetch to reflect true state on failure
        await mutateAdmin();
      }
    },
    [setActiveCall, mutateAdmin]
  );

  // ── Seed / re-seed upload flow ─────────────────────────────────────────────
  const seedInputRef = useRef<HTMLInputElement>(null);
  const [seedStatus, setSeedStatus] = useState<SeedStatus>("idle");
  const [seedJobId, setSeedJobId] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);

  // Ref mirror so the socket / poll handlers guard on the live status without a
  // stale closure (there is no zustand store here; this replaces getState()).
  const seedStatusRef = useRef<SeedStatus>(seedStatus);
  useEffect(() => {
    seedStatusRef.current = seedStatus;
  }, [seedStatus]);

  // First-to-resolve-wins: socket OR poll, whichever lands while status is "parsing".
  const applySeedOutcome = useCallback(
    (status?: string, boqName?: string | null, errorCode?: string | null) => {
      if (seedStatusRef.current !== "parsing") return;
      if (status === "success" && boqName) {
        // Navigate to the freshly-authored seed BoQ hub (verbatim name).
        navigate(`/upload-boq/hub/${boqName}`);
      } else if (status === "error") {
        setSeedError(SEED_ERROR_MSGS[errorCode ?? "internal"] ?? SEED_ERROR_MSGS.internal);
        setSeedStatus("error");
      }
    },
    [navigate]
  );

  // Fast path: realtime boq:wizard_parse_done (screen-scoped, not global).
  useEffect(() => {
    if (!socket) return;
    const handler = (payload: ParseDonePayload) =>
      applySeedOutcome(payload.status, payload.boq_name, payload.error_code);
    socket.on("boq:wizard_parse_done", handler);
    return () => {
      socket.off("boq:wizard_parse_done", handler);
    };
  }, [socket, applySeedOutcome]);

  // Fallback path: poll get_upload_status by job id while parsing.
  const shouldPoll = seedStatus === "parsing" && !!seedJobId;
  const { data: pollData } = useFrappeGetCall<{ message: UploadStatusResponse }>(
    "nirmaan_stack.api.boq.wizard.upload_file.get_upload_status",
    { job_id: seedJobId },
    shouldPoll ? `boq-seed-status::${seedJobId}` : null,
    { refreshInterval: shouldPoll ? 3000 : 0 }
  );

  useEffect(() => {
    const msg = pollData?.message;
    if (!msg || msg.state !== "done") return;
    applySeedOutcome(msg.status, msg.boq_name, msg.error_code);
  }, [pollData, applySeedOutcome]);

  // ── Sheet editor: row editor + sheet-level ops (add / remove / reorder) ─────
  const isTemplateAdmin = isAuthorized;
  const templateName = master?.name ?? "";

  const sortedSheets = useMemo(
    () =>
      [...(master?.sheets ?? [])].sort(
        (a, b) => (a.sheet_order ?? 0) - (b.sheet_order ?? 0)
      ),
    [master]
  );
  const sheetNames = useMemo(
    () => sortedSheets.map((s) => s.sheet_name),
    [sortedSheets]
  );

  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  // Derived active sheet: the user's pick if still present, else the first sheet.
  // No effect -- a removed / reordered-away sheet falls back automatically.
  const effectiveSheet =
    selectedSheet && sheetNames.includes(selectedSheet)
      ? selectedSheet
      : sheetNames[0] ?? null;
  const effectiveIndex = effectiveSheet ? sheetNames.indexOf(effectiveSheet) : -1;

  const { call: addSheetCall } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.template_edit.template_add_sheet"
  );
  const { call: removeSheetCall } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.template_edit.template_remove_sheet"
  );
  const { call: reorderSheetsCall } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.template_edit.template_reorder_sheets"
  );

  const [sheetOpBusy, setSheetOpBusy] = useState(false);
  const [sheetOpError, setSheetOpError] = useState<string | null>(null);

  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [newSheetName, setNewSheetName] = useState("");
  const [newSheetDisposition, setNewSheetDisposition] = useState<
    "data" | "general_specs"
  >("data");

  const handleAddSheet = useCallback(async () => {
    const name = newSheetName; // sheet_name VERBATIM -- never trim the identity (#152)
    if (!name.trim()) {
      setSheetOpError("Sheet name is required.");
      return;
    }
    setSheetOpBusy(true);
    setSheetOpError(null);
    try {
      await addSheetCall({
        template: templateName,
        sheet_name: name,
        disposition: newSheetDisposition,
      });
      await mutateAdmin();
      setSelectedSheet(name);
      setAddSheetOpen(false);
      setNewSheetName("");
      setNewSheetDisposition("data");
    } catch (e) {
      setSheetOpError(getFrappeError(e));
    } finally {
      setSheetOpBusy(false);
    }
  }, [newSheetName, newSheetDisposition, addSheetCall, templateName, mutateAdmin]);

  const [removeSheetTarget, setRemoveSheetTarget] = useState<string | null>(null);
  const handleRemoveSheet = useCallback(async () => {
    if (!removeSheetTarget) return;
    setSheetOpBusy(true);
    setSheetOpError(null);
    try {
      await removeSheetCall({
        template: templateName,
        sheet_name: removeSheetTarget,
      });
      await mutateAdmin();
      if (selectedSheet === removeSheetTarget) setSelectedSheet(null);
      setRemoveSheetTarget(null);
    } catch (e) {
      setSheetOpError(getFrappeError(e));
    } finally {
      setSheetOpBusy(false);
    }
  }, [removeSheetTarget, removeSheetCall, templateName, mutateAdmin, selectedSheet]);

  // Reorder: swap the active sheet with its neighbour and send the FULL ordered list
  // (the backend requires a COMPLETE, duplicate-free permutation of every sheet).
  const handleMoveSheet = useCallback(
    async (dir: -1 | 1) => {
      if (effectiveIndex < 0) return;
      const target = effectiveIndex + dir;
      if (target < 0 || target >= sheetNames.length) return;
      const next = [...sheetNames];
      [next[effectiveIndex], next[target]] = [next[target], next[effectiveIndex]];
      setSheetOpBusy(true);
      setSheetOpError(null);
      try {
        await reorderSheetsCall({
          template: templateName,
          ordered_sheet_names: next,
        });
        await mutateAdmin();
      } catch (e) {
        setSheetOpError(getFrappeError(e));
      } finally {
        setSheetOpBusy(false);
      }
    },
    [effectiveIndex, sheetNames, reorderSheetsCall, templateName, mutateAdmin]
  );

  async function triggerSeedUpload(file: File): Promise<void> {
    setSeedStatus("uploading");
    setSeedError(null);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      fd.append("is_template_source", "1");

      const res = await fetch(
        "/api/method/nirmaan_stack.api.boq.wizard.upload_file.upload_file",
        {
          method: "POST",
          headers: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            "X-Frappe-CSRF-Token": (window as any).frappe?.csrf_token ?? "",
          },
          body: fd,
        }
      );

      if (!res.ok) {
        setSeedError("Upload failed. Please try again.");
        setSeedStatus("error");
        return;
      }

      const json = (await res.json()) as { message?: { job_id?: string } };
      setSeedJobId(json?.message?.job_id ?? null);
      setSeedStatus("parsing");
    } catch {
      setSeedError("Upload failed. Check your connection and try again.");
      setSeedStatus("error");
    }
  }

  function onSeedFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    const ext = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
    if (!ACCEPTED_EXTS.has(ext)) {
      setSeedError(`"${ext}" is not supported. Please upload an .xlsx or .xlsm file.`);
      setSeedStatus("error");
      return;
    }
    void triggerSeedUpload(file);
  }

  const seeding = seedStatus === "uploading" || seedStatus === "parsing";

  const hiddenSeedInput = (
    <input
      ref={seedInputRef}
      type="file"
      accept=".xlsx,.xlsm"
      className="hidden"
      onChange={onSeedFileChange}
    />
  );

  const seedStatusBanner = seeding ? (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
      <Loader2 className="h-4 w-4 animate-spin text-primary" />
      <span className="text-foreground">
        {seedStatus === "uploading" ? "Uploading workbook..." : "Parsing workbook..."}
      </span>
    </div>
  ) : seedStatus === "error" && seedError ? (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
      <p className="font-medium text-destructive">Seeding failed</p>
      <p className="mt-1 text-muted-foreground">{seedError}</p>
      <button
        type="button"
        className="mt-2 text-sm text-primary underline-offset-4 hover:underline"
        onClick={() => {
          setSeedStatus("idle");
          setSeedError(null);
          setSeedJobId(null);
        }}
      >
        Dismiss
      </button>
    </div>
  ) : null;

  // ── Not authorized ─────────────────────────────────────────────────────────
  if (!isAuthorized) {
    return (
      <div className="flex-1 max-w-3xl mx-auto pt-6 pb-10">
        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <ShieldAlert className="h-6 w-6 text-destructive" />
            <div>
              <CardTitle className="text-base font-semibold">Not authorized</CardTitle>
              <CardDescription>
                BoQ Templates administration is restricted to Admin and Estimates roles.
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex-1 max-w-4xl mx-auto pt-6 pb-10">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading master template...
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 max-w-4xl mx-auto pt-6 pb-10">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">BoQ Templates</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage the single master template used by &ldquo;Create from template&rdquo;.
        </p>
      </div>

      {hiddenSeedInput}

      {!hasMaster ? (
        /* ── Empty state: no master configured ──────────────────────────── */
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">No master template yet</CardTitle>
            <CardDescription>
              Seed the master template from an authoring workbook. The workbook is uploaded
              as a project-less scratch BoQ you configure and commit, then promote to the
              master template.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {seedStatusBanner}
            <Button
              disabled={seeding}
              onClick={() => seedInputRef.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              Seed the master template from a workbook
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── Master template card ─────────────────────────────────────── */}
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div className="min-w-0">
                <CardTitle className="text-base font-semibold truncate">
                  {master?.template_name || master?.name}
                </CardTitle>
                <CardDescription>
                  {isActive
                    ? "Active -- offered in Create from template."
                    : "Inactive -- hidden from Create from template."}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Label htmlFor="template-active" className="text-sm text-muted-foreground">
                  {isActive ? "Active" : "Inactive"}
                </Label>
                <Switch
                  id="template-active"
                  checked={isActive}
                  disabled={togglingActive}
                  onCheckedChange={handleToggleActive}
                />
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              {/* Provenance */}
              <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Seeded from</dt>
                  <dd className="mt-0.5 text-foreground truncate">
                    {master?.seeded_from_boq || "--"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Seeded at</dt>
                  <dd className="mt-0.5 text-foreground">
                    {master?.seeded_at ? formatDate(master.seeded_at) : "--"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Last updated by</dt>
                  <dd className="mt-0.5 text-foreground truncate">
                    {master?.last_updated_by || "--"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Last updated on</dt>
                  <dd className="mt-0.5 text-foreground">
                    {master?.last_updated_on ? formatDate(master.last_updated_on) : "--"}
                  </dd>
                </div>
              </dl>

              {/* Sheets */}
              <div>
                <h3 className="mb-2 text-sm font-semibold text-foreground">
                  Sheets ({master?.sheets?.length ?? 0})
                </h3>
                <div className="overflow-x-auto rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">#</TableHead>
                        <TableHead>Sheet</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Rows</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(master?.sheets ?? []).length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={4}
                            className="text-center text-sm text-muted-foreground"
                          >
                            No sheets in this template.
                          </TableCell>
                        </TableRow>
                      ) : (
                        (master?.sheets ?? []).map((s) => (
                          <TableRow key={s.sheet_name}>
                            <TableCell className="text-muted-foreground tabular-nums">
                              {s.sheet_order}
                            </TableCell>
                            <TableCell className="font-medium text-foreground">
                              {(s.sheet_label || s.sheet_name)?.trim()}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  s.disposition === "general_specs" ? "secondary" : "outline"
                                }
                              >
                                {s.disposition === "general_specs"
                                  ? "General specs"
                                  : "Data"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-foreground">
                              {s.row_count ?? "--"}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Seed / re-seed */}
              <div className="space-y-3 border-t border-border pt-4">
                {seedStatusBanner}
                <Button
                  variant="outline"
                  disabled={seeding}
                  onClick={() => seedInputRef.current?.click()}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Seed / Re-seed from workbook
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* ── Template rows editor + sheet-level controls ──────────────── */}
          <Card>
            <CardHeader>
              <div className="flex flex-row items-center gap-3">
                <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
                <div>
                  <CardTitle className="text-base font-semibold">Template rows</CardTitle>
                  <CardDescription>
                    Edit the structure of each sheet in the master template.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Sheet toolbar */}
              <div className="flex flex-wrap items-center gap-2">
                {sheetNames.length > 0 ? (
                  <div className="flex items-center gap-1.5">
                    <Label
                      htmlFor="tpl-sheet-select"
                      className="text-sm text-muted-foreground"
                    >
                      Sheet
                    </Label>
                    <Select
                      value={effectiveSheet ?? undefined}
                      onValueChange={(v) => setSelectedSheet(v)}
                    >
                      <SelectTrigger id="tpl-sheet-select" className="h-8 w-[240px]">
                        <SelectValue placeholder="Select a sheet" />
                      </SelectTrigger>
                      <SelectContent>
                        {sortedSheets.map((s) => (
                          <SelectItem key={s.sheet_name} value={s.sheet_name}>
                            {(s.sheet_label || s.sheet_name)?.trim()}
                            {s.disposition === "general_specs"
                              ? " (General specs)"
                              : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    No sheets yet.
                  </span>
                )}

                {isTemplateAdmin && (
                  <div className="ml-auto flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2"
                      title="Move sheet earlier"
                      disabled={sheetOpBusy || effectiveIndex <= 0}
                      onClick={() => handleMoveSheet(-1)}
                    >
                      <ArrowUp className="h-4 w-4" />
                      <span className="sr-only">Move earlier</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2"
                      title="Move sheet later"
                      disabled={
                        sheetOpBusy ||
                        effectiveIndex < 0 ||
                        effectiveIndex >= sheetNames.length - 1
                      }
                      onClick={() => handleMoveSheet(1)}
                    >
                      <ArrowDown className="h-4 w-4" />
                      <span className="sr-only">Move later</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={sheetOpBusy}
                      onClick={() => {
                        setSheetOpError(null);
                        setAddSheetOpen(true);
                      }}
                    >
                      <Plus className="mr-1 h-4 w-4" />
                      Add sheet
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-destructive hover:text-destructive"
                      disabled={sheetOpBusy || !effectiveSheet}
                      onClick={() => {
                        setSheetOpError(null);
                        if (effectiveSheet) setRemoveSheetTarget(effectiveSheet);
                      }}
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      Remove sheet
                    </Button>
                  </div>
                )}
              </div>

              {sheetOpError && (
                <p className="text-sm text-destructive">{sheetOpError}</p>
              )}

              {effectiveSheet ? (
                <TemplateRowsEditor
                  template={templateName}
                  sheetName={effectiveSheet}
                  canEdit={isTemplateAdmin}
                />
              ) : (
                <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  Add a sheet to start building the template.
                </p>
              )}
            </CardContent>
          </Card>

          {/* ── Add sheet dialog ─────────────────────────────────────────── */}
          <Dialog
            open={addSheetOpen}
            onOpenChange={(o) => {
              if (!o && !sheetOpBusy) setAddSheetOpen(false);
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Add a sheet</DialogTitle>
                <DialogDescription>
                  A new blank sheet is appended to the master template. Build its
                  rows below once it is created.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="new-sheet-name">Sheet name</Label>
                  <Input
                    id="new-sheet-name"
                    value={newSheetName}
                    onChange={(e) => setNewSheetName(e.target.value)}
                    placeholder="e.g. Electrical"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-sheet-disp">Type</Label>
                  <Select
                    value={newSheetDisposition}
                    onValueChange={(v) =>
                      setNewSheetDisposition(v as "data" | "general_specs")
                    }
                  >
                    <SelectTrigger id="new-sheet-disp">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="data">Data</SelectItem>
                      <SelectItem value="general_specs">General specs</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {sheetOpError && (
                  <p className="text-sm text-destructive">{sheetOpError}</p>
                )}
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={sheetOpBusy}
                  onClick={() => setAddSheetOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="button" disabled={sheetOpBusy} onClick={handleAddSheet}>
                  {sheetOpBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Add sheet
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* ── Remove sheet confirm ─────────────────────────────────────── */}
          <AlertDialog
            open={!!removeSheetTarget}
            onOpenChange={(o) => {
              if (!o && !sheetOpBusy) setRemoveSheetTarget(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove this sheet?</AlertDialogTitle>
                <AlertDialogDescription>
                  {removeSheetTarget
                    ? `"${removeSheetTarget.trim()}" and all of its rows will be permanently removed from the master template.`
                    : ""}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {sheetOpError && (
                <p className="text-sm text-destructive">{sheetOpError}</p>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={sheetOpBusy}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={sheetOpBusy}
                  onClick={(e) => {
                    e.preventDefault();
                    void handleRemoveSheet();
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {sheetOpBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Remove sheet
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}

export { TemplateEditorPage as Component };
