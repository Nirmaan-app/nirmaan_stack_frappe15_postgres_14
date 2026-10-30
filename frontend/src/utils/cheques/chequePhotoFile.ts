/**
 * What a cheque photo goes through before it is uploaded, pure so vitest covers it without a browser (F4).
 *
 * A phone camera's photo is often 3-12 MB. The picker used to drop anything over its 5 MB default without a
 * word, so photos never uploaded while small PDFs did. Now the picker takes up to `CHEQUE_PHOTO_PICK_LIMIT`, and
 * an image that is large, or of a type Frappe refuses for website users (`frappe.handler.ALLOWED_MIMETYPES`:
 * JPG, PNG, GIF), is redrawn as a JPG no wider or taller than `CHEQUE_PHOTO_MAX_SIDE` before upload
 * (`components/cheques/shrinkChequePhoto.ts`). A PDF is uploaded as it is; the server refuses one over 10 MB.
 */

/** What the picker accepts at all; a bigger file is refused with a message. */
export const CHEQUE_PHOTO_PICK_LIMIT = 25 * 1024 * 1024;
/** An image at or under this size, and of a type every user may upload, goes up unchanged. */
export const CHEQUE_PHOTO_KEEP_UNDER = 2 * 1024 * 1024;
/** The longest side of a redrawn photo, in pixels: the cheque's number and amount stay readable. */
export const CHEQUE_PHOTO_MAX_SIDE = 2400;
/** The image types Frappe lets every user upload (`frappe.handler.ALLOWED_MIMETYPES`). */
const UPLOADABLE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif"];

const MB = 1024 * 1024;

/** Whether the photo is redrawn as a JPG before upload: a large image, or one of a type not every user may upload. */
export const needsShrink = (file: { type: string; size: number }): boolean =>
    file.type.startsWith("image/") && (file.size > CHEQUE_PHOTO_KEEP_UNDER || !UPLOADABLE_IMAGE_TYPES.includes(file.type));

/** The redrawn photo's size: the longest side at most `maxSide`, never enlarged. */
export const shrunkSize = (width: number, height: number, maxSide = CHEQUE_PHOTO_MAX_SIDE) => {
    const scale = Math.min(1, maxSide / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
};

/** The redrawn photo's file name: the same name, ending in .jpg. */
export const jpgName = (name: string): string => `${name.replace(/\.[^./\\]+$/, "") || "cheque-photo"}.jpg`;

/** The message when the picker refuses a file (`CustomAttachment`'s `onError`). */
export const pickRefusal = (error: { type: "size" | "type" }): string =>
    error.type === "size"
        ? `The file is over ${CHEQUE_PHOTO_PICK_LIMIT / MB} MB. Upload a smaller photo of the cheque.`
        : "This file type cannot be read. Upload the cheque as a JPG, PNG or PDF.";
