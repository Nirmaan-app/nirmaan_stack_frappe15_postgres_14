// The six handover documents that already live elsewhere in Nirmaan, shown READ-ONLY: HOD never
// writes to the Commission Report, TDS, Snag List or Design Tracker. Records are fixed there.
//
// The user TICKS which records go into the download (owner 2026-09-22: "sometimes they don't need all five"):
// Commission reports, TDS data sheets, snag batches (each prints as its own snag list) and As Built drawings
// (downloaded from their Google Drive links). The ticks are saved on the row (`form_data.selected`) so the
// binder takes the same ones; with nothing saved, every available record is ticked.

import { Download, ExternalLink, Eye, Loader2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ReportPreviewDialog } from "@/pages/CommissionReport/components/ReportPreviewDialog";

import { useFromAppSources } from "../hodApi";
import { formatDate } from "@/utils/FormatDate";

import {
  commissionReportPdfUrl,
  hodPdfFilename,
  saveUrlAs,
  snagBatchPdfUrl,
  usePdfDownload,
} from "../hodDownloads";
import { asStringList } from "../hodRules";
import type {
  HodCommissionTask,
  HodDesignTask,
  HodDocumentMeta,
  HodRow,
  HodSnagBatch,
  HodTdsItem,
} from "../types";

const th =
  "border-b bg-gray-50 px-2 py-1.5 text-left text-xs font-semibold text-gray-600";
const td = "border-b px-2 py-1.5 text-sm text-gray-700";

const FileLink: React.FC<{ url: string | null; label?: string }> = ({
  url,
  label = "Open",
}) =>
  url ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-blue-600 hover:underline"
    >
      {label} <ExternalLink className="h-3 w-3" />
    </a>
  ) : (
    <span className="text-gray-400">—</span>
  );

/** What View / Download open for one Commission task: the signed copy, else the filled report printed with
 *  the Commission format, else the uploaded report file (the binder's own order). */
interface ReportTarget {
  label: string;
  url: string;
  /** A stored file (shown / saved as it is) rather than a report rendered on request. */
  direct: boolean;
}

function reportTarget(t: HodCommissionTask): ReportTarget | null {
  if (t.approval_proof)
    return { label: "Signed copy", url: t.approval_proof, direct: true };
  if (t.has_report)
    return {
      label: "Filled report",
      url: commissionReportPdfUrl(t.parent, t.name, t.print_format),
      direct: false,
    };
  if (t.file_link)
    return { label: "Uploaded file", url: t.file_link, direct: true };
  return null;
}

const WHERE: Record<string, string> = {
  commission: "the project's Commission Report",
  tds: "the project's TDS list",
  snag: "the project's Snag List",
  design: "the Design Tracker (Handover phase)",
};

export interface SourcesViewProps {
  projectId: string;
  hodSystem: string;
  meta: HodDocumentMeta;
  row: HodRow;
  canEdit: boolean;
  /** Save the ticked records on the row and download them as one PDF. */
  onDownloadSelected: (selected: string[]) => Promise<void>;
}

export const SourcesView: React.FC<SourcesViewProps> = ({
  projectId,
  hodSystem,
  meta,
  row,
  canEdit,
  onDownloadSelected,
}) => {
  const { sources, isLoading, error } = useFromAppSources(
    projectId,
    hodSystem,
    meta.key,
    true,
  );
  const { busyKey, download } = usePdfDownload();
  const [preview, setPreview] = React.useState<{
    target: ReportTarget;
    title: string;
    fileName: string;
  } | null>(null);
  const [ticked, setTicked] = React.useState<Set<string> | null>(null);
  const [starting, setStarting] = React.useState(false);

  const items = sources?.items ?? [];
  // Every From Nirmaan document is picked record by record (owner 2026-09-22).
  const selectable = true;
  const NOUNS: Record<string, string> = {
    commission: "report",
    tds: "data sheet",
    snag: "snag list",
    design: "drawing",
  };
  const noun = NOUNS[meta.source ?? ""] ?? "record";
  // Only records that have something to download can be ticked.
  const available = React.useMemo(
    () =>
      items
        .filter((t) => {
          if (meta.source === "commission")
            return reportTarget(t as HodCommissionTask) !== null;
          if (meta.source === "tds") return !!(t as HodTdsItem).tds_attachment;
          if (meta.source === "design")
            return !!(t as HodDesignTask).download_url;
          return (t as HodSnagBatch).count > 0;
        })
        .map((t) => t.name),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sources, meta.source],
  );
  const saved = asStringList(row.form_data?.selected);
  const current =
    ticked ??
    new Set(saved ? saved.filter((n) => available.includes(n)) : available);
  const toggle = (name: string, on: boolean) => {
    const next = new Set(current);
    if (on) next.add(name);
    else next.delete(name);
    setTicked(next);
  };
  const allOn = available.length > 0 && available.every((n) => current.has(n));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-sm text-gray-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading records…
      </div>
    );
  }
  if (error || !sources) {
    return (
      <p className="py-6 text-center text-sm text-red-600">
        Could not load the records.
      </p>
    );
  }

  const note = (
    <p className="text-xs text-gray-500">
      Read from {WHERE[meta.source ?? ""] ?? "Nirmaan"}. Changes are made there.
    </p>
  );

  if (!items.length) {
    return (
      <div className="space-y-2">
        <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-gray-500">
          Nothing is recorded for this system yet.
        </p>
        {note}
      </div>
    );
  }

  const tickCell = (name: string) => (
    <td className={`${td} w-8`}>
      <Checkbox
        checked={current.has(name)}
        disabled={!available.includes(name) || starting || !canEdit}
        onCheckedChange={(c) => toggle(name, c === true)}
        aria-label="Include in the download"
      />
    </td>
  );
  const tickHead = (
    <th className={`${th} w-8`}>
      <Checkbox
        checked={allOn}
        disabled={!available.length || starting || !canEdit}
        onCheckedChange={(c) => setTicked(new Set(c === true ? available : []))}
        aria-label="Select all"
      />
    </th>
  );

  return (
    <div className="space-y-2">
      <div className="max-h-[55vh] overflow-auto rounded-md border">
        <table className="w-full border-collapse">
          {meta.source === "commission" && (
            <>
              <thead className="sticky top-0">
                <tr>
                  {tickHead}
                  <th className={`${th} w-10`}>#</th>
                  <th className={th}>Report</th>
                  <th className={th}>Category</th>
                  <th className={th}>Status</th>
                  <th className={th}>Open</th>
                </tr>
              </thead>
              <tbody>
                {(items as HodCommissionTask[]).map((t, i) => {
                  const target = reportTarget(t);
                  const fileName = hodPdfFilename(
                    t.task_name,
                    target?.label ?? "",
                  );
                  const key = `report:${t.name}`;
                  return (
                    <tr key={t.name}>
                      {tickCell(t.name)}
                      <td className={td}>{i + 1}</td>
                      <td className={td}>{t.task_name}</td>
                      <td className={td}>{t.commission_category}</td>
                      <td className={td}>{t.task_status || "Pending"}</td>
                      <td className={td}>
                        {target ? (
                          <div className="flex items-center gap-1">
                            <span className="mr-1 text-xs text-green-700">
                              {target.label}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() =>
                                setPreview({
                                  target,
                                  title: t.task_name,
                                  fileName,
                                })
                              }
                            >
                              <Eye className="mr-1 h-3.5 w-3.5" /> View
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="Download this report"
                              disabled={busyKey === key}
                              onClick={() =>
                                target.direct
                                  ? saveUrlAs(target.url, fileName)
                                  : download(key, target.url, fileName)
                              }
                            >
                              {busyKey === key ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Download className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </div>
                        ) : (
                          <span className="text-gray-400">Not filled yet</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </>
          )}
          {meta.source === "tds" && (
            <>
              <thead className="sticky top-0">
                <tr>
                  {tickHead}
                  <th className={`${th} w-10`}>#</th>
                  <th className={th}>Item</th>
                  <th className={th}>Make</th>
                  <th className={th}>Category</th>
                  <th className={th}>Status</th>
                  <th className={th}>Sheet</th>
                </tr>
              </thead>
              <tbody>
                {(items as HodTdsItem[]).map((t, i) => (
                  <tr key={t.name}>
                    {tickCell(t.name)}
                    <td className={td}>{i + 1}</td>
                    <td className={td}>{t.tds_item_name}</td>
                    <td className={td}>{t.tds_make || "—"}</td>
                    <td className={td}>{t.tds_category || "—"}</td>
                    <td className={td}>{t.tds_status || "—"}</td>
                    <td className={td}>
                      <FileLink url={t.tds_attachment} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
          {meta.source === "snag" && (
            <>
              <thead className="sticky top-0">
                <tr>
                  {tickHead}
                  <th className={`${th} w-10`}>#</th>
                  <th className={th}>Snag list</th>
                  <th className={th}>Uploaded</th>
                  <th className={th}>Completed snags</th>
                  <th className={th}>Open</th>
                </tr>
              </thead>
              <tbody>
                {(items as HodSnagBatch[]).map((b, i) => {
                  const url = snagBatchPdfUrl(projectId, b.name);
                  const fileName = hodPdfFilename("Snag_List", b.batch_name);
                  const key = `snag:${b.name}`;
                  return (
                    <tr key={b.name}>
                      {tickCell(b.name)}
                      <td className={td}>{i + 1}</td>
                      <td className={td}>{b.batch_name}</td>
                      <td className={td}>
                        {b.uploaded_on ? formatDate(b.uploaded_on) : "—"}
                      </td>
                      <td className={td}>
                        {b.count}
                        {b.total > b.count && (
                          <span className="text-xs text-gray-500">
                            {" "}
                            of {b.total}
                          </span>
                        )}
                      </td>
                      <td className={td}>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() =>
                              setPreview({
                                target: {
                                  label: "Snag list",
                                  url,
                                  direct: false,
                                },
                                title: b.batch_name,
                                fileName,
                              })
                            }
                          >
                            <Eye className="mr-1 h-3.5 w-3.5" /> View
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Download this snag list"
                            disabled={busyKey === key}
                            onClick={() => download(key, url, fileName)}
                          >
                            {busyKey === key ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Download className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </>
          )}
          {meta.source === "design" && (
            <>
              <thead className="sticky top-0">
                <tr>
                  {tickHead}
                  <th className={`${th} w-10`}>#</th>
                  <th className={th}>Drawing</th>
                  <th className={th}>Category</th>
                  <th className={th}>Zone</th>
                  <th className={th}>Status</th>
                  <th className={th}>Open</th>
                </tr>
              </thead>
              <tbody>
                {(items as HodDesignTask[]).map((t, i) => (
                  <tr key={t.name}>
                    {tickCell(t.name)}
                    <td className={td}>{i + 1}</td>
                    <td className={td}>{t.task_name}</td>
                    <td className={td}>{t.design_category}</td>
                    <td className={td}>{t.task_zone || "—"}</td>
                    <td className={td}>{t.task_status || "Pending"}</td>
                    <td className={td}>
                      {t.download_url ? (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            asChild
                          >
                            <a
                              href={t.file_link ?? t.download_url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Eye className="mr-1 h-3.5 w-3.5" /> View
                            </a>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Download this drawing"
                            onClick={() =>
                              saveUrlAs(
                                t.download_url as string,
                                hodPdfFilename(t.task_name),
                              )
                            }
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : t.file_link ? (
                        <span className="text-xs text-gray-500">
                          <FileLink url={t.file_link} label="Link only" />
                        </span>
                      ) : (
                        <span className="text-gray-400">No drawing yet</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
        </table>
      </div>

      {selectable && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-gray-50 px-3 py-2">
          <span className="text-xs text-gray-600">
            {current.size} of {available.length} {noun}
            {available.length !== 1 ? "s" : ""} ticked — the ticked ones go into
            the download and the binder.
          </span>
          <Button
            size="sm"
            className="h-8"
            disabled={!current.size || starting}
            onClick={async () => {
              setStarting(true);
              try {
                await onDownloadSelected(
                  available.filter((n) => current.has(n)),
                );
              } finally {
                setStarting(false);
              }
            }}
          >
            {starting ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1 h-3.5 w-3.5" />
            )}
            Download selected ({current.size})
          </Button>
        </div>
      )}
      {note}
      {preview && (
        <ReportPreviewDialog
          open
          onOpenChange={(o) => !o && setPreview(null)}
          pdfUrl={preview.target.url}
          directSrc={preview.target.direct}
          title={preview.title}
          fileName={preview.fileName}
          canDownload
        />
      )}
    </div>
  );
};
