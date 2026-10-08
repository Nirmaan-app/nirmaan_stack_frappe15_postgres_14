/**
 * Turning a picked or captured image into a snag photo DRAFT: shrink it, and work out where it
 * was TAKEN. Browser-only (canvas, fetch). The location rules themselves are pure, in
 * `@/utils/snagPhoto`.
 *
 * WHERE THE LOCATION COMES FROM (owner 2026-10-08):
 *  - Take photo -> the device GPS at the moment of capture (DPR `CameraCapture`), behind DPR's
 *    camera + location permission steps (`usePermissionCheck`);
 *  - Upload     -> NO location. The owner dropped reading GPS out of the file (no `exifr`), and
 *    the device's position at upload time is never used: whoever uploads from the office would
 *    send the Directions link to the office.
 */

import { usableLocation } from "@/utils/snagPhoto";

/** Longest side of the stored photo. Plenty for a hover preview and a full-size view. */
const MAX_PX = 1600;
const JPEG_QUALITY = 0.82;

export type SnagPhotoSource = "camera" | "upload";

/** A photo chosen in a dialog and not yet uploaded — it uploads only on Save. */
export interface SnagPhotoDraft {
  file: File;
  /** An object URL for the dialog preview. Revoked by the field that created it. */
  previewUrl: string;
  /** DPR format, or null when where-it-was-taken is unknown. */
  location: string | null;
  source: SnagPhotoSource;
}

/**
 * Re-encode as a JPEG no longer than MAX_PX. Throws a readable error for a format the browser
 * cannot decode (an iPhone HEIC outside Safari), so the dialog can say so instead of storing a
 * photo that neither the table nor the PDF could show.
 */
export async function compressImage(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(
      "This image format can't be read here. Use a JPG or PNG, or take the photo with the camera."
    );
  }
  const scale = Math.min(1, MAX_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );
  if (!blob) throw new Error("The photo could not be prepared for upload.");
  const base = file.name.replace(/\.[^.]+$/, "") || "snag-photo";
  return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
}

/** An uploaded file -> a draft. It carries NO location (see the header). */
export async function draftFromUpload(file: File): Promise<SnagPhotoDraft> {
  const compressed = await compressImage(file);
  return {
    file: compressed,
    previewUrl: URL.createObjectURL(compressed),
    location: null,
    source: "upload",
  };
}

/**
 * A camera capture -> a draft. `CameraCapture` already geocoded it at capture time; its failure
 * strings ("Location Not Found (Error)") carry no coordinates and are dropped.
 */
export async function draftFromCamera(file: File, location: string | null): Promise<SnagPhotoDraft> {
  const compressed = await compressImage(file);
  return {
    file: compressed,
    previewUrl: URL.createObjectURL(compressed),
    location: usableLocation(location),
    source: "camera",
  };
}
