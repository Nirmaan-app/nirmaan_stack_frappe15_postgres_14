// src/utils/downloadPrintFormatPdf.ts
//
// Download a Frappe print format as a PDF file: any doctype, extra query-string
// params for the format's `frappe.form_dict`. Throws with the server's message
// when Frappe answers with an error instead of a PDF.

export interface PrintFormatPdfOptions {
  doctype: string;
  name: string;
  format: string;
  fileName: string;
  /** Read by the format as `frappe.form_dict.<key>`; empty values are skipped. */
  params?: Record<string, string | undefined>;
}

/**
 * Frappe answers a failed print with a JSON body, not a PDF. Without this check a
 * server-side error downloads as a .pdf nobody can open and the message is lost.
 */
async function assertPdfResponse(response: Response): Promise<void> {
  if (response.ok && !response.headers.get("content-type")?.includes("json")) return;

  let message = `PDF generation failed (${response.status}).`;
  try {
    const payload = await response.json();
    const serverMessages: string[] = JSON.parse(payload?._server_messages || "[]");
    const first = serverMessages.length ? JSON.parse(serverMessages[0])?.message : null;
    message = first || payload?.exc_type || payload?.message || message;
  } catch {
    // Body was not JSON after all — keep the status-code message.
  }
  throw new Error(message);
}

export async function downloadPrintFormatPdf({ doctype, name, format, fileName, params }: PrintFormatPdfOptions) {
  const query = new URLSearchParams({ doctype, name, format, no_letterhead: "1", _lang: "en" });
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value) query.append(key, value);
  });

  const response = await fetch(`/api/method/frappe.utils.print_format.download_pdf?${query.toString()}`);
  await assertPdfResponse(response);

  const url = window.URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", fileName.replace(/[/\\?%*:|"<>]/g, "-"));
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
