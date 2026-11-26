/**
 * VAV-2c1 -- SMALL WORDINGS WORKED OUT FROM LIVE VALUES (R1 sentence 8, R6 b, R7 6.4). PURE, no category named.
 *
 * Owner 2026-11-21 23:22 "the users xan edit the 0.25 number in future ... so the text should get automatically updated of the inlut
 * changes"; 2026-11-22 12:47 "a": the stored text says only what the number is, and the screen works out the plain reading from the
 * current value wherever the input is shown.
 */

/** A number as a person writes it: 0.25 -> "0.25", 1 -> "1" (never 0.30000000000000004). */
const num = (n: number) => String(Math.round(n * 1e6) / 1e6);
export const percentOf = (n: number) => `${num(n * 100)}%`;

/** "half the installation rate" / "the installation rate" / "40% of the installation rate" / "1.5 times the installation rate". An input
 *  that is not set reads "-" (the row then refuses with its own line). */
export function rateShareWords(factor: number | null): string {
  if (factor === null || !Number.isFinite(factor)) return "-";
  if (factor === 0.5) return "half the installation rate";
  if (factor === 1) return "the installation rate";
  return factor < 1 ? `${percentOf(factor)} of the installation rate` : `${num(factor)} times the installation rate`;
}

/**
 * The plain reading of a Pricing Input beside its value, worked out from the value and its unit text: a share reads as a percentage
 * ("share of the final install", 0.25 -> "25%"), a multiple of the installation rate as words ("x 0.5 = half the installation rate"); a
 * plain unit ("mm", "Nos") says nothing more than the value with its unit -> null.
 */
export function pricingInputReading(unit: unknown, value: unknown): string | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  const u = String(unit ?? "").trim().toLowerCase();
  if (u.startsWith("share of ")) return percentOf(n);
  if (u === "x the installation rate") return `x ${num(n)} = ${rateShareWords(n)}`;
  return null;
}

/** R1 sentence 4: a row named at the start of a sentence starts it with a capital ("... added. Row 40 also prices it"). */
export const rowsStart = (s: string): string => s.split(". row").join(". Row");

/** R1 sentence 8 / the pick's note: the helper's scope and its reason put in; a reason that ends its own sentence keeps ONE full stop. */
export function panelPickLead(note: string, helper: string, because: string): string {
  return note.replace("{helper}", helper).replace("{because}.", `${because.replace(/\.\s*$/, "")}.`).replace("{because}", because);
}
