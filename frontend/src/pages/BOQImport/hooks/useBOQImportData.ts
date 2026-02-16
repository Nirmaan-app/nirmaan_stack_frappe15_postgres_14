import { useFrappeGetDocList } from 'frappe-react-sdk';
import { useMemo } from 'react';
import type { SelectOption } from '../schema';

/** Fetch work packages for the dropdown */
export function useWorkPackages() {
  const { data, isLoading } = useFrappeGetDocList('Work Packages', {
    fields: ['work_package_name'],
    orderBy: { field: 'work_package_name', order: 'asc' },
    limit: 1000,
  });

  const options: SelectOption[] = useMemo(
    () =>
      data?.map((wp: any) => ({
        value: wp.work_package_name,
        label: wp.work_package_name,
      })) || [],
    [data]
  );

  return { options, isLoading };
}
