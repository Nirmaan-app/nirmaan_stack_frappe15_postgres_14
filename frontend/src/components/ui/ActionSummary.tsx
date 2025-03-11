import { BookOpenText, ListChecks, SendToBack } from "lucide-react"
import React from "react"

interface ActionSummaryProps {
  generateActionSummary: (actionType : string) => string | JSX.Element
}

export const ActionSummary : React.FC<ActionSummaryProps> = ({generateActionSummary}) => {
  return (
   <div className="bg-white shadow-md rounded-lg p-4 border border-gray-200">
        <h2 className="text-lg font-bold mb-3 flex items-center">
            <BookOpenText className="h-5 w-5 text-blue-500 mr-2" />
            Actions Summary
        </h2>
        <div className="grid md:grid-cols-2 gap-4">
            {/* Send Back Action Summary */}
            <div className="p-3 border border-gray-300 rounded-lg bg-gray-50">
                <div className="flex items-center mb-2">
                    <SendToBack className="h-5 w-5 text-red-500 mr-2" />
                    <h3 className="font-medium text-gray-700">Send Back</h3>
                </div>
                <p className="text-sm text-gray-600">{generateActionSummary("sendBack")}</p>
            </div>
            {/* Approve Action Summary */}
            <div className="p-3 border border-gray-300 rounded-lg bg-gray-50">
                <div className="flex items-center mb-2">
                    <ListChecks className="h-5 w-5 text-green-500 mr-2" />
                    <h3 className="font-medium text-gray-700">Approve</h3>
                </div>
                <p className="text-sm text-gray-600">{generateActionSummary("approve")}</p>
            </div>
        </div>
    </div>
  )
}