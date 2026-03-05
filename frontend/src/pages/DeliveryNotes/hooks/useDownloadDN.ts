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
    async (deliveryDate?: string) => {
      if (!poId) {
        toast({
          title: "Error",
          description: "PO ID is missing",
          variant: "destructive",
        });
        return;
      }

      const isSpecificDate = !!deliveryDate;
      const description = isSpecificDate
        ? `Downloading note for ${formatDate(deliveryDate)}...`
        : "Downloading overall delivery note...";

      try {
        toast({ title: "Generating PDF", description });

        const formatName = "PO Delivery Histroy"; // Backend print format name (has typo)
        let printUrl = `/api/method/frappe.utils.print_format.download_pdf?doctype=Procurement%20Orders&name=${poId}&format=${encodeURIComponent(formatName)}&no_letterhead=0`;

        if (isSpecificDate) {
          printUrl += `&delivery_date=${encodeURIComponent(deliveryDate)}`;
        }

        const response = await fetch(printUrl);
        if (!response.ok) throw new Error("Failed to generate PDF");

        const blob = await response.blob();

        const fileName = isSpecificDate
          ? `${poId}_Delivery_${deliveryDate}.pdf`
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
