/**
 * The snag photo's location: how it is written, read back, and linked to Google Maps.
 *
 * One photo per snag (owner 2026-10-08). `Project Snag.location` holds it in the DPR
 * `CameraCapture` format: `"<address> (Lat: 12.9716, Lon: 77.5946)"`.
 *
 * The only parser: the PDF's Map link was removed (owner 2026-10-08), and with it the Python copy
 * in `nirmaan_stack/services/snag_photo.py`.
 */

/** "(Lat: x, Lon: y)" at the end of the string, as DPR's `CameraCapture` writes it. */
const LAT_LON = /\(\s*Lat:\s*(-?\d+(?:\.\d+)?)\s*,\s*Lon:\s*(-?\d+(?:\.\d+)?)\s*\)\s*$/;

const DIRECTIONS = "https://www.google.com/maps/dir/?api=1&destination=";

export interface SnagPhotoCoordinates {
  lat: number;
  lon: number;
}

/** The coordinates in a stored location, or null when it carries none. */
export function parseCoordinates(location: string | null | undefined): SnagPhotoCoordinates | null {
  const match = LAT_LON.exec(location ?? "");
  if (!match) return null;
  return { lat: Number(match[1]), lon: Number(match[2]) };
}

/** The address part of a stored location: everything before "(Lat: …)". */
export function locationAddress(location: string | null | undefined): string {
  return (location ?? "").replace(LAT_LON, "").trim();
}

/**
 * Google Maps directions to where the photo was taken, or null when there is no location.
 * The coordinates win when there are any; an address alone can land mid-street.
 */
export function directionsUrl(location: string | null | undefined): string | null {
  const text = (location ?? "").trim();
  if (!text) return null;
  const coords = parseCoordinates(text);
  const destination = coords ? `${coords.lat},${coords.lon}` : text;
  return DIRECTIONS + encodeURIComponent(destination).replace(/%2C/gi, ",");
}

/**
 * Keep a location only when it says WHERE: a string with real coordinates. DPR's camera
 * writes "Location Not Found (Error)" when GPS fails, and that must not be stored as the
 * photo's location (owner Q7b: no location is better than a wrong one).
 */
export function usableLocation(location: string | null | undefined): string | null {
  const coords = parseCoordinates(location);
  if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lon)) return null;
  if (coords.lat === 0 && coords.lon === 0) return null;
  return (location ?? "").trim();
}
