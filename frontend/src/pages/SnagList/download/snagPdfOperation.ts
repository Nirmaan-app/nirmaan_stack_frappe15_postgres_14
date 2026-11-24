// frontend/src/pages/SnagList/download/snagPdfOperation.ts
//
// A Snag List PDF as a background operation (#1669, ADR 0047): `start_snag_pdf` starts it through
// `services/background_ops`, `useSnagDownload` follows it with `useBackgroundOperation`, and this reads what its
// view means for the "Generating PDF..." toast. Pure, so it is tested without a screen.

import { isRecord, type OpView } from "@/utils/backgroundOps/operationFollower";

/** What the toast says while the operation is under way. `detail` counts renders (`snag_pdf_op`'s progress). */
export function snagPdfProgressText(view: OpView): string {
  if (view.phase === "queued") return "Waiting for the server to start on it...";
  const detail = view.phase === "running" ? view.progress?.detail : undefined;
  const done = typeof detail?.done === "number" ? detail.done : 0;
  const total = typeof detail?.total === "number" ? detail.total : 0;
  if (total > 1) return `Built ${done} of ${total} sections...`;
  return "Building the PDF...";
}

/** What a download started with, kept as the operation's context (JSON) so a reload still names its file. */
export interface SnagPdfContext {
  label: string;
  isSummary: boolean;
}

export function snagPdfContextOf(context: unknown): SnagPdfContext | null {
  return isRecord(context) && typeof context.label === "string" && typeof context.isSummary === "boolean"
    ? { label: context.label, isSummary: context.isSummary }
    : null;
}
