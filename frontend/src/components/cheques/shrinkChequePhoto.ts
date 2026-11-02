import { jpgName, needsShrink, shrunkSize } from "@/utils/cheques/chequePhotoFile";

/**
 * The cheque photo as it is uploaded: a large image, or one of a type not every user may upload, redrawn as a
 * JPG (`utils/cheques/chequePhotoFile` says which and how big); anything else as picked. Throws when the browser
 * cannot open the image (a HEIC photo outside Safari), with a message to show.
 */
export const shrinkChequePhoto = async (file: File): Promise<File> => {
    if (!needsShrink(file)) return file;
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        throw new Error("This photo could not be opened. Save it as a JPG or PNG and upload it again.");
    }
    const { width, height } = shrunkSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This photo could not be prepared for upload. Try again.");
    // A transparent PNG would turn black as a JPG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("This photo could not be prepared for upload. Try again.");
    return new File([blob], jpgName(file.name), { type: "image/jpeg" });
};
