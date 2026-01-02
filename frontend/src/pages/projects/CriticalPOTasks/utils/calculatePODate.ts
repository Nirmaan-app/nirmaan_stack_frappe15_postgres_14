/**
 * Calculate PO Release Date by adding offset days to project start date
 * @param projectStartDate - ISO date string (YYYY-MM-DD)
 * @param offsetDays - Number of days to add
 * @returns ISO date string (YYYY-MM-DD)
 */
export const calculatePOReleaseDate = (
  projectStartDate: string,
  offsetDays: number
): string => {
  const startDate = new Date(projectStartDate);
  startDate.setDate(startDate.getDate() + offsetDays);
  return startDate.toISOString().split('T')[0]; // Format: YYYY-MM-DD
};

/**
 * Validate if project start date is valid
 * @param projectStartDate - Date string
 * @returns boolean
 */
export const isValidProjectStartDate = (projectStartDate?: string | null): boolean => {
  if (!projectStartDate) return false;
  const date = new Date(projectStartDate);
  return !isNaN(date.getTime());
};
