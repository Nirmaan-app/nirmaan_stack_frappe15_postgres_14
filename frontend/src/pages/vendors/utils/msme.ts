import * as z from "zod";

import { parseJson } from "@/lib/parseJson";

/**
 * A vendor's MSME (Udyam) details (owner, 2026-11-19). Mirrors the server's
 * `services/vendor_msme.py`: change both together.
 *
 * `msme_id` is the Udyam Registration Number, UDYAM-<state>-<district>-<7 digits>.
 */
export const UDYAM_REGEX = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;
export const UDYAM_EXAMPLE = "UDYAM-UP-28-0012345";

/** Upper case, no spaces, plain dashes: "udyam - up-28 – 0012345" -> "UDYAM-UP-28-0012345". */
export const normalizeUdyam = (value?: string | null): string =>
  (value ?? "").replace(/[‐-―−]/g, "-").replace(/\s+/g, "").toUpperCase();

export const isValidUdyam = (value?: string | null): boolean => UDYAM_REGEX.test(value ?? "");

/** What Document AI read off the certificate, stored on the vendor as `autofill_all_entities_json`. */
export interface MsmeJson {
  udyam_registration_number?: string | null;
  enterprise_name?: string | null;
  enterprise_type?: string | null;
  major_activity?: string | null;
  date_of_udyam_registration?: string | null;
  date_of_incorporation?: string | null;
  file_url?: string | null;
  read_on?: string | null;
  model?: string | null;
}

const MSME_JSON_KEYS: ReadonlyArray<keyof MsmeJson> = [
  "udyam_registration_number", "enterprise_name", "enterprise_type", "major_activity",
  "date_of_udyam_registration", "date_of_incorporation", "file_url", "read_on", "model",
];

/** `Vendors.autofill_all_entities_json` as Frappe returns it (an object, or its JSON text); null when absent or unreadable. */
export const readMsmeJson = (value: unknown): MsmeJson | null => {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = parseJson(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: MsmeJson = {};
  for (const key of MSME_JSON_KEYS) {
    const v: unknown = Reflect.get(raw, key);
    if (typeof v === "string") out[key] = v;
  }
  return out;
};

/**
 * The vendor forms' MSME fields: the ID, when typed, must be a Udyam number. Whether ID and
 * certificate come as a pair is checked across fields by `refineMsmePair`.
 */
export const vendorMsmeSchemas = {
  msme_id: z
    .string()
    .transform((v) => normalizeUdyam(v))
    .refine((v) => v === "" || isValidUdyam(v), {
      message: `MSME ID must be a Udyam Registration Number, e.g. ${UDYAM_EXAMPLE}`,
    })
    .optional(),
  msme_attachment: z.string().optional(),
  autofill_all_entities_json: z.custom<MsmeJson | null>((v) => v === null || v === undefined || readMsmeJson(v) !== null).optional(),
};

export const MSME_NEEDS_CERTIFICATE = "Upload the MSME certificate for this MSME ID.";
export const MSME_NEEDS_ID = "Enter the MSME ID from the certificate.";

/**
 * MSME ID and certificate go together (owner, 2026-11-19): both or neither. Flags the missing one,
 * under its own field. Mirrors `Vendors._validate_msme` on the server.
 */
export const refineMsmePair = (
  values: { msme_id?: string; msme_attachment?: string },
  ctx: z.RefinementCtx
) => {
  const hasId = !!normalizeUdyam(values.msme_id);
  const hasCertificate = !!values.msme_attachment;
  if (hasId && !hasCertificate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["msme_attachment"], message: MSME_NEEDS_CERTIFICATE });
  }
  if (hasCertificate && !hasId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["msme_id"], message: MSME_NEEDS_ID });
  }
};

/**
 * What to send for the three fields on save: blanks become null so a cleared value is cleared. The
 * read data goes as JSON text: `autofill_all_entities_json` is Long Text, like the invoices' field.
 */
export const msmeValuesToSave = (values: {
  msme_id?: string;
  msme_attachment?: string;
  autofill_all_entities_json?: MsmeJson | null;
}) => ({
  msme_id: values.msme_id || null,
  msme_attachment: values.msme_attachment || null,
  autofill_all_entities_json:
    values.msme_attachment && values.autofill_all_entities_json ? JSON.stringify(values.autofill_all_entities_json) : null,
});
