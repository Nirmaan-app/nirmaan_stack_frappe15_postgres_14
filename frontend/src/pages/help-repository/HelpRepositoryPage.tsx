import React, { useState } from "react";
import { useUserData } from "@/hooks/useUserData";
import { HelpViewTab } from "./components/HelpViewTab";
import { HelpManageTab } from "./components/HelpManageTab";

const TABS = [
    { key: "view", label: "View" },
    { key: "manage", label: "Manage" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export const HelpRepositoryPage: React.FC = () => {
    const { role, user_id } = useUserData();
    const canManage =
        ["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile"].includes(role) ||
        user_id === "Administrator";

    const [tab, setTab] = useState<TabKey>("view");

    return (
        <div className="flex-1 space-y-4 p-4 md:p-6">
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold tracking-tight text-gray-800">
                    Help Repository
                </h2>

                {canManage && (
                    <div className="flex gap-1 bg-gray-50 p-0.5 rounded-lg">
                        {TABS.map((t) => (
                            <button
                                key={t.key}
                                onClick={() => setTab(t.key)}
                                className={`px-3 py-1.5 text-sm rounded transition-colors ${
                                    tab === t.key
                                        ? "bg-sky-500 text-white"
                                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                }`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {tab === "view" || !canManage ? <HelpViewTab /> : <HelpManageTab />}
        </div>
    );
};

export default HelpRepositoryPage;
