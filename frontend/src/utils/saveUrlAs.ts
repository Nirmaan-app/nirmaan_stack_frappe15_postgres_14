/** Have the browser save what a URL serves (a blob URL, or a same-origin download) as `filename`. */
export function saveUrlAs(url: string, filename: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
}
