/**
 * downloadBlob -- decode a base64 payload to bytes + trigger a browser download.
 *
 * The 5a Excel write-back endpoint (export_priced_workbook) returns the stamped .xlsx as
 * base64-in-JSON (the file-only frappe.response.filecontent idiom cannot also carry the
 * skipped-formula report). The frontend decodes it here and downloads via the SAME
 * Blob -> createObjectURL -> anchor.click -> revokeObjectURL tail exportReviewXlsx uses.
 */

/**
 * Decode a base64 string to a Uint8Array. PURE (atob only) -- unit-tested. Throws on
 * malformed input (atob raises), which the caller surfaces as an inline error.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Trigger a browser download of raw bytes under `filename`. DOM-side (createObjectURL +
 * anchor click + revoke) -- not unit-runnable headless; owner-certified live. Mirrors
 * exportReviewXlsx's download tail.
 */
export function downloadBytes(bytes: Uint8Array, filename: string, contentType: string): void {
  const blob = new Blob([bytes], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
