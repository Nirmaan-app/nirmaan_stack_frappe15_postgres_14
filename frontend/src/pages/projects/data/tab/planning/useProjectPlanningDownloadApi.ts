export interface ProjectPrintDownloadOptions {
  projectId: string;
  projectName?: string;
  formatName: string;
  startDate?: string;
  endDate?: string;
  zone?: string;
  filePrefix: string;
  extraParams?: Record<string, string>;
}

const buildDownloadUrl = ({
  projectId,
  formatName,
  startDate,
  endDate,
  zone,
  extraParams,
}: ProjectPrintDownloadOptions) => {
  const params = new URLSearchParams({
    doctype: "Projects",
    name: projectId,
    format: formatName,
    no_letterhead: "0",
    _lang: "en",
  });

  if (startDate) {
    params.append("start_date", startDate);
  }
  if (endDate) {
    params.append("end_date", endDate);
  }
  if (zone && zone !== "All") {
    params.append("zone", zone);
  }

  Object.entries(extraParams || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.append(key, value);
    }
  });

  return `/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`;
};

const sanitize = (value: string) => value.replace(/\s+/g, "_");

export const downloadProjectPrintFormatPdf = async (options: ProjectPrintDownloadOptions) => {
  const url = buildDownloadUrl(options);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Network response was not ok");
  }

  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;

  const baseName = sanitize(options.projectName || options.projectId);
  const zoneSuffix = options.zone && options.zone !== "All" ? `_${sanitize(options.zone)}` : "";
  const timestamp = new Date().toISOString().slice(0, 10);
  link.download = `${options.filePrefix}_${baseName}${zoneSuffix}_${timestamp}.pdf`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(downloadUrl);
};
