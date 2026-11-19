import { collectResultFile } from "@/hooks/useBackgroundOperation";
import { readTdsExport } from "@/utils/tds/tdsExport";
import { saveBlobAs } from "@/utils/saveUrlAs";

/** A generated PDF held in memory for the in-app preview, never saved. Its holder revokes `blobUrl` on close. */
export interface TdsPdfPreview {
  blobUrl: string;
  filename: string;
  sizeBytes: number;
}

/**
 * Hand over a finished TDS export's PDF, for the TDS Repository tab and the Handover Documents tab alike: collect
 * it by operation id, then hold it for the preview when the start asked for one (`preview`), else save it now
 * (`preview` is null). Rejects with the server's words when the file cannot be collected.
 */
export async function deliverTdsExport(
  opId: string,
  result: unknown,
  context: unknown,
): Promise<{ preview: TdsPdfPreview | null; failedItems: string[] }> {
  const { previewOnly, filename, failedItems } = readTdsExport(result, context);
  const blob = await collectResultFile(opId);
  if (previewOnly) {
    return { preview: { blobUrl: window.URL.createObjectURL(blob), filename, sizeBytes: blob.size }, failedItems };
  }
  saveBlobAs(blob, filename);
  return { preview: null, failedItems };
}
