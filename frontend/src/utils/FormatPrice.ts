import { parseNumber } from "./parseNumber";

function formatToIndianRupee(price: number | string | undefined) {
  // Ensure the price is a number before formatting
  const amount = parseNumber(price);

  if (isNaN(amount) || !amount) {
    return "--";
  }

  // Convert the number to Indian currency format
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}


/** `formatToIndianRupee`, but a zero reads "₹0.00" rather than "--": for a figure that is really 0. */
export const formatToIndianRupeeOrZero = (price: number | string | undefined) =>
  parseNumber(price) ? formatToIndianRupee(price) : "₹0.00";

/**
 * A rupee figure rounded to the NEAREST rupee (#1543, owner ruling Q30-A): ₹3,061.22 reads ₹3,061 and a
 * ₹0.30 Due reads ₹0, so a fully paid order never shows ₹1 due. Half a rupee rounds away from zero, so an
 * overpaid -₹120.50 reads -₹121 as ₹120.50 reads ₹121, and a figure that rounds to nothing is 0, never -0.
 * ⚠️ NEVER `Math.ceil`: it was, and it turned every paisa into a rupee.
 */
export const roundToRupee = (amount: number): number => (Math.sign(amount) * Math.round(Math.abs(amount))) || 0;

export const formatToRoundedIndianRupee = (price: number | string | undefined) => {
  const amount = parseNumber(price);

  if (isNaN(amount)) {
    return "--";
  }

  return `₹${roundToRupee(amount).toLocaleString('en-IN')}`;
}

/** The same rounded figure as a number, for a report's export column. */
export const formatForReport = (price: number | string | undefined) => {
  const amount = parseNumber(price);

  if (isNaN(amount)) {
    return "--";
  }

  return roundToRupee(amount);
}

/**
 * Formats a value to lakhs with intelligent rounding
 * Uses Math.round for natural rounding behavior
 * For fractional lakhs < 0.5, floors down; >= 0.5, ceils up
 */
export const formatToApproxLakhs = (amount: number | string | undefined): string => {
  const value = parseNumber(amount);

  if (isNaN(value)) {
    return "--";
  }

  if (value === 0) {
    return "₹0 L";
  }

  // Convert to lakhs
  const lakhs = value / 100000;

  // Use Math.round for natural rounding (< 0.5 floors, >= 0.5 ceils)
  const roundedLakhs = Math.round(lakhs * 100) / 100; // Round to 2 decimal places

  // Format with Indian locale
  return `₹${roundedLakhs.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} L`;
}

/**
 * Converts a value to lakhs and returns just the numeric string (e.g., "2.50")
 * Intended for CSV/spreadsheet exports where raw numbers are needed
 */
export const formatToLakhsNumber = (amount: number | string | undefined): string => {
  const value = parseNumber(amount);

  if (isNaN(value)) return "";
  if (value === 0) return "0.00";

  const lakhs = value / 100000;
  const roundedLakhs = Math.round(lakhs * 100) / 100;

  return roundedLakhs.toFixed(2);
}

export default formatToIndianRupee;