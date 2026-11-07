/**
 * The pill a `PillBar` shows, kept in its own URL param: read on load, written on a click, followed on back/forward.
 * A value that is not a pill falls back to `fallback`.
 */
import { useEffect, useState } from "react";

import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { urlStateManager } from "@/utils/urlStateManager";

export const useUrlPill = <K extends string>(param: string, isKey: (value: string) => value is K, fallback: K) => {
    const [initial] = useState<K>(() => {
        const fromUrl = getUrlStringParam(param, fallback);
        return isKey(fromUrl) ? fromUrl : fallback;
    });
    const [pill, setPill] = useState<K>(initial);

    useEffect(() => {
        if (urlStateManager.getParam(param) !== pill) {
            urlStateManager.updateParam(param, pill);
        }
    }, [param, pill]);

    useEffect(() => {
        return urlStateManager.subscribe(param, (_, value) => {
            setPill(value && isKey(value) ? value : initial);
        });
    }, [param, isKey, initial]);

    return [pill, setPill] as const;
};
