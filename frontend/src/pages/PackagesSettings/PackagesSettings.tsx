import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { urlStateManager } from "@/utils/urlStateManager";
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  PACKAGE_SETTINGS_TABS,
  PACKAGE_SETTINGS_TAB_OPTIONS,
  PACKAGE_SETTINGS_TAB_VALUES,
  PackageSettingsTabValue,
} from "./config/packageSettingsTabs.constants";

export const PackagesSettings: React.FC = () => {
  const defaultTab = PACKAGE_SETTINGS_TABS.MILESTONE_PACKAGES;

  const initialTab = useMemo(() => {
    const urlTab = getUrlStringParam("tab", defaultTab);
    return PACKAGE_SETTINGS_TAB_VALUES.has(urlTab as PackageSettingsTabValue)
      ? (urlTab as PackageSettingsTabValue)
      : defaultTab;
  }, [defaultTab]);

  const [tab, setTab] = useState<PackageSettingsTabValue>(initialTab);

  useEffect(() => {
    if (urlStateManager.getParam("tab") !== tab) {
      urlStateManager.updateParam("tab", tab);
    }
  }, [tab]);

  useEffect(() => {
    const unsubscribe = urlStateManager.subscribe("tab", (_, value) => {
      const nextTab = PACKAGE_SETTINGS_TAB_VALUES.has(value as PackageSettingsTabValue)
        ? (value as PackageSettingsTabValue)
        : defaultTab;

      setTab((previousTab) => (previousTab === nextTab ? previousTab : nextTab));
    });

    return unsubscribe;
  }, [defaultTab]);

  const handleTabClick = useCallback((value: PackageSettingsTabValue) => {
    if (tab !== value) {
      setTab(value);
    }
  }, [tab]);

  const activeTabComponent = useMemo(() => {
    return PACKAGE_SETTINGS_TAB_OPTIONS.find((option) => option.value === tab)?.component;
  }, [tab]);

  const ActiveTabComponent = activeTabComponent;

  return (
    <div className="flex-1 space-y-4">
      <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-thin">
        <div className="flex flex-nowrap sm:flex-wrap items-center gap-1.5 pb-1 sm:pb-0">
          {PACKAGE_SETTINGS_TAB_OPTIONS.map((option) => {
            const isActive = tab === option.value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleTabClick(option.value)}
                className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded transition-colors whitespace-nowrap ${
                  isActive
                    ? "bg-sky-500 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <Suspense fallback={<LoadingFallback />}>
        {ActiveTabComponent ? <ActiveTabComponent /> : null}
      </Suspense>
    </div>
  );
};
