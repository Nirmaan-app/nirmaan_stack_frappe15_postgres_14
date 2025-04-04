function formatToIndianRupee(price : number | string | undefined) {
  // Ensure the price is a number before formatting
  const amount = parseFloat(price);

  if (isNaN(amount)) {
    return "--";
  }

  // Convert the number to Indian currency format
  return `₹${Math.round(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export default formatToIndianRupee;