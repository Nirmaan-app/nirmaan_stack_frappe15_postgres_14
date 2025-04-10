// src/hooks/useSearchParamsManager.ts
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export const useSearchParamsManager = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const updateParams = useCallback(
    (params: Record<string, string>, removeParams: string[] = []) => {
      const newParams = new URLSearchParams(searchParams);
      
      // Set new parameters
      Object.entries(params).forEach(([key, value]) => {
        newParams.set(key, value);
      });

      // Remove specified parameters
      removeParams.forEach(key => {
        newParams.delete(key);
      });

      setSearchParams(newParams);
    },
    [searchParams, setSearchParams]
  );

  const getParam = useCallback(
    (key: string) => searchParams.get(key),
    [searchParams]
  );

  return {
    updateParams,
    getParam,
    searchParams
  };
};

// Hook for syncing state with URL parameters
export const useStateSyncedWithParams = <T extends string = string>(
  paramKey: string,
  defaultValue: T | ""
) => {
  const { getParam, updateParams, searchParams } = useSearchParamsManager();
  const [state, setState] = useState<T | "">(getParam(paramKey) as T || defaultValue);

  // Add effect to sync state with URL changes
  useEffect(() => {
    const currentValue: string | null = getParam(paramKey);
    if (currentValue !== state) {
      setState(currentValue as T || defaultValue);
    }
  }, [searchParams, paramKey, getParam, state, defaultValue]);


  const setSyncedState = useCallback(
    (value: T | "", removeParams: string[] = []) => {
      setState(value);
      updateParams({ [paramKey]: value }, removeParams);
    },
    [updateParams, paramKey]
  );

  return [state, setSyncedState] as const;
};