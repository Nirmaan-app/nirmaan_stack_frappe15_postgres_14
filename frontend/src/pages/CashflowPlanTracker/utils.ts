/**
 * Get progress color based on percentage
 */
export const getProgressColor = (progress: number): string => {
  if (progress >= 80) return "text-green-600";
  if (progress >= 50) return "text-yellow-600";
  if (progress >= 25) return "text-orange-500";
  return "text-red-500";
};

/**
 * Get background color for progress
 */
export const getProgressBgColor = (progress: number): string => {
  if (progress >= 80) return "bg-green-50";
  if (progress >= 50) return "bg-yellow-50";
  if (progress >= 25) return "bg-orange-50";
  return "bg-red-50";
};
