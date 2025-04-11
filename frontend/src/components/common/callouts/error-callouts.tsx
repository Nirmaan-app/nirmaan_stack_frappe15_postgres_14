import { AlertTriangle } from 'lucide-react';
import { FC, PropsWithChildren } from "react";
import { CustomCallout } from "./custom-callout";


export const ErrorCallout = ({ children, ...props }: PropsWithChildren<{ message?: string }>) => {
    return (<CustomCallout
        rootProps={{ color: "red" }}
        iconChildren={<AlertTriangle size={18} />}
        textChildren={children || props.message || "An error occurred"}
    />)
}

interface CalloutProps {
  title: string;
  description: string;
}

export const CustomCallout2: FC<CalloutProps> = ({ title, description }) => (
  <div className="p-4 bg-blue-50 border border-blue-200 rounded-md">
    <h2 className="text-lg font-semibold text-blue-800">{title}</h2>
    <p className="text-blue-700 mt-2">{description}</p>
  </div>
);

export const ErrorCallout2: FC<CalloutProps> = ({ title, description }) => (
  <div className="p-4 bg-red-50 border border-red-200 rounded-md">
    <h2 className="text-lg font-semibold text-red-800">{title}</h2>
    <p className="text-red-700 mt-2">{description}</p>
  </div>
);
