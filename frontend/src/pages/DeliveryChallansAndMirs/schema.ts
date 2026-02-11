import { z } from "zod";

/**
 * Schema for a single DC/MIR item row in the upload form.
 * The `selected` field is UI-only (checkbox state).
 */
export const dcItemSchema = z.object({
  item_id: z.string(),
  item_name: z.string(),
  unit: z.string(),
  category: z.string().optional(),
  quantity: z.number().min(0, "Quantity must be >= 0"),
  make: z.string().optional(),
  selected: z.boolean().default(false),
});

export type DCItemFormValues = z.infer<typeof dcItemSchema>;

/**
 * Schema for the Upload DC/MIR form.
 * Validates reference number (required), optional date, items array,
 * and conditional client representative name.
 */
export const uploadDCMIRSchema = z
  .object({
    referenceNumber: z.string().min(1, "Reference number is required"),
    dcReference: z.string().optional(),
    dcDate: z.string().optional(),
    items: z.array(dcItemSchema),
    isSignedByClient: z.boolean().default(false),
    clientRepresentativeName: z.string().optional(),
  })
  .refine(
    (data) => {
      // At least one item must be selected with quantity > 0
      const hasSelectedItems = data.items.some(
        (item) => item.selected && item.quantity > 0
      );
      return hasSelectedItems;
    },
    {
      message: "Select at least one item with quantity > 0",
      path: ["items"],
    }
  )
  .refine(
    (data) => {
      // Client representative name required when signed
      if (data.isSignedByClient) {
        return (
          !!data.clientRepresentativeName &&
          data.clientRepresentativeName.trim().length > 0
        );
      }
      return true;
    },
    {
      message: "Client representative name is required when signed",
      path: ["clientRepresentativeName"],
    }
  );

export type UploadDCMIRFormValues = z.infer<typeof uploadDCMIRSchema>;
