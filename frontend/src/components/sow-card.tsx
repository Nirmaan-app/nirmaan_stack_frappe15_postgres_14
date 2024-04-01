//import React, {useState, useEffect} from "react"

import { useFrappeGetDocList } from "frappe-react-sdk"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { PersonStanding } from "lucide-react"

interface SOWCardProps {
    sow_id: string
    sow_name: string
}

interface Milestones {
    name: string
    milestone_name: string
}


export const SOWCard: React.FC<SOWCardProps> = ({ sow_id, sow_name }) => {

    const { data: data, isLoading: isLoading, error: error } = useFrappeGetDocList<Milestones>("Milestones", {
        fields: ["name", "milestone_name"],
        filters: [["scope_of_work", "=", sow_id]]
    })

    return (
        <Card className="hover:animate-shadow-drop-center" >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                    {sow_name}
                </CardTitle>
                <PersonStanding className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div>
                    {(isLoading) && (<p>Loading</p>)}
                    {error && <p>Error</p>}
                    {(data || []).map(d =>
                        <p className="text-xs text-muted-foreground">{d.milestone_name}</p>
                    )}
                </div>
                {/* <p className="text-xs text-muted-foreground">COUNT</p> */}
            </CardContent>
        </Card>

    )
}