import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FrappeConfig,
  FrappeContext,
  useFrappeGetCall,
  useFrappePostCall,
} from "frappe-react-sdk";
import {
  FileSpreadsheet,
  Loader2,
  ShieldAlert,
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

          {/* ── Per-row editor placeholder (later slice) ─────────────────── */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-3">
              <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-base font-semibold">Template rows</CardTitle>
                <CardDescription>
                  Per-row editing coming in the next slice.
                </CardDescription>
              </div>
            </CardHeader>
          </Card>
        </>
      )}
    </div>
  );
}

export { TemplateEditorPage as Component };
