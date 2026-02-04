/**
 * Safely parse JSON that may be a string or already parsed object
 */
export const safeJsonParse = <T>(
  jsonString: string | T | undefined | null,
  defaultValue: T
): T => {
  if (jsonString === null || jsonString === undefined) {
    return defaultValue;
  }
  if (typeof jsonString === 'string') {
    try {
      return JSON.parse(jsonString) as T;
    } catch (error) {
      console.error('Failed to parse JSON:', error);
      return defaultValue;
    }
  }
  return jsonString as T;
};

/**
 * Parse category_list field from Frappe - handles both string and object
 * Returns the unwrapped list array, not the wrapper object
 */
export const parseCategoryList = <T = { name: string; status?: string; makes?: string[] }>(
  categoryList: string | { list: T[] } | undefined | null
): T[] => {
  const parsed = safeJsonParse(categoryList, { list: [] as T[] });
  return parsed?.list || [];
};
