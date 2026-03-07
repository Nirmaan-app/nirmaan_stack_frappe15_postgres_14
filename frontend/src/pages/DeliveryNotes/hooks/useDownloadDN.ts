import { useCallback } from "react";
import { useToast } from "@/components/ui/use-toast";
import { formatDate } from "@/utils/FormatDate";

/**
 * Hook for downloading Delivery Note PDFs via Frappe's print format API.
 * Consolidates the duplicated download logic from DeliveryHistory and deliverynote.
 */
export function useDownloadDN(poId?: string) {
  const { toast } = useToast();

  const downloadDN = useCallback(
    async (deliveryDate?: string, noteNo?: string | number) => {
      if (!poId) {
        toast({
          title: "Error",
          description: "PO ID is missing",
          variant: "destructive",
        });
        return;
      }

      const isSpecificNote = !!deliveryDate && !!noteNo;
      const description = isSpecificNote
        ? `Downloading note DN-${noteNo} for ${formatDate(deliveryDate)}...`
        : "Downloading overall delivery note...";

      try {
        toast({ title: "Generating PDF", description });

        const formatName = "PO Delivery Histroy"; // Backend print format name (has typo)
        let printUrl = `/api/method/frappe.utils.print_format.download_pdf?doctype=Procurement%20Orders&name=${poId}&format=${encodeURIComponent(formatName)}&no_letterhead=0`;

        if (deliveryDate) {
          printUrl += `&delivery_date=${encodeURIComponent(deliveryDate)}`;
        }
        if (noteNo) {
          printUrl += `&note_no=${encodeURIComponent(noteNo.toString())}`;
        }

        const response = await fetch(printUrl);
        if (!response.ok) throw new Error("Failed to generate PDF");

        const blob = await response.blob();

        const fileName = isSpecificNote
          ? `${poId}_DN_${noteNo}_${deliveryDate}.pdf`
          : `${poId}_Delivery_Overall.pdf`;

        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", fileName);
        document.body.appendChild(link);
        link.click();

        link.remove();
        window.URL.revokeObjectURL(url);

        toast({
          title: "Success",
          description: "Delivery note downloaded.",
        });
      } catch (error) {
        console.error("Download error:", error);
        toast({
          title: "Error",
          description: "Failed to download delivery note.",
          variant: "destructive",
        });
      }
    },
    [poId, toast]
  );

  return { downloadDN };
}
