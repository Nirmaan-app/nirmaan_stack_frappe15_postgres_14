/**
 * Get Tailwind CSS classes for status badge styling
 */
export const getStatusStyle = (status: string): string => {
  switch (status) {
    case "Released":
      return "bg-green-50 text-green-700 border border-green-200";
    case "Not Released":
      return "bg-red-50 text-red-700 border border-red-200";
    default:
      return "bg-gray-50 text-gray-600 border border-gray-200";
  }
};

/**
 * Get progress circle color based on completion percentage
 */
export const getProgressColor = (percentage: number): string => {
  if (percentage === 100) return "text-green-600";
  if (percentage >= 76) return "text-green-600";
  if (percentage >= 26) return "text-yellow-500";
  return "text-red-600";
};
