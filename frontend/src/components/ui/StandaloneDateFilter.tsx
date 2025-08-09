// frontend/src/components/ui/StandaloneDateFilter.tsx
import React, { useState, useMemo, useEffect } from 'react';
import { CalendarIcon } from 'lucide-react';
import { DateRange } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { datePresets, DatePreset } from '../../utils/datePresents'; // Corrected path
import { format } from 'date-fns';

interface StandaloneDateFilterProps {
  value?: DateRange;
  onClear: () => void;
  onChange: (value?: DateRange) => void;
  className?: string;
}

export function StandaloneDateFilter({ value, onChange,onClear, className }: StandaloneDateFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  // Temporary state for the calendar while the popover is open
  const [tempDate, setTempDate] = useState<DateRange | undefined>(value);

  // Sync temp state when the popover opens
  useEffect(() => {
    if (isOpen) {
      setTempDate(value);
    }
  }, [isOpen, value]);

  const selectedPresetLabel = useMemo(() => {
    if (!value?.from || !value?.to) return null;
    const fromStr = format(value.from, 'yyyy-MM-dd');
    const toStr = format(value.to, 'yyyy-MM-dd');
    for (const preset of datePresets) {
      const range = preset.getRange();
      if (format(range.from!, 'yyyy-MM-dd') === fromStr && format(range.to!, 'yyyy-MM-dd') === toStr) {
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

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
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
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={tempDate?.from}
              selected={tempDate}
              onSelect={setTempDate} // Update temporary state
              numberOfMonths={2}
            />
            <div className="p-2 border-t flex justify-between">
                <Button variant="ghost" onClick={handleClear}>Clear</Button>
                <Button onClick={handleApply} disabled={!tempDate?.from || !tempDate?.to}>Apply</Button>
            </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}