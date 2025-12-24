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


export const formatToRoundedIndianRupee = (price: number | string | undefined) => {
  // Ensure the price is a number before formatting
  const amount = parseNumber(price);

  if (isNaN(amount)) {
    return "--";
  }

  // Convert the number to Indian currency format
  return `₹${Math.ceil(amount).toLocaleString('en-IN')}`;
}

export const formatForReport = (price: number | string | undefined) => {
  // Ensure the price is a number before formatting
  const amount = parseNumber(price);

  if (isNaN(amount)) {
    return "--";
  }

  // Convert the number to Indian currency format
  return Math.ceil(amount);
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

export default formatToIndianRupee;