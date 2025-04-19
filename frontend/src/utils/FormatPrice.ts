import { parseNumber } from "./parseNumber";

function formatToIndianRupee(price : number | string | undefined) {
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


export const formatToRoundedIndianRupee = (price : number | string | undefined) => {
  // Ensure the price is a number before formatting
  const amount = parseNumber(price);

  if (isNaN(amount)) {
    return "--";
  }

  // Convert the number to Indian currency format
  return `₹${Math.ceil(amount).toLocaleString('en-IN')}`;
}

export default formatToIndianRupee;