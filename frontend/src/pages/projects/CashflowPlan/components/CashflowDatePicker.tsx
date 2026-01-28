import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { useState } from "react";

interface CashflowDatePickerProps {
    date: Date | undefined;
    setDate: (date: Date | undefined) => void;
    label?: string;
    required?: boolean;
    disabled?: boolean;
    className?: string; // For container styling
}

export const CashflowDatePicker = ({
    date,
    setDate,
    label,
    required = false,
    disabled = false,
    className
}: CashflowDatePickerProps) => {
    const [isOpen, setIsOpen] = useState(false);

    const handleSelect = (newDate: Date | undefined) => {
        setDate(newDate);
        setIsOpen(false); // Auto-close on selection
    };

    return (
        <div className={cn("space-y-2", className)}>
            {label && (
                <Label className="text-sm font-medium text-gray-700">
                    {label} {required && <span className="text-red-500">*</span>}
                </Label>
            )}
            <Popover open={isOpen} onOpenChange={setIsOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        className={cn(
                            "w-full pl-3 text-left font-normal",
                            !date && "text-muted-foreground"
                        )}
                        disabled={disabled}
                    >
                        {date ? format(date, "dd/MM/yyyy") : <span>dd/mm/yyyy</span>}
                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                        mode="single"
                        selected={date}
                        onSelect={handleSelect}
                        disabled={(date) => {
                            // Disable past dates (before today)
                            // "today" is valid.
                            const today = new Date();
                            today.setHours(0, 0, 0, 0);
                            return date < today;
                        }}
                        initialFocus
                    />
                </PopoverContent>
            </Popover>
        </div>
    );
};
