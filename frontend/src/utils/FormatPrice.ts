function formatToIndianRupee(price) {
    // Ensure the price is a number before formatting
    const amount = parseFloat(price);
  
    if (isNaN(amount)) {
      return "--";
    }
  
    // Convert the number to Indian currency format
    return `₹${amount.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  
  export default formatToIndianRupee;