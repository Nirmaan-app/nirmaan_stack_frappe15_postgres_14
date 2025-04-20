// src/hooks/usePersistentState.ts
import { useState, useEffect, Dispatch, SetStateAction } from 'react';

// Improved typing
type SetValue<T> = Dispatch<SetStateAction<T>>;

export function usePersistentState<T>(key: string, defaultValue: T): [T, SetValue<T>] {
    const [state, setState] = useState<T>(() => {
        try {
            const storedValue = localStorage.getItem(key);
            // Check if stored value exists and is not 'undefined' string
            if (storedValue && storedValue !== 'undefined') {
                return JSON.parse(storedValue) as T;
            }
            return defaultValue;
        } catch (error) {
            console.error(`Error reading localStorage key “${key}”:`, error);
            return defaultValue;
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem(key, JSON.stringify(state));
        } catch (error) {
            console.error(`Error setting localStorage key “${key}”:`, error);
        }
    }, [key, state]);

    return [state, setState];
}