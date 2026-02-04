// frontend/src/components/ui/StandaloneDateFilter.tsx
import { useState, useMemo } from 'react';
import { CalendarIcon } from 'lucide-react';
import { DateRange } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { datePresets, DatePreset } from '../../utils/datePresents'; // Corrected path
import { format } from 'date-fns';
import { formatDate } from "@/utils/FormatDate";


interface StandaloneDateFilterProps {
  value?: DateRange;
  onClear: () => void;
  onChange: (value?: DateRange) => void;
  className?: string;
}

export function StandaloneDateFilter({ value, onChange, onClear, className }: StandaloneDateFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  // Temporary state for the calendar while the popover is open
  const [tempDate, setTempDate] = useState<DateRange | undefined>(value);

  // Sync temp state when the popover opens
  const handleOpenChange = (open: boolean) => {
    if (open) {
      setTempDate(value);
    }
    setIsOpen(open);
  };

  const selectedPresetLabel = useMemo(() => {
    // If value is undefined, check if it matches the "ALL" preset (which returns undefined)
    if (!value?.from || !value?.to) {
      // Find a preset that returns undefined (like "ALL")
      const allPreset = datePresets.find(preset => preset.getRange() === undefined);
      if (!value && allPreset) {
        return allPreset.label;
      }
      return null;
    }
    const fromStr = format(value.from, 'yyyy-MM-dd');
    const toStr = format(value.to, 'yyyy-MM-dd');
    for (const preset of datePresets) {
      const range = preset.getRange();
      // Skip presets that return undefined (like "ALL")
      if (!range?.from || !range?.to) continue;
      if (format(range.from, 'yyyy-MM-dd') === fromStr && format(range.to, 'yyyy-MM-dd') === toStr) {
        return preset.label;
      }
    }
    return null;
  }, [value]);

  const handlePresetClick = (preset: DatePreset) => {
    onChange(preset.getRange());
    setIsOpen(false);
  };

  const handleApply = () => {
    onChange(tempDate);
    setIsOpen(false);
  };

  const handleClear = () => {
    onClear();
    setIsOpen(false);
  }

  // NEW: Function to clear only the temporary date state
  const handleTempClear = () => {
    setTempDate(undefined); // Clear the dates in the calendar view
    onChange(undefined); // Notify parent about the clear action
    //  setIsOpen(false);
  }

  const formatTempDate = (dateRange?: DateRange) => {
    if (!dateRange?.from) return 'No selection';
    
    return dateRange.to
      ? `${formatDate(dateRange.from)} - ${formatDate(dateRange.to)}`
      : formatDate(dateRange.from);
  }

  return (
    <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
      <div className="whitespace-nowrap text-sm font-medium">Selected Date Range:</div>
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn('w-[280px] justify-start text-left font-normal', !value && 'text-muted-foreground', className)}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {selectedPresetLabel ? (
              <span>{selectedPresetLabel}</span>
            ) : value?.from ? (
              value.to ? (
                <>
                  {format(value.from, 'LLL dd, y')} - {format(value.to, 'LLL dd, y')}
                </>
              ) : (
                format(value.from, 'LLL dd, y')
              )
            ) : (
              <span>Pick a date range</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 flex" align="start">
          
          <div className="flex flex-col space-y-2 border-r p-2">
            {datePresets.map((preset) => (
              <Button
                key={preset.label}
                variant="ghost"
                className="justify-start"
                onClick={() => handlePresetClick(preset)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-col">
             <div className="flex justify-between items-center p-3 border-b">
            <span className="text-sm font-semibold">
              Range: {formatTempDate(tempDate)}
            </span>
            <Button 
                variant="outline" 
                size="sm" 
                onClick={handleTempClear} 
                disabled={!tempDate?.from && !tempDate?.to}
            >
                Clear
            </Button>
          </div>
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={tempDate?.from}
              selected={tempDate}
              onSelect={setTempDate} // Update temporary state
              numberOfMonths={2}
            />
            <div className="p-2 border-t flex justify-end space-x-2">
              <Button variant="outline" onClick={handleClear}>Reset</Button>
              <Button onClick={handleApply} disabled={!tempDate?.from || !tempDate?.to}>Apply</Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}