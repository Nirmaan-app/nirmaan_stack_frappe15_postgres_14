import React from 'react';
import { cn } from '@/lib/utils';
import { ProgressCircle } from '@/components/ui/ProgressCircle';
import { getColorForProgress } from '../utils/milestoneHelpers';

interface MilestoneProgressProps {
  milestoneStatus: 'Not Applicable' | 'In Progress' | 'Completed' | string;
  value: number | string;
  sizeClassName?: string;
  textSizeClassName?: string;
}

export const MilestoneProgress: React.FC<MilestoneProgressProps> = ({
  milestoneStatus,
  value,
  sizeClassName = "size-[60px]",
  textSizeClassName = "text-md"
}) => {
  // Handle N/A status
  if (milestoneStatus === "Not Applicable" || value === "N/A") {
    return (
      <div
        className={cn(
          "relative inline-flex items-center justify-center",
          "text-gray-500 font-semibold",
          sizeClassName,
          textSizeClassName
        )}
      >
        N/A
      </div>
    );
  }

  const numericValue = typeof value === 'string' ? parseFloat(value) : value;
  const colorClass = getColorForProgress(numericValue);

  return (
    <ProgressCircle
      value={numericValue}
      className={cn(sizeClassName, colorClass)}
      textSizeClassName={textSizeClassName}
    />
  );
};

export default MilestoneProgress;
