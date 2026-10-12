import { useFrappeGetDocList } from "frappe-react-sdk";

interface DepartmentRow {
  name: string;
  is_active: 0 | 1;
}

/** SWR keys of the department list, so the Departments tab can refresh every picker after a change. */
export const DEPARTMENT_LIST_KEYS = {
  active: "nirmaan_department_options_active",
  all: "nirmaan_department_options_all",
} as const;

/**
 * The departments (`Nirmaan Department`), sorted by name. Pickers use the active ones only -- a
 * switched-off department can't be given to anyone new. Filters pass `includeInactive`, so old
 * records with a switched-off department can still be found.
 */
export function useDepartmentOptions(enabled = true, { includeInactive = false }: { includeInactive?: boolean } = {}) {
  const { data, isLoading, mutate } = useFrappeGetDocList<DepartmentRow>(
    "Nirmaan Department",
    {
      fields: ["name", "is_active"],
      filters: includeInactive ? [] : [["is_active", "=", 1]],
      orderBy: { field: "name", order: "asc" },
      limit: 0,
    },
    enabled ? (includeInactive ? DEPARTMENT_LIST_KEYS.all : DEPARTMENT_LIST_KEYS.active) : null
  );

  return { departments: (data ?? []).map((row) => row.name), isLoading, refresh: mutate };
}
